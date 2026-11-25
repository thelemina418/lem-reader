// playwright.workers.ts
// Issue #185 — the functional suites' quiet-load-aware worker cap.
//
// The reference box is shared: it runs this repo's self-hosted runner AND
// ordinary multi-user work (docs/agents/test-discipline.md). Two operating
// points are documented in playwright.config.ts's worker-cap note:
//
//   - LOADED → 3 workers. The 13-10 honest-gate cap. The historical
//     moving-target starvation class (late-suite webkit contexts starved on
//     the single Vite dev server's module fetches under load 6–10)
//     converged at this concurrency; every green reference gate since has
//     run with it.
//   - QUIET → cores/2 capped at 5. The pre-cap default that ran for months
//     on the 10-core reference Mac before the cap; the starvation class was
//     observed only under load, never on a quiet box. The #185
//     under-ten-minute PR-gate goal is unreachable at 3 workers (best
//     serialized quiet evidence: 27.0m wall for 4.8k worker-seconds), so a
//     genuinely quiet window re-raises concurrency to the known-good shape.
//
// "Genuinely quiet" operationalizes the issue's "load < ~3 held for the
// whole suite": a full run spans many minutes, so BOTH the 1- and 5-minute
// load averages must sit under QUIET_LOAD_THRESHOLD at startup. A settling
// window (1-min under, 5-min still at/above) stays at the loaded cap — the
// 2026-10-14 03:26 gate dispatched at 1-min 2.89 / 5-min 3.26 and its
// webkit tail still hit 60-120s budget ceilings. The decision is made once
// when the config is evaluated (load at startup is the best predictor;
// the suite's own load is expected and was the historical quiet shape).
// `--workers=N` still overrides the config for one-off calibration of the
// cap itself.
//
// Pure function on purpose: tests/unit/worker-cap.test.ts pins both
// operating points against the recorded dispatch loads.
//
// 2026-11-25 (agents moved off the reference Mac to Lemcentre): a third,
// MODERATE operating point — 4 workers — for the common case the binary
// rule never served. Back-to-back queued CI runs start on the previous
// suite's load tail, and ordinary desktop use (browsing, editing) keeps the
// 1-min average at 3–6, so 11 of the 12 reference gates on 2026-11-22..25
// ran at 3 workers (~36m); the one quiet start ran at 5 (23.1m, 0 flaky).
// The starvation class above was recorded at load 6–10 WITH agent sessions
// on the box, so MODERATE stays strictly below that band (both averages
// under MODERATE_LOAD_THRESHOLD).
//
// MEMORY GUARD: the box is also the owner's working machine, and a swap
// storm freezes the desktop and poisons every timing. Neither raised tier
// (QUIET or MODERATE) is taken unless the OS reports at least
// MIN_AVAILABLE_MEMORY_PCT of memory available at startup (macOS:
// kern.memorystatus_level; Linux: MemAvailable / MemTotal). Unknown memory
// (unreadable on this platform) keeps the pre-guard behavior for QUIET and
// never grants MODERATE.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Below this 1- AND 5-minute load average the box counts as quiet. */
export const QUIET_LOAD_THRESHOLD = 3;

/** Quiet ceiling — the pre-cap default on the 10-core reference machine. */
export const MAX_QUIET_WORKERS = 5;

/** The loaded cap every green reference gate has run with since 13-10. */
export const LOADED_WORKERS = 3;

/** Below this 1- AND 5-minute load average (and not quiet) the box is moderate. */
export const MODERATE_LOAD_THRESHOLD = 6;

/** The moderate operating point — between the loaded cap and the quiet ceiling. */
export const MODERATE_WORKERS = 4;

/** Raised tiers need at least this much memory available at startup. */
export const MIN_AVAILABLE_MEMORY_PCT = 40;

/**
 * @param availableMemoryPct  percent of memory the OS reports available at
 *   startup, or `undefined` when it cannot be read on this platform.
 */
export function planWorkers(
  cores: number,
  load1min: number,
  load5min: number,
  availableMemoryPct?: number,
): number {
  const halfCores = Math.max(1, Math.floor(cores / 2));
  const loaded = Math.min(LOADED_WORKERS, halfCores);
  const memoryKnown = availableMemoryPct !== undefined && Number.isFinite(availableMemoryPct);
  const memoryTight = memoryKnown && availableMemoryPct < MIN_AVAILABLE_MEMORY_PCT;
  if (memoryTight) return loaded;
  const quiet = load1min < QUIET_LOAD_THRESHOLD && load5min < QUIET_LOAD_THRESHOLD;
  if (quiet) return Math.min(MAX_QUIET_WORKERS, halfCores);
  const moderate = load1min < MODERATE_LOAD_THRESHOLD && load5min < MODERATE_LOAD_THRESHOLD;
  if (moderate && memoryKnown) return Math.min(MODERATE_WORKERS, halfCores);
  return loaded;
}

/**
 * Percent of memory the OS reports available right now, or `undefined` when
 * it cannot be read (the planner then never grants MODERATE). macOS:
 * kern.memorystatus_level — the "System-wide memory free percentage" that
 * `memory_pressure` prints. Linux: MemAvailable / MemTotal from /proc/meminfo.
 */
export function readAvailableMemoryPct(
  platform: NodeJS.Platform = process.platform,
): number | undefined {
  try {
    if (platform === "darwin") {
      const out = execFileSync("sysctl", ["-n", "kern.memorystatus_level"], {
        encoding: "utf8",
        timeout: 2000,
      });
      const pct = Number(out.trim());
      return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : undefined;
    }
    if (platform === "linux") {
      const info = readFileSync("/proc/meminfo", "utf8");
      const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(info)?.[1]);
      const total = kb("MemTotal");
      const available = kb("MemAvailable");
      if (!(total > 0) || !Number.isFinite(available)) return undefined;
      return Math.round((available / total) * 100);
    }
  } catch {
    // Unreadable → unknown; the planner falls back to the pre-guard tiers.
  }
  return undefined;
}
