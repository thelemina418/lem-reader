import { z } from "zod";
import type { CanonicalArticle } from "../content/types";
import type { SourceCursor, PageFragment } from "./types";
export declare const BlockWindowSchema: z.ZodObject<{
    includeFootnotes: z.ZodOptional<z.ZodBoolean>;
    startBlock: z.ZodNumber;
    endBlock: z.ZodNumber;
    startGrapheme: z.ZodOptional<z.ZodNumber>;
    endGrapheme: z.ZodOptional<z.ZodNumber>;
    startFootnote: z.ZodOptional<z.ZodNumber>;
    endFootnote: z.ZodOptional<z.ZodNumber>;
    startFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
    endFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type BlockWindow = z.infer<typeof BlockWindowSchema>;
export declare const MeasurementScopeSchema: z.ZodObject<{
    includeFootnotes: z.ZodOptional<z.ZodBoolean>;
    startBlock: z.ZodNumber;
    endBlock: z.ZodNumber;
    startGrapheme: z.ZodOptional<z.ZodNumber>;
    endGrapheme: z.ZodOptional<z.ZodNumber>;
    startFootnote: z.ZodOptional<z.ZodNumber>;
    endFootnote: z.ZodOptional<z.ZodNumber>;
    startFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
    endFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
    articleId: z.ZodString;
    revision: z.ZodNumber;
}, z.core.$strip>;
export type MeasurementScope = z.infer<typeof MeasurementScopeSchema>;
export declare const MAX_BLOCKS = 32;
export declare const MAX_GRAPHEMES = 8000;
export declare const WHOLE_ARTICLE_MOUNT_BOUND_GRAPHEMES: number;
export declare function blockWindows(article: CanonicalArticle): readonly BlockWindow[];
/**
 * Whole-work measurement is bounded independently of the small continuation
 * tiles. Bound both DOM rows and aggregate text (including a single long
 * block). Source rows are not pages: many short paragraphs can share a page.
 * The independent 2,048-row DOM bound and aggregate-text bound limit admission;
 * the engine's unchanged 300-page ceiling limits actual layout work.
 * This is a source-work admission bound, NOT a page estimate:
 * extreme layouts can still hit capacity and refine through the scoped host.
 * Body and note rows share a bounded publication, with homogeneous pages.
 */
export declare function readingWindows(article: CanonicalArticle): readonly BlockWindow[];
/**
 * Issue #303 — cooperative cold-mount chunks for an oversized scope.
 *
 * Returns null when the window's projection is small enough to mount in one
 * synchronous pass (every scope at or under the pre-#301 whole-article
 * bound — byte-identical rendering path). Otherwise returns BLOCK-ALIGNED
 * body chunk windows followed by ROW-ALIGNED footnote chunk windows whose
 * concatenation covers exactly the window's rows in canonical order:
 * the projection mounts one chunk per task (WindowedPaginatedSurface),
 * restoring the 260820 slicing invariant over the cold open while the
 * scope — and therefore the publication's whole-work numbering — stays
 * exactly what readingWindows admitted.
 *
 * Chunks never cut a block or a note row: the measurement engine counts the
 * scope's rendered rows 1:1 (measureAllBlocks + the alignment guard), so a
 * mid-row cut would change the row count the engine must find. A giant row
 * mounts whole inside its chunk (over capacity, never over scope). The
 * window's own boundary cursors (a refined/assignment scope's slice bounds)
 * ride the boundary chunks; interior chunks are whole-row windows.
 */
export declare function coldMountChunks(article: CanonicalArticle, window: BlockWindow): readonly BlockWindow[] | null;
/** A capacity-limited prefix must not briefly advertise a whole-work count. */
export declare function hasWholeArticlePagination(article: CanonicalArticle, range: BlockWindow | undefined, pages: readonly PageFragment[]): boolean;
/** Exact page denominators are legal only for a complete canonical scope. */
export declare function isWholeArticleWindow(article: CanonicalArticle, range?: BlockWindow): boolean;
export declare function canUseBlockWindows(article: CanonicalArticle): boolean;
/** The article-global D-05 offset of a window's first source grapheme. */
export declare function windowGlobalStart(article: CanonicalArticle, window: BlockWindow): number;
/**
 * The article-global D-05 offset one past the window's last source grapheme.
 * A window that ends at its last row's full length also owns the block
 * separator that follows it (the pre-#233 half-open convention) — EXCEPT the
 * work's final row, which owns nothing past its text: the last window's end
 * is exactly the canonical total, so a footnoted work finishes only when its
 * footnote text is truly reached (#235).
 */
export declare function windowGlobalEnd(article: CanonicalArticle, window: BlockWindow): number;
export declare function blockWindowForOffset(article: CanonicalArticle, offset: number, windows?: readonly BlockWindow[]): BlockWindow;
/**
 * The canonical D-05 offset of a continuation cursor (issues #233/#235): body
 * cursors read the block prefix sums; footnote cursors read their row's
 * canonical start. The ONE conversion — consumers must never rebuild it.
 */
export declare function cursorGlobalOffset(article: CanonicalArticle, cursor: SourceCursor): number;
/**
 * Refine an existing source window at a capacity cursor. The two children
 * cover exactly the same original source range; nothing is renumbered.
 * Intra-block cursors refine any split-semantic kind (prose per issue
 * #233, lists/quotations per issue #234); a cursor inside an atomic block
 * has no slice semantic and stays unsupported (honest failure). Issue #235:
 * a cursor carrying footnoteIndex refines a footnote window's rows — a
 * footnote body is a pure inline-run stream, so any interior grapheme
 * boundary is legal.
 */
export declare function refineWindow(article: CanonicalArticle, window: BlockWindow, cursor: SourceCursor): readonly [BlockWindow, BlockWindow] | null;
export declare function sameWindow(a: BlockWindow, b: BlockWindow): boolean;
/**
 * The ONE scope-identity string (issue #233): two continuation windows of
 * the SAME block are different scopes, so consumers that gate repagination
 * anchoring on a scope key must include the slice bounds. Keys built by
 * hand elsewhere drift from this definition — always call this.
 */
export declare function windowScopeKey(window: BlockWindow | undefined): string;
/**
 * The footnote-slice identity string (issue #235) — shared by windowScopeKey
 * and the pagination trail's scope-change evidence so two formatters can
 * never drift.
 */
export declare function footnoteSliceScopeKey(startFootnote: number, endFootnote: number, startFootnoteGrapheme?: number, endFootnoteGrapheme?: number): string;
/** Article metadata belongs only at the original work's source origin. */
export declare function isWorkStart(window: BlockWindow | undefined): boolean;
/**
 * Whether a neighbor continuation exists BEFORE this scope — a scope may
 * begin mid-block (a giant-prose tail slice), so the block index alone
 * cannot answer (issue #233).
 */
export declare function windowHasPrevious(article: CanonicalArticle, window: BlockWindow): boolean;
/** Whether a neighbor continuation exists AFTER this scope (issue #233). */
export declare function windowHasNext(article: CanonicalArticle, window: BlockWindow): boolean;
