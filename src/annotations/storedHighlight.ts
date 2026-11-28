// src/annotations/storedHighlight.ts
// Spec #68 — the ONE rule for showing a stored highlight on the article as
// read ("annotations never silently re-attach").
//
// A highlight's `revision` is the ingest revision it was made on, and the
// words of one revision never change: corrections change blocks, never
// words (ADR 0014), and PDF repair keeps every D-05 coordinate. So a
// highlight saved at the article's own revision but against another text
// stamp (a different set of corrections) is trusted only by an EXACT match.
// One whose words now span a split, merged or moved block boundary would
// otherwise be found by the loose prefix/suffix fallback — re-attached
// quietly although the consequences dialog said it would stop matching. It
// needs attention instead (orphaned), until an exact match returns.
//
// Everything else keeps the D5-02 tri-state unchanged: a highlight on the
// same text as saved (every uncorrected article), and one carried from an
// older revision whose words may really have changed (Reprocessing).

import { resolveQuoteSelectorExact } from "./resolution";
// The reader's established import site (component tests stub it there).
import { resolveQuoteSelector, type TextPositionSelector } from "../content/normalizeText";
import type { CanonicalArticle, HighlightRecord } from "../content/schema";
import { isSameText, textStamp } from "../content/sameText";

export type StoredHighlightAnchor = Pick<
  HighlightRecord,
  "quote" | "position" | "revision" | "fingerprint"
>;

/** Resolve a stored highlight on `shown` (the article as read). */
export function resolveStoredHighlight(
  shown: CanonicalArticle,
  record: StoredHighlightAnchor,
): TextPositionSelector | "ambiguous" | "orphan" {
  if (wordsUnchanged(shown, record)) return resolveQuoteSelectorExact(shown, record.quote);
  return resolveQuoteSelector(shown, record.quote, record.position);
}

/** Same words as when saved, but another substrate: only an exact match
 * may show it (for callers that resolve over memoized clusters). */
export function wordsUnchanged(shown: CanonicalArticle, record: StoredHighlightAnchor): boolean {
  return record.revision === shown.revision && !isSameText(record, textStamp(shown));
}
