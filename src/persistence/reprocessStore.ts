// Reprocessing (#63, spec #66; CONTEXT.md "Reprocessing"): run an existing
// article through ingestion again, preview what would change, and apply only
// on the reader's explicit confirmation. Never automatic. Follows the PDF
// repair precedent (pdfRepairStore): preview performs NO writes; apply is one
// transaction that refuses a preview made against an older library state.
//
// The operation is split so other candidate sources plug in at one seam:
//   - previewReprocess(articleId, candidate) — the core. Takes an ingest
//     result from ANY source (URL re-fetch here; the re-chosen original file
//     in #64, which passes `requireSameSource`), adopts it as the next
//     revision of the saved article, and computes the consequences.
//   - previewUrlReprocess(articleId) — the URL source: re-fetches the stored
//     address through the existing guarded ingest endpoint.
//   - applyReprocess(preview) — writes the new revision.
// Future stages (#51 re-applying corrections, #52 embed cards) transform the
// proposed article inside previewReprocess before consequences are derived,
// so the preview always shows what apply will write.
//
// Carry-over rules on apply (spec #66 "Reprocessing"):
//   - The article keeps its id; revision increments (D-06 monotonic).
//   - Reader-owned row fields (tags, display overrides, addedAt) are kept.
//   - Highlights are never rewritten: they re-match against the new revision
//     by their stored quote (D5-01/D5-02), exactly as the preview reports.
//   - Article notes, reading sessions and whole-article completion/collection
//     targets are keyed by article id and carry over untouched.
//   - Reading position is re-anchored by quote to the new revision; a finished
//     position stays finished. A position that cannot be matched is disclosed
//     and left on its old revision (the article opens at the start).
//   - Chapter-targeted completions and collection entries whose chapter no
//     longer corresponds are disclosed and need explicit acceptance.
//   - Image assets are replaced together with the article.
import type { Collection, Table } from "dexie";
import {
  ArticleSchema,
  BookSchema,
  CollectionSchema,
  type ArticleSource,
  type Book,
  type CanonicalArticle,
  type CollectionEntryTarget,
  type LocationRecord,
  LocationRecordSchema,
  HighlightRecordSchema,
} from "../content/schema";
import {
  BLOCK_SEPARATOR,
  deriveQuoteSelector,
  graphemeLength,
  mainTextLength,
  normalizeText,
  resolveQuoteSelector,
} from "../content/normalizeText";
import { deriveWorkStructure } from "../content/structure";
import { fromLegacyEndPin, inNotesOffset, isFinishedOffset } from "../reader/readingPosition";
import {
  ingestEpub,
  ingestHtml,
  ingestMarkdown,
  ingestUrl,
  IngestionError,
  type EpubIngestionSuccess,
  type IngestionSuccess,
  type ValidatedAsset,
} from "../ingestion/IngestionClient";
import { bytesToBase64 } from "../ingestion/ingestCopy";
import { EPUB_MAX_BYTES } from "../ingestion/types";
import { bookAssetsForChapters } from "../ingestion/addToLibrary";
import type { BookAsset } from "./booksStore";
import { db, type AssetRecordRow } from "./db";
import { chapterConsequences, type ChapterConsequence } from "./chapterConsequences";
import { isSameText } from "../content/sameText";

/** A calm, reader-facing refusal. Nothing was changed when one is thrown. */
export class ReprocessRefusal extends Error {}

export type PassageChange = { kind: "removed" | "added"; text: string };

export type HighlightOutcome = "confident" | "ambiguous" | "orphan";

export interface HighlightConsequence {
  highlightId: string;
  /** The highlighted text as stored (the reader's own words for it). */
  exact: string;
  outcome: HighlightOutcome;
}

export type PositionConsequence =
  { kind: "none" } | { kind: "kept"; offset: number } | { kind: "unmatched" };

/** What reprocessing one article would do, before any snapshot is taken:
 * the per-article unit a single-article preview and each kept chapter of a
 * book preview share. */
export interface ReprocessPlan {
  articleId: string;
  proposed: CanonicalArticle;
  assets: ValidatedAsset[];
  /** The source fingerprint differs from the one stored when it was added. */
  sourceChanged: boolean;
  changes: PassageChange[];
  highlights: HighlightConsequence[];
  position: PositionConsequence;
  consequences: ChapterConsequence[];
}

export interface ReprocessPreview extends ReprocessPlan {
  /** Snapshot identity of everything apply depends on: never apply a preview
   * against a newer library state. */
  snapshot: string;
}

export interface PreviewOptions {
  /** Uploaded sources (#64): the candidate must come from the same source
   * bytes as the saved article, or the preview is refused. */
  requireSameSource?: { refusal: string };
}

/** Reader-owned row fields that are never ingestion's to decide. */
const READER_OWNED = [
  "tags",
  "readerTitle",
  "readerAuthor",
  "readerPublishedAt",
  "readerSourceUrl",
  "addedAt",
] as const;

/** Bounded copy for the preview list; the article itself is never truncated. */
const PASSAGE_PREVIEW_LIMIT = 280;

async function loadSaved(articleId: string): Promise<CanonicalArticle> {
  const row = await db.articles.get(articleId);
  const parsed = ArticleSchema.safeParse(row);
  if (!parsed.success)
    throw new ReprocessRefusal("This article is no longer in your library; nothing was changed.");
  return parsed.data;
}

/** Every revision's rows of one article, by the [articleId+revision] key. */
function everyRevision<T, K>(table: Table<T, K>, articleId: string): Collection<T, K> {
  return table
    .where("[articleId+revision]")
    .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER]);
}

/** Everything apply reads, serialized in a stable order. */
async function snapshotOf(articleId: string): Promise<string> {
  const [row, highlights, locations, completions, collections, corrections] = await Promise.all([
    db.articles.get(articleId),
    everyRevision(db.highlights, articleId).toArray(),
    everyRevision(db.location, articleId).toArray(),
    db.completions.toArray(),
    db.collections.toArray(),
    // Spec #68 / #71 — a correction made between preview and apply is a change.
    db.corrections.get(articleId),
  ]);
  return JSON.stringify({ row, highlights, locations, completions, collections, corrections });
}

function adoptCandidate(saved: CanonicalArticle, fresh: CanonicalArticle): CanonicalArticle {
  const keep: Partial<CanonicalArticle> = {};
  for (const key of READER_OWNED) {
    if (saved[key] !== undefined) Object.assign(keep, { [key]: saved[key] });
  }
  const aliases = [
    ...(saved.provenance.sourceAliases ?? []),
    ...(fresh.provenance.sourceAliases ?? []),
    ...(saved.provenance.sourceUrl !== undefined &&
    saved.provenance.sourceUrl !== fresh.provenance.sourceUrl
      ? [saved.provenance.sourceUrl]
      : []),
  ].filter((url, n, all) => all.indexOf(url) === n && url !== fresh.provenance.sourceUrl);
  const proposed = ArticleSchema.parse({
    ...fresh,
    ...keep,
    id: saved.id,
    revision: saved.revision + 1,
    provenance: {
      ...fresh.provenance,
      ...(aliases.length > 0 ? { sourceAliases: aliases } : { sourceAliases: undefined }),
    },
    structure: undefined,
  });
  proposed.structure = deriveWorkStructure({
    ...proposed,
    provenanceTitle: proposed.provenance.title,
  });
  return proposed;
}

/** Passage-level diff of the two normalized texts (longest common
 * subsequence over passages, after trimming the shared ends). */
export function passageChanges(before: string[], after: string[]): PassageChange[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const bound = (text: string): string =>
    text.length > PASSAGE_PREVIEW_LIMIT ? `${text.slice(0, PASSAGE_PREVIEW_LIMIT)}…` : text;
  const out: PassageChange[] = [];
  const push = (kind: PassageChange["kind"], text: string) => {
    if (text.trim() !== "") out.push({ kind, text: bound(text) });
  };
  // Very large rewrites skip the quadratic table: everything in the changed
  // middle is honestly reported as removed then added.
  if (a.length * b.length > 4_000_000) {
    for (const text of a) push("removed", text);
    for (const text of b) push("added", text);
    return out;
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) push("removed", a[i++]!);
    else push("added", b[j++]!);
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return out;
}

/** The latest saved position across revisions (the library's own fold). */
async function latestLocation(articleId: string): Promise<LocationRecord | undefined> {
  const rows = await everyRevision(db.location, articleId).toArray();
  return rows
    .flatMap((row) => {
      const parsed = LocationRecordSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((x, y) => (x.savedAt < y.savedAt ? 1 : x.savedAt > y.savedAt ? -1 : 0))[0];
}

/** Re-anchor a reading position by the text that follows it. */
function carryPosition(
  saved: CanonicalArticle,
  proposed: CanonicalArticle,
  location: LocationRecord | undefined,
): PositionConsequence {
  if (!location) return { kind: "none" };
  if (!isSameText(location, saved)) return { kind: "unmatched" };
  const total = graphemeLength(saved);
  // Spec #66 — finished is reaching the end of the MAIN text; a finish
  // carries to the proposed article's main-text end (its end-pin), never to
  // the end of its notes. A position inside the notes re-anchors by quote.
  // The legacy end pin (a pre-#66 finish at the end of the notes) is a finish.
  const mainEnd = mainTextLength(saved);
  const saveOffset = fromLegacyEndPin(location.graphemeOffset, mainEnd, total);
  if (!inNotesOffset(saveOffset, mainEnd) && isFinishedOffset(saveOffset, mainEnd))
    return { kind: "kept", offset: mainTextLength(proposed) };
  if (location.graphemeOffset === 0) return { kind: "kept", offset: 0 };
  const start = Math.min(location.graphemeOffset, total);
  const quote = deriveQuoteSelector(saved, { start, end: Math.min(total, start + 48) });
  const resolved = resolveQuoteSelector(proposed, quote, { start, end: start + 48 });
  return typeof resolved === "string"
    ? { kind: "unmatched" }
    : { kind: "kept", offset: resolved.start };
}

/**
 * previewReprocess — the core. No writes. Adopts `candidate` (a fresh ingest
 * result from any source) as the next revision of the saved article and
 * reports every consequence apply would have.
 */
export async function previewReprocess(
  articleId: string,
  candidate: IngestionSuccess,
  options: PreviewOptions = {},
): Promise<ReprocessPreview> {
  const snapshot = await snapshotOf(articleId);
  const saved = await loadSaved(articleId);
  const fresh = ArticleSchema.parse(candidate.article);
  const sourceChanged = saved.provenance.originalHtmlHash !== fresh.provenance.originalHtmlHash;
  if (options.requireSameSource && sourceChanged)
    throw new ReprocessRefusal(options.requireSameSource.refusal);
  return {
    snapshot,
    ...(await planRevision(saved, adoptCandidate(saved, fresh), candidate.assets, sourceChanged)),
  };
}

/** No writes. Every consequence of replacing `saved` with `proposed`. */
async function planRevision(
  saved: CanonicalArticle,
  proposed: CanonicalArticle,
  assets: ValidatedAsset[],
  sourceChanged: boolean,
): Promise<ReprocessPlan> {
  const articleId = saved.id;
  const highlights: HighlightConsequence[] = [];
  for (const row of await everyRevision(db.highlights, articleId).toArray()) {
    const parsed = HighlightRecordSchema.safeParse(row);
    if (!parsed.success) continue;
    const resolved = resolveQuoteSelector(proposed, parsed.data.quote, parsed.data.position);
    highlights.push({
      highlightId: parsed.data.id,
      exact: parsed.data.quote.exact,
      outcome: typeof resolved === "string" ? resolved : "confident",
    });
  }

  const oldStructure =
    saved.structure ?? deriveWorkStructure({ ...saved, provenanceTitle: saved.provenance.title });
  return {
    articleId,
    proposed,
    assets,
    sourceChanged,
    changes: passageChanges(
      normalizeText(saved).split(BLOCK_SEPARATOR),
      normalizeText(proposed).split(BLOCK_SEPARATOR),
    ),
    highlights,
    position: carryPosition(saved, proposed, await latestLocation(articleId)),
    consequences: await chapterConsequences(articleId, oldStructure, proposed.structure),
  };
}

/**
 * previewUrlReprocess — the URL source. Re-fetches the saved address through
 * the existing guarded ingest endpoint (SSRF/size/redirect caps unchanged).
 * An unreachable or refused source rejects with the IngestionError; the
 * article is untouched because nothing has been written.
 */
export async function previewUrlReprocess(
  articleId: string,
  fetchSource: (url: string) => Promise<IngestionSuccess> = ingestUrl,
): Promise<ReprocessPreview> {
  const saved = await loadSaved(articleId);
  const url = saved.provenance.sourceUrl;
  if (saved.ingestionMeta?.source !== "url" || url === undefined)
    throw new ReprocessRefusal(
      "This article was not added from a web address, so it cannot be fetched again.",
    );
  return previewReprocess(articleId, await fetchSource(url));
}

/** Uploaded article sources (#64): Lem Reader keeps no original files, so
 * the reader chooses the original again. An HTML file upload is stored as
 * "paste" (the client posts its text through the paste channel, origin
 * "paste" too), so it cannot be told apart from typed paste: paste articles
 * take the same path and the fingerprint check decides. PDF is not here
 * (spec #66: "PDF ingestion is unchanged" — PDF articles have their own
 * repair flow). */
export const UPLOAD_SOURCES = ["markdown", "html-upload", "paste"] as const;
export type UploadSource = (typeof UPLOAD_SOURCES)[number];

export const isUploadSource = (source: ArticleSource | undefined): source is UploadSource =>
  (UPLOAD_SOURCES as readonly string[]).includes(source ?? "");

/** The copy for a re-chosen file whose fingerprint does not match. */
export const NOT_THE_ORIGINAL =
  "This is not the original file for this article: its fingerprint does not match the one saved when you added it. Nothing was changed.";

/** Process a re-chosen original with the SAME ingestion channel the article
 * was added through (the add dialog's dispatch, keyed by the saved source
 * rather than the new file's name). */
export async function ingestOriginalFile(
  file: File,
  source: UploadSource,
): Promise<IngestionSuccess> {
  if (file.size > 5 * 1024 * 1024) throw new IngestionError("response-too-large");
  if (source === "markdown") return ingestMarkdown(await file.text(), file.name);
  return ingestHtml(await file.text());
}

/**
 * previewUploadReprocess — the upload source (#64). The re-chosen file must
 * come from the same bytes as the saved article (its stored source
 * fingerprint), or the preview is refused calmly with nothing written.
 */
export async function previewUploadReprocess(
  articleId: string,
  file: File,
  ingestFile: (file: File, source: UploadSource) => Promise<IngestionSuccess> = ingestOriginalFile,
): Promise<ReprocessPreview> {
  const saved = await loadSaved(articleId);
  const source = saved.ingestionMeta?.source;
  if (!isUploadSource(source))
    throw new ReprocessRefusal(
      "This article was not added from a file, so there is no original file to choose.",
    );
  return previewReprocess(articleId, await ingestFile(file, source), {
    requireSameSource: { refusal: NOT_THE_ORIGINAL },
  });
}

const STALE_PREVIEW =
  "This article or its reader data changed after the preview. Preview again before applying; nothing was changed.";
const ACCEPTANCE_REQUIRED =
  "Explicit acceptance is required for the disclosed chapter consequences; nothing was changed.";

function assetRowsOf(
  assets: readonly (ValidatedAsset & { articleId?: string })[],
  articleId: string,
  createdAt: string,
): AssetRecordRow[] {
  return assets.map((asset) => ({
    articleId: asset.articleId ?? articleId,
    assetId: asset.assetId,
    contentType: asset.contentType,
    byteLength: asset.byteLength,
    data: new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType }),
    createdAt,
  }));
}

/** Inside a transaction: drop the accepted completion and collection-entry
 * consequences. */
async function writeConsequences(
  consequences: readonly ChapterConsequence[],
  updatedAt: string,
): Promise<void> {
  for (const consequence of consequences) {
    if (consequence.kind === "completion") await db.completions.delete(consequence.id);
  }
  const byCollection = new Map<string, Set<string>>();
  for (const item of consequences) {
    if (item.kind !== "collection-entry") continue;
    const set = byCollection.get(item.collectionId) ?? new Set<string>();
    set.add(item.entryId);
    byCollection.set(item.collectionId, set);
  }
  for (const [id, removed] of byCollection) {
    const before = CollectionSchema.parse(await db.collections.get(id));
    await db.collections.put({
      ...before,
      entries: before.entries.filter((entry) => !removed.has(entry.id)),
      updatedAt,
    });
    const active = await db.collectionActiveEntries.get(id);
    if (active && removed.has(active.entryId)) await db.collectionActiveEntries.delete(id);
  }
}

/** Inside a transaction: write one planned revision, its re-anchored
 * position and its replacement assets. `row` adds stored-only fields (the
 * denormalized chapter `bookId` index). */
async function writeRevision(
  plan: Pick<ReprocessPlan, "articleId" | "proposed" | "position">,
  assetRows: readonly AssetRecordRow[],
  createdAt: string,
  row: Record<string, unknown> = {},
): Promise<void> {
  const { articleId, proposed } = plan;
  if (plan.position.kind === "kept") {
    const latest = await latestLocation(articleId);
    await everyRevision(db.location, articleId).delete();
    // The savedAt stays the reader's own: reprocessing is not reading.
    await db.location.put({
      schemaVersion: 1,
      articleId,
      revision: proposed.revision,
      graphemeOffset: plan.position.offset,
      savedAt: latest?.savedAt ?? createdAt,
    });
  }
  await db.assets.where("articleId").equals(articleId).delete();
  await db.articles.put({ ...proposed, ...row });
  for (const asset of assetRows) await db.assets.put(asset);
}

/** Apply a preview as one transaction. Refuses a preview made against an
 * older library state, and chapter consequences that were not accepted. */
export async function applyReprocess(
  preview: ReprocessPreview,
  options: { acceptConsequences?: boolean } = {},
): Promise<void> {
  const createdAt = new Date().toISOString();
  const assetRows = assetRowsOf(preview.assets, preview.articleId, createdAt);
  await db.transaction(
    "rw",
    [
      db.articles,
      db.assets,
      db.highlights,
      db.location,
      db.completions,
      db.collections,
      db.collectionActiveEntries,
      db.corrections,
    ],
    async () => {
      if ((await snapshotOf(preview.articleId)) !== preview.snapshot)
        throw new ReprocessRefusal(STALE_PREVIEW);
      if (preview.consequences.length > 0 && options.acceptConsequences !== true)
        throw new ReprocessRefusal(ACCEPTANCE_REQUIRED);
      await writeConsequences(preview.consequences, createdAt);
      await writeRevision(preview, assetRows, createdAt);
    },
  );
}

// ── EPUB books (#64, spec #66 story 59) ─────────────────────────────────────
// A book reprocesses as a whole book: the reader re-chooses the original
// EPUB, whose file fingerprint must match the saved book's. Chapters are
// matched to the saved chapters by their own source fingerprint (the
// chapter's source document hash), never by position: a chapter that is
// admitted, skipped or reordered differently by current ingestion cannot
// take over another chapter's identity, highlights or progress.
//   - A matched chapter keeps its article id and becomes its next revision,
//     with the same carry-over rules as a single article.
//   - A newly admitted chapter is added under an id no saved chapter ever
//     used (its fresh positional id may name a different saved chapter).
//   - A saved chapter with no match leaves the book. That deletes it with
//     its highlights, notes and position, so it is a disclosed consequence
//     that needs explicit acceptance, together with every completion and
//     collection entry that targets it.

export const NOT_THE_ORIGINAL_BOOK =
  "This is not the original file for this book: its fingerprint does not match the one saved when you added it. Nothing was changed.";

export type BookConsequence =
  ChapterConsequence | { kind: "chapter-removed"; articleId: string; label: string };

export interface BookChapterSummary {
  articleId: string;
  title: string;
}

export interface BookReprocessPreview {
  bookId: string;
  snapshot: string;
  proposedBook: Book;
  /** Matched chapters, in the new book order. */
  kept: ReprocessPlan[];
  added: (BookChapterSummary & { article: CanonicalArticle })[];
  removed: (BookChapterSummary & { highlightCount: number })[];
  chaptersBefore: string[];
  chaptersAfter: string[];
  changes: (PassageChange & { chapter: string })[];
  highlights: (HighlightConsequence & { chapter: string })[];
  /** Titles of kept chapters whose reading position cannot be matched. */
  positionsUnmatched: string[];
  consequences: BookConsequence[];
  assets: BookAsset[];
}

const boundTitle = (title: string): string =>
  `“${title.length > 120 ? `${title.slice(0, 120)}…` : title}”`;

const targetsArticle = (target: CollectionEntryTarget, articleId: string): boolean =>
  target.kind !== "book" && target.articleId === articleId;

async function loadBook(bookId: string): Promise<Book> {
  const parsed = BookSchema.safeParse(await db.books.get(bookId));
  if (!parsed.success)
    throw new ReprocessRefusal("This book is no longer in your library; nothing was changed.");
  return parsed.data;
}

/** Declared TOC ∪ live bookId carriers (the removeBook live-truth rule). */
async function bookChapterIds(book: Book): Promise<string[]> {
  const ids = [...book.chapterArticleIds];
  for (const key of await db.articles.where("bookId").equals(book.id).primaryKeys())
    if (!ids.includes(String(key))) ids.push(String(key));
  return ids;
}

/** Everything a book apply reads, serialized in a stable order. */
async function bookSnapshotOf(bookId: string): Promise<string> {
  const row = await db.books.get(bookId);
  const chapterIds = row ? await bookChapterIds(BookSchema.parse(row)) : [];
  const chapters = [];
  for (const id of chapterIds) {
    chapters.push({
      id,
      row: await db.articles.get(id),
      highlights: await everyRevision(db.highlights, id).toArray(),
      locations: await everyRevision(db.location, id).toArray(),
      notes: await db.articleNotes.where("articleId").equals(id).toArray(),
      corrections: await db.corrections.get(id),
    });
  }
  return JSON.stringify({
    row,
    chapters,
    completions: await db.completions.toArray(),
    collections: await db.collections.toArray(),
  });
}

/** Process a re-chosen original EPUB through the same book channel the add
 * dialog uses. */
export async function ingestOriginalBook(file: File): Promise<EpubIngestionSuccess> {
  if (file.size > EPUB_MAX_BYTES) throw new IngestionError("epub-too-large");
  return ingestEpub(bytesToBase64(new Uint8Array(await file.arrayBuffer())), file.name);
}

/**
 * previewBookReprocess — no writes. Re-ingests the re-chosen original EPUB
 * and reports the whole book's consequences: chapters before and after,
 * added and removed chapters, changed passages, every highlight's re-match
 * outcome and every chapter consequence.
 */
export async function previewBookReprocess(
  bookId: string,
  file: File,
  ingestBook: (file: File) => Promise<EpubIngestionSuccess> = ingestOriginalBook,
): Promise<BookReprocessPreview> {
  const candidate = await ingestBook(file);
  const snapshot = await bookSnapshotOf(bookId);
  const savedBook = await loadBook(bookId);
  if (candidate.book.originalFileHash !== savedBook.originalFileHash)
    throw new ReprocessRefusal(NOT_THE_ORIGINAL_BOOK);

  const savedChapters: CanonicalArticle[] = [];
  for (const id of await bookChapterIds(savedBook)) {
    const parsed = ArticleSchema.safeParse(await db.articles.get(id));
    if (parsed.success) savedChapters.push(parsed.data);
  }
  const usedIds = new Set(savedChapters.map((c) => c.id));
  const matched = new Set<string>();
  const kept: ReprocessPlan[] = [];
  const added: BookReprocessPreview["added"] = [];
  const finalChapters: CanonicalArticle[] = [];
  const addedAt = new Date().toISOString();
  for (const freshRow of candidate.articles) {
    const fresh = ArticleSchema.parse(freshRow);
    const saved = savedChapters.find(
      (c) =>
        !matched.has(c.id) && c.provenance.originalHtmlHash === fresh.provenance.originalHtmlHash,
    );
    const meta = { ...fresh.ingestionMeta!, bookId };
    if (saved) {
      matched.add(saved.id);
      const proposed = adoptCandidate(saved, { ...fresh, ingestionMeta: meta });
      kept.push(await planRevision(saved, proposed, [], false));
      finalChapters.push(proposed);
      continue;
    }
    let id = fresh.id;
    for (let n = 2; usedIds.has(id) || (await db.articles.get(id)) !== undefined; n++)
      id = `${fresh.id}-r${n}`;
    usedIds.add(id);
    const article = ArticleSchema.parse({
      ...fresh,
      id,
      ingestionMeta: meta,
      addedAt,
      structure: undefined,
    });
    article.structure = deriveWorkStructure({
      ...article,
      provenanceTitle: article.provenance.title,
    });
    added.push({ articleId: id, title: article.provenance.title, article });
    finalChapters.push(article);
  }

  const removed: BookReprocessPreview["removed"] = [];
  const consequences: BookConsequence[] = kept.flatMap((plan) => plan.consequences);
  const completions = await db.completions.toArray();
  const collections = await db.collections.toArray();
  for (const chapter of savedChapters.filter((c) => !matched.has(c.id))) {
    const title = chapter.provenance.title;
    const highlightCount = await everyRevision(db.highlights, chapter.id).count();
    removed.push({ articleId: chapter.id, title, highlightCount });
    consequences.push({
      kind: "chapter-removed",
      articleId: chapter.id,
      label: `Remove chapter ${boundTitle(title)} with its ${highlightCount} highlight${highlightCount === 1 ? "" : "s"}, notes, and reading position; it is not in the reprocessed book.`,
    });
    for (const completion of completions)
      if (targetsArticle(completion.target, chapter.id))
        consequences.push({
          kind: "completion",
          id: completion.targetKey,
          label: `Remove ${completion.finished ? "finished" : "unfinished"} status for chapter ${boundTitle(title)}.`,
        });
    for (const collection of collections)
      for (const entry of collection.entries)
        if (targetsArticle(entry.target, chapter.id))
          consequences.push({
            kind: "collection-entry",
            collectionId: collection.id,
            entryId: entry.id,
            label: `Remove chapter ${boundTitle(title)}, entry ${entry.id}, from “${collection.name}”; it is no longer in the book.`,
          });
  }

  const titleOf = (id: string) =>
    kept.find((plan) => plan.articleId === id)?.proposed.provenance.title ?? "";
  return {
    bookId,
    snapshot,
    proposedBook: BookSchema.parse({
      ...candidate.book,
      id: bookId,
      chapterArticleIds: finalChapters.map((c) => c.id),
      tags: savedBook.tags,
      addedAt: savedBook.addedAt,
    }),
    kept,
    added,
    removed,
    chaptersBefore: savedChapters.map((c) => c.provenance.title),
    chaptersAfter: finalChapters.map((c) => c.provenance.title),
    changes: kept.flatMap((plan) =>
      plan.changes.map((change) => ({ ...change, chapter: titleOf(plan.articleId) })),
    ),
    highlights: kept.flatMap((plan) =>
      plan.highlights.map((h) => ({ ...h, chapter: titleOf(plan.articleId) })),
    ),
    positionsUnmatched: kept
      .filter((plan) => plan.position.kind === "unmatched")
      .map((plan) => titleOf(plan.articleId)),
    consequences,
    assets: bookAssetsForChapters(finalChapters, candidate.assets),
  };
}

/** Apply a book preview as one transaction: every chapter, the removed
 * chapters' reader data and the book row commit together or not at all. */
export async function applyBookReprocess(
  preview: BookReprocessPreview,
  options: { acceptConsequences?: boolean } = {},
): Promise<void> {
  const createdAt = new Date().toISOString();
  const assetRows = assetRowsOf(preview.assets, "", createdAt);
  const rowsFor = (id: string) => assetRows.filter((row) => row.articleId === id);
  await db.transaction(
    "rw",
    [
      db.books,
      db.articles,
      db.assets,
      db.highlights,
      db.notes,
      db.noteDrafts,
      db.articleNotes,
      db.articleNoteDrafts,
      db.location,
      db.readingSessions,
      db.completions,
      db.collections,
      db.collectionActiveEntries,
      db.corrections,
    ],
    async () => {
      let stale = (await bookSnapshotOf(preview.bookId)) !== preview.snapshot;
      for (const { articleId } of preview.added)
        stale ||= (await db.articles.get(articleId)) !== undefined;
      if (stale)
        throw new ReprocessRefusal(
          "This book or its reader data changed after the preview. Preview again before applying; nothing was changed.",
        );
      if (preview.consequences.length > 0 && options.acceptConsequences !== true)
        throw new ReprocessRefusal(ACCEPTANCE_REQUIRED);
      await writeConsequences(
        preview.consequences.filter((c): c is ChapterConsequence => c.kind !== "chapter-removed"),
        createdAt,
      );
      for (const { articleId } of preview.removed) {
        const highlightIds = (await everyRevision(db.highlights, articleId).primaryKeys()).map(
          (k) => (Array.isArray(k) ? String(k[0]) : String(k)),
        );
        if (highlightIds.length > 0) {
          await db.notes.where("highlightId").anyOf(highlightIds).delete();
          await db.noteDrafts.bulkDelete(highlightIds);
        }
        await everyRevision(db.highlights, articleId).delete();
        await everyRevision(db.location, articleId).delete();
        await db.articleNotes.where("articleId").equals(articleId).delete();
        await db.articleNoteDrafts.where("articleId").equals(articleId).delete();
        await db.assets.where("articleId").equals(articleId).delete();
        await db.readingSessions.where("articleId").equals(articleId).delete();
        // Spec #68 / #71 — a dropped chapter's corrections go with it.
        await db.corrections.delete(articleId);
        await db.articles.delete(articleId);
      }
      const bookRow = { bookId: preview.bookId };
      for (const plan of preview.kept)
        await writeRevision(plan, rowsFor(plan.articleId), createdAt, bookRow);
      for (const { articleId, article } of preview.added)
        await writeRevision(
          { articleId, proposed: article, position: { kind: "none" } },
          rowsFor(articleId),
          createdAt,
          bookRow,
        );
      await db.books.put(preview.proposedBook);
    },
  );
}
