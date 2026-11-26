// tests/e2e/calibration/fingerprint.compare.ts
// D3-10 CI regression gate. Loads the committed calibration/fingerprint.json,
// reads the per-engine results written by the calibration harness to
// .calibration-tmp/<engine>.json, merges them into a fresh fingerprint, and
// exits 1 if a previously-eligible kind regressed (became ineligible in the
// fresh run). A newly-eligible kind is NOT a regression (improvement); a
// previously-ineligible kind staying ineligible is NOT a regression.
//
// Invocation:
//   node tests/e2e/calibration/fingerprint.compare.ts
// (Node 22.22+ strips TypeScript type annotations natively; no transpile
// step needed. CI invokes this AFTER `npm run calibrate` writes the temp
// files.)
//
// The comparison is READ-ONLY against the committed baseline: the fresh
// merged result goes to .calibration-tmp/fingerprint.fresh.json (the
// evidence the Lemcentre nightly lane stages as calibration/merged.json).
// A gate that rewrote its own baseline on every run made the Linux lane
// report a baseline regeneration (exit 8) on a PASSED comparison
// (lem-reader#2 attempt 1). Rewriting calibration/fingerprint.json takes
// the explicit --write-baseline flag (npm run calibrate:rebaseline).
//
// Exit codes:
//   0 — no regression (or no committed fingerprint to diff against; first run)
//   1 — a previously-eligible (engine, kind) is now ineligible (REGRESSION),
//       or the fresh run measured a different fixture set than the baseline
//       (COVERAGE MISMATCH: the comparison would not be like for like)
//
// Usage in CI:
//   - On a PR: `npm run calibrate` then `node tests/e2e/calibration/fingerprint.compare.ts`
//     — fails the build if a Pretext-eligible kind regressed.
//   - To intentionally update the baseline after an approved eligibility
//     change (e.g. a new Pretext version widens eligibility): run
//     `npm run calibrate:rebaseline`, then commit the regenerated
//     calibration/fingerprint.json.
//
// Shape (mirrors the fingerprint.ts loader in src/measurement):

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const FINGERPRINT_PATH = resolve(REPO_ROOT, "calibration", "fingerprint.json");
const TMP_DIR = resolve(REPO_ROOT, ".calibration-tmp");
const FRESH_NAME = "fingerprint.fresh.json";
const FRESH_PATH = resolve(TMP_DIR, FRESH_NAME);
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// ── Types (mirror src/measurement/fingerprint.ts) ───────────────────────────

interface CellAggregate {
  eligible: boolean;
  heightDriftP95: number;
  breaksMatchRatio: number;
  sampleCount: number;
}
interface EngineRows {
  [fixtureId: string]: {
    [variantKey: string]: {
      paragraph?: CellAggregate;
      heading?: CellAggregate;
    };
  };
}
interface Fingerprint {
  schemaVersion: number;
  generatedAt?: string;
  toleranceBound?: { heightDriftPx?: number; breaksExact?: boolean };
  rationale?: string;
  engines?: Record<string, EngineRows>;
}
interface BlockResult {
  fixtureId: string;
  variantKey: string;
  kind: "paragraph" | "heading";
  level?: number;
  engine: string;
  heightDrift: number;
  breaksMatch: boolean;
}

// ── Aggregation (mirror calibration.harness.ts semantics) ───────────────────

const TOLERANCE_PX = 1.0;
const ELIGIBILITY_THRESHOLD = 0.95;

function aggregate(results: readonly BlockResult[]): Record<string, EngineRows> {
  const byEngine: Record<string, EngineRows> = {};
  // Per-cell raw accumulators (separate from final CellAggregate).
  interface CellRaw {
    heightDriftSamples: number[];
    breaksMatches: number;
    total: number;
  }
  const rawByCell = new Map<string, CellRaw>();
  for (const r of results) {
    const key = `${r.engine}|${r.fixtureId}|${r.variantKey}|${r.kind}`;
    const cell = rawByCell.get(key) ?? {
      heightDriftSamples: [],
      breaksMatches: 0,
      total: 0,
    };
    cell.heightDriftSamples.push(Math.abs(r.heightDrift));
    cell.breaksMatches += r.breaksMatch ? 1 : 0;
    cell.total += 1;
    rawByCell.set(key, cell);
  }
  for (const [key, raw] of rawByCell) {
    const [engine, fixtureId, variantKey, kind] = key.split("|") as [
      string,
      string,
      string,
      "paragraph" | "heading",
    ];
    const e = (byEngine[engine] ??= {});
    const f = (e[fixtureId] ??= {});
    const v = (f[variantKey] ??= {});
    const sorted = [...raw.heightDriftSamples].sort((a, b) => a - b);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
    const p95 = sorted[p95Idx] ?? 0;
    const breaksRatio = raw.breaksMatches / raw.total;
    const eligible = p95 <= TOLERANCE_PX && breaksRatio >= 1.0;
    v[kind] = {
      eligible,
      heightDriftP95: p95,
      breaksMatchRatio: breaksRatio,
      sampleCount: raw.total,
    };
  }
  return byEngine;
}

/**
 * Derive per-engine per-kind eligibility aggregates at the (engine, kind)
 * level. A kind is engine-eligible iff ≥ ELIGIBILITY_THRESHOLD fraction of
 * its cells pass AND every (font × spacing) combination for that kind has
 * at least one passing (size × measure) cell (Pitfalls 5/6 — a kind
 * failing only under sans or spacious is conditionally ineligible, recorded
 * per cell but flagged in the rationale).
 */
function engineKindEligibility(
  engine: EngineRows,
  kind: "paragraph" | "heading",
): { eligible: boolean; passingFraction: number } {
  let total = 0;
  let passing = 0;
  for (const fixture of Object.values(engine)) {
    for (const variant of Object.values(fixture)) {
      const cell = variant[kind];
      if (!cell) continue;
      total += 1;
      if (cell.eligible) passing += 1;
    }
  }
  if (total === 0) return { eligible: false, passingFraction: 0 };
  return {
    eligible: passing / total >= ELIGIBILITY_THRESHOLD,
    passingFraction: passing / total,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function loadTempResults(): BlockResult[] {
  if (!existsSync(TMP_DIR)) return [];
  const out: BlockResult[] = [];
  for (const f of readdirSync(TMP_DIR)) {
    if (!f.endsWith(".json") || f === FRESH_NAME) continue;
    try {
      const txt = readFileSync(resolve(TMP_DIR, f), "utf8");
      const arr = JSON.parse(txt) as BlockResult[];
      out.push(...arr);
    } catch {
      // ignore malformed/partial temp files
    }
  }
  return out;
}

function loadCommittedFingerprint(): Fingerprint | null {
  if (!existsSync(FINGERPRINT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FINGERPRINT_PATH, "utf8")) as Fingerprint;
  } catch {
    return null;
  }
}

function buildRationale(
  results: readonly BlockResult[],
  enginesPresent: readonly string[],
): string {
  if (results.length === 0) {
    return "Placeholder fingerprint (DOM-only seed). No calibration data recorded yet — the engine measures via domMeasurer; no Pretext fast path is enabled. Re-run npm run calibrate to populate this artifact.";
  }
  const cells = `${results.length} block samples across ${enginesPresent.join("/")} engines`;
  return `Calibration run with tolerance heightDriftPx<=${TOLERANCE_PX} AND breaks exact. Per-(engine,fixture,variant,kind) eligibility recorded; per-cell eligibility may legitimately differ across fonts/spacings (Pitfalls 5: system-ui in sans unsafe on macOS; 6: wordSpacing unmodeled under spacious). A kind is engine-eligible iff >= ${ELIGIBILITY_THRESHOLD * 100}% of its cells pass. Derived from ${cells}.`;
}

function normalizeEngines(byEngine: Record<string, EngineRows>): Record<string, EngineRows> {
  const out: Record<string, EngineRows> = {};
  for (const engine of ["chromium", "firefox", "webkit"]) {
    out[engine] = byEngine[engine] ?? {};
  }
  return out;
}

function main(): void {
  // Never leave a previous run's merge behind as this run's evidence.
  rmSync(FRESH_PATH, { force: true });
  const freshResults = loadTempResults();
  if (freshResults.length === 0) {
    // No fresh calibration data — the harness did not run (or wrote no
    // samples). Do NOT overwrite the committed fingerprint; surface the
    // error so CI catches a misconfigured calibrate step.
    console.error(
      "[calibration] no per-engine results in .calibration-tmp/ — did the harness run?",
    );
    console.error(
      "[calibration] refusing to overwrite calibration/fingerprint.json with empty data",
    );
    console.error("[calibration] D3-10 gate SKIPPED (no fresh data)");
    process.exit(2);
  }
  const freshByEngine = normalizeEngines(aggregate(freshResults));
  const enginesPresent = Object.keys(freshByEngine).filter(
    (e) => Object.keys(freshByEngine[e] ?? {}).length > 0,
  );
  const freshFingerprint: Fingerprint = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    toleranceBound: { heightDriftPx: TOLERANCE_PX, breaksExact: true },
    rationale: buildRationale(freshResults, enginesPresent),
    engines: freshByEngine,
  };

  // Read the committed baseline BEFORE any write, so --write-baseline
  // still diffs against the original.
  const committed = loadCommittedFingerprint();
  const serialized = JSON.stringify(freshFingerprint, null, 2) + "\n";
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(FRESH_PATH, serialized, "utf8");
  const target = WRITE_BASELINE ? FINGERPRINT_PATH : FRESH_PATH;
  if (WRITE_BASELINE) {
    mkdirSync(resolve(FINGERPRINT_PATH, ".."), { recursive: true });
    writeFileSync(FINGERPRINT_PATH, serialized, "utf8");
  }
  console.log(
    `[calibration] wrote ${target} (${freshResults.length} samples, engines: ${enginesPresent.join(", ") || "none"})`,
  );

  // D3-10 regression gate: diff fresh vs committed for previously-eligible
  // (engine, kind) pairs. A committed-eligible kind now ineligible = FAIL.
  if (!committed || !committed.engines) {
    console.log("[calibration] no committed fingerprint to diff against (first run); exit 0");
    process.exit(0);
  }

  // Like-for-like guard: eligibility is aggregated per (engine, kind) over
  // every measured cell, so a run over different fixtures is a different
  // experiment, not a pass or a regression. The harness once shrank to the
  // one starter-library article for months without the gate noticing.
  const coverage: string[] = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const want = Object.keys(committed.engines[engine] ?? {}).sort();
    const got = Object.keys(freshByEngine[engine] ?? {}).sort();
    if (want.join("\n") !== got.join("\n")) {
      coverage.push(`  - ${engine}: baseline [${want.join(", ")}], fresh [${got.join(", ")}]`);
    }
  }
  if (coverage.length > 0) {
    console.error(
      "[calibration] D3-10 COVERAGE MISMATCH — the fresh run measured a different fixture set than the baseline:",
    );
    for (const line of coverage) console.error(line);
    console.error(
      "Restore the harness corpus (CALIBRATION_FIXTURE_IDS), or regenerate the baseline with owner approval (npm run calibrate:rebaseline).",
    );
    process.exit(1);
  }

  const regressions: Array<{ engine: string; kind: string }> = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const committedEngine = committed.engines[engine] ?? {};
    const freshEngine = freshByEngine[engine] ?? {};
    for (const kind of ["paragraph", "heading"] as const) {
      const committedEligible = engineKindEligibility(committedEngine, kind);
      const freshEligible = engineKindEligibility(freshEngine, kind);
      if (committedEligible.eligible && !freshEligible.eligible) {
        regressions.push({ engine, kind });
      }
    }
  }

  if (regressions.length > 0) {
    console.error(
      "[calibration] D3-10 REGRESSION — previously-eligible (engine, kind) pairs now ineligible:",
    );
    for (const r of regressions) {
      console.error(`  - ${r.engine} / ${r.kind}`);
    }
    console.error(
      "If this is intentional (e.g. a font regression), run npm run calibrate:rebaseline, document the rationale in calibration/fingerprint.json and commit the new baseline.",
    );
    // D3-10 — the regression fails the build. process.exit(1) is the CI gate.
    process.exit(1);
  }

  console.log("[calibration] D3-10 gate PASSED — no previously-eligible kind regressed");
  process.exit(0);
}

main();
