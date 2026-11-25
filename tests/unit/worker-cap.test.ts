// tests/unit/worker-cap.test.ts
// Issue #185 — the reference suite's quiet-load-aware worker cap. The
// functional configs ask `planWorkers` for a worker count at startup; the
// cap must reproduce the two documented operating points exactly:
//
//   - LOADED (the 13-10 honest-gate shape): 3 workers, bounded by cores/2
//     on smaller machines (a 4-core loaded box gets 2 — the physical
//     oversubscription bound; the reference Mac is 10-core so the bound
//     never bites there). The historical
//     moving-target webkit starvation class (late-suite contexts starved on
//     the single Vite dev server under ordinary multi-user load, load 6–10)
//     converged at this cap, and every green reference gate since has run
//     with it.
//   - QUIET: cores/2 capped at 5 — the pre-cap default that ran for months
//     on the 10-core reference box before the cap. The under-ten-minute
//     PR-gate goal (#185) is unreachable at 3 workers (best serialized
//     quiet evidence: 27.0m); the quiet cap re-raises concurrency ONLY when
//     the box is genuinely quiet, where the starvation class was never
//     observed.
//
// "Genuinely quiet" follows the issue's operational definition (load < ~3
// held for the whole suite). A ~16-30m run spans the 5-minute average, so
// quiet requires BOTH the 1- and 5-minute averages under the threshold —
// the 2026-10-14 03:26 gate dispatched at 1-min 2.89 with the 5-min still
// at 3.26 (a settling window, not a quiet one) and must not get the quiet 5.
//
// 2026-11-25 — MODERATE (4) and the memory guard. Agents moved off the
// reference Mac; its remaining load is the owner's desktop use plus the
// previous queued suite's tail. Both averages under 6 (strictly below the
// recorded 6–10 starvation band) with memory known and ≥ 40% available
// earns 4; a raised tier is never taken with memory tight, and MODERATE is
// never granted with memory unknown. The existing 3-argument operating
// points (memory unknown) are unchanged.
import { describe, expect, test } from "vitest";
import {
  LOADED_WORKERS,
  MAX_QUIET_WORKERS,
  MIN_AVAILABLE_MEMORY_PCT,
  MODERATE_LOAD_THRESHOLD,
  MODERATE_WORKERS,
  planWorkers,
  QUIET_LOAD_THRESHOLD,
} from "../../playwright.workers";

describe("planWorkers — the reference suite's quiet-load-aware cap", () => {
  test("a loaded box keeps the 13-10 starvation cap (3)", () => {
    // Observed dispatch loads from the recorded reference runs.
    expect(planWorkers(10, 12.46, 9.51)).toBe(3); // 2026-10-14 00:47 PR gate
    expect(planWorkers(10, 6.37, 5.2)).toBe(3); // ordinary multi-user load
    expect(planWorkers(10, 46.06, 20.0)).toBe(3); // 2026-10-14 00:56 exhaustive
  });

  test("a genuinely quiet box raises to cores/2 capped at the known-good 5", () => {
    expect(planWorkers(10, 2.3, 2.1)).toBe(5); // the quiet Mac window
    expect(MAX_QUIET_WORKERS).toBe(5); // the pre-cap default on 10 cores
  });

  test("a settling window is NOT quiet: 1-min under, 5-min at the threshold keeps 3", () => {
    // The exact 2026-10-14 03:26 gate dispatch: declining but not held.
    expect(planWorkers(10, 2.89, 3.26)).toBe(3);
    // Exactly at the threshold is not below it (strict <).
    expect(planWorkers(10, QUIET_LOAD_THRESHOLD, 2.0)).toBe(3);
    expect(planWorkers(10, 2.0, QUIET_LOAD_THRESHOLD)).toBe(3);
  });

  test("smaller boxes never exceed cores/2 in either operating point", () => {
    expect(planWorkers(4, 1.0, 1.0)).toBe(2);
    expect(planWorkers(4, 8.0, 8.0)).toBe(2);
    expect(planWorkers(2, 0.5, 0.5)).toBe(1);
    expect(planWorkers(2, 9.0, 9.0)).toBe(1);
  });

  test("the loaded cap also respects cores/2 on small boxes", () => {
    expect(LOADED_WORKERS).toBe(3);
    expect(planWorkers(4, 12.0, 12.0)).toBe(2);
  });

  test("moderate load with memory to spare runs 4 (2026-11-22..25 dispatch loads)", () => {
    expect(MODERATE_WORKERS).toBe(4);
    expect(MODERATE_LOAD_THRESHOLD).toBe(6);
    expect(planWorkers(10, 3.85, 3.96, 55)).toBe(4); // 2026-11-23 18:59 main
    expect(planWorkers(10, 5.85, 4.85, 55)).toBe(4); // 2026-11-23 16:52 main
    expect(planWorkers(10, 3.68, 2.85, 55)).toBe(4); // 2026-11-22 20:26 PR
    // The settling window gets MODERATE, never the quiet 5.
    expect(planWorkers(10, 2.89, 3.26, 55)).toBe(4);
  });

  test("the recorded 6–10 starvation band and a hot 5-min average stay at 3", () => {
    expect(planWorkers(10, 6.2, 6.31, 70)).toBe(3); // 2026-11-25 17:30 main
    expect(planWorkers(10, 7.65, 6.81, 70)).toBe(3); // 2026-11-25 18:20 #14
    expect(planWorkers(10, 4.38, 12.18, 70)).toBe(3); // previous suite's tail
    expect(planWorkers(10, MODERATE_LOAD_THRESHOLD, 2.0, 70)).toBe(3); // strict <
  });

  test("tight memory never takes a raised tier — quiet or moderate", () => {
    expect(MIN_AVAILABLE_MEMORY_PCT).toBe(40);
    expect(planWorkers(10, 2.3, 2.1, 39)).toBe(3);
    expect(planWorkers(10, 3.85, 3.96, 39)).toBe(3);
    expect(planWorkers(10, 2.3, 2.1, MIN_AVAILABLE_MEMORY_PCT)).toBe(5); // at threshold is enough
    expect(planWorkers(4, 1.0, 1.0, 10)).toBe(2); // the small-box bound still holds
  });

  test("unknown memory keeps the pre-guard behavior: quiet 5, never moderate", () => {
    expect(planWorkers(10, 2.3, 2.1, undefined)).toBe(5);
    expect(planWorkers(10, 3.85, 3.96, undefined)).toBe(3);
    expect(planWorkers(10, 3.85, 3.96, Number.NaN)).toBe(3);
  });

  test("moderate respects cores/2 on small boxes", () => {
    expect(planWorkers(4, 4.0, 4.0, 80)).toBe(2);
    expect(planWorkers(6, 4.0, 4.0, 80)).toBe(3);
  });
});
