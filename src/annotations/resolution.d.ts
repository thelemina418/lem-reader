import type { CanonicalArticle } from "../content/types";
import type { TextPositionSelector, TextQuoteSelector } from "../content/normalizeText";
/**
 * Find every grapheme-offset position where `needle` appears as a contiguous
 * run of clusters inside `haystack` (cluster array). Empty needle or a needle
 * longer than the haystack returns [].
 *
 * Returns grapheme-cluster ordinals (0-based) suitable for slicing back into
 * the cluster array.
 */
export declare function findAllOccurrences(haystack: readonly string[], needle: readonly string[]): number[];
/**
 * Check whether the text surrounding a candidate position matches the stored
 * prefix/suffix context. Used to disambiguate N>1 exact matches (D5-02 step 3).
 *
 * The stored prefix (resp. suffix) is the text that immediately preceded
 * (resp. followed) the highlight at capture time. For a candidate at
 * `candidateStart`, the expected prefix is the `prefixClusters.length`-cluster
 * window ending at `candidateStart`; the expected suffix is the
 * `suffixClusters.length`-cluster window starting at `candidateEnd`.
 *
 * An empty prefix or suffix (stored because the capture was at the very
 * beginning/end of the text) is treated as a wildcard — it cannot help
 * disambiguate, so it never fails the check.
 */
export declare function matchesContext(clusters: readonly string[], candidateStart: number, exactLen: number, selector: TextQuoteSelector, lang: string): boolean;
/**
 * Core re-anchoring routine over a precomputed normalized-text cluster array.
 * Exposed for unit testing (the cluster array is the load-bearing input; the
 * article-level wrapper below is a thin adapter). Implements D5-02.
 */
export declare function resolveQuoteSelectorInText(clusters: readonly string[], selector: TextQuoteSelector, lang: string, positionHint?: TextPositionSelector): TextPositionSelector | "ambiguous" | "orphan";
/**
 * ANNO-07 tri-state re-anchor: re-resolve a stored TextQuoteSelector against
 * the current revision's normalized text. This thin wrapper is re-exported
 * from src/content/normalizeText.ts so the contract signature stays at the
 * Phase 1 stub site (05-PATTERNS.md §normalizeText.ts).
 *
 * Within a single revision, normalizeText(article) is byte-identical to the
 * text at capture time, so `exact` always matches at least once → the fast
 * confident path. The "ambiguous" and "orphan" branches are only genuinely
 * reachable cross-revision (an edited passage → orphan; a duplicated passage
 * → ambiguous).
 */
export declare function resolveQuoteSelector(article: CanonicalArticle, selector: TextQuoteSelector, positionHint?: TextPositionSelector): TextPositionSelector | "ambiguous" | "orphan";
