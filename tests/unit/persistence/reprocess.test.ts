// Reprocessing (#63, spec #66 Seam 3): the library-level preview/apply
// operation against the in-memory database. Observed only through the
// operation's public interface plus what the library holds afterwards.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, type CanonicalArticle } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import type { IngestionSuccess } from "../../../src/ingestion/IngestionClient";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });

const KEPT = "Calm readers keep their place through long arguments.";
const EDITED_BEFORE = "The second claim was stated once, plainly, in the original.";
const EDITED_AFTER = "The second claim is now stated twice, with a new caveat.";
const REPEATED = "A repeated sentence.";

const saved = ArticleSchema.parse({
  id: "example-essay",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/essay",
    title: "An essay",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
  },
  blocks: [para(KEPT), para(EDITED_BEFORE), para(REPEATED)],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/essay",
    fetchedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
    extractionConfidence: "high",
  },
  tags: ["essays"],
  readerTitle: "My title",
  addedAt: "2026-01-01T00:00:00Z",
});

function candidate(overrides: Partial<CanonicalArticle> = {}): IngestionSuccess {
  const article = ArticleSchema.parse({
    ...saved,
    // A fresh ingest knows nothing of reader-owned fields.
    tags: undefined,
    readerTitle: undefined,
    addedAt: undefined,
    id: "example-essay-fresh-slug",
    provenance: {
      ...saved.provenance,
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "hash-now",
    },
    blocks: [para(KEPT), para(EDITED_AFTER), para(REPEATED), para(REPEATED)],
    ...overrides,
  });
  return { article, confidence: { state: "confident" }, assets: [] };
}

// Highlights are captured the way the reader captures them: a position in
// the saved revision plus the quote derived from it.
function highlight(id: string, exact: string, occurrence = 0) {
  const text = normalizeText(saved);
  let at = -1;
  for (let n = 0; n <= occurrence; n++) at = text.indexOf(exact, at + 1);
  const start = [...text.slice(0, at)].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1 as const,
    id,
    articleId: saved.id,
    revision: 1,
    position,
    quote: deriveQuoteSelector(saved, position),
    createdAt: "2026-01-02T00:00:00Z",
  };
}

const keptHighlight = highlight("h-kept", "keep their place");
const editedHighlight = highlight("h-edited", "stated once, plainly");
const repeatedHighlight = highlight("h-repeated", REPEATED);

async function seed() {
  const { db } = await import("../../../src/persistence/db");
  await db.articles.put(saved);
  await db.highlights.bulkPut([keptHighlight, editedHighlight, repeatedHighlight]);
  return db;
}

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("reprocessing a URL article", () => {
  it("previews a changed source, its changed passages, and every highlight's outcome without writing", async () => {
    const db = await seed();
    const { previewReprocess } = await import("../../../src/persistence/reprocessStore");

    const preview = await previewReprocess(saved.id, candidate());

    expect(preview.sourceChanged).toBe(true);
    expect(preview.changes).toEqual([
      { kind: "removed", text: EDITED_BEFORE },
      { kind: "added", text: EDITED_AFTER },
      { kind: "added", text: REPEATED },
    ]);
    expect(Object.fromEntries(preview.highlights.map((h) => [h.highlightId, h.outcome]))).toEqual({
      "h-kept": "confident",
      "h-edited": "orphan",
      "h-repeated": "ambiguous",
    });
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("applies the new revision and carries over position, annotations, tags, collections and completion", async () => {
    const db = await seed();
    const { previewReprocess, applyReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const { resolveQuoteSelector } = await import("../../../src/content/normalizeText");
    const keptOffset = normalizeText(saved).indexOf("Calm");
    const readingAt = keptOffset + "Calm readers ".length;
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 1,
      graphemeOffset: readingAt,
      savedAt: "2026-01-03T00:00:00Z",
    });
    const stamp = "2026-01-01T00:00:00Z";
    const wholeArticle = { kind: "article" as const, articleId: saved.id };
    const completion = {
      schemaVersion: 1 as const,
      targetKey: `article:${saved.id}`,
      target: wholeArticle,
      finished: true,
      source: "reader" as const,
      updatedAt: stamp,
    };
    const collection = {
      schemaVersion: 1 as const,
      id: "plan",
      name: "Plan",
      entries: [{ id: "e1", target: wholeArticle, addedAt: stamp }],
      createdAt: stamp,
      updatedAt: stamp,
    };
    const articleNote = await db.articleNotes.toArray();
    await db.completions.put(completion);
    await db.collections.put(collection);
    await db.assets.put({
      articleId: saved.id,
      assetId: "img-000000000000",
      contentType: "image/png",
      byteLength: 1,
      data: new Blob([new Uint8Array([1])]),
      createdAt: stamp,
    });

    const fresh = candidate();
    fresh.assets = [
      {
        assetId: "img-111111111111",
        contentType: "image/png",
        byteLength: 1,
        bytes: new Uint8Array([2]),
      },
    ] as typeof fresh.assets;
    await applyReprocess(await previewReprocess(saved.id, fresh));

    const after = ArticleSchema.parse(await db.articles.get(saved.id));
    expect(after.revision).toBe(2);
    expect(after.blocks).toEqual(fresh.article.blocks);
    expect(after.provenance.originalHtmlHash).toBe("hash-now");
    expect(after.tags).toEqual(["essays"]);
    expect(after.readerTitle).toBe("My title");
    expect(after.addedAt).toBe(saved.addedAt);
    expect(await db.articles.get(fresh.article.id)).toBeUndefined();
    // Position: re-anchored onto the same words in the new revision.
    const location = await db.location.get([saved.id, 2]);
    expect(location?.graphemeOffset).toBe(normalizeText(after).indexOf("keep their place"));
    expect(location?.savedAt).toBe("2026-01-03T00:00:00Z");
    // Highlights are not rewritten; they re-match by their stored quote.
    expect(await db.highlights.count()).toBe(3);
    expect(resolveQuoteSelector(after, keptHighlight.quote)).not.toBe("orphan");
    expect(resolveQuoteSelector(after, editedHighlight.quote, editedHighlight.position)).toBe(
      "orphan",
    );
    expect(await db.articleNotes.toArray()).toEqual(articleNote);
    expect(await db.completions.get(completion.targetKey)).toEqual(completion);
    expect(await db.collections.get(collection.id)).toEqual(collection);
    expect(
      (await db.assets.where("articleId").equals(saved.id).toArray()).map((a) => a.assetId),
    ).toEqual(["img-111111111111"]);
  });

  it("refuses a preview made against an older state and leaves everything unchanged", async () => {
    const db = await seed();
    const { previewReprocess, applyReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const preview = await previewReprocess(saved.id, candidate());
    await db.highlights.put(highlight("h-new", "long arguments"));
    await expect(applyReprocess(preview)).rejects.toThrow(/changed after the preview/);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("discloses an unchanged source and still offers the newly processed version", async () => {
    await seed();
    const { previewReprocess } = await import("../../../src/persistence/reprocessStore");
    const preview = await previewReprocess(
      saved.id,
      candidate({ provenance: { ...saved.provenance, retrievedAt: "2026-11-27T00:00:00Z" } }),
    );
    expect(preview.sourceChanged).toBe(false);
  });

  it("re-fetches the saved address, and an unreachable source fails with the article untouched", async () => {
    const db = await seed();
    const { previewUrlReprocess } = await import("../../../src/persistence/reprocessStore");
    const { IngestionError } = await import("../../../src/ingestion/IngestionClient");
    const fetched: string[] = [];
    const preview = await previewUrlReprocess(saved.id, async (url) => {
      fetched.push(url);
      return candidate();
    });
    expect(fetched).toEqual(["https://example.com/essay"]);
    expect(preview.proposed.revision).toBe(2);
    await expect(
      previewUrlReprocess(saved.id, async () => {
        throw new IngestionError("fetch-failed");
      }),
    ).rejects.toBeInstanceOf(IngestionError);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("requires explicit acceptance when a chapter target loses its meaning", async () => {
    const db = await seed();
    const { previewReprocess, applyReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const target = { kind: "work-chapter" as const, articleId: saved.id, destinationId: "ch-9.b" };
    const stamp = "2026-01-01T00:00:00Z";
    await db.collections.put({
      schemaVersion: 1,
      id: "chapters",
      name: "Chapters",
      entries: [{ id: "c1", target, addedAt: stamp }],
      createdAt: stamp,
      updatedAt: stamp,
    });
    const preview = await previewReprocess(saved.id, candidate());
    expect(preview.consequences.map((c) => c.kind)).toEqual(["collection-entry"]);
    await expect(applyReprocess(preview)).rejects.toThrow(/Explicit acceptance/);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
    await applyReprocess(preview, { acceptConsequences: true });
    expect((await db.collections.get("chapters"))!.entries).toEqual([]);
  });

  it("re-anchors a moved position, keeps a finished article finished, and discloses one it cannot match", async () => {
    const db = await seed();
    const { previewReprocess, applyReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const shifted = candidate({
      blocks: [para("A new opening passage."), para(KEPT), para(EDITED_AFTER), para(REPEATED)],
    });
    const at = (offset: number) => ({
      schemaVersion: 1 as const,
      articleId: saved.id,
      revision: 1,
      graphemeOffset: offset,
      savedAt: "2026-01-03T00:00:00Z",
    });
    const total = [...normalizeText(saved)].length;

    await db.location.put(at(normalizeText(saved).indexOf("keep")));
    const moved = await previewReprocess(saved.id, shifted);
    expect(moved.position).toEqual({
      kind: "kept",
      offset: normalizeText(moved.proposed).indexOf("keep"),
    });

    await db.location.put(at(total));
    const finished = await previewReprocess(saved.id, shifted);
    expect(finished.position).toEqual({
      kind: "kept",
      offset: [...normalizeText(finished.proposed)].length,
    });

    await db.location.put(at(normalizeText(saved).indexOf("once, plainly")));
    const lost = await previewReprocess(saved.id, shifted);
    expect(lost.position).toEqual({ kind: "unmatched" });
    await applyReprocess(lost);
    expect(await db.location.get([saved.id, 2])).toBeUndefined();
    expect(await db.location.get([saved.id, 1])).toBeDefined();
  });
});
