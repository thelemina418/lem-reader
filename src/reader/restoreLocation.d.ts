import type { CanonicalArticle } from "../content/types";
/**
 * The rendered top-level article blocks in document order. The
 * [data-block-index] selector matches EXACTLY the top-level blocks — not
 * (a) the article header's <p class="meta"> provenance paragraph (not an
 * article block), and (b) blockquote child <p> elements (a <blockquote> and
 * its child <p> both matched "p, blockquote"). The extra elements shifted
 * the grapheme offsets computed by computeTopVisibleOffset so they no longer
 * matched the article-global offsets from pageStartGlobalOffset (which walks
 * article.blocks via blockNormalizedText). [data-block-index] aligns the
 * scrolling-mode anchor with the paginated-mode page boundaries.
 *
 * Lives here (not in the route) because every offset↔DOM consumer shares it:
 * useScrollSave, the D4-10 anchor capture, the read-aloud follower's scroll
 * target — one selector, one contract.
 */
export declare function queryBlocks(articleEl: HTMLElement): HTMLElement[];
/**
 * Issue #58 — the rendered notes region's top edge (viewport-relative px),
 * or null when the article renders no notes. The hidden measurement
 * projection never counts (it is not the reader's document).
 */
export declare function notesRegionTop(articleEl: HTMLElement): number | null;
/**
 * Normalize a single rendered DOM element's text contribution, mirroring
 * normalizeText's per-block rules EXACTLY (D-05 contract):
 *
 *   - heading / paragraph: collapse ASCII whitespace on .textContent, trim
 *   - code-block (<pre>): .textContent VERBATIM (whitespace is readable code)
 *   - footnote-reference (<sup><a>): the visible marker (e.g. "[1]")
 *   - figure caption / blockquote / list-item: collapse ASCII whitespace on
 *     the direct .textContent (these compound blocks contribute a single
 *     normalized run each under the simplified DOM-element model)
 *
 * The DOM renderer (BlockRenderer.tsx) maps each block kind to a distinct
 * semantic element. We key off the tagName + a `data-kind` hint when present
 * so code-block verbatim behavior is preserved (the load-bearing divergence
 * from normalizeText's whitespace-collapse rule).
 *
 * NOTE: this helper is intentionally a simplified projection — the rendered
 * DOM may carry nested elements (e.g. inline marks inside a paragraph). We
 * rely on HTMLElement.textContent to flatten those into the visible reading
 * text, which is the same thing a screen-reader announces. The block-level
 * granularity is sufficient for location restore (Pattern 5: best-effort
 * block-level target, not exact-character re-anchoring).
 */
export declare function normalizeElText(el: HTMLElement): string;
/**
 * Resolve a saved grapheme offset to the DOM block whose normalized-text
 * range contains it. Walks `blocks` in document order, accumulating each
 * block's grapheme contribution plus one BLOCK_SEPARATOR between blocks
 * (matching normalizeText's `blocks.join(BLOCK_SEPARATOR)` rule).
 *
 * Returns:
 *   - the block whose [consumed, consumed + blockLen] range contains `offset`
 *   - the LAST block if `offset` overshoots the article (clamp — corpus
 *     changed since save; calm nearest-block fallback, never null)
 *   - null if `blocks` is empty (nothing to scroll to)
 *
 * The caller calls `element.scrollIntoView({ block: "start" })` on the
 * result. Under prefers-reduced-motion the global CSS gate sets
 * scroll-behavior: auto, so the restore is instant; otherwise a single calm
 * scroll lands the block at the viewport top.
 */
export declare function findScrollTarget(article: CanonicalArticle, blocks: HTMLElement[], offset: number): HTMLElement | null;
/**
 * Compute the article-global grapheme offset of the topmost visible block,
 * mirroring findScrollTarget's accumulation in the forward direction. Reuses
 * normalizeElText + graphemeClusters so the offset round-trips exactly with
 * the restored target on reopen.
 *
 * Phase 4 Plan 04-04 (D4-10 anchor): ArticleView calls this to capture the
 * reader's current scrolling position before switching to paginated mode, so
 * the paginated surface can render the page containing the same passage.
 * useScrollSave (scroll-position persistence) also calls this — both consumers
 * share ONE implementation (no fork — Pattern 5).
 *
 * @param article   The canonical article (lang drives grapheme segmentation).
 * @param blocks    The rendered block elements in document order (from
 *                  ArticleView.queryBlocks — same selector useScrollSave uses).
 * @param headerPx  Approximate header height in CSS px. A block whose top has
 *                  scrolled to (or past) this line marks the reader's current
 *                  section. Defaults to 48 (the .app-header min-height).
 */
export declare function computeTopVisibleOffset(article: CanonicalArticle, blocks: HTMLElement[], headerPx?: number): number;
