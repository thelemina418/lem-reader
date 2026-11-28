import type { Block, CanonicalArticle, InlineRun } from "./types";
import { type FootnoteBodyT } from "./footnoteBody";
/** Separator between consecutive blocks (and between body and footnotes region). */
export declare const BLOCK_SEPARATOR = "\n";
/**
 * Collapse ASCII whitespace runs to a single space, then trim.
 *
 * Pitfall 2 rule: ONLY ASCII whitespace ([\t\n\f\r ]) is collapsed. Do NOT
 * touch Unicode whitespace (NBSP \u00A0, ZWJ \u200D, RTL marks) — these are
 * preserved verbatim because they are part of the readable text. Do NOT apply
 * Unicode normalization (no NFC/NFKC) — it would break Intl.Segmenter
 * reproducibility across revisions.
 */
export declare function normalizeRunText(text: string): string;
/** Render an inline run array to its normalized text contribution.
 * Exported for the read-aloud speakable-channel walk (src/readaloud/chunks.ts),
 * which needs the caption sub-range of a figure block — the SAME function the
 * D-05 substrate uses, never a fork (Pitfall 3). */
export declare function inlineText(runs: readonly InlineRun[]): string;
/**
 * runSeparators — THE inline run-join rule, per run: the separator graphemes
 * the D-05 stream places before that run's contribution (0 for a run with no
 * contribution, and for the first contributing run).
 *
 * Adjacent contributions join with one " " — except at a Footnote
 * reference's edge with no whitespace in the source: spec #66 keeps the
 * marker graphemes where the old flattened ingest had them ("Claim1 more."),
 * so a stored highlight quote that includes a marker is unchanged.
 * Whitespace-only runs between two contributions count as source
 * whitespace. Every walk over the stream (inlineText, the splitBlock
 * slicing family, footnoteReferenceSpans) reads its joins from here.
 */
export declare function runSeparators(runs: readonly InlineRun[]): readonly (0 | 1)[];
/**
 * A Footnote body's normalized text contribution (issue #59): its block-shaped
 * view's text — one paragraph's inline text, or a multi-paragraph note's
 * paragraphs joined with BLOCK_SEPARATOR. A one-paragraph note's text is
 * byte-identical to the pre-#59 `inlineText(fn.content)`, so stored offsets
 * never move. The ONE derivation every footnote-text consumer reads.
 */
export declare function footnoteText(fn: FootnoteBodyT): string;
/**
 * Exported alias for `blockText` — Phase 4 Plan 04-04 anchor helpers
 * (src/pagination/anchor.ts) need per-block normalized text to compute
 * article-global grapheme offsets for the D4-10 mode-switch + D4-11
 * repagination anchors. Exporting the SAME function (rather than a parallel
 * implementation) honors Pattern 5 / Pitfall: never fork normalization —
 * any divergence would shift every passage anchor.
 */
export declare function blockNormalizedText(block: Block): string;
/**
 * D-05 contract: ONE deterministic normalized-text string per article revision.
 *
 * Pitfall 3 rule: footnote BODY text participates AFTER the body blocks, in
 * footnotes-region order. The `[bodyText, footnoteText].filter(Boolean).join()`
 * form guarantees a footnote body's offset is always greater than its
 * reference marker's offset.
 */
export declare function normalizeText(article: CanonicalArticle): string;
/**
 * Grapheme-offset substrate.
 *
 * CRITICAL (Pitfall 1): the canonical offset of the Nth grapheme cluster is N,
 * NOT segment.index (which is a UTF-16 code-unit offset into the source string).
 *
 * Returns: an array of grapheme cluster substrings in order, so callers can
 * derive offsets as array indices.
 */
export declare function graphemeClusters(text: string, locale: string): string[];
/** Precomputed grapheme index for one parsed article object. */
export interface ArticleGraphemeIndex {
    /** normalizeText(article) — the D-05 canonical string. */
    readonly normalizedText: string;
    /** Full-article grapheme clusters of normalizedText (footnotes included). */
    readonly clusters: readonly string[];
    /** Body-block grapheme lengths (per-block segmentation, in block order). */
    readonly perBlockLengths: readonly number[];
    /**
     * The footnotes region's canonical rows (issue #235): one entry per
     * NON-EMPTY footnote body, in footnotes order, carrying the canonical
     * [start, end) D-05 offsets normalizeText assigns it. Empty bodies spend
     * no offset and no separator (the substrate's filter(Boolean) join), so
     * they are not rows. The LAST row ends exactly at `totalGraphemes` — the
     * work's true end — so a body-only view never pins a footnoted work done.
     */
    readonly footnoteRows: readonly FootnoteRow[];
    /**
     * Prefix sums over perBlockLengths, length blocks.length + 1. Entry i =
     * sum over j < i of perBlockLengths[j] + BLOCK_SEPARATOR.length — the exact
     * quantity the pre-change pageStartGlobalOffset loop accumulated. The final
     * entry (i = blocks.length) is the SENTINEL: the capped accumulation an
     * out-of-range blockIndex used to produce.
     */
    readonly blockStartOffsets: readonly number[];
    /** clusters.length — the canonical article length in grapheme clusters. */
    readonly totalGraphemes: number;
}
/**
 * One speakable/addressable footnote body in the canonical coordinate stream
 * (issue #235). `index` is the footnote's position in `article.footnotes`
 * (canonical identity — never a filtered ordinal); `start`/`length` are
 * article-global D-05 grapheme ordinals over normalizeText(article).
 */
export interface FootnoteRow {
    readonly index: number;
    readonly start: number;
    readonly length: number;
}
/**
 * The canonical row covering footnote `footnoteIndex`, or undefined when the
 * footnote has no row (no text, or out of range). The ONE lookup — windows,
 * entries, anchors, the guard, and the renderers all read it; a missing row
 * is honest absence (the body contributes nothing), and each caller decides
 * its own miss behavior explicitly.
 */
export declare function footnoteRowFor(article: CanonicalArticle, footnoteIndex: number): FootnoteRow | undefined;
/**
 * The canonical row whose text contains article-global `offset`, or
 * undefined in the main text (issue #65 — which note a highlight lies in).
 */
export declare function footnoteRowAt(article: CanonicalArticle, offset: number): FootnoteRow | undefined;
/**
 * The footnotes region's canonical rows for `article` (issue #235).
 *
 * Served by the per-article grapheme index — one derivation per parsed
 * article object, never a per-call accumulation. Consumers: bounded source
 * traversal (src/pagination/blockWindow.ts), the pagination engine's
 * footnote entries, and the page anchors.
 */
export declare function footnoteRows(article: CanonicalArticle): readonly FootnoteRow[];
/**
 * The per-article grapheme index (built once per article object, then cached).
 *
 * CRITICAL: perBlockLengths are derived by segmenting blockText(block) per
 * block. Do NOT split the joined normalizedText on BLOCK_SEPARATOR — code-block
 * sources are verbatim and can themselves contain newline characters, so
 * separator positions in the joined string are not reliable block boundaries.
 */
export declare function articleGraphemeIndex(article: CanonicalArticle): ArticleGraphemeIndex;
/** The canonical length of an article in grapheme clusters. */
export declare function graphemeLength(article: CanonicalArticle): number;
/**
 * Issue #58 — the canonical length of the article's MAIN TEXT: the
 * coordinate stream up to (not including) the notes region. The notes are
 * reference material, not reading: completion, progress, read-aloud's
 * continuous stop, and Estimated reading time all measure against this
 * end. Equals graphemeLength when there are no footnote rows. The body's
 * last block ends one separator before the first row
 * (normalizeText's `[body, notes].join(SEP)`); an all-empty body spends no
 * separator, so its main text is empty.
 */
export declare function mainTextLength(article: CanonicalArticle): number;
/**
 * A whitespace cluster: a grapheme cluster consisting solely of ASCII
 * [\t\n\f\r ] (the set normalizeRunText collapses). Unicode whitespace
 * (NBSP, ZWJ, RTL marks) is NOT in this set — those are readable text and
 * must NOT be collapsed (Pitfall 2 rule from normalizeText.ts). Shared by
 * the raw↔norm bridge and the paginated visible-window clip: separator
 * graphemes (BLOCK_SEPARATOR, the inlineText run join) are whitespace
 * clusters that render in no run piece.
 */
export declare function isWhitespaceCluster(cluster: string): boolean;
/**
 * Build a map from raw-cluster offset → normalized-grapheme offset.
 *
 * `rawClusters` is the grapheme clustering of a block's raw concatenated
 * text (the DOM textContent projection). `normClusters` is the grapheme
 * clustering of blockNormalizedText(block). Both contain the same
 * non-whitespace clusters in the same order; whitespace may differ (raw has
 * extra spaces from non-collapsed runs / run-boundary concatenation that
 * normalizeRunText collapses + trims, or norm has separator spaces that raw
 * lacks at run boundaries).
 *
 * The returned array has length `rawClusters.length + 1`. `map[i]` is the
 * normalized-grapheme offset corresponding to raw-cluster offset `i`. The
 * extra trailing entry `map[rawClusters.length]` is the normalized length
 * (past-the-end), so an end-exclusive DOM offset maps cleanly.
 */
export declare function buildRawToNormMap(rawClusters: readonly string[], normClusters: readonly string[]): number[];
/** Grapheme offset range into normalizeText(article); start inclusive, end exclusive. */
export interface TextPositionSelector {
    start: number;
    end: number;
}
/** A TextQuote selector over the normalized grapheme text (prefix/exact/suffix). */
export interface TextQuoteSelector {
    prefix: string;
    exact: string;
    suffix: string;
}
/**
 * Derive a TextQuoteSelector from a TextPositionSelector (used when saving an
 * annotation). `exact` round-trips through graphemeClusters(normalizeText(article)).
 */
export declare function deriveQuoteSelector(article: CanonicalArticle, position: TextPositionSelector, contextRadius?: number): TextQuoteSelector;
/**
 * Re-resolve a stored TextQuoteSelector against the current revision's
 * normalized text (D5-02). Returns:
 *   - a TextPositionSelector when the passage is found confidently;
 *   - "ambiguous" when the exact text appears N>1 times even after
 *     prefix/suffix disambiguation (ANNO-07 — the reader is shown the
 *     ambiguous state, never a silent re-attach);
 *   - "orphan" when zero exact matches AND no confident prefix/suffix fallback.
 *
 * Pure function — no DOM, no React, no side effects. jsdom-safe.
 *
 * `positionHint` (the stored TextPositionSelector) is a nearness hint for the
 * zero-exact fallback only; it is IGNORED when the exact text matches uniquely
 * (the text IS the anchor). Never silently re-attaches to a wrong spot.
 */
export declare function resolveQuoteSelector(article: CanonicalArticle, selector: TextQuoteSelector, positionHint?: TextPositionSelector): TextPositionSelector | "ambiguous" | "orphan";
