import type { LineBox } from "./types";
/**
 * Convenience wrapper exposing the D-05 per-block text rule to the
 * pagination engine's caller. Delegates to normalizeElText so the DOM-text
 * contribution matches normalizeText(article) exactly (Pitfall 3 — no fork).
 * Call this to derive the `fullText` argument to readLineBoxes.
 */
export declare function blockNormalizedText(el: HTMLElement): string;
/**
 * Map a UTF-16 code-unit offset (the coordinate Range.setStart/setEnd
 * natively accepts) to a D-05 grapheme ordinal over the same text. Walks
 * grapheme clusters accumulating their UTF-16 length until the cluster
 * containing `charOffset` is found.
 *
 * For ASCII-only text the grapheme ordinal equals the UTF-16 offset. For
 * text with surrogate pairs (emoji) or combining marks, the grapheme
 * ordinal is the array index of the cluster spanning `charOffset`.
 *
 * Returns `clusters.length` when `charOffset` is at or past end-of-text
 * (the exclusive-end convention — a split at endGrapheme == blockLength
 * means "whole block").
 */
export declare function charOffsetToGrapheme(text: string, charOffset: number, locale: string): number;
/**
 * Read every CSS line box of a block's text as a LineBox[].
 *
 * Plan 04-06 generalization: walks ALL descendant text nodes in document
 * order (TreeWalker), maintaining a running UTF-16 char-offset accumulator
 * that maps each text node's local offset into the block's full normalized
 * text. For each text node, finds each next line boundary by BINARY-SEARCHING
 * the minimal prefix offset whose probe's rounded last-rect top differs from
 * the current line's — and records a LineBox each time one is found — the
 * LineBox.charOffset is the GLOBAL offset into the concatenated text (the
 * coordinate charOffsetToGrapheme expects).
 *
 * 260820-beo: the former per-character prefix scan probed EVERY i in
 * 0..localLen (a 500-char paragraph = 501 Range.getClientRects queries;
 * ~100k+ rect queries per measurement pass on a long article, multiplied by
 * every overflow-guard correction). The binary search produces a
 * byte-identical LineBox[] at O(lines × log L) probe cost — equivalence is
 * pinned by tests/unit/pagination/lineBoxesBinarySearch.test.ts, which
 * replicates the OLD linear walk as a test-local oracle and deep-equals the
 * two across diverse schedules (plateau/container/surrogate).
 *
 * For flat blocks (paragraph/heading with a single text node) the output is
 * byte-identical to the prior implementation. For container blocks
 * (blockquote / list), the walk covers every descendant paragraph/list-item
 * text node in document order so a single LineBox[] spans the entire
 * container — exactly what the engine needs to split containers at line
 * boundaries.
 *
 * The char-offset accumulator MUST sum text-node lengths in the SAME order
 * `normalizeElText(el)` traverses them (it calls `el.textContent` which is
 * the document-order concatenation of descendant text nodes). TreeWalker
 * with NodeFilter.SHOW_TEXT walks in document order; the accumulator stays
 * aligned with textContent. (Pitfall 3 — no normalization fork.)
 *
 * @param el        The block's rendered HTMLElement (must contain ≥1 text node
 *                    descendant, or [] is returned).
 * @param fullText  The block's normalized text (use blockNormalizedText(el)).
 * @param signal    Cancel signal; throws AbortError if aborted mid-walk.
 *
 * Aborts (via AbortError) if `signal` is or becomes aborted. Returns [] if
 * the element has no text node descendant or Range.getClientRects yields no
 * rects (e.g. the block is display:none or empty — the caller treats this as
 * a zero-line block and moves it whole per D4-02 atomic fallback).
 */
export declare function readLineBoxes(el: HTMLElement, fullText: string, signal: AbortSignal): LineBox[];
