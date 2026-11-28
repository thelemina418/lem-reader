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
//   - `applyCorrectionsChange(preview)` — ONE rw transaction: refuses a
//     preview made against an older state (STALE_PREVIEW), refuses a
//     preview with consequences the reader hasn't accepted
//     (ACCEPTANCE_REQUIRED — #71 never sends one; #72 adds the dialog), then
//     writes the corrections list, re-anchored highlight positions
//     (confident matches only; nothing else on a highlight row changes) and
//     the reading position. Finished stays finished.
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
} from "../content/schema";
import type { CanonicalArticle } from "../content/types";
import { applyCorrections, type CorrectionOutcome } from "../content/corrections/engine";
import { carryOffset } from "../content/corrections/positions";
import { graphemeLength, mainTextLength, resolveQuoteSelector } from "../content/normalizeText";
import { fromLegacyEndPin, inNotesOffset, isFinishedOffset } from "../reader/readingPosition";
import { resolveWorkStructure } from "../content/chapterTargets";
import { isSameText, textStamp } from "../content/sameText";
import { chapterConsequences, type ChapterConsequence } from "./chapterConsequences";
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

export type CorrectionHighlightOutcome = "confident" | "ambiguous" | "orphan" | "hidden";

export interface CorrectionHighlightConsequence {
  readonly highlightId: string;
  readonly exact: string;
  readonly outcome: CorrectionHighlightOutcome;
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

interface Plan {
  preview: Omit<CorrectionsPreview, "snapshot">;
  /** Highlight id → its new position (confident matches only). */
  positions: Map<string, { start: number; end: number }>;
  location: LocationRecord | undefined;
}

async function plan(articleId: string, next: readonly Correction[]): Promise<Plan> {
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
    const then = resolveQuoteSelector(after.article, record.quote, now);
    if (typeof then !== "string") {
      outcome = "confident";
      positions.set(record.id, then);
    } else {
      // Still in the view article but inside a hidden block → hidden while
      // the block is hidden (matches again on unhide).
      const inView = resolveQuoteSelector(after.view.article, record.quote);
      const hiddenThere =
        typeof inView !== "string" &&
        after.view.allBlocks.some(
          (b) => b.hidden && b.viewStart <= inView.start && inView.end <= b.viewEnd,
        );
      outcome = hiddenThere ? "hidden" : then;
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

  const chapters = await chapterConsequences(
    articleId,
    resolveWorkStructure(before.article),
    resolveWorkStructure(after.article),
  );
  const clean = chapters.length === 0 && highlights.every((h) => h.outcome === "confident");
  return {
    preview: {
      articleId,
      corrections: next,
      outcomes: after.outcomes,
      proposed: after.article,
      highlights,
      position,
      chapters,
      clean,
    },
    positions,
    location,
  };
}

/** Preview replacing the article's corrections list with `next`. No writes. */
export async function previewCorrectionsChange(
  articleId: string,
  next: readonly Correction[],
): Promise<CorrectionsPreview> {
  const snapshot = await snapshotOf(articleId);
  const { preview } = await plan(articleId, next);
  return { ...preview, snapshot };
}

/** Preview appending one correction. */
export async function previewAddCorrection(
  articleId: string,
  correction: Correction,
): Promise<CorrectionsPreview> {
  const current = await loadCorrections(articleId);
  return previewCorrectionsChange(articleId, [...current, correction]);
}

/** Apply a preview — one atomic transaction (see the header). */
export async function applyCorrectionsChange(preview: CorrectionsPreview): Promise<void> {
  if (!preview.clean) throw new CorrectionsRefusal(ACCEPTANCE_REQUIRED);
  const { articleId } = preview;
  await db.transaction(
    "rw",
    [db.articles, db.corrections, db.highlights, db.location, db.completions, db.collections],
    async () => {
      if ((await snapshotOf(articleId)) !== preview.snapshot) {
        throw new CorrectionsRefusal(STALE_PREVIEW);
      }
      const { positions, location, preview: fresh } = await plan(articleId, preview.corrections);
      if (!fresh.clean) throw new CorrectionsRefusal(ACCEPTANCE_REQUIRED);
      const stamp = textStamp(fresh.proposed);

      if (preview.corrections.length === 0) {
        await db.corrections.delete(articleId);
      } else {
        const record: CorrectionsRecord = {
          schemaVersion: CORRECTIONS_SCHEMA_VERSION,
          articleId,
          corrections: [...preview.corrections],
          updatedAt: new Date().toISOString(),
        };
        await db.corrections.put(record);
      }

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
}

/** Delete an article's corrections (inside the caller's delete transaction). */
export async function removeCorrectionsForDeletedArticles(articleIds: readonly string[]) {
  if (articleIds.length > 0) await db.corrections.bulkDelete([...articleIds]);
}
