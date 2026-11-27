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
import {
  ArticleSchema,
  CollectionSchema,
  type CanonicalArticle,
  type LocationRecord,
  LocationRecordSchema,
  HighlightRecordSchema,
} from "../content/schema";
import {
  BLOCK_SEPARATOR,
  deriveQuoteSelector,
  graphemeLength,
  normalizeText,
  resolveQuoteSelector,
} from "../content/normalizeText";
import { deriveWorkStructure } from "../content/structure";
import { isFinishedOffset } from "../reader/readingPosition";
import {
  ingestUrl,
  type IngestionSuccess,
  type ValidatedAsset,
} from "../ingestion/IngestionClient";
import { db, type AssetRecordRow } from "./db";
import { chapterConsequences, type ChapterConsequence } from "./chapterConsequences";

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

export interface ReprocessPreview {
  articleId: string;
  /** Snapshot identity of everything apply depends on: never apply a preview
   * against a newer library state. */
  snapshot: string;
  proposed: CanonicalArticle;
  assets: ValidatedAsset[];
  /** The source fingerprint differs from the one stored when it was added. */
  sourceChanged: boolean;
  changes: PassageChange[];
  highlights: HighlightConsequence[];
  position: PositionConsequence;
  consequences: ChapterConsequence[];
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

/** Everything apply reads, serialized in a stable order. */
async function snapshotOf(articleId: string): Promise<string> {
  const range: [[string, number], [string, number]] = [
    [articleId, 0],
    [articleId, Number.MAX_SAFE_INTEGER],
  ];
  const [row, highlights, locations, completions, collections] = await Promise.all([
    db.articles.get(articleId),
    db.highlights
      .where("[articleId+revision]")
      .between(...range)
      .toArray(),
    db.location
      .where("[articleId+revision]")
      .between(...range)
      .toArray(),
    db.completions.toArray(),
    db.collections.toArray(),
  ]);
  return JSON.stringify({ row, highlights, locations, completions, collections });
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
  const rows = await db.location
    .where("[articleId+revision]")
    .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER])
    .toArray();
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
  if (location.revision !== saved.revision) return { kind: "unmatched" };
  const total = graphemeLength(saved);
  if (isFinishedOffset(location.graphemeOffset, total))
    return { kind: "kept", offset: graphemeLength(proposed) };
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
  const proposed = adoptCandidate(saved, fresh);

  const highlights: HighlightConsequence[] = [];
  for (const row of await db.highlights
    .where("[articleId+revision]")
    .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER])
    .toArray()) {
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
    snapshot,
    proposed,
    assets: candidate.assets,
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

/** Apply a preview as one transaction. Refuses a preview made against an
 * older library state, and chapter consequences that were not accepted. */
export async function applyReprocess(
  preview: ReprocessPreview,
  options: { acceptConsequences?: boolean } = {},
): Promise<void> {
  const { articleId, proposed } = preview;
  const createdAt = new Date().toISOString();
  const assetRows: AssetRecordRow[] = preview.assets.map((asset) => ({
    articleId,
    assetId: asset.assetId,
    contentType: asset.contentType,
    byteLength: asset.byteLength,
    data: new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType }),
    createdAt,
  }));
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
    ],
    async () => {
      if ((await snapshotOf(articleId)) !== preview.snapshot)
        throw new ReprocessRefusal(
          "This article or its reader data changed after the preview. Preview again before applying; nothing was changed.",
        );
      if (preview.consequences.length > 0 && options.acceptConsequences !== true)
        throw new ReprocessRefusal(
          "Explicit acceptance is required for the disclosed chapter consequences; nothing was changed.",
        );
      for (const consequence of preview.consequences) {
        if (consequence.kind === "completion") await db.completions.delete(consequence.id);
      }
      const byCollection = new Map<string, Set<string>>();
      for (const item of preview.consequences) {
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
          updatedAt: createdAt,
        });
        const active = await db.collectionActiveEntries.get(id);
        if (active && removed.has(active.entryId)) await db.collectionActiveEntries.delete(id);
      }
      if (preview.position.kind === "kept") {
        const latest = await latestLocation(articleId);
        await db.location
          .where("[articleId+revision]")
          .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER])
          .delete();
        // The savedAt stays the reader's own: reprocessing is not reading.
        await db.location.put({
          schemaVersion: 1,
          articleId,
          revision: proposed.revision,
          graphemeOffset: preview.position.offset,
          savedAt: latest?.savedAt ?? createdAt,
        });
      }
      await db.assets.where("articleId").equals(articleId).delete();
      await db.articles.put(proposed);
      for (const row of assetRows) await db.assets.put(row);
    },
  );
}
