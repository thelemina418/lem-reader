// Spec #68 / #69 — the ONE "same text as before?" check.
//
// Every stored record that addresses the article's text by coordinates — a
// reading position (and the position table's key), a highlight, the
// work-structure snapshot, pagination's trusted scope, an imported row —
// carries the text stamp it was saved against. It is trusted directly only
// when that stamp matches the article being shown; otherwise the caller
// falls back to re-matching by quote (the existing cross-revision path).
//
// Today the stamp is exactly the original's monotonic ingest revision
// (D-06). Corrections (spec #68 "Coordinates, highlights and position")
// extend THIS module — the original's revision plus a fingerprint of the
// applied corrections — instead of touching each call site. Consumers must
// never compare revisions directly for "same text" purposes.

/** The identity of the text a stored record's coordinates refer to. */
export interface TextStamp {
  readonly revision: number;
}

/** The stamp a record saved against `article` carries (and is keyed by). */
export function textStamp(article: TextStamp): TextStamp {
  return { revision: article.revision };
}

/**
 * Was `stored` saved against the same text as `shown`? True → trust its
 * coordinates directly; false → re-match by quote (or treat as unmatched).
 */
export function isSameText(stored: TextStamp, shown: TextStamp): boolean {
  return stored.revision === shown.revision;
}
