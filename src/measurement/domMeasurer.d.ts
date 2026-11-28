import type { BlockMeasurement } from "./types";
/**
 * Cooperative slice budget (ms). A slice must stay well under a frame-pair
 * budget so paint and input interleave with the measurement pass; ~10ms
 * sits inside the 8–12ms direction (260820-beo). The budget is a CEILING —
 * a small article that measures in under 10ms completes with zero yields.
 */
export declare const DEFAULT_SLICE_BUDGET_MS = 10;
/**
 * The ONE measured-elements selector (Plan 05-05 + issue #235): top-level
 * body blocks AND footnote rows, excluding page-fragment descendants. The
 * engine's alignment checks consume the SAME string — selector drift between
 * measurement and validation would silently misalign rows.
 */
export declare const MEASURED_ELEMENTS_SELECTOR: string;
/**
 * Yield control to the main thread so paint/input can interleave with a
 * long measurement pass. Prefers scheduler.yield() when the platform
 * provides it; falls back to setTimeout(0) otherwise (jsdom, older
 * engines). `scheduler` is read DYNAMICALLY off globalThis via STRUCTURAL
 * typing — no reliance on lib.dom's Scheduler typings (coverage under the
 * project's TypeScript lib is unverified) and no `any`. The dynamic
 * per-call read is also what makes the jsdom spy in
 * domMeasurerSlicing.test.ts (a globalThis.scheduler stub) effective.
 *
 * Exported as the ONE cooperative-yield primitive (issue #303): the cold-mount
 * chunk walk in WindowedPaginatedSurface reuses THIS yield so the slicing
 * invariant keeps one implementation — never a forked timer policy.
 */
export declare function yieldToMain(): Promise<void>;
/**
 * Measure every top-level rendered block in a single read-phase per slice.
 * Returns fractional heights + per-line counts + per-block LineBox[]
 * (Plan 04-06). Aborts mid-pass (via AbortError) if `signal` fires — the
 * engine treats AbortError as a silent cancel.
 *
 * 260820-beo: the pass is async and cooperatively time-sliced — DOM reads
 * are batched within a ~sliceBudgetMs slice, and between slices the pass
 * yields to the main thread and re-checks the signal. Layout drift BETWEEN
 * slices (scroll, an image load shifting earlier blocks) is ACCEPTED and
 * must NOT be "fixed" by re-reading earlier blocks: heights were always
 * measured against shifting geometry, and the engine's epoch/commit guard
 * is the invalidation mechanism — re-reading would reintroduce the
 * re-measure storm this slicing removes.
 *
 * Plan 04-06: queries `[data-block-index]` (1:1 with article.blocks by
 * BlockRenderer construction) instead of the legacy flat BLOCK_SELECTOR.
 * Container blocks (blockquote / lists) used to double-count their nested
 * children under BLOCK_SELECTOR, breaking the engine's 1:1 contract — the
 * attribute selector eliminates that mismatch by construction.
 *
 * @param articleEl The rendered <article> element (from ArticleView's
 *   callback-ref seam). Must contain top-level blocks emitted by ArticleBody
 *   (each carrying data-block-index).
 * @param signal The current epoch's AbortSignal; checked between blocks AND
 *   after every yield AND between text-node iterations inside readLineBoxes
 *   so a newer trigger cancels a long measurement.
 * @param sliceBudgetMs Ceiling on accumulated read time before the pass
 *   yields to the main thread (defaults to DEFAULT_SLICE_BUDGET_MS).
 */
export declare function measureAllBlocks(articleEl: HTMLElement, signal: AbortSignal, sliceBudgetMs?: number): Promise<BlockMeasurement[]>;
