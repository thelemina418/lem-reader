// src/ingestion/library/readingStats.ts
// Issue #38 — the ambient reading-stats derivations ("on the shelf" verdict
// from prototype branch prototype/stats-presentation, wayfinder ticket #29).
// PURE module (the readingState.ts discipline): zero React, zero Dexie,
// zero DOM — components own the reads (the ONE LibrarySnapshot carries the
// ReadingSessionRecord[] rows), this module owns the algebra.
//
// Presentation contracts (issue #38 + the prototype's agreed variant A):
//   1. ONE summary strip sentence — "You've read {duration} across {N}
//      visits." — plus a second sentence "{N} finished." ONLY when the
//      finished count is nonzero. No streaks, no goals, no words-read.
//   2. A per-article quiet meta line "{duration} read here", SUPPRESSED
//      under one minute of accrued time.
//   3. Silence is the empty state: zero visits → the strip renders null;
//      under-a-minute articles → no meta line. No zeros, no placeholders.
//   4. Orphan history (a session whose articleId is not in the library —
//     possible only via the issue #37 bundle-import ride-along, since
//     removal cascades) counts NOWHERE: the prototype's deriveStats
//     skipped it and this module keeps that discipline. Visits and time
//     always sum over the SAME counted sessions.
//
// formatDuration is VERBATIM from the prototype branch (its presentation
// was the agreed verdict) — do not re-round: minutes use Math.round,
// hours floor with the remainder as minutes.

import type { ReadingSessionRecord } from "../../content/schema";

/**
 * formatDuration — the one duration voice. Under a minute says so in
 * words (never "0 min"); minutes round; hours floor with the trailing
 * minutes ("2 h 5 min"). Verbatim from the prototype's agreed variant A.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The per-article meta line's suppression floor (issue #38 — suppressed
 * under one minute). One accrued minute is the quietest honest line. */
const READ_HERE_MINIMUM_SECONDS = 60;

/**
 * timeReadLabel — the card meta line "{duration} read here", or undefined
 * when the article's accrued time is under a minute (the suppression is
 * the empty state, not a placeholder).
 */
export function timeReadLabel(totalSeconds: number): string | undefined {
  if (totalSeconds < READ_HERE_MINIMUM_SECONDS) return undefined;
  return `${formatDuration(totalSeconds)} read here`;
}

/** The whole-library reading-stats fold over recorded sessions. */
export interface ReadingStats {
  /** Sum of activeSeconds over counted sessions. */
  totalSeconds: number;
  /** Count of counted sessions (one recorded visit = one row). */
  visits: number;
  /** Per-article accrued seconds (the row meta line's input). */
  secondsByArticleId: Map<string, number>;
}

/**
 * deriveReadingStats — fold the session rows into whole-library totals and
 * a per-article time map. Sessions whose articleId is not in
 * `knownArticleIds` are inert orphan history (issue #37 ride-along) and
 * count nowhere. Order-independent: addition over non-negative integers.
 *
 * @param sessions        Every persisted ReadingSessionRecord (the ONE
 *                        LibrarySnapshot's readingSessions array).
 * @param knownArticleIds The library's article ids (snapshot.articles) —
 *                        the membership set that keeps orphan history out.
 */
export function deriveReadingStats(
  sessions: readonly ReadingSessionRecord[],
  knownArticleIds: ReadonlySet<string>,
): ReadingStats {
  const secondsByArticleId = new Map<string, number>();
  let totalSeconds = 0;
  let visits = 0;
  for (const session of sessions) {
    if (!knownArticleIds.has(session.articleId)) continue;
    totalSeconds += session.activeSeconds;
    visits += 1;
    secondsByArticleId.set(
      session.articleId,
      (secondsByArticleId.get(session.articleId) ?? 0) + session.activeSeconds,
    );
  }
  return { totalSeconds, visits, secondsByArticleId };
}

/**
 * ReadingStatsInput — the structural slice of the ONE LibrarySnapshot the
 * reading-stats fold reads (articles for membership, sessions for the
 * fold). Kept structural so this pure module stays decoupled from the
 * snapshot loader; every real caller passes the snapshot as-is.
 */
export interface ReadingStatsInput {
  readonly articles: ReadonlyArray<{ readonly id: string }>;
  readonly readingSessions: readonly ReadingSessionRecord[];
}

/**
 * deriveLibraryReadingStats — the whole-library fold from the ONE snapshot:
 * builds the article-membership set over `snapshot.articles` and folds the
 * snapshot's session rows. Every reading-stats consumer (the strip and the
 * row labels) folds the same way, so the membership construction and the
 * orphan discipline live in exactly one place.
 */
export function deriveLibraryReadingStats(snapshot: ReadingStatsInput): ReadingStats {
  const knownArticleIds = new Set(snapshot.articles.map((article) => article.id));
  return deriveReadingStats(snapshot.readingSessions, knownArticleIds);
}

/**
 * timeReadLabels — the per-article card meta lines as one map keyed by
 * article id. A label exists ONLY for articles whose accrued time clears
 * the under-one-minute suppression — the missing key is the empty state,
 * not a placeholder.
 */
export function timeReadLabels(stats: ReadingStats): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [articleId, seconds] of stats.secondsByArticleId) {
    const label = timeReadLabel(seconds);
    if (label !== undefined) labels.set(articleId, label);
  }
  return labels;
}

// ── Estimated reading time (issue #40; CONTEXT.md "Estimated reading time") ──
// THE one home of the fixed pace and its conversion. The estimate describes
// the article, never the reader: it is a pure function of the article's
// grapheme total (the snapshot's ONE `totalsByArticleId` fold — no new
// library read), so it never moves as the reader progresses and is never
// learned from reading sessions.
//
// Pace: ~238 words per minute (Brysbaert 2019, silent reading of English
// non-fiction). Words are not countable in languages written without spaces
// (Chinese, Japanese, Thai…), so the pace is converted ONCE into graphemes:
// an English word averages ~4.7 letters plus its trailing space and a share
// of punctuation, rounded to 6 graphemes per word. 238 × 6 = 1428 graphemes
// per minute, applied to every language and source alike (YouTube
// transcripts included — no special case).
//
// What counts is the D-05 MAIN TEXT the totals fold measures: prose,
// headings, quotes, lists, captions and code (verbatim). The notes at the
// end are reference material, not reading, and are left out (issue #58 —
// the fold is mainTextLength). Images add no per-image time allowance. The
// stream also carries a few short incidental strings — image alt text,
// footnote markers like "[1]", and the plain description of an unsupported
// block — which are too small to move a minute-rounded estimate, so they
// are left in rather than forking the one fold.

/** Typical silent-reading pace, in words per minute. */
const READING_PACE_WORDS_PER_MINUTE = 238;
/** Graphemes per average word (≈ 4.7 letters + space + punctuation). */
const GRAPHEMES_PER_WORD = 6;
/** The fixed pace the estimate uses, in graphemes per minute (1428). */
export const READING_PACE_GRAPHEMES_PER_MINUTE = READING_PACE_WORDS_PER_MINUTE * GRAPHEMES_PER_WORD;

/**
 * estimatedReadingTimeLabel — the row meta line "about {duration} read"
 * (formatDuration's rounding and wording), "under a minute read" for short
 * pieces, or undefined when there is no reading text at all (silence is the
 * empty state). Worded apart from the accrued "{duration} read here" line.
 *
 * @param graphemeTotal The article's (or a book's summed) normalized-text
 *                      grapheme total from `snapshot.totalsByArticleId`.
 */
export function estimatedReadingTimeLabel(graphemeTotal: number): string | undefined {
  if (graphemeTotal <= 0) return undefined;
  const seconds = (graphemeTotal * 60) / READING_PACE_GRAPHEMES_PER_MINUTE;
  if (seconds < 60) return "under a minute read";
  return `about ${formatDuration(seconds)} read`;
}
