import type { Block, CanonicalArticle, InlineRun } from "../content/types";
import type { SplitDecision } from "./types";
/**
 * The block's raw concatenated text — the DOM textContent projection.
 *
 * Spike 0007 F2 reconciliation: there is ONE text coordinate (the D-05
 * normalized text, blockNormalizedText). This helper exists ONLY as the raw
 * counterpart the pagination engine needs to convert DOM line-box char
 * offsets (UTF-16 ordinals over the rendered text nodes, which concatenate
 * run texts verbatim with no separators and no whitespace collapsing) into
 * D-05 grapheme ordinals via the shared buildRawToNormMap bridge.
 *
 * Mirrors the DOM structure the renderer emits: leaf runs contribute their
 * text verbatim; container children/items concatenate with NOTHING between
 * them (adjacent elements contribute no text nodes). Code-block source is
 * verbatim (raw == norm there by contract). Figures project alt + caption —
 * unused in practice (figures are D4-02 atomic and never split).
 */
export declare function blockRawText(block: Block): string;
/**
 * Classify a block as atomic or splitting per D4-02.
 *
 * Exhaustive switch over `block.kind` — NO default (Pattern F). The case
 * set covers all 9 BlockKind literals; TS narrows the return type so the
 * caller can branch on `decision.kind` without a fallback path.
 *
 * The atomic set (figure, code-block, footnote-reference,
 * unsupported) NEVER splits: if the block does not fit on the current
 * page, the orchestrator moves it whole to the next page (subject to the
 * 75% oversize fallback per PAGE-04).
 *
 * The splitting set (paragraph, heading, blockquote, bulleted-list,
 * numbered-list) carries a split decision; the orchestrator chooses the
 * actual split offset using line boxes + widow rules. (Container kinds —
 * blockquote, bulleted-list, numbered-list — split recursively in Plan
 * 03's fragment renderer; the engine produces the source ranges, the
 * renderer slices the model.) Headings prefer whole-page placement in the
 * orchestrator, but can continue when they cannot fit (#296).
 */
export declare function classifyBlock(block: Block): SplitDecision;
/**
 * The D-05 stream length of an inline-run array: the grapheme count of the
 * block's normalized text contribution (normalizeRunText per run, empties
 * dropped, non-empty runs joined with " " — the inlineText join rule).
 *
 * Grapheme clusters never span the inserted single-space separator, so the
 * count is the sum of per-contribution cluster counts plus one separator per
 * adjacent contribution pair — identical to segmenting the joined string.
 *
 * Spike 0007 F2 reconciliation: this — NOT the raw per-run sum — is the
 * length sliceRunsForHighlights clamps intersections against and the
 * pagination engine emits endGrapheme against. One coordinate everywhere:
 * highlight positions (stored D-05 offsets), split points, and run slicing
 * now address the same stream, so marks stay aligned across wrap and reflow.
 */
export declare function inlineStreamGraphemeLength(runs: readonly InlineRun[], lang: string): number;
export declare function splitParagraphRuns(runs: readonly InlineRun[], splitAtGrapheme: number, lang: string): {
    before: InlineRun[];
    after: InlineRun[];
};
/**
 * The paragraph's InlineRun[] slice for the intra-block [startGrapheme,
 * endGrapheme) D-05 range — the ONE block-projection primitive shared by
 * the paginated fragment renderer (page entries) and the windowed
 * measurement projection (issue #233's bounded window heads/tails).
 *
 * Resolve BOTH boundaries against the original runs' cached raw↔norm
 * bridge, then materialize only the requested raw interval. In particular,
 * never build a [0, end) intermediate run: late pages would re-segment that
 * discarded prefix on every render. Marks stay attached to their source
 * run; edge separator graphemes render in no piece.
 *
 * Callers only invoke this for kinds with a split semantic (paragraphs for
 * issue #233); whole-range calls return the source runs unchanged.
 */
export declare function splitInlineBlock(block: Block, startGrapheme: number, endGrapheme: number, lang: string): Block;
/**
 * The UTF-16 raw prefix a projection rendered away for the intra-block
 * D-05 window starting at `startGrapheme`: the raw position where
 * {@link splitParagraphRuns}(runs, startGrapheme).after begins in the
 * concatenated raw run text. Walks the SAME per-run clusters and cut rule
 * the partition primitive uses (cached — issue #233), so the pagination
 * engine can rebase slice-local line-box charOffsets onto whole-block raw
 * coordinates with byte-identical cuts and no whole-block re-segmentation.
 *
 * Whitespace-only runs ride exactly per the partition rule (before when
 * the cut sits at/past the next contribution's start, after otherwise), so
 * the prefix always matches the rendered slice's first raw character.
 */
export declare function rawPrefixUtf16ForNormOffset(runs: readonly InlineRun[], startGrapheme: number, lang: string): number;
/**
 * Convert a whole-block RAW UTF-16 offset (the concatenated run text — the
 * coordinate the rebased line-box charOffsets address) into a D-05 norm
 * grapheme ordinal, walking per-run cached clusters (issue #233 — never a
 * whole-block re-segmentation). Mirrors charOffsetToGrapheme over the
 * concatenation followed by the shared raw↔norm bridge: cluster ordinals
 * at run boundaries and separator graphemes resolve identically, and
 * end-of-text returns the norm length (the exclusive-end convention).
 */
export declare function charOffsetToNormGrapheme(runs: readonly InlineRun[], charOffset: number, lang: string): number;
/** Round a candidate cursor out of an atomic descendant. Never silently
 * split a figure, code block, reference, or disclosure. */
export declare function blockSliceBoundary(block: Block, offset: number, lang: string, direction?: "before" | "after"): number;
export declare function hasOversizedAtomicDescendant(block: Block, capacity: number, lang: string): boolean;
export declare function footnoteBodyBlock(footnote: CanonicalArticle["footnotes"][number], lang: string): Block;
export declare function blockCharOffsetToNormGrapheme(block: Block, offset: number, lang: string): number;
export declare function resolveBlockSlice(block: Block, startGrapheme: number, endGrapheme: number, lang: string): Block;
export declare function blockRawPrefixUtf16(block: Block, startGrapheme: number, lang: string): number;
