// src/persistence/correctionsStore.ts
// Spec #68 / issue #71 — the corrections store (ADR 0014: corrections are a
// layer over the preserved original). Follows the PDF repair and
// Reprocessing precedent:
//
//   - `loadCorrections` / `loadAllCorrections` — Zod at the boundary
//     (STATE-04); never throw; a corrupt row reads as "no corrections"
//     (the original), never coerced.
//   - `previewCorrectionsChange(articleId, next)` — NO writes. The proposed
//     corrected article, an outcome per correction, highlight outcomes
//     (confident / ambiguous / orphan / hidden), the reading position
//     re-anchored by quote, and chapter consequences (the derivation PDF
//     repair and Reprocessing share). Carries a snapshot of everything
//     apply reads.
//   - `applyCorrectionsChange(preview, { acceptConsequences })` — ONE rw
//     transaction: refuses a preview made against an older state
//     (STALE_PREVIEW), refuses a preview with consequences the reader
//     hasn't accepted (ACCEPTANCE_REQUIRED — the Correction view shows them
//     in the consequences dialog first, #72), then writes the corrections
//     list, re-anchored highlight positions (confident matches only;
//     nothing else on a highlight row changes), the reading position, and
//     the accepted chapter consequences (completions and collection
//     entries removed). Finished stays finished.
//
// Undo, redo and Restore original (#76) are the same preview / apply over a
// different list: `previewUndoCorrection` (remove one, re-apply the rest —
// later corrections that would no longer fit are `laterNotApplied`, a
// consequence), `previewRestoreOriginal` (the empty list). An apply returns
// the chapter rows its accepted consequences removed; the Correction view's
// session history hands them back (`removedEarlier`) so an undo that brings
// the chapter back puts them back, named in the preview's `restored`.
//
// Chapters: a chapter the correction leaves in place keeps its id and
// title in the corrected structure (src/content/corrections/correctedStructure.ts),
// so its completions and collection entries carry over untouched; only a
// chapter that is genuinely removed (its heading hidden) — or whose title
// changed — is a consequence.
//
// The article row is only ever READ here. Bundled fixtures have no row and
// are not correctable (`NOT_CORRECTABLE`): their corrections would have no
// original to sit on top of in the library, export or delete cascade.

import {
  CORRECTIONS_SCHEMA_VERSION,
  ArticleSchema,
  CorrectionsRecordSchema,
  HighlightRecordSchema,
  LocationRecordSchema,
  type Correction,
  type CorrectionsRecord,
  type LocationRecord,
  type WorkStructure,
} from "../content/schema";
import type { CanonicalArticle } from "../content/types";
import {
  applyCorrections,
  isHiddenByCorrections,
  type CorrectionOutcome,
  type DroppedMark,
} from "../content/corrections/engine";
import { carryOffset } from "../content/corrections/positions";
import { graphemeLength, mainTextLength, resolveQuoteSelector } from "../content/normalizeText";
import { resolveQuoteSelectorExact } from "../annotations/resolution";
import { fromLegacyEndPin, inNotesOffset, isFinishedOffset } from "../reader/readingPosition";
import { resolveWorkStructure } from "../content/chapterTargets";
import { isSameText, textStamp } from "../content/sameText";
import {
  chapterConsequences,
  NO_REMOVED_ROWS,
  reinstatableRows,
  reinstateLabels,
  writeChapterConsequences,
  writeReinstatedRows,
  type ChapterConsequence,
  type RemovedChapterRows,
  type SameChapter,
} from "./chapterConsequences";
import { db } from "./db";

export const STALE_PREVIEW =
  "Something changed while this was open. Nothing was changed; try again.";
export const ACCEPTANCE_REQUIRED =
  "This correction affects highlights or chapters. Nothing was changed.";
export const NOT_CORRECTABLE = "This article can't be corrected. Nothing was changed.";

export class CorrectionsRefusal extends Error {}

const EMPTY: readonly Correction[] = Object.freeze([]);

/** The article's ordered corrections ([] when none, or when the row is corrupt). */
export async function loadCorrections(articleId: string): Promise<readonly Correction[]> {
  try {
    const parsed = CorrectionsRecordSchema.safeParse(await db.corrections.get(articleId));
    return parsed.success ? parsed.data.corrections : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Every article's corrections, for the library snapshot's fold. Never throws. */
export async function loadAllCorrections(): Promise<ReadonlyMap<string, readonly Correction[]>> {
  const out = new Map<string, readonly Correction[]>();
  try {
    for (const row of await db.corrections.toArray()) {
      const parsed = CorrectionsRecordSchema.safeParse(row);
      if (parsed.success && parsed.data.corrections.length > 0) {
        out.set(parsed.data.articleId, parsed.data.corrections);
      }
    }
  } catch {
    // Fail quiet: the library reads the originals.
  }
  return out;
}

/** Every valid corrections RECORD (articleId, ordered list, updatedAt), for
 * export (#77). A corrupt row is dropped (STATE-04, never coerced); an
 * empty list has nothing to carry. Never throws. */
export async function loadAllCorrectionRecords(): Promise<CorrectionsRecord[]> {
  try {
    return (await db.corrections.toArray()).flatMap((row) => {
      const parsed = CorrectionsRecordSchema.safeParse(row);
      return parsed.success && parsed.data.corrections.length > 0 ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

/** "crosses" (#73): the highlight's words are all still there, but a block
 * boundary inside or at its edge moved, so its exact quote no longer
 * matches — found only by its surrounding context. Reported, never
 * re-anchored. */
export type CorrectionHighlightOutcome =
  "confident" | "ambiguous" | "orphan" | "hidden" | "crosses";

export interface CorrectionHighlightConsequence {
  readonly highlightId: string;
  readonly exact: string;
  readonly outcome: CorrectionHighlightOutcome;
}

export interface ContentsChange {
  readonly change: "added" | "removed";
  readonly title: string;
}

/** Chapters in one structure and not the other (ids carry over for
 * chapters a correction leaves in place — corrections/correctedStructure.ts). */
function contentsChanges(
  before: WorkStructure | null,
  after: WorkStructure | null,
): ContentsChange[] {
  const chapters = (s: WorkStructure | null) =>
    (s?.destinations ?? []).filter((d) => d.kind === "chapter");
  const was = chapters(before);
  const now = chapters(after);
  const ids = (list: typeof was) => new Set(list.map((d) => d.id));
  const wasIds = ids(was);
  const nowIds = ids(now);
  return [
    ...was
      .filter((d) => !nowIds.has(d.id))
      .map((d) => ({ change: "removed" as const, title: d.title })),
    ...now
      .filter((d) => !wasIds.has(d.id))
      .map((d) => ({ change: "added" as const, title: d.title })),
  ];
}

export interface CorrectionsPreview {
  readonly articleId: string;
  readonly corrections: readonly Correction[];
  readonly outcomes: readonly CorrectionOutcome[];
  readonly proposed: CanonicalArticle;
  /** Every highlight confidently shown before, and how it fares after. */
  readonly highlights: readonly CorrectionHighlightConsequence[];
  /** The re-anchored reading position (null = no saved position). */
  readonly position: { readonly offset: number } | { readonly unmatched: true } | null;
  readonly chapters: readonly ChapterConsequence[];
  /** Corrections that apply today and would no longer fit (#76: undoing an
   * earlier correction a later one depends on). A consequence. */
  readonly laterNotApplied: readonly {
    readonly correction: Correction;
    readonly reason: string;
  }[];
  /** Rows an earlier accepted consequence removed that this change brings
   * back (session history only, #76) — and their plain-words labels. */
  readonly reinstate: RemovedChapterRows;
  readonly restored: readonly string[];
  /** Issue #74 — chapters the change adds to or removes from the contents
   * (by identity: an unchanged chapter keeps its id). */
  readonly contents: readonly ContentsChange[];
  /** Issue #74 — marks the change drops (a code block holds plain text only),
   * by the words that carried them. */
  readonly droppedMarks: readonly DroppedMark[];
  /** True when nothing needs the reader's acceptance. */
  readonly clean: boolean;
  /** Snapshot identity of everything apply reads. */
  readonly snapshot: string;
}

async function originalOf(articleId: string): Promise<CanonicalArticle> {
  const parsed = ArticleSchema.safeParse(await db.articles.get(articleId));
  if (!parsed.success) throw new CorrectionsRefusal(NOT_CORRECTABLE);
  return parsed.data;
}

function revisionsOf(table: typeof db.highlights | typeof db.location, articleId: string) {
  return table
    .where("[articleId+revision]")
    .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER]);
}

function everyRevision(table: typeof db.highlights | typeof db.location, articleId: string) {
  return revisionsOf(table, articleId).toArray() as Promise<unknown[]>;
}

async function snapshotOf(articleId: string): Promise<string> {
  const [row, corrections, highlights, locations, completions, collections] = await Promise.all([
    db.articles.get(articleId),
    db.corrections.get(articleId),
    everyRevision(db.highlights, articleId),
    everyRevision(db.location, articleId),
    db.completions.toArray(),
    db.collections.toArray(),
  ]);
  return JSON.stringify({ row, corrections, highlights, locations, completions, collections });
}

/** The latest valid saved position across revisions. */
function latest(rows: unknown[]): LocationRecord | undefined {
  return rows
    .flatMap((row) => {
      const parsed = LocationRecordSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((x, y) => (x.savedAt < y.savedAt ? 1 : x.savedAt > y.savedAt ? -1 : 0))[0];
}

/**
 * Carry a reading offset across a corrections change. When both sides share
 * the same view article (hide / unhide change only what is read, never the
 * blocks themselves) the view model's maps are exact: a position inside a
 * newly hidden block lands at the next passage still read. Otherwise the
 * position re-matches by quote (finished stays finished).
 */
function carryBetween(
  before: ReturnType<typeof applyCorrections>,
  after: ReturnType<typeof applyCorrections>,
  offset: number,
): number | null {
  if (before.article === after.article) return offset;
  if (before.view.article === after.view.article) {
    // Finished and the very start are rules, not text: honour them first.
    const mainEnd = mainTextLength(before.article);
    const saveOffset = fromLegacyEndPin(offset, mainEnd, graphemeLength(before.article));
    if (!inNotesOffset(saveOffset, mainEnd) && isFinishedOffset(saveOffset, mainEnd)) {
      return mainTextLength(after.article);
    }
    if (offset === 0) return 0;
    return after.view.readingOffsetFor(before.view.viewOffsetFor(offset));
  }
  return carryOffset(before.article, after.article, offset);
}

/** Corrections keep an unchanged chapter's id; its range may move. */
const sameChapter: SameChapter = (was, now) =>
  was.kind === now.kind && was.title === now.title && was.titleSource === now.titleSource;

interface Plan {
  preview: Omit<CorrectionsPreview, "snapshot">;
  /** Highlight id → its new position (confident matches only). */
  positions: Map<string, { start: number; end: number }>;
  location: LocationRecord | undefined;
}

async function plan(
  articleId: string,
  next: readonly Correction[],
  removedEarlier: RemovedChapterRows = NO_REMOVED_ROWS,
): Promise<Plan> {
  const original = await originalOf(articleId);
  const current = await loadCorrections(articleId);
  const before = applyCorrections(original, current);
  const after = applyCorrections(original, next);

  // Highlights: what the reader sees now (resolved by quote against the
  // shown article) → where the same words land after.
  const highlights: CorrectionHighlightConsequence[] = [];
  const positions = new Map<string, { start: number; end: number }>();
  for (const row of await everyRevision(db.highlights, articleId)) {
    const parsed = HighlightRecordSchema.safeParse(row);
    if (!parsed.success) continue;
    const record = parsed.data;
    const now = resolveQuoteSelector(before.article, record.quote, record.position);
    if (typeof now === "string") continue; // not shown confidently today — untouched
    let outcome: CorrectionHighlightOutcome;
    // Corrections never change words, so a highlight whose text matches
    // exactly today must match exactly after. One whose words now span a
    // moved, merged or split boundary is found only by its context: it is
    // reported as crossing the boundary, never re-attached by the loose
    // prefix/suffix fallback (#73, #75). A highlight already shown only by
    // that fallback (its words changed in an earlier revision) keeps the
    // rule it is shown by.
    const exactToday = typeof resolveQuoteSelectorExact(before.article, record.quote) !== "string";
    const then = exactToday
      ? resolveQuoteSelectorExact(after.article, record.quote)
      : resolveQuoteSelector(after.article, record.quote, now);
    if (typeof then !== "string") {
      outcome = "confident";
      positions.set(record.id, then);
    } else {
      // Still in the view article but inside a hidden block → hidden while
      // the block is hidden (matches again on unhide).
      outcome = isHiddenByCorrections(after, record.quote)
        ? "hidden"
        : exactToday && typeof resolveQuoteSelector(after.article, record.quote, now) !== "string"
          ? "crosses" // its words are all there; only a boundary moved
          : then;
    }
    highlights.push({ highlightId: record.id, exact: record.quote.exact, outcome });
  }

  const location = latest(await everyRevision(db.location, articleId));
  let position: CorrectionsPreview["position"] = null;
  if (location) {
    const offset = isSameText(location, before.article)
      ? carryBetween(before, after, location.graphemeOffset)
      : isSameText(location, original)
        ? carryOffset(original, after.article, location.graphemeOffset)
        : null;
    position = offset === null ? { unmatched: true } : { offset };
  }

  const beforeStructure = resolveWorkStructure(before.article);
  const afterStructure = resolveWorkStructure(after.article);
  const chapters = await chapterConsequences(
    articleId,
    beforeStructure,
    afterStructure,
    sameChapter,
  );
  const contents = contentsChanges(beforeStructure, afterStructure);
  // Marks dropped by the corrections this change adds (earlier ones were
  // told about when they were made).
  const existing = new Set(current.map((c) => c.id));
  const droppedMarks = next.flatMap((c, i) => {
    const outcome = after.outcomes[i];
    return !existing.has(c.id) && outcome?.status === "applied" ? (outcome.droppedMarks ?? []) : [];
  });

  // Later corrections that fit today and would not after this change.
  const appliedNow = new Set(
    current.filter((_, i) => before.outcomes[i]?.status === "applied").map((c) => c.id),
  );
  const laterNotApplied: CorrectionsPreview["laterNotApplied"][number][] = [];
  next.forEach((correction, i) => {
    const outcome = after.outcomes[i];
    if (outcome?.status === "not-applied" && appliedNow.has(correction.id)) {
      laterNotApplied.push({ correction, reason: outcome.reason });
    }
  });

  const reinstate =
    removedEarlier.completions.length + removedEarlier.entries.length === 0
      ? NO_REMOVED_ROWS
      : await reinstatableRows(articleId, removedEarlier, afterStructure);
  const restored =
    reinstate.entries.length + reinstate.completions.length === 0
      ? []
      : reinstateLabels(
          reinstate,
          afterStructure,
          new Map((await db.collections.toArray()).map((c) => [c.id, c.name])),
        );

  const clean =
    chapters.length === 0 &&
    laterNotApplied.length === 0 &&
    contents.length === 0 &&
    droppedMarks.length === 0 &&
    highlights.every((h) => h.outcome === "confident");
  return {
    preview: {
      articleId,
      corrections: next,
      outcomes: after.outcomes,
      proposed: after.article,
      highlights,
      position,
      chapters,
      laterNotApplied,
      reinstate,
      restored,
      contents,
      droppedMarks,
      clean,
    },
    positions,
    location,
  };
}

export interface PreviewOptions {
  /** Rows earlier accepted consequences removed in this session (#76):
   * those whose chapter this change brings back are put back on apply. */
  readonly removedEarlier?: RemovedChapterRows;
}

/** Preview replacing the article's corrections list with `next`. No writes. */
export async function previewCorrectionsChange(
  articleId: string,
  next: readonly Correction[],
  options: PreviewOptions = {},
): Promise<CorrectionsPreview> {
  const snapshot = await snapshotOf(articleId);
  const { preview } = await plan(articleId, next, options.removedEarlier);
  return { ...preview, snapshot };
}

/** Preview undoing ONE correction (any, not only the latest): remove it from
 * the list and re-apply the rest. Later corrections that would no longer fit
 * are the preview's `laterNotApplied`. Removing a not-applied correction
 * (tidying the list) is the same operation and changes nothing else. */
export async function previewUndoCorrection(
  articleId: string,
  correctionId: string,
  options: PreviewOptions = {},
): Promise<CorrectionsPreview> {
  const current = await loadCorrections(articleId);
  return previewCorrectionsChange(
    articleId,
    current.filter((c) => c.id !== correctionId),
    options,
  );
}

/** Preview Restore original: the article exactly as it was added. */
export async function previewRestoreOriginal(
  articleId: string,
  options: PreviewOptions = {},
): Promise<CorrectionsPreview> {
  return previewCorrectionsChange(articleId, EMPTY, options);
}

/** Preview appending one correction. */
export async function previewAddCorrection(
  articleId: string,
  correction: Correction,
): Promise<CorrectionsPreview> {
  const current = await loadCorrections(articleId);
  return previewCorrectionsChange(articleId, [...current, correction]);
}

export interface ApplyOptions {
  /** The reader accepted the preview's consequences (the dialog). */
  readonly acceptConsequences?: boolean;
}

/** What an apply did that only the session can undo: the chapter rows its
 * accepted consequences removed (#76). */
export interface AppliedCorrectionsChange {
  readonly removed: RemovedChapterRows;
}

/** Apply a preview — one atomic transaction (see the header). */
export async function applyCorrectionsChange(
  preview: CorrectionsPreview,
  options: ApplyOptions = {},
): Promise<AppliedCorrectionsChange> {
  const accepted = options.acceptConsequences === true;
  if (!preview.clean && !accepted) throw new CorrectionsRefusal(ACCEPTANCE_REQUIRED);
  const { articleId } = preview;
  let removed: RemovedChapterRows = NO_REMOVED_ROWS;
  await db.transaction(
    "rw",
    [
      db.articles,
      db.corrections,
      db.highlights,
      db.location,
      db.completions,
      db.collections,
      db.collectionActiveEntries,
    ],
    async () => {
      if ((await snapshotOf(articleId)) !== preview.snapshot) {
        throw new CorrectionsRefusal(STALE_PREVIEW);
      }
      const {
        positions,
        location,
        preview: fresh,
      } = await plan(articleId, preview.corrections, preview.reinstate);
      // Consent covers exactly what the reader was shown: the same state
      // (snapshot) gives the same consequences, re-derived here.
      if (!fresh.clean && !accepted) throw new CorrectionsRefusal(ACCEPTANCE_REQUIRED);
      const stamp = textStamp(fresh.proposed);
      const now = new Date().toISOString();

      if (preview.corrections.length === 0) {
        await db.corrections.delete(articleId);
      } else {
        const record: CorrectionsRecord = {
          schemaVersion: CORRECTIONS_SCHEMA_VERSION,
          articleId,
          corrections: [...preview.corrections],
          updatedAt: now,
        };
        await db.corrections.put(record);
      }
      if (accepted) removed = await writeChapterConsequences(fresh.chapters, now);
      await writeReinstatedRows(fresh.reinstate, now);

      for (const [id, position] of positions) {
        const row = await db.highlights.get(id);
        if (!row) continue;
        const { corrections: _old, ...rest } = row;
        void _old;
        await db.highlights.put({
          ...rest,
          position,
          ...(stamp.corrections !== undefined ? { corrections: stamp.corrections } : {}),
        });
      }

      if (location && fresh.position !== null && "offset" in fresh.position) {
        // One position per article (the saved passage) at the current
        // revision, stamped with the new substrate; the reader's savedAt is
        // kept (a correction is not reading).
        await revisionsOf(db.location, articleId).delete();
        await db.location.put({
          schemaVersion: 1,
          articleId,
          revision: stamp.revision,
          graphemeOffset: fresh.position.offset,
          savedAt: location.savedAt,
          ...(stamp.corrections !== undefined ? { corrections: stamp.corrections } : {}),
        });
      }
    },
  );
  return { removed };
}

/** Delete an article's corrections (inside the caller's delete transaction). */
export async function removeCorrectionsForDeletedArticles(articleIds: readonly string[]) {
  if (articleIds.length > 0) await db.corrections.bulkDelete([...articleIds]);
}
