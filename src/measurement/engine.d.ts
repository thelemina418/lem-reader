import type { CanonicalArticle } from "../content/types";
import type { BlockWindow } from "../pagination/blockWindow";
import type { ReaderSettings } from "../content/schema";
import type { Constraints, EligibilityState, MeasurementResult } from "./types";
import type { DiagnosticBus } from "./diagnostics";
import type { RuntimeDriftGuard } from "./driftGuard";
/**
 * The block-kind strings the renderer emits (mirrors src/content/schema.ts
 * Block union kinds). Used by chooseStrategy's exhaustive switch — do NOT
 * add a default branch (Pattern F: TS flags missing cases at compile time).
 */
export type BlockKind = "heading" | "paragraph" | "blockquote" | "bulleted-list" | "numbered-list" | "figure" | "code-block" | "footnote-reference" | "unsupported";
export interface MeasurementEngineOptions {
    article: CanonicalArticle;
    blockWindow?: BlockWindow;
    articleEl: HTMLElement;
    diagnostics: DiagnosticBus;
    /** Defaults to DOM-only; Plan 02 seeds from the calibration fingerprint. */
    eligibility?: EligibilityState;
    /**
     * Optional runtime drift guard (D3-08). When present, the engine samples
     * Pretext-predicted eligible blocks against DOM references each pass and
     * downgrades drifting kinds. Optional so the engine is constructible
     * without it (e.g. when no kind is eligible — no point sampling).
     */
    driftGuard?: RuntimeDriftGuard;
    /**
     * Reads the current ReaderSettings — needed to derive the canvas font
     * shorthand + line-height per block kind for Pretext measurement. The
     * hook supplies this from its settingsRef. Required when driftGuard is
     * present OR any kind is eligible (so Pretext predictions can be computed);
     * absent → every pass is all-DOM regardless of eligibility.
     */
    getReaderSettings?: () => ReaderSettings;
    /**
     * Max |DOM heightPx − fast-measurer heightPx| for a dispatched block to
     * count as agreement (the fast result is committed). Blocks beyond it —
     * or with a line-count mismatch — fall back to the DOM measurement and
     * emit drift-exceedance. Defaults to DEFAULT_DRIFT_TOLERANCE_PX; the hook
     * passes its RUNTIME_DRIFT_TOLERANCE_PX so the dispatch and the drift
     * guard share one bound.
     */
    driftTolerancePx?: number;
}
/**
 * MeasurementEngine owns its own Epoch — each run() captures the latest
 * bumped epoch, so a trigger fired during a previous run invalidates that
 * previous run at its commit guard. (The TriggerCoalescer has its own
 * Epoch for trigger-coalescing; this one is for engine-internal commit
 * guards when the engine is invoked directly.)
 */
export declare class MeasurementEngine {
    private readonly opts;
    private readonly driftTolerancePx;
    private readonly epoch;
    private trustedHandler;
    constructor(opts: MeasurementEngineOptions);
    /**
     * Run one measurement pass for `constraints`. The font gate + epoch
     * commit guard run inside; on success the trusted handler is invoked
     * with a fresh MeasurementResult. On staleness or cancel, the result is
     * dropped silently (late-epoch-drop diagnostic emitted for staleness).
     *
     * PAGE-07: a late-epoch result NEVER replaces the trusted view.
     */
    run(constraints: Constraints): Promise<void>;
    /**
     * Calibration-gated per-block strategy dispatch (issue 6 — the seam the
     * ADR-0001 gate feeds).
     *
     * For each DOM-measured block, chooseStrategy picks the measurer:
     *   - "dom" (non-eligible kinds, or kinds the runtime guard downgraded)
     *     → the DOM measurement is committed unchanged.
     *   - "pretext" → the fast text measurer produces height + lineCount from
     *     the block's text (canvas-measured, no reflow). The fast result is
     *     committed ONLY when it agrees with the DOM reference: finite,
     *     positive, line-count equal, and |Δheight| ≤ driftTolerancePx.
     *     Committed entries keep the DOM margins AND the DOM line boxes —
     *     line boxes are the D-05 split-point primitive for splitting kinds
     *     (lineBoxes.ts), and the sole currently-eligible kind (heading) is
     *     atomic, so pagination consumes only the fast height/lineCount.
     *     Every usable pair (agreement or not) is also returned for the
     *     runtime drift guard, which owns kind-level downgrade (D3-08).
     *
     * Disagreement/throw handling (never silent):
     *   - usable prediction + drift beyond tolerance or line-count mismatch
     *     → DOM committed; ONE `drift-exceedance` diagnostic per pass.
     *   - Pretext throw → DOM committed; `measurement-error` diagnostic (V7).
     *   - empty text / non-finite numbers → DOM committed, no diagnostic
     *     (the fast measurer is not applicable — calibration never exercised
     *     such blocks; this is expected fallback, not drift).
     *
     * When no settings reader is configured (or no block routes to "pretext")
     * the returned blocks ARE the DOM measurements — byte-identical output to
     * a dispatch-free pass (zero behavior change for ineligible-only corpora).
     */
    private dispatchPretextStrategies;
    /**
     * Register the trusted-view handler. Returns an unsubscribe. The hook
     * calls this once per mount; the engine invokes the handler only with a
     * result that survived the commit guard.
     */
    onTrusted(handler: (result: MeasurementResult) => void): () => void;
    /** Cancel any in-flight pass by bumping the epoch past the captured one. */
    cancel(): void;
}
/**
 * Choose the measurement strategy for a block kind. Exhaustive switch — NO
 * default branch — so TypeScript flags any missing case at compile time
 * (Pattern F, mirrors BlockRenderer.tsx L21–113). paragraph + heading
 * dispatch to "pretext" when their eligibility flag is true (seeded from
 * calibration/fingerprint.json); all other kinds are DOM by definition
 * (D3-01 — rich/non-text kinds have no Pretext fast path).
 *
 * Production caller: MeasurementEngine.run() → dispatchPretextStrategies
 * invokes this per block (issue 6 wiring); the runtime drift guard's
 * downgrades mutate the eligibility the next pass consults here.
 */
export declare function chooseStrategy(kind: BlockKind, eligibility: EligibilityState): "pretext" | "dom";
