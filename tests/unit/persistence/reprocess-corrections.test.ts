// Spec #68 / issue #78 — seam 2: corrections re-applied by Reprocessing (URL
// re-fetch, re-chosen original file, a whole EPUB book per chapter article)
// and by PDF repair. Each correction is re-applied to the new original by
// finding its text inside the preview, before consequences are derived, so
// the preview shows what apply will write; corrections that no longer fit
// are listed in the preview and stay in the corrections list as not
// applied, never dropped. Observed through the operations' public
// interfaces and what the library holds afterwards.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import {
  ArticleSchema,
  BookSchema,
  LocationRecordSchema,
  type CanonicalArticle,
  type Correction,
} from "../../../src/content/schema";
import {
  deriveQuoteSelector,
  mainTextLength,
  normalizeText,
} from "../../../src/content/normalizeText";
import {
  applyCorrections,
  blockCorrection,
  REASONS,
  splitCorrection,
} from "../../../src/content/corrections/engine";
import { setTypeCorrection } from "../../../src/content/corrections/setType";
import { isSameText, textStamp } from "../../../src/content/sameText";
import type {
  EpubIngestionSuccess,
  IngestionSuccess,
} from "../../../src/ingestion/IngestionClient";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });
const heading = (text: string, level = 2) => ({
  kind: "heading" as const,
  level,
  content: [{ text, marks: [] }],
});

const FERRY = "The ferry leaves at dawn, before the fog lifts.";
const SHARE = "Share this article";
const GULLS = "Gulls follow it out past the breakwater and back.";
const NEWSLETTER = "Sign up for our newsletter";
const NEW_PASSAGE = "The harbour master now keeps a second log.";

const saved = ArticleSchema.parse({
  id: "harbour-essay",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour",
    title: "The harbour",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
  },
  blocks: [para(FERRY), para(SHARE), para(GULLS), para(NEWSLETTER)],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour",
    fetchedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
    extractionConfidence: "high",
  },
  addedAt: "2026-01-01T00:00:00Z",
});

/** The hide correction for the block holding `text`, made the way the
 * Correction view makes it (against `article` plus `before`). */
function hideOf(article: CanonicalArticle, text: string, before: Correction[] = []): Correction {
  const result = applyCorrections(article, before);
  const graphemes = [...normalizeText(result.view.article)];
  const block = result.view.allBlocks.find(
    (b) => graphemes.slice(b.viewStart, b.viewEnd).join("") === text,
  )!;
  return blockCorrection("hide", result, block, {
    id: `hide-${text.slice(0, 8).replace(/\W/g, "")}`,
    createdAt: "2026-11-27T10:00:00.000Z",
  })!;
}

const hideShare = hideOf(saved, SHARE);
const hideNewsletter = hideOf(saved, NEWSLETTER, [hideShare]);
const corrections = [hideShare, hideNewsletter];

/** A highlight captured the way the reader captures it: against the article
 * being shown (the corrected one). */
function highlightIn(shown: CanonicalArticle, articleId: string, id: string, exact: string) {
  const text = normalizeText(shown);
  const start = [...text.slice(0, text.indexOf(exact))].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1 as const,
    id,
    articleId,
    position,
    quote: deriveQuoteSelector(shown, position),
    createdAt: "2026-01-02T00:00:00Z",
    ...textStamp(shown),
  };
}

/** A reading position saved at `text` in the article being shown. */
function positionAt(shown: CanonicalArticle, articleId: string, text: string) {
  const normalized = normalizeText(shown);
  return {
    schemaVersion: 1 as const,
    articleId,
    ...textStamp(shown),
    graphemeOffset: [...normalized.slice(0, normalized.indexOf(text))].length,
    savedAt: "2026-01-03T00:00:00.000Z",
  };
}

const offsetOf = (shown: CanonicalArticle, text: string) => {
  const normalized = normalizeText(shown);
  return [...normalized.slice(0, normalized.indexOf(text))].length;
};

/** The re-fetched page: a new passage, the share chrome still there, the
 * newsletter sign-up gone. */
function refetched(hash = "hash-now"): IngestionSuccess {
  const article = ArticleSchema.parse({
    ...saved,
    addedAt: undefined,
    provenance: {
      ...saved.provenance,
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: hash,
    },
    ingestionMeta: { ...saved.ingestionMeta!, originalHtmlHash: hash },
    blocks: [para(FERRY), para(NEW_PASSAGE), para(SHARE), para(GULLS)],
  });
  return { article, confidence: { state: "confident" }, assets: [] };
}

async function seedArticle(article: CanonicalArticle = saved) {
  const { db } = await import("../../../src/persistence/db");
  const shown = applyCorrections(article, corrections).article;
  await db.articles.put(article);
  await db.corrections.put({
    schemaVersion: 1,
    articleId: article.id,
    corrections,
    updatedAt: "2026-11-27T10:00:00.000Z",
  });
  await db.highlights.bulkPut([
    highlightIn(shown, article.id, "h-gulls", "past the breakwater"),
    // Made before the share line was hidden: hidden while its block is.
    highlightIn(article, article.id, "h-share", "Share this"),
  ]);
  await db.location.put(positionAt(shown, article.id, GULLS));
  return db;
}

async function reprocess() {
  return import("../../../src/persistence/reprocessStore");
}

async function shownFromLibrary(articleId: string) {
  const { db } = await import("../../../src/persistence/db");
  const { loadCorrections } = await import("../../../src/persistence/correctionsStore");
  const original = ArticleSchema.parse(await db.articles.get(articleId));
  return { original, result: applyCorrections(original, await loadCorrections(articleId)) };
}

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("reprocessing a corrected URL article", () => {
  it("re-applies the corrections inside the preview and lists the one that no longer fits", async () => {
    const db = await seedArticle();
    const { previewReprocess } = await reprocess();
    const rowBefore = JSON.stringify(await db.articles.get(saved.id));

    const preview = await previewReprocess(saved.id, refetched());

    expect(preview.corrections.reapplied.map((c) => c.id)).toEqual([hideShare.id]);
    expect(preview.corrections.notApplied).toEqual([
      { correction: hideNewsletter, reason: REASONS.notFound },
    ]);
    // Changed passages are what the reader reads: the hidden sign-up was
    // never read, so its disappearance is not a change.
    expect(preview.changes).toEqual([{ kind: "added", text: NEW_PASSAGE }]);
    expect(Object.fromEntries(preview.highlights.map((h) => [h.highlightId, h.outcome]))).toEqual({
      "h-gulls": "confident",
      "h-share": "hidden",
    });
    const shownAfter = applyCorrections(preview.proposed, corrections).article;
    expect(preview.position).toEqual({ kind: "kept", offset: offsetOf(shownAfter, GULLS) });
    // No writes.
    expect(JSON.stringify(await db.articles.get(saved.id))).toBe(rowBefore);
  });

  it("applies the new original, keeps every correction in the list, and stores the not-applied outcome", async () => {
    await seedArticle();
    const { previewUrlReprocess, applyReprocess } = await reprocess();
    const preview = await previewUrlReprocess(saved.id, async () => refetched());
    await applyReprocess(preview);

    const { original, result } = await shownFromLibrary(saved.id);
    expect(original.revision).toBe(2);
    expect(original.blocks).toEqual(refetched().article.blocks); // the original, uncorrected
    const { loadCorrections } = await import("../../../src/persistence/correctionsStore");
    expect(await loadCorrections(saved.id)).toEqual(corrections);
    expect(result.outcomes).toEqual([
      { status: "applied" },
      { status: "not-applied", reason: REASONS.notFound },
    ]);
    expect(normalizeText(result.article)).not.toContain(SHARE);

    // The reading position follows the corrected text, stamped with the new
    // substrate, so it is trusted directly.
    const { db } = await import("../../../src/persistence/db");
    const locations = (await db.location.toArray()).map((l) => LocationRecordSchema.parse(l));
    expect(locations).toHaveLength(1);
    expect(isSameText(locations[0]!, result.article)).toBe(true);
    expect(locations[0]!.graphemeOffset).toBe(offsetOf(result.article, GULLS));
  });

  it("carries a finished position to the corrected new version's main-text end", async () => {
    const db = await seedArticle();
    const shown = applyCorrections(saved, corrections).article;
    await db.location.put({
      ...positionAt(shown, saved.id, FERRY),
      graphemeOffset: mainTextLength(shown),
    });
    const { previewReprocess } = await reprocess();
    const preview = await previewReprocess(saved.id, refetched());
    const shownAfter = applyCorrections(preview.proposed, corrections).article;
    expect(preview.position).toEqual({ kind: "kept", offset: mainTextLength(shownAfter) });
  });

  it("refuses a preview once a correction changed after it, and leaves everything unchanged", async () => {
    const db = await seedArticle();
    const { previewReprocess, applyReprocess } = await reprocess();
    const preview = await previewReprocess(saved.id, refetched());
    await db.corrections.put({
      schemaVersion: 1,
      articleId: saved.id,
      corrections: [hideShare],
      updatedAt: "2026-11-27T11:00:00.000Z",
    });
    await expect(applyReprocess(preview)).rejects.toThrow(/changed after the preview/);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("leaves an uncorrected article's preview exactly as before (nothing to re-apply)", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(saved);
    const { previewReprocess } = await reprocess();
    const preview = await previewReprocess(saved.id, refetched());
    expect(preview.corrections).toEqual({ reapplied: [], notApplied: [] });
    // The diff is the originals' own: the sign-up's removal is a change.
    expect(preview.changes).toContainEqual({ kind: "removed", text: NEWSLETTER });
  });
});

describe("reprocessing an article with a hidden block and a split paragraph", () => {
  // A paragraph run together at ingest; the reader split it.
  const RUN = "The tide turns at noon. The boats come home by dusk.";
  const article = ArticleSchema.parse({
    ...saved,
    blocks: [para(FERRY), para(SHARE), para(RUN), para(GULLS)],
  });
  const hide = hideOf(article, SHARE);
  const split = (() => {
    const result = applyCorrections(article, [hide]);
    const graphemes = [...normalizeText(result.view.article)];
    const block = result.view.allBlocks.find(
      (b) => graphemes.slice(b.viewStart, b.viewEnd).join("") === RUN,
    )!;
    const caret = [...RUN.slice(0, RUN.indexOf("The boats"))].length;
    return splitCorrection(result, block, caret, {
      id: "split-run",
      createdAt: "2026-11-27T10:01:00.000Z",
    })!;
  })();

  it("keeps both when their text is still found in the new version", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(article);
    await db.corrections.put({
      schemaVersion: 1,
      articleId: article.id,
      corrections: [hide, split],
      updatedAt: "2026-11-27T10:01:00.000Z",
    });
    const { previewReprocess, applyReprocess } = await reprocess();
    const fresh = ArticleSchema.parse({
      ...refetched().article,
      blocks: [para(FERRY), para(NEW_PASSAGE), para(SHARE), para(RUN), para(GULLS)],
    });
    const preview = await previewReprocess(article.id, {
      article: fresh,
      confidence: { state: "confident" },
      assets: [],
    });
    expect(preview.corrections.reapplied.map((c) => c.id)).toEqual([hide.id, split.id]);
    expect(preview.corrections.notApplied).toEqual([]);
    expect(preview.changes).toEqual([{ kind: "added", text: NEW_PASSAGE }]);

    await applyReprocess(preview);
    const { result } = await shownFromLibrary(article.id);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(normalizeText(result.article).split("\n")).toEqual([
      FERRY,
      NEW_PASSAGE,
      "The tide turns at noon.",
      "The boats come home by dusk.",
      GULLS,
    ]);
  });
});

describe("reprocessing an article with a hidden block and a moved caption", () => {
  // The caption was extracted as a stray paragraph after its figure; the
  // reader made it the figure's caption (set-type caption, #74) and hid the
  // share chrome.
  const CAPTION = "The morning ferry at the quay, 1932.";
  const figure = (alt: string, caption: string[] = []) => ({
    kind: "figure" as const,
    alt,
    caption: caption.map((text) => ({ text, marks: [] })),
  });
  const article = ArticleSchema.parse({
    ...saved,
    blocks: [para(FERRY), para(SHARE), figure("A ferry at the quay"), para(CAPTION), para(GULLS)],
  });
  const hide = hideOf(article, SHARE);
  const caption = (() => {
    const result = applyCorrections(article, [hide]);
    const graphemes = [...normalizeText(result.view.article)];
    const block = result.view.allBlocks.find(
      (b) => graphemes.slice(b.viewStart, b.viewEnd).join("") === CAPTION,
    )!;
    return setTypeCorrection(
      result,
      block,
      { type: "caption" },
      {
        id: "caption-ferry",
        createdAt: "2026-11-27T10:01:00.000Z",
      },
    )!;
  })();

  it("keeps the block hidden and the caption on its figure in the new version", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(article);
    await db.corrections.put({
      schemaVersion: 1,
      articleId: article.id,
      corrections: [hide, caption],
      updatedAt: "2026-11-27T10:01:00.000Z",
    });
    const { previewReprocess, applyReprocess } = await reprocess();
    const fresh = ArticleSchema.parse({
      ...refetched().article,
      blocks: [
        para(FERRY),
        para(NEW_PASSAGE),
        para(SHARE),
        figure("A ferry at the quay"),
        para(CAPTION),
        para(GULLS),
      ],
    });
    const preview = await previewReprocess(article.id, {
      article: fresh,
      confidence: { state: "confident" },
      assets: [],
    });
    expect(preview.corrections.reapplied.map((c) => c.id)).toEqual([hide.id, caption.id]);
    expect(preview.corrections.notApplied).toEqual([]);
    expect(preview.changes).toEqual([{ kind: "added", text: NEW_PASSAGE }]);

    await applyReprocess(preview);
    const { result } = await shownFromLibrary(article.id);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(result.article.blocks).toEqual([
      para(FERRY),
      para(NEW_PASSAGE),
      figure("A ferry at the quay", [CAPTION]),
      para(GULLS),
    ]);
    expect(normalizeText(result.article)).not.toContain(SHARE);
  });
});

describe("reprocessing a corrected uploaded article", () => {
  const upload = ArticleSchema.parse({
    ...saved,
    id: "md-harbour-0123456789ab",
    provenance: { ...saved.provenance, sourceUrl: undefined, originalHtmlHash: "sha256:bytes" },
    ingestionMeta: {
      source: "markdown",
      origin: "upload",
      originalHtmlHash: "sha256:bytes",
      extractionConfidence: "high",
    },
  });

  it("re-applies the corrections to the re-chosen file and keeps the non-fitting one as not applied", async () => {
    await seedArticle(upload);
    const { previewUploadReprocess, applyReprocess } = await reprocess();
    const preview = await previewUploadReprocess(
      upload.id,
      new File(["# Harbour"], "harbour.md"),
      async () => {
        const fresh = refetched("sha256:bytes").article;
        return {
          article: ArticleSchema.parse({
            ...fresh,
            id: upload.id,
            ingestionMeta: upload.ingestionMeta,
          }),
          confidence: { state: "confident" },
          assets: [],
        };
      },
    );
    expect(preview.corrections.reapplied.map((c) => c.id)).toEqual([hideShare.id]);
    expect(preview.corrections.notApplied.map((n) => n.correction.id)).toEqual([hideNewsletter.id]);

    await applyReprocess(preview);
    const { result } = await shownFromLibrary(upload.id);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "not-applied"]);
  });
});

describe("reprocessing a book with corrected chapters", () => {
  const BOOK = "epub-0123456789ab";
  const stamp = "2026-01-01T00:00:00Z";
  const chapter = (index: number, title: string, hash: string, blocks: unknown[]) =>
    ArticleSchema.parse({
      id: `${BOOK}-c${String(index).padStart(2, "0")}`,
      revision: 1,
      lang: "en",
      provenance: { title, retrievedAt: stamp, originalHtmlHash: `sha256:${hash}` },
      blocks,
      ingestionMeta: {
        source: "epub-chapter",
        origin: "upload",
        originalHtmlHash: `sha256:${hash}`,
        extractionConfidence: "high",
        bookId: BOOK,
        chapterIndex: index,
      },
    });
  const one = chapter(0, "One", "one", [para(FERRY), para(SHARE), para(GULLS), para(NEWSLETTER)]);
  const two = chapter(1, "Two", "two", [para("The second chapter is plain.")]);
  const book = BookSchema.parse({
    id: BOOK,
    title: "A book",
    authors: ["An author"],
    language: "en",
    chapterArticleIds: [one.id, two.id],
    skippedChapterCount: 0,
    source: "epub-upload",
    originalFileHash: "sha256:book-bytes",
    tags: [],
    addedAt: stamp,
  });
  const chapterCorrections = [hideOf(one, SHARE), hideOf(one, NEWSLETTER, [hideOf(one, SHARE)])];

  function reingested(): EpubIngestionSuccess {
    const articles = [
      chapter(0, "One", "one", [para(FERRY), para(NEW_PASSAGE), para(SHARE), para(GULLS)]),
      two,
    ];
    return {
      book: BookSchema.parse({ ...book, chapterArticleIds: articles.map((a) => a.id) }),
      articles,
      skippedCount: 0,
      assets: [],
    };
  }

  it("re-applies each chapter's corrections, names the chapter of the one that no longer fits, and stores the outcome", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.books.put(book);
    for (const c of [one, two]) await db.articles.put({ ...c, bookId: BOOK });
    await db.corrections.put({
      schemaVersion: 1,
      articleId: one.id,
      corrections: chapterCorrections,
      updatedAt: stamp,
    });
    const shown = applyCorrections(one, chapterCorrections).article;
    await db.location.put(positionAt(shown, one.id, GULLS));

    const { previewBookReprocess, applyBookReprocess } = await reprocess();
    const preview = await previewBookReprocess(BOOK, new File(["epub"], "book.epub"), async () =>
      reingested(),
    );
    expect(
      preview.correctionsNotApplied.map((n) => [n.chapter, n.correction.id, n.reason]),
    ).toEqual([["One", chapterCorrections[1]!.id, REASONS.notFound]]);
    expect(preview.correctionsReapplied).toBe(1);
    expect(preview.positionsUnmatched).toEqual([]);

    await applyBookReprocess(preview);
    const { result } = await shownFromLibrary(one.id);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "not-applied"]);
    const location = LocationRecordSchema.parse(await db.location.toCollection().first());
    expect(isSameText(location, result.article)).toBe(true);
    expect(location.graphemeOffset).toBe(offsetOf(result.article, GULLS));
  });
});

describe("PDF repair of a corrected work", () => {
  const PROMOTED = "An ordinary paragraph was wrongly promoted.";
  const MISSED = "A real section heading";
  const pdf = ArticleSchema.parse({
    id: "damaged-pdf",
    revision: 1,
    lang: "en",
    provenance: {
      title: "Saved PDF",
      originalHtmlHash: "same-source-bytes",
      retrievedAt: "2026-01-01T00:00:00Z",
    },
    blocks: [heading(PROMOTED), para(SHARE), para(MISSED), para(GULLS)],
  });
  // The repair demotes the promoted paragraph and promotes the missed heading.
  const candidate = ArticleSchema.parse({
    ...pdf,
    id: "new-intake-id",
    blocks: [para(PROMOTED), para(SHARE), heading(MISSED), para(GULLS)],
  });
  const hideSharePdf = hideOf(pdf, SHARE);
  // The reader hid the paragraph the repair turns into a heading: its block
  // is no longer a paragraph, so it no longer fits.
  const hideMissed = hideOf(pdf, MISSED, [hideSharePdf]);
  const pdfCorrections = [hideSharePdf, hideMissed];

  async function seedPdf(list: Correction[] = pdfCorrections) {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(pdf);
    if (list.length > 0)
      await db.corrections.put({
        schemaVersion: 1,
        articleId: pdf.id,
        corrections: list,
        updatedAt: "2026-11-27T10:00:00.000Z",
      });
    const shown = applyCorrections(pdf, list).article;
    await db.location.put(positionAt(shown, pdf.id, GULLS));
    return db;
  }

  it("re-applies the corrections to the repaired structure, lists the one that no longer fits, and stores it as not applied", async () => {
    const db = await seedPdf();
    const { previewPdfRepair, applyPdfRepair } =
      await import("../../../src/persistence/pdfRepairStore");
    const preview = await previewPdfRepair(pdf.id, candidate);
    expect(preview.corrections.reapplied.map((c) => c.id)).toEqual([hideSharePdf.id]);
    expect(preview.corrections.notApplied.map((n) => n.correction.id)).toEqual([hideMissed.id]);
    // The chapters the reader will see: the un-hidden heading is new.
    expect(preview.chaptersAfter).toContain(MISSED);
    expect(ArticleSchema.parse(await db.articles.get(pdf.id))).toEqual(pdf);

    await applyPdfRepair(preview, { acceptConsequences: true });
    const { result } = await shownFromLibrary(pdf.id);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "not-applied"]);
    expect(normalizeText(result.article)).not.toContain(SHARE);
    const location = LocationRecordSchema.parse(await db.location.toCollection().first());
    expect(isSameText(location, result.article)).toBe(true);
    expect(location.graphemeOffset).toBe(offsetOf(result.article, GULLS));
  });

  it("gives a repaired original a text identity of its own, and keeps the saved position trusted across repair and recovery", async () => {
    const db = await seedPdf([]);
    const { previewPdfRepair, applyPdfRepair, recoverPdfRepair } =
      await import("../../../src/persistence/pdfRepairStore");
    await applyPdfRepair(await previewPdfRepair(pdf.id, candidate), { acceptConsequences: true });
    const repaired = ArticleSchema.parse(await db.articles.get(pdf.id));
    expect(isSameText(textStamp(repaired), textStamp(pdf))).toBe(false);
    let location = LocationRecordSchema.parse(await db.location.toCollection().first());
    expect(isSameText(location, repaired)).toBe(true);
    expect(location.graphemeOffset).toBe(offsetOf(pdf, GULLS));

    await recoverPdfRepair(pdf.id);
    const recovered = ArticleSchema.parse(await db.articles.get(pdf.id));
    expect(isSameText(textStamp(recovered), textStamp(pdf))).toBe(true);
    location = LocationRecordSchema.parse(await db.location.toCollection().first());
    expect(isSameText(location, recovered)).toBe(true);
    expect(location.graphemeOffset).toBe(offsetOf(pdf, GULLS));
  });

  it("refuses a repair preview once the corrections changed after it", async () => {
    const db = await seedPdf();
    const { previewPdfRepair, applyPdfRepair } =
      await import("../../../src/persistence/pdfRepairStore");
    const preview = await previewPdfRepair(pdf.id, candidate);
    await db.corrections.delete(pdf.id);
    await expect(applyPdfRepair(preview, { acceptConsequences: true })).rejects.toThrow(
      /changed after (the|this) preview|no longer valid/i,
    );
    expect(ArticleSchema.parse(await db.articles.get(pdf.id))).toEqual(pdf);
  });
});
