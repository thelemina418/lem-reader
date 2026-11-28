// src/content/corrections/positions.ts
// Spec #68 / issue #71 — carrying a reading position from one substrate to
// another (original ↔ corrected, or one set of corrections to the next),
// by the text that follows it. The same rule Reprocessing uses for a new
// revision (reprocessStore.carryPosition): finished stays finished (carried
// to the target's main-text end), the very start stays the start, anything
// else re-matches a 48-grapheme forward quote and only a confident match
// moves it. Pure.

import {
  deriveQuoteSelector,
  graphemeLength,
  mainTextLength,
  resolveQuoteSelector,
} from "../normalizeText";
import { fromLegacyEndPin, inNotesOffset, isFinishedOffset } from "../../reader/readingPosition";
import type { CanonicalArticle } from "../types";
import { applyCorrections } from "./engine";
import { isSameText } from "../sameText";
import type { Correction } from "../schema";

const QUOTE_LENGTH = 48;

/** Carry `offset` (in `from`'s coordinates) into `to`; null when its text
 * can't be found confidently. */
export function carryOffset(
  from: CanonicalArticle,
  to: CanonicalArticle,
  offset: number,
): number | null {
  if (from === to) return offset;
  const total = graphemeLength(from);
  const mainEnd = mainTextLength(from);
  const saveOffset = fromLegacyEndPin(offset, mainEnd, total);
  if (!inNotesOffset(saveOffset, mainEnd) && isFinishedOffset(saveOffset, mainEnd)) {
    return mainTextLength(to);
  }
  if (offset === 0) return 0;
  const start = Math.min(offset, total);
  const end = Math.min(total, start + QUOTE_LENGTH);
  if (end <= start) return Math.min(offset, graphemeLength(to));
  const quote = deriveQuoteSelector(from, { start, end });
  const resolved = resolveQuoteSelector(to, quote, { start, end });
  return typeof resolved === "string" ? null : resolved.start;
}

/**
 * A stored reading offset, expressed in the article being shown. Trusted
 * directly when it was saved against the same text; carried by quote when
 * it was saved against the uncorrected original (e.g. a position written by
 * Reprocessing or an import before corrections were applied); otherwise the
 * best we can do is the stored offset clamped into the shown article.
 */
export function storedOffsetInShown(
  stored: {
    readonly graphemeOffset: number;
    readonly revision: number;
    readonly corrections?: string;
  },
  original: CanonicalArticle,
  corrections: readonly Correction[],
): number {
  const shown = applyCorrections(original, corrections).article;
  if (isSameText(stored, shown)) return stored.graphemeOffset;
  if (isSameText(stored, original)) {
    const carried = carryOffset(original, shown, stored.graphemeOffset);
    if (carried !== null) return carried;
  }
  return Math.min(stored.graphemeOffset, graphemeLength(shown));
}
