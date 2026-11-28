/**
 * Epoch — a monotonic counter + AbortController. The single source of
 * "what is the newest in-flight measurement" so the commit guard can drop
 * stale results (PAGE-07).
 */
export declare class Epoch {
    private epochCount;
    private controller;
    /**
     * Cancel in-flight work for the previous epoch and start a new one.
     * Returns the new epoch number and a fresh AbortSignal that the engine
     * threads through the font gate + DOM measurer.
     */
    bump(): {
        epoch: number;
        signal: AbortSignal;
    };
    /**
     * True iff `candidate` is the newest epoch. The engine's commit guard
     * calls this with the epoch captured at run() start; a false return means
     * a newer trigger has invalidated this work and the result MUST be
     * dropped (PAGE-07 — late epoch cannot win).
     */
    isCurrent(candidate: number): boolean;
    /** The newest epoch number issued so far (0 before any bump). */
    current(): number;
}
