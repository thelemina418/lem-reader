/** Below this 1- AND 5-minute load average the box counts as quiet. */
export declare const QUIET_LOAD_THRESHOLD = 3;
/** Quiet ceiling — the pre-cap default on the 10-core reference machine. */
export declare const MAX_QUIET_WORKERS = 5;
/** The loaded cap every green reference gate has run with since 13-10. */
export declare const LOADED_WORKERS = 3;
/** Below this 1- AND 5-minute load average (and not quiet) the box is moderate. */
export declare const MODERATE_LOAD_THRESHOLD = 6;
/** The moderate operating point — between the loaded cap and the quiet ceiling. */
export declare const MODERATE_WORKERS = 4;
/** Raised tiers need at least this much memory available at startup. */
export declare const MIN_AVAILABLE_MEMORY_PCT = 40;
/**
 * @param availableMemoryPct  percent of memory the OS reports available at
 *   startup, or `undefined` when it cannot be read on this platform.
 */
export declare function planWorkers(cores: number, load1min: number, load5min: number, availableMemoryPct?: number): number;
/**
 * Percent of memory the OS reports available right now, or `undefined` when
 * it cannot be read (the planner then never grants MODERATE). macOS:
 * kern.memorystatus_level — the "System-wide memory free percentage" that
 * `memory_pressure` prints. Linux: MemAvailable / MemTotal from /proc/meminfo.
 */
export declare function readAvailableMemoryPct(platform?: NodeJS.Platform): number | undefined;
