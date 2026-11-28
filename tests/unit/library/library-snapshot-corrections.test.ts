// Spec #68 / issue #71 — the library reads the article AS READ: the
// snapshot's totals (estimated reading time, progress, completion) and its
// location fold go through the one correction engine, so a hidden block is
// left out of the estimate; `articles` stay the stored originals (the rows
// other surfaces write back), and an uncorrected article reads as itself.
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema } from "../../../src/content/schema";
import { mainTextLength } from "../../../src/content/normalizeText";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";
import { estimatedReadingTimeLabel } from "../../../src/ingestion/library/readingStats";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
(globalThis as { indexedDB?: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB;
(globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });
const long = (word: string, n: number) => Array.from({ length: n }, () => word).join(" ");

const article = ArticleSchema.parse({
  id: "chrome-heavy",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/chrome",
    title: "Chrome heavy",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash",
  },
  // ~2 minutes of body, ~3 minutes of "related posts" chrome.
  blocks: [para(long("story", 470)), para(long("related", 700))],
});

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = fakeIndexedDB.deleteDatabase("lem-reader");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe("the library snapshot and corrections", () => {
  it("leaves hidden blocks out of the estimated reading time", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(article);
    const { loadLibrarySnapshot, readingArticleOf } =
      await import("../../../src/ingestion/library/librarySnapshot");
    const before = await loadLibrarySnapshot();
    expect(before.totalsByArticleId.get(article.id)).toBe(mainTextLength(article));
    expect(
      readingArticleOf(
        before,
        before.articles.find((a) => a.id === article.id)!,
      ).blocks,
    ).toHaveLength(2);

    const result = applyCorrections(article, []);
    const hide = blockCorrection("hide", result, result.view.blocks[1]!, {
      id: "hide-related",
      createdAt: "2026-11-27T00:00:00.000Z",
    })!;
    const { previewAddCorrection, applyCorrectionsChange } =
      await import("../../../src/persistence/correctionsStore");
    await applyCorrectionsChange(await previewAddCorrection(article.id, hide));

    const after = await loadLibrarySnapshot();
    const total = after.totalsByArticleId.get(article.id)!;
    expect(total).toBe([...long("story", 470)].length);
    expect(estimatedReadingTimeLabel(total)).not.toBe(
      estimatedReadingTimeLabel(before.totalsByArticleId.get(article.id)!),
    );
    // The stored original is untouched; the reading article is corrected.
    const stored = after.articles.find((a) => a.id === article.id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(readingArticleOf(after, stored).blocks).toHaveLength(1);
    await db.delete();
  });
});
