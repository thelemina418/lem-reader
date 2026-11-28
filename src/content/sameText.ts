// Spec #68 / #69 / #71 — the ONE "same text as before?" check.
//
// Every stored record that addresses the article's text by coordinates — a
// reading position (and the position table's key), a highlight, the
// work-structure snapshot, pagination's trusted scope, an imported row —
// carries the text stamp it was saved against. It is trusted directly only
// when that stamp matches the article being shown; otherwise the caller
// falls back to re-matching by quote (the existing cross-revision path).
//
// The stamp is the original's monotonic ingest revision (D-06) plus, since
// #71, a fingerprint of the applied corrections (spec #68 "Coordinates,
// highlights and position"). An uncorrected article has NO fingerprint —
// its stamp is exactly `{ revision }`, so stored rows stay byte-identical.
// The correction engine registers the fingerprint of every corrected
// article it builds (`registerCorrectionsFingerprint`); records carry it as
// their `corrections` field. Consumers must never compare revisions
// directly for "same text" purposes.

/** The identity of the text a stored record's coordinates refer to. */
export interface TextStamp {
  readonly revision: number;
  /** Fingerprint of the applied corrections; absent = the original. */
  readonly corrections?: string;
}

// Corrected article objects → their fingerprint. A WeakMap so a corrected
// article carries its identity without a field on the canonical shape (the
// corrected article must stay a valid, plain canonical article).
const fingerprints = new WeakMap<object, string>();

/** Engine-only: record the corrections fingerprint of a corrected article. */
export function registerCorrectionsFingerprint(article: object, fingerprint: string): void {
  fingerprints.set(article, fingerprint);
}

function fingerprintOf(stamp: TextStamp): string | undefined {
  return stamp.corrections ?? fingerprints.get(stamp);
}

/** The stamp a record saved against `article` carries (and is keyed by). */
export function textStamp(article: TextStamp): TextStamp {
  const corrections = fingerprintOf(article);
  return corrections === undefined
    ? { revision: article.revision }
    : { revision: article.revision, corrections };
}

/**
 * Was `stored` saved against the same text as `shown`? True → trust its
 * coordinates directly; false → re-match by quote (or treat as unmatched).
 */
export function isSameText(stored: TextStamp, shown: TextStamp): boolean {
  return (
    stored.revision === shown.revision &&
    (fingerprintOf(stored) ?? "") === (fingerprintOf(shown) ?? "")
  );
}
