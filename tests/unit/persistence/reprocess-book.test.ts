// Reprocessing an EPUB book (#64, spec #66 story 59; Seam 3): a book
// reprocesses as a whole book from its re-chosen original file, with the
// chapter consequences shown in the preview and applied only on explicit
// acceptance. Observed through the operation's public interface plus what
// the library holds afterwards.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, BookSchema, type CanonicalArticle } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import type { EpubIngestionSuccess } from "../../../src/ingestion/IngestionClient";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });
const BOOK = "epub-0123456789ab";
const stamp = "2026-01-01T00:00:00Z";

function chapter(
  index: number,
  title: string,
  hash: string,
  texts: string[],
  id = `${BOOK}-c${String(index).padStart(2, "0")}`,
): CanonicalArticle {
  return ArticleSchema.parse({
    id,
    revision: 1,
    lang: "en",
    provenance: { title, retrievedAt: stamp, originalHtmlHash: `sha256:${hash}` },
    blocks: texts.map(para),
    ingestionMeta: {
      source: "epub-chapter",
      origin: "upload",
      originalHtmlHash: `sha256:${hash}`,
      extractionConfidence: "high",
      bookId: BOOK,
      chapterIndex: index,
    },
  });
}

const one = chapter(0, "One", "one", ["The first chapter begins1 here, calmly."]);
const two = chapter(1, "Two", "two", ["The second chapter is the one that goes away."]);
const three = chapter(2, "Three", "three", ["The third chapter stays exactly the same."]);

const book = BookSchema.parse({
  id: BOOK,
  title: "A book",
  authors: ["An author"],
  language: "en",
  chapterArticleIds: [one.id, two.id, three.id],
  skippedChapterCount: 1,
  source: "epub-upload",
  originalFileHash: "sha256:book-bytes",
  tags: ["shelf"],
  addedAt: stamp,
});

// The re-processed book: chapter One gains a linked marker, Two is no longer
// admitted, and a previously skipped Interlude is admitted between them. Its
// fresh positional id (c01) is the dropped chapter's id.
function reingested(fileHash = "sha256:book-bytes"): EpubIngestionSuccess {
  const fresh = (c: CanonicalArticle) => ({
    ...c,
    provenance: { ...c.provenance, retrievedAt: "2026-11-27T00:00:00Z" },
  });
  const articles = [
    fresh(chapter(0, "One", "one", ["The first chapter begins here, calmly."])),
    fresh(chapter(1, "Interlude", "interlude", ["An interlude, once skipped."])),
    fresh(chapter(2, "Three", "three", ["The third chapter stays exactly the same."])),
  ];
  return {
    book: BookSchema.parse({
      ...book,
      tags: [],
      addedAt: "2026-11-27T00:00:00Z",
      chapterArticleIds: articles.map((a) => a.id),
      skippedChapterCount: 0,
      originalFileHash: fileHash,
    }),
    articles,
    skippedCount: 0,
    assets: [],
  };
}

function highlight(id: string, article: CanonicalArticle, exact: string) {
  const text = normalizeText(article);
  const start = [...text.slice(0, text.indexOf(exact))].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1 as const,
    id,
    articleId: article.id,
    revision: 1,
    position,
    quote: deriveQuoteSelector(article, position),
    createdAt: stamp,
  };
}

const completion = (articleId: string) => ({
  schemaVersion: 1 as const,
  targetKey: `article:${articleId}`,
  target: { kind: "book-chapter" as const, bookId: BOOK, articleId },
  finished: true,
  source: "reader" as const,
  updatedAt: stamp,
});

async function seed() {
  const { db } = await import("../../../src/persistence/db");
  await db.books.put(book);
  for (const c of [one, two, three]) await db.articles.put({ ...c, bookId: BOOK });
  await db.highlights.bulkPut([
    highlight("h-one", one, "here, calmly"),
    highlight("h-two", two, "goes away"),
  ]);
  await db.location.put({
    schemaVersion: 1,
    articleId: one.id,
    revision: 1,
    graphemeOffset: normalizeText(one).indexOf("here"),
    savedAt: stamp,
  });
  const { completionTargetKey } = await import("../../../src/content/completion");
  for (const id of [two.id, three.id]) {
    const row = completion(id);
    await db.completions.put({ ...row, targetKey: completionTargetKey(row.target) });
  }
  await db.collections.put({
    schemaVersion: 1,
    id: "plan",
    name: "Plan",
    entries: [
      {
        id: "e-two",
        target: { kind: "book-chapter", bookId: BOOK, articleId: two.id },
        addedAt: stamp,
      },
      { id: "e-book", target: { kind: "book", bookId: BOOK }, addedAt: stamp },
    ],
    createdAt: stamp,
    updatedAt: stamp,
  });
  return db;
}

const epub = () => new File(["epub"], "book.epub");

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("reprocessing an EPUB book", () => {
  it("previews the whole book: chapters before and after, highlights, and chapter consequences, without writing", async () => {
    const db = await seed();
    const { previewBookReprocess } = await import("../../../src/persistence/reprocessStore");
    const before = JSON.stringify(await db.articles.toArray());

    const preview = await previewBookReprocess(BOOK, epub(), async () => reingested());

    expect(preview.chaptersBefore).toEqual(["One", "Two", "Three"]);
    expect(preview.chaptersAfter).toEqual(["One", "Interlude", "Three"]);
    expect(preview.removed.map((c) => c.title)).toEqual(["Two"]);
    expect(preview.added.map((c) => c.title)).toEqual(["Interlude"]);
    expect(preview.highlights.map((h) => [h.chapter, h.highlightId, h.outcome])).toEqual([
      ["One", "h-one", "confident"],
    ]);
    const labels = preview.consequences.map((c) => c.label).join("\n");
    expect(preview.consequences).toHaveLength(3);
    expect(labels).toMatch(/Two.*1 highlight/);
    expect(labels).toMatch(/finished status.*Two/);
    expect(labels).toMatch(/Two.*from “Plan”/);
    expect(JSON.stringify(await db.articles.toArray())).toBe(before);
  });

  it("refuses an EPUB that is not the original, calmly, and changes nothing", async () => {
    const db = await seed();
    const { previewBookReprocess, ReprocessRefusal } =
      await import("../../../src/persistence/reprocessStore");
    const attempt = previewBookReprocess(BOOK, epub(), async () => reingested("sha256:other"));
    await expect(attempt).rejects.toBeInstanceOf(ReprocessRefusal);
    await expect(attempt).rejects.toThrow(/not the original file/);
    expect(BookSchema.parse(await db.books.get(BOOK))).toEqual(book);
  });

  it("applies the book only with consequences accepted, keeping chapter identity and reader data", async () => {
    const db = await seed();
    const { previewBookReprocess, applyBookReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const preview = await previewBookReprocess(BOOK, epub(), async () => reingested());

    await expect(applyBookReprocess(preview)).rejects.toThrow(/Explicit acceptance/);
    expect(BookSchema.parse(await db.books.get(BOOK))).toEqual(book);

    await applyBookReprocess(preview, { acceptConsequences: true });

    const after = BookSchema.parse(await db.books.get(BOOK));
    expect(after.tags).toEqual(["shelf"]);
    expect(after.addedAt).toBe(stamp);
    expect(after.skippedChapterCount).toBe(0);
    const [firstId, interludeId, thirdId] = after.chapterArticleIds;
    expect(firstId).toBe(one.id);
    expect(thirdId).toBe(three.id);
    // The dropped chapter's id is never reused for a different chapter.
    expect(interludeId).not.toBe(two.id);
    const chapters = await Promise.all(
      after.chapterArticleIds.map(async (id) => ArticleSchema.parse(await db.articles.get(id))),
    );
    expect(
      chapters.map((c) => [c.provenance.title, c.revision, c.ingestionMeta?.chapterIndex]),
    ).toEqual([
      ["One", 2, 0],
      ["Interlude", 1, 1],
      ["Three", 2, 2],
    ]);
    expect(normalizeText(chapters[0]!)).toBe("The first chapter begins here, calmly.");
    expect(await db.articles.where("bookId").equals(BOOK).count()).toBe(3);
    expect(await db.articles.get(two.id)).toBeUndefined();
    expect((await db.highlights.toArray()).map((h) => h.id)).toEqual(["h-one"]);
    expect((await db.location.get([one.id, 2]))?.graphemeOffset).toBe(
      normalizeText(chapters[0]!).indexOf("here"),
    );
    expect((await db.completions.toArray()).map((c) => c.target)).toEqual([
      completion(three.id).target,
    ]);
    expect((await db.collections.get("plan"))!.entries.map((e) => e.id)).toEqual(["e-book"]);
  });

  it("refuses a preview made against an older state", async () => {
    const db = await seed();
    const { previewBookReprocess, applyBookReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const preview = await previewBookReprocess(BOOK, epub(), async () => reingested());
    await db.highlights.put(highlight("h-new", two, "second chapter"));
    await expect(applyBookReprocess(preview, { acceptConsequences: true })).rejects.toThrow(
      /changed after the preview/,
    );
    expect(BookSchema.parse(await db.books.get(BOOK))).toEqual(book);
    expect(await db.articles.get(two.id)).toBeDefined();
  });
});
