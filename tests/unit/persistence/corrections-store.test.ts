// Spec #68 / issue #71 — seam 2: the corrections store against the in-memory
// database. Observed through the store's public interface and what the
// library holds afterwards: preview writes nothing; apply is one atomic
// transaction that refuses a stale preview, writes the corrections list
// (never the article row — ADR 0014), re-anchors highlight positions and the
// reading position by quote, and keeps finished finished; deleting an
// article deletes its corrections.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import {
  deriveQuoteSelector,
  mainTextLength,
  normalizeText,
} from "../../../src/content/normalizeText";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";
import { textStamp } from "../../../src/content/sameText";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });

const saved = ArticleSchema.parse({
  id: "harbour-essay",
  revision: 2,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour",
    title: "The harbour",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash",
  },
  blocks: [
    para("The ferry leaves at dawn, before the fog lifts."),
    para("Share this article"),
    para("Gulls follow it out past the breakwater and back."),
    para("Sign up for our newsletter"),
  ],
});

function highlight(id: string, exact: string) {
  const text = normalizeText(saved);
  const at = text.indexOf(exact);
  const start = [...text.slice(0, at)].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1 as const,
    id,
    articleId: saved.id,
    revision: 2,
    position,
    quote: deriveQuoteSelector(saved, position),
    createdAt: "2026-01-02T00:00:00Z",
  };
}

const gulls = highlight("h-gulls", "past the breakwater");

function hideOf(path: number[], corrections: Correction[] = []): Correction {
  const result = applyCorrections(saved, corrections);
  const block = result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;
  return blockCorrection("hide", result, block, {
    id: `hide-${path.join(".")}`,
    createdAt: "2026-11-27T10:00:00.000Z",
  })!;
}

async function seed() {
  const { db } = await import("../../../src/persistence/db");
  await db.articles.put(saved);
  await db.highlights.put(gulls);
  return db;
}

async function store() {
  return import("../../../src/persistence/correctionsStore");
}

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("previewing a correction", () => {
  it("writes nothing and shows the proposed corrected article", async () => {
    const db = await seed();
    const { previewAddCorrection } = await store();
    const before = JSON.stringify(await db.highlights.toArray());
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    expect(normalizeText(preview.proposed)).not.toContain("Share this article");
    expect(preview.outcomes).toEqual([{ status: "applied" }]);
    expect(preview.highlights).toEqual([
      { highlightId: "h-gulls", exact: "past the breakwater", outcome: "confident" },
    ]);
    expect(preview.clean).toBe(true);
    expect(await db.corrections.count()).toBe(0);
    expect(JSON.stringify(await db.highlights.toArray())).toBe(before);
  });
});

describe("applying a correction", () => {
  it("writes the corrections list and never the article row", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange, loadCorrections } = await store();
    const hide = hideOf([1]);
    await applyCorrectionsChange(await previewAddCorrection(saved.id, hide));
    expect(await loadCorrections(saved.id)).toEqual([hide]);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("re-anchors highlight positions by quote onto the corrected text", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    await applyCorrectionsChange(preview);
    const row = await db.highlights.get("h-gulls");
    const text = normalizeText(preview.proposed);
    const start = [...text.slice(0, text.indexOf("past the breakwater"))].length;
    expect(row!.position).toEqual({ start, end: start + [..."past the breakwater"].length });
    expect(row!.quote).toEqual(gulls.quote);
    expect(row!.revision).toBe(2);
    expect(row!.corrections).toMatch(/^c/);
  });

  it("re-anchors the reading position to the same words", async () => {
    const db = await seed();
    const text = normalizeText(saved);
    const offset = [...text.slice(0, text.indexOf("Gulls follow"))].length;
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: offset,
      savedAt: "2026-11-01T00:00:00.000Z",
    });
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    await applyCorrectionsChange(preview);
    const rows = await db.location.toArray();
    const corrected = normalizeText(preview.proposed);
    expect(rows).toEqual([
      {
        schemaVersion: 1,
        articleId: saved.id,
        revision: 2,
        graphemeOffset: [...corrected.slice(0, corrected.indexOf("Gulls follow"))].length,
        savedAt: "2026-11-01T00:00:00.000Z",
        corrections: expect.stringMatching(/^c/),
      },
    ]);
  });

  it("moves a position inside a newly hidden block to the next passage still read", async () => {
    const db = await seed();
    const text = normalizeText(saved);
    const offset = [...text.slice(0, text.indexOf("this article"))].length;
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: offset,
      savedAt: "2026-11-01T00:00:00.000Z",
    });
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    await applyCorrectionsChange(preview);
    const corrected = normalizeText(preview.proposed);
    expect((await db.location.toArray())[0]!.graphemeOffset).toBe(
      [...corrected.slice(0, corrected.indexOf("Gulls follow"))].length,
    );
  });

  it("keeps a finished article finished at the corrected end of the main text", async () => {
    const db = await seed();
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: mainTextLength(saved),
      savedAt: "2026-11-01T00:00:00.000Z",
    });
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    // Hide the trailing chrome: the main text now ends earlier.
    const preview = await previewAddCorrection(saved.id, hideOf([3]));
    await applyCorrectionsChange(preview);
    const end = mainTextLength(preview.proposed);
    expect(end).toBeLessThan(mainTextLength(saved));
    expect((await db.location.toArray())[0]!.graphemeOffset).toBe(end);
  });

  it("unhide restores the original substrate exactly", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange, previewCorrectionsChange } = await store();
    const hide = hideOf([1]);
    await applyCorrectionsChange(await previewAddCorrection(saved.id, hide));
    const result = applyCorrections(saved, [hide]);
    const block = result.view.blocks[1]!;
    const unhide = blockCorrection("unhide", result, block, {
      id: "unhide-1",
      createdAt: "2026-11-27T10:01:00.000Z",
    })!;
    const preview = await previewCorrectionsChange(saved.id, [hide, unhide]);
    // Back to the original substrate: no corrections fingerprint at all.
    expect(textStamp(preview.proposed)).toEqual({ revision: 2 });
    expect(normalizeText(preview.proposed)).toBe(normalizeText(saved));
    await applyCorrectionsChange(preview);
    const row = await db.highlights.get("h-gulls");
    expect(row!.position).toEqual(gulls.position);
    expect("corrections" in row!).toBe(false);
  });

  it("refuses a preview made against an older state and changes nothing", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange, STALE_PREVIEW } = await store();
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    // The reader keeps reading in another tab.
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: 5,
      savedAt: "2026-11-02T00:00:00.000Z",
    });
    await expect(applyCorrectionsChange(preview)).rejects.toThrow(STALE_PREVIEW);
    expect(await db.corrections.count()).toBe(0);
    expect((await db.highlights.get("h-gulls"))!.position).toEqual(gulls.position);
  });

  it("is atomic: a failed write leaves corrections, highlights and position as they were", async () => {
    const db = await seed();
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: 60,
      savedAt: "2026-11-01T00:00:00.000Z",
    });
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    const preview = await previewAddCorrection(saved.id, hideOf([1]));
    const put = db.location.put.bind(db.location);
    db.location.put = (() => Promise.reject(new Error("disk full"))) as typeof db.location.put;
    try {
      await expect(applyCorrectionsChange(preview)).rejects.toThrow();
    } finally {
      db.location.put = put;
    }
    expect(await db.corrections.count()).toBe(0);
    expect((await db.highlights.get("h-gulls"))!.position).toEqual(gulls.position);
    expect((await db.location.toArray())[0]!.graphemeOffset).toBe(60);
  });

  it("refuses an article with no library row (a bundled fixture)", async () => {
    const { previewAddCorrection, NOT_CORRECTABLE } = await store();
    await expect(previewAddCorrection("not-in-library", hideOf([1]))).rejects.toThrow(
      NOT_CORRECTABLE,
    );
  });
});

describe("deleting an article", () => {
  it("deletes its corrections too", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    await applyCorrectionsChange(await previewAddCorrection(saved.id, hideOf([1])));
    expect(await db.corrections.count()).toBe(1);
    const { DexieLibrarySource } = await import("../../../src/ingestion/LibrarySource");
    await new DexieLibrarySource().remove(saved.id);
    expect(await db.corrections.count()).toBe(0);
  });

  it("deletes every chapter's corrections when a book is removed", async () => {
    const { db } = await import("../../../src/persistence/db");
    const { BookSchema } = await import("../../../src/content/schema");
    const chapterId = "epub-abc123def456-c00";
    await db.books.put(
      BookSchema.parse({
        id: "epub-abc123def456",
        title: "A Book",
        authors: [],
        language: "en",
        chapterArticleIds: [chapterId],
        skippedChapterCount: 0,
        source: "epub-upload",
        originalFileHash: "sha256:" + "b".repeat(64),
        addedAt: "2026-08-18T00:00:00.000Z",
      }),
    );
    await db.articles.put({ ...saved, id: chapterId });
    await db.corrections.put({
      schemaVersion: 1,
      articleId: chapterId,
      corrections: [],
      updatedAt: "2026-11-27T00:00:00.000Z",
    });
    const { removeBook } = await import("../../../src/persistence/booksStore");
    await removeBook("epub-abc123def456");
    expect(await db.corrections.count()).toBe(0);
  });
});

describe("reading the corrections list", () => {
  it("reads a corrupt row as no corrections (the original), never coerced", async () => {
    const db = await seed();
    await db.corrections.put({ articleId: saved.id, schemaVersion: 99, corrections: "nope" });
    const { loadCorrections, loadAllCorrections } = await store();
    expect(await loadCorrections(saved.id)).toEqual([]);
    expect((await loadAllCorrections()).size).toBe(0);
  });
});
