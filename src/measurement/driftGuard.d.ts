import type { DiagnosticBus } from "./diagnostics";
import type { BlockMeasurement, EligibilityState } from "./types";
/** Constructor args for RuntimeDriftGuard. */
export interface RuntimeDriftGuardOptions {
    /** Max |dom.heightPx − prediction.heightPx| before a kind is downgraded. */
    tolerancePx: number;
    /** Where downgrade diagnostics are emitted (D3-05). */
    diagnostics: DiagnosticBus;
    /** Max blocks sampled per pass (RESEARCH Assumption A3 — keep cheap). */
    sampleSize?: number;
}
/**
 * RuntimeDriftGuard samples Pretext predictions against DOM references per
 * measurement pass and downgrades a kind Pretext→DOM when drift exceeds
 * tolerance.
 *
 * The guard is stateless across passes other than the EligibilityState it
 * mutates; the engine threads the (possibly-mutated) eligibility into the
 * next pass's chooseStrategy calls.
 */
export declare class RuntimeDriftGuard {
    private readonly tolerancePx;
    private readonly diagnostics;
    private readonly sampleSize;
    constructor(opts: RuntimeDriftGuardOptions);
    /**
     * Compare up to `sampleSize` Pretext predictions to their DOM references.
     * Mutates `eligibility` in place when a kind drifts beyond tolerance and
     * emits one `runtime-guard-downgrade` diagnostic per downgraded kind
     * (D3-05 — never silently degrade). Returns the same eligibility object
     * (possibly mutated) for the engine to thread into the next pass.
     *
     * @param predictions Pretext-predicted measurements for blocks where
     *   chooseStrategy returned "pretext" this pass.
     * @param domReference DOM-measured truth for the same blocks (parallel
     *   array; matched by index).
     * @param eligibility The current EligibilityState; mutated on downgrade.
     */
    sample(predictions: BlockMeasurement[], domReference: BlockMeasurement[], eligibility: EligibilityState): EligibilityState;
}
