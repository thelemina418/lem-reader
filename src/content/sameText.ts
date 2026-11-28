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
// their `fingerprint` field. Consumers must never compare revisions
// directly for "same text" purposes.
//
// #78 — PDF repair rewrites the original's block kinds WITHOUT bumping the
// revision (it changes structure, not words). A repaired original carries
// its own `repairStamp` (a fingerprint of the repaired blocks) on the row,
// and that stamp rides the same `fingerprint` field of the records saved
// against it, so a repaired original is never mistaken for the one before
// the repair (or after recovery). A corrected article built over a repaired
// original folds the repair stamp into its corrections fingerprint.

/** The identity of the text a stored record's coordinates refer to. */
export interface TextStamp {
  readonly revision: number;
  /** Fingerprint of the substrate beyond the revision — the applied
   * corrections, or a PDF repair of the original; absent = the original as
   * ingested. */
  readonly fingerprint?: string;
  /** On a repaired original row only (never on a record): its repair stamp. */
  readonly repairStamp?: string;
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
  return stamp.fingerprint ?? fingerprints.get(stamp) ?? stamp.repairStamp;
}

/** Was this article built by the correction engine (a corrected article,
 * not an original — repaired or not)? */
export function isCorrectedArticle(article: object): boolean {
  return fingerprints.has(article);
}

/** A short, stable fingerprint of a string (cyrb53 — not cryptographic). */
export function fingerprintText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The repair stamp of an original whose blocks a PDF repair rewrote. */
export function repairStampOf(blocks: readonly unknown[]): string {
  return `r${fingerprintText(JSON.stringify(blocks))}`;
}

/** The stamp a record saved against `article` carries (and is keyed by). */
export function textStamp(article: TextStamp): TextStamp {
  const fingerprint = fingerprintOf(article);
  return fingerprint === undefined
    ? { revision: article.revision }
    : { revision: article.revision, fingerprint };
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
