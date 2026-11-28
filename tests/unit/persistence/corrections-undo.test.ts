// Spec #68 / issue #76 — seam 2: undo one correction, redo, Restore original
// and its undo, through the corrections store against the in-memory
// database. Observed through the store's public interface and what the
// library holds afterwards.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, type BlockTypeChoice, type Correction } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import {
  applyCorrections,
  blockCorrection,
  correctedArticle,
} from "../../../src/content/corrections/engine";
import { describeCorrection } from "../../../src/content/corrections/describe";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });
const heading2 = (text: string) => ({
  kind: "heading" as const,
  level: 2 as const,
  content: [{ text, marks: [] }],
});

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

const work = ArticleSchema.parse({
  ...saved,
  id: "harbour-work",
  blocks: [
    heading2("Morning"),
    para("The ferry leaves at dawn, before the fog lifts."),
    heading2("Noon"),
    para("Gulls follow it out past the breakwater and back."),
    heading2("Evening"),
    para("The lamps come on along the quay."),
  ],
});

const STAMP = "2026-11-01T00:00:00.000Z";

function correctionOf(
  article: typeof saved,
  kind: "hide" | "unhide",
  path: number[],
  before: Correction[] = [],
  id = `${kind}-${path.join(".")}`,
): Correction {
  const result = applyCorrections(article, before);
  const block = result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;
  return blockCorrection(kind, result, block, { id, createdAt: "2026-11-27T10:00:00.000Z" })!;
}

function offsetOf(text: string, words: string) {
  return [...text.slice(0, text.indexOf(words))].length;
}

async function store() {
  return import("../../../src/persistence/correctionsStore");
}

async function seedArticle(article = saved) {
  const { db } = await import("../../../src/persistence/db");
  await db.articles.put(article);
  return db;
}

/** Apply a list of corrections one by one (each preview accepted). */
async function applyEach(articleId: string, corrections: Correction[]) {
  const { previewAddCorrection, applyCorrectionsChange } = await store();
  for (const c of corrections) {
    await applyCorrectionsChange(await previewAddCorrection(articleId, c), {
      acceptConsequences: true,
    });
  }
}

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("undoing one correction", () => {
  it("removes it and re-applies the rest", async () => {
    await seedArticle();
    const share = correctionOf(saved, "hide", [1]);
    const signup = correctionOf(saved, "hide", [3], [share]);
    await applyEach(saved.id, [share, signup]);
    const { previewUndoCorrection, applyCorrectionsChange, loadCorrections } = await store();
    const preview = await previewUndoCorrection(saved.id, share.id);
    expect(preview.clean).toBe(true);
    expect(preview.laterNotApplied).toEqual([]);
    await applyCorrectionsChange(preview);
    expect(await loadCorrections(saved.id)).toEqual([signup]);
    const text = normalizeText(correctedArticle(saved, [signup]));
    expect(text).toContain("Share this article");
    expect(text).not.toContain("Sign up");
  });

  it("names a later correction that depends on it as no longer fitting, before it applies", async () => {
    const db = await seedArticle();
    const share = correctionOf(saved, "hide", [1]);
    const signup = correctionOf(saved, "hide", [3], [share]);
    const unhideShare = correctionOf(saved, "unhide", [1], [share, signup]);
    await applyEach(saved.id, [share, signup, unhideShare]);
    const { previewUndoCorrection, applyCorrectionsChange, loadCorrections, ACCEPTANCE_REQUIRED } =
      await store();

    const preview = await previewUndoCorrection(saved.id, share.id);
    expect(preview.clean).toBe(false);
    expect(preview.laterNotApplied).toEqual([
      { correction: unhideShare, reason: "This block isn't hidden." },
    ]);
    // It needs the reader's acceptance, like any consequence.
    await expect(applyCorrectionsChange(preview)).rejects.toThrow(ACCEPTANCE_REQUIRED);
    expect(await db.corrections.count()).toBe(1);

    await applyCorrectionsChange(preview, { acceptConsequences: true });
    // Kept in the list, not applied — never dropped silently.
    expect(await loadCorrections(saved.id)).toEqual([signup, unhideShare]);
    expect(applyCorrections(saved, [signup, unhideShare]).outcomes).toEqual([
      { status: "applied" },
      { status: "not-applied", reason: "This block isn't hidden." },
    ]);
  });

  it("removing a not-applied correction changes nothing else", async () => {
    await seedArticle();
    const share = correctionOf(saved, "hide", [1]);
    const unhideShare = correctionOf(saved, "unhide", [1], [share]);
    await applyEach(saved.id, [share, unhideShare]);
    const { previewUndoCorrection, applyCorrectionsChange, loadCorrections } = await store();
    await applyCorrectionsChange(await previewUndoCorrection(saved.id, share.id), {
      acceptConsequences: true,
    });
    const tidy = await previewUndoCorrection(saved.id, unhideShare.id);
    expect(tidy.clean).toBe(true);
    expect(JSON.stringify(tidy.proposed)).toBe(JSON.stringify(saved));
    await applyCorrectionsChange(tidy);
    expect(await loadCorrections(saved.id)).toEqual([]);
  });

  it("re-anchors the reading position and highlights the way a correction does", async () => {
    const db = await seedArticle();
    const text = normalizeText(saved);
    const start = offsetOf(text, "past the breakwater");
    const position = { start, end: start + [..."past the breakwater"].length };
    await db.highlights.put({
      schemaVersion: 1,
      id: "h-gulls",
      articleId: saved.id,
      revision: 2,
      position,
      quote: deriveQuoteSelector(saved, position),
      createdAt: STAMP,
    });
    await db.location.put({
      schemaVersion: 1,
      articleId: saved.id,
      revision: 2,
      graphemeOffset: offsetOf(text, "Gulls follow"),
      savedAt: STAMP,
    });
    const share = correctionOf(saved, "hide", [1]);
    await applyEach(saved.id, [share]);
    expect((await db.location.toArray())[0]!.graphemeOffset).not.toBe(
      offsetOf(text, "Gulls follow"),
    );
    const { previewUndoCorrection, applyCorrectionsChange } = await store();
    await applyCorrectionsChange(await previewUndoCorrection(saved.id, share.id));
    // Back on the original substrate: the original offsets, no stamp.
    expect(await db.location.toArray()).toEqual([
      {
        schemaVersion: 1,
        articleId: saved.id,
        revision: 2,
        graphemeOffset: offsetOf(text, "Gulls follow"),
        savedAt: STAMP,
      },
    ]);
    const row = await db.highlights.get("h-gulls");
    expect(row!.position).toEqual(position);
    expect(row!.corrections).toBeUndefined();
  });
});

describe("redo", () => {
  it("is the change to the list as it was, previewed and applied the same way", async () => {
    await seedArticle();
    const share = correctionOf(saved, "hide", [1]);
    await applyEach(saved.id, [share]);
    const {
      previewUndoCorrection,
      previewCorrectionsChange,
      applyCorrectionsChange,
      loadCorrections,
    } = await store();
    await applyCorrectionsChange(await previewUndoCorrection(saved.id, share.id));
    expect(await loadCorrections(saved.id)).toEqual([]);
    const redo = await previewCorrectionsChange(saved.id, [share]);
    expect(redo.clean).toBe(true);
    await applyCorrectionsChange(redo);
    expect(await loadCorrections(saved.id)).toEqual([share]);
  });
});

describe("Restore original", () => {
  it("returns the article to exactly how it was added, and can be undone right after", async () => {
    const db = await seedArticle();
    const share = correctionOf(saved, "hide", [1]);
    const signup = correctionOf(saved, "hide", [3], [share]);
    await applyEach(saved.id, [share, signup]);
    const {
      previewRestoreOriginal,
      previewCorrectionsChange,
      applyCorrectionsChange,
      loadCorrections,
    } = await store();
    const restore = await previewRestoreOriginal(saved.id);
    expect(JSON.stringify(restore.proposed)).toBe(JSON.stringify(saved));
    await applyCorrectionsChange(restore);
    expect(await db.corrections.count()).toBe(0);
    const reads = correctedArticle(saved, await loadCorrections(saved.id));
    expect(JSON.stringify(reads)).toBe(JSON.stringify(saved));

    // Undo right after: the list as it was, with its ids.
    await applyCorrectionsChange(await previewCorrectionsChange(saved.id, [share, signup]));
    expect(await loadCorrections(saved.id)).toEqual([share, signup]);
  });

  it("previews its consequences like any correction (none for a hidden paragraph)", async () => {
    await seedArticle();
    await applyEach(saved.id, [correctionOf(saved, "hide", [1])]);
    const { previewRestoreOriginal } = await store();
    const preview = await previewRestoreOriginal(saved.id);
    expect(preview.chapters).toEqual([]);
    expect(preview.laterNotApplied).toEqual([]);
    expect(preview.clean).toBe(true);
  });
});

describe("undo brings back what an accepted consequence removed", () => {
  async function seedWork() {
    const db = await seedArticle(work);
    const { resolveWorkStructure } = await import("../../../src/content/chapterTargets");
    const noon = resolveWorkStructure(work)!.destinations.filter((d) => d.kind === "chapter")[1]!
      .id;
    const target = { kind: "work-chapter" as const, articleId: work.id, destinationId: noon };
    await db.completions.put({
      schemaVersion: 1,
      targetKey: `work-chapter:${work.id}/${noon}`,
      target,
      finished: true,
      source: "reader",
      updatedAt: STAMP,
    });
    await db.collections.put({
      schemaVersion: 1,
      id: "harbour-plan",
      name: "Harbour plan",
      entries: [
        { id: "e-first", target: { kind: "article", articleId: work.id }, addedAt: STAMP },
        { id: "e-noon", target, addedAt: STAMP },
      ],
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    return { db, noon };
  }

  it("puts the completion and collection entry back when the session undoes the hide", async () => {
    const { db, noon } = await seedWork();
    const before = {
      completions: await db.completions.toArray(),
      entries: (await db.collections.get("harbour-plan"))!.entries,
    };
    const { previewAddCorrection, previewUndoCorrection, applyCorrectionsChange } = await store();
    const hideNoon = correctionOf(work, "hide", [2]);
    const applied = await applyCorrectionsChange(await previewAddCorrection(work.id, hideNoon), {
      acceptConsequences: true,
    });
    expect(await db.completions.count()).toBe(0);
    expect(applied.removed.completions).toEqual(before.completions);
    expect(applied.removed.entries.map((e) => e.entry.id)).toEqual(["e-noon"]);

    const undo = await previewUndoCorrection(work.id, hideNoon.id, {
      removedEarlier: applied.removed,
    });
    expect(undo.restored).toEqual([
      "Bring back finished status for chapter “Noon”.",
      "Put chapter “Noon” back in “Harbour plan”.",
    ]);
    // The chapter coming back is a contents change (#74), so the undo goes
    // through the consequences step like any other.
    expect(undo.contents).toEqual([{ change: "added", title: "Noon" }]);
    expect(undo.clean).toBe(false);
    await applyCorrectionsChange(undo, { acceptConsequences: true });
    expect(await db.completions.toArray()).toEqual(before.completions);
    expect((await db.collections.get("harbour-plan"))!.entries).toEqual(before.entries);
    void noon;
  });

  it("brings nothing back when the chapter does not come back", async () => {
    const { db } = await seedWork();
    const { previewAddCorrection, previewCorrectionsChange, applyCorrectionsChange } =
      await store();
    const hideNoon = correctionOf(work, "hide", [2]);
    const applied = await applyCorrectionsChange(await previewAddCorrection(work.id, hideNoon), {
      acceptConsequences: true,
    });
    const same = await previewCorrectionsChange(work.id, [hideNoon], {
      removedEarlier: applied.removed,
    });
    expect(same.restored).toEqual([]);
    await applyCorrectionsChange(same);
    expect(await db.completions.count()).toBe(0);
  });
});

describe("describing a correction", () => {
  it("says in plain words what it did, with the text it touched", () => {
    expect(describeCorrection(correctionOf(saved, "hide", [1]))).toBe(
      "Hid the paragraph “Share this article”",
    );
    const hidden = correctionOf(saved, "hide", [2]);
    expect(describeCorrection(correctionOf(saved, "unhide", [2], [hidden]))).toBe(
      "Unhid the paragraph “Gulls follow it out past the breakwater…”",
    );
    expect(describeCorrection(correctionOf(work, "hide", [2]))).toBe("Hid the heading “Noon”");
  });

  it("describes a change of type by the words it touched (#74)", () => {
    const base = correctionOf(saved, "hide", [1]);
    const setType = (to: BlockTypeChoice, kind = base.target.kind): Correction => ({
      kind: "set-type",
      id: "st",
      createdAt: base.createdAt,
      target: { ...base.target, kind },
      to,
    });
    expect(describeCorrection(setType({ type: "heading", level: 2 }))).toBe(
      "Changed “Share this article” from Paragraph to Heading 2",
    );
    expect(describeCorrection(setType({ type: "caption" }))).toBe(
      "Made “Share this article” the caption of the figure",
    );
    expect(describeCorrection(setType({ type: "quotation" }))).toBe(
      "Made the paragraph “Share this article” a quotation",
    );
    expect(describeCorrection(setType({ type: "paragraph" }, "blockquote"))).toBe(
      "Turned the quotation “Share this article” back into ordinary blocks",
    );
  });
});
