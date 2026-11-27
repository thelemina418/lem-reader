// src/reader/readingPosition.ts
// Issue #2 — ONE pure home for the reading-completion policy. Before this
// module, "have I finished this article?" was decided in four places
// (passive scroll completion, final-page anchor pinning, the explicit
// "Mark read and close" gesture, and end-landing re-pinning), and the
// FINISHED_THRESHOLD constant lived inside ContinueReadingStrip.tsx — a UI
// component that pure policy modules (readingState.ts, bookProgress.ts)
// imported upward. Every decision site now calls THIS module; the strip
// imports it like everyone else.
//
// The module owns four policy families (plus the savedAt fold that feeds
// them):
//   1. The finished threshold (FINISHED_THRESHOLD — D8-12 + RESEARCH
//      §Pattern 4 L498) and the offset-level finished predicate
//      (isFinishedOffset — the VERBATIM Math.min(1, offset/total) >=
//      threshold expression readingState always used, byte-stable by
//      construction).
//   2. At-end predicates, one per reading mode: atScrollBottom (scrolling
//      geometry — moved verbatim from useScrollSave.ts) and isFinalPage
//      (paginated committed-page — the final page of a MULTI-page set,
//      260908-oht; a one-page set keeps anchor 0, POLISH-02).
//   3. End-pins — endPinOffset(article) = mainTextLength(article): the ONE
//      offset every completion path persists or anchors at (the scroll-
//      bottom save, the final-page anchor, and "Mark read and close").
//   4. Landing behavior for restore/mode-swap offsets at or after the end
//      (landingForRestore): such an offset lands at the absolute document
//      BOTTOM so the first scroll-save re-pins total instead of
//      un-finishing a finished article.
//
// Plus latestLocationByArticle — the max-savedAt-per-articleId fold (D8-10
// "recently-read = opened") moved verbatim from bookProgress.ts. The fold
// decides WHICH persisted LocationRecord is the live truth the finished
// check reads; owning it here pins the savedAt-tie discipline (strict >
// comparison — on a tie the FIRST row in iteration order wins) next to the
// threshold it feeds.
//
// PURE domain logic — no DOM, no React, no Dexie. Every export is safe to
// unit test with synthetic numbers/records (jsdom-free truth tables).
import type { CanonicalArticle } from "../content/types";
import type { LocationRecord } from "../content/schema";
import { mainTextLength } from "../content/normalizeText";

/**
 * FINISHED_THRESHOLD — D8-12 + RESEARCH §Pattern 4 L498 recommendation. At
 * or above this ratio the article is "Finished": it leaves the
 * continue-reading strip and shows the filled-hairline + "Finished" mark in
 * the main list. Exported so every policy consumer (readingState,
 * bookProgress, tests) references the same value without forking the
 * constant.
 */
export const FINISHED_THRESHOLD = 0.98;

/**
 * isFinishedOffset — the offset-level finished predicate (the VERBATIM
 * ratio formula readingState/LibraryRow/the strip always used:
 * Math.min(1, offset / total) >= FINISHED_THRESHOLD). Every edge is
 * byte-stable — including the opened zero-length article (total 0 with a
 * positive offset clamps to 1 → finished; offset 0 on total 0 is NaN →
 * not finished), deliberately preserved.
 *
 * @param offset The reader's persisted grapheme offset.
 * @param total  The article's normalized-text grapheme total.
 */
export function isFinishedOffset(offset: number, total: number): boolean {
  return Math.min(1, offset / total) >= FINISHED_THRESHOLD;
}

/**
 * inNotesOffset — spec #66: `total` is the end of the MAIN text
 * (mainTextLength — every completion total is), so an offset past it is a position inside the notes.
 * A zero total keeps the opened-zero-length-article edge (finished).
 */
export function inNotesOffset(offset: number, total: number): boolean {
  return total > 0 && offset > total;
}

/**
 * fromLegacyEndPin — spec #66: before #66 the end pin of a footnoted article
 * was the end of its NOTES (graphemeLength — the whole coordinate stream),
 * so a reader who finished then left a row at exactly that offset. Read
 * there, it is the legacy end pin — a finish — and reads as today's end pin
 * (mainEnd, endPinOffset). Every other offset, including one inside the
 * notes, reads as saved. Nothing today saves `textEnd` for a footnoted
 * article (note positions save their passage start; every finish saves the
 * main-text end), so the exact offset is unambiguous. Apply it wherever a
 * persisted location is read against the article it was saved for (same
 * revision): the library's latest-location fold, the notes carry-over in
 * saveLocation, and reprocess carry-over.
 *
 * @param mainEnd The saved revision's main-text end (mainTextLength).
 * @param textEnd The saved revision's whole length (graphemeLength).
 */
export function fromLegacyEndPin(offset: number, mainEnd: number, textEnd: number): number {
  return textEnd > mainEnd && offset === textEnd ? mainEnd : offset;
}

/**
 * noteListenEndOffset — spec #66: where a read-aloud session started inside a
 * note leaves the reader: that note's end, except the LAST note, whose end is
 * the article's whole length — the legacy end pin (fromLegacyEndPin), a
 * finish. That one pins its final grapheme instead, still inside the note.
 *
 * @param noteEnd The note session's scope end.
 * @param textEnd The article's whole length (graphemeLength).
 */
export function noteListenEndOffset(noteEnd: number, textEnd: number): number {
  return Math.min(noteEnd, textEnd - 1);
}

/**
 * Scroll-bottom tolerance (260908-oht): within this many CSS px of the
 * document bottom counts as "reached the end" (sub-pixel/rounding slack).
 */
export const BOTTOM_EPSILON_PX = 4;

/**
 * ScrollGeometry — ONE viewport-in-document observation: the three numbers
 * that always travel together (where the reader is, how tall the viewport
 * is, how tall the whole document is). The Data-Clump fix: the at-end
 * predicate consumes one geometry object, never a loose triple.
 */
export interface ScrollGeometry {
  /** window.scrollY — the reader's current y position. */
  scrollY: number;
  /** window.innerHeight — the visible viewport height. */
  viewportHeight: number;
  /** document.documentElement.scrollHeight — the full document height. */
  scrollHeight: number;
}

/**
 * atScrollBottom — the SCROLLING-mode at-end predicate (moved verbatim
 * from useScrollSave.ts; its boundary table moved with it into
 * reading-position.test.ts). True when the document is scrolled to (or
 * within BOTTOM_EPSILON_PX of) its absolute bottom — and always false for
 * a non-scrollable document (scrollHeight <= viewportHeight), which must
 * never passively finish. The tolerance is the module-owned constant —
 * callers never supply it.
 */
export function atScrollBottom(geometry: ScrollGeometry): boolean {
  const scrollMax = geometry.scrollHeight - geometry.viewportHeight;
  if (scrollMax <= 0) return false;
  return geometry.scrollY >= scrollMax - BOTTOM_EPSILON_PX;
}

/**
 * mainTextEndInView — issue #58: the SCROLLING-mode "reached the end of the
 * main text" predicate for a footnoted article. The notes sit below the
 * main text; once the notes region's top edge (viewport-relative px, null
 * when the article has no rendered notes) is inside the viewport, the whole
 * main text has been scrolled to and the article finishes — the reader
 * never has to walk the notes to reach the document bottom.
 */
export function mainTextEndInView(input: {
  notesTop: number | null;
  viewportHeight: number;
}): boolean {
  return input.notesTop !== null && input.notesTop < input.viewportHeight;
}

/**
 * isFinalPage — the PAGINATED-mode at-end predicate: the committed page is
 * the last page of a MULTI-page set (the 260908-oht final-page pin
 * eligibility). A one-page set is deliberately NOT at-end (POLISH-02 —
 * opening a one-page article reads offset 0, never a finished pin).
 * Out-of-range indices are never final.
 */
export function isFinalPage(pageIndex: number, pageCount: number): boolean {
  return pageCount > 1 && pageIndex === pageCount - 1;
}

/**
 * endPinOffset — the ONE end-pin: the end of the article's MAIN TEXT
 * (mainTextLength — the whole normalized-text total when the article has
 * no notes). Every completion path persists or anchors at exactly this
 * offset — the scroll-bottom passive save, the final-page committed
 * anchor, and the explicit "Mark read and close" gesture — so they can
 * never disagree about what "the end" is.
 *
 * Issue #58 — the notes at the end of an article are reference material,
 * not part of reading it through: the article finishes at the end of the
 * main text, never by reaching (or walking) the notes. A saved position
 * inside the notes lies past this pin and is not a completion signal at all
 * (inNotesOffset; spec #66 review S1): it neither finishes the article nor
 * un-finishes one already finished (the completion record carried in at the
 * notes transition — locationStore.saveLocation — stands).
 */
export function endPinOffset(article: CanonicalArticle): number {
  return mainTextLength(article);
}

/**
 * isAtArticleEnd — true when an offset is at or past the article's total.
 * "Past" is honest, not defensive: an offset can overshoot when the
 * corpus changed since the save; it still reads as at-end (the calm
 * nearest-passage clamp happens downstream in
 * fragmentContainingOffset / the end-landing below).
 */
export function isAtArticleEnd(offset: number, total: number): boolean {
  return offset >= total;
}

/** Where a restored (or mode-swapped) offset lands. */
export type RestoreLanding = "end" | "passage";

/**
 * landingForRestore — the landing behavior for restore offsets at or after
 * the end (260908-oht end-landing): such an offset lands at the absolute
 * document BOTTOM ("end") so the first scroll-save re-pins total instead
 * of un-finishing a finished article; anything short of the total is a
 * normal passage landing ("passage" — the caller's findScrollTarget
 * path). Pure decision only: the DOM scroll itself stays at the call
 * site.
 */
export function landingForRestore(
  offset: number,
  total: number,
  streamEnd: number = total,
): RestoreLanding {
  // Issue #58 — `total` is the end pin (the main-text end); `streamEnd` is
  // the whole coordinate stream's end (past the notes). A position strictly
  // inside the notes is a passage: it restores into its note.
  if (offset > total && offset < streamEnd) return "passage";
  return isAtArticleEnd(offset, total) ? "end" : "passage";
}

/**
 * latestLocationByArticle — index the max-savedAt LocationRecord per
 * articleId (the D8-10 fold, moved verbatim from bookProgress.ts; the
 * strip / LibraryView / BookRow folds all CALL this function now — Issue
 * #2 convergence, one fold instead of four drift-prone copies). ISO-8601
 * strings from Date.prototype.toISOString() compare correctly
 * lexicographically. On a savedAt TIE the first row in iteration order
 * wins (strict > keeps the incumbent) — the discipline the
 * reading-position truth table pins. LocationRecords are keyed
 * [articleId+revision], so an article read across revisions carries
 * several rows; the latest-savedAt row is the live truth for the
 * finished check and the resume pick.
 */
export function latestLocationByArticle(locations: LocationRecord[]): Map<string, LocationRecord> {
  const latest = new Map<string, LocationRecord>();
  for (const loc of locations) {
    const prev = latest.get(loc.articleId);
    if (!prev || loc.savedAt > prev.savedAt) {
      latest.set(loc.articleId, loc);
    }
  }
  return latest;
}
