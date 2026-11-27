// scripts/lib/e2e-passes.mjs — the pure half of scripts/e2e-passes.mjs.
//
// The browser suites (`test:e2e`, `test:e2e:pr`) run in two passes
// (lem-reader #2, attempt 4):
//   1. "parallel" — every test except the @timing ones, at the planned
//      worker count;
//   2. "timing" — only the @timing tests (wall-clock budget checks), one
//      worker, so nothing else shares the CPU while they measure.
// Callers (ci.yml e2e-reference, the lemcentre guest PR and nightly
// harness, the hosted shadow) consume ONE Playwright JSON report per run,
// so the two pass reports are merged into one with the same shape.

/** Tag carried by wall-clock budget checks (see the passes above). */
export const TIMING_TAG = "@timing";

/**
 * Playwright argv for each pass. `args` are the pass-through arguments
 * (--config, reporters, --shard, --project, ...), identical in both passes
 * so a shard selects the same slice of each.
 */
export function passArgv(args, outputDir = "test-results") {
  return {
    parallel: ["test", ...args, `--grep-invert=${TIMING_TAG}`],
    // The pass's own flags come LAST so they win over a caller's (a
    // `--workers=3` pass-through must not reach the timing pass).
    timing: [
      "test",
      ...args,
      `--grep=${TIMING_TAG}`,
      "--workers=1",
      // Playwright empties its output dir at start; a subdirectory keeps the
      // parallel pass's traces and error contexts for the diagnostics bundle.
      `--output=${outputDir}/timing`,
      // A shard (or a --project selection) may hold no @timing test.
      "--pass-with-no-tests",
    ],
  };
}

function* testIdentities(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield `${test.projectName} ${spec.id}`;
  }
  for (const child of suite.suites ?? []) yield* testIdentities(child);
}

/**
 * Merge the two pass reports into one Playwright JSON report. Either may be
 * null (its pass produced no report). Throws when a test appears in both
 * passes, which would mean the tag split leaked.
 */
export function mergePassReports(parallel, timing) {
  const reports = [parallel, timing].filter(Boolean);
  if (reports.length === 0) return null;
  const seen = new Set();
  for (const report of reports) {
    for (const suite of report.suites ?? []) {
      for (const identity of testIdentities(suite)) {
        if (seen.has(identity)) {
          throw new Error(`test ${identity} ran in both the parallel and the timing pass`);
        }
        seen.add(identity);
      }
    }
  }
  const stats = { startTime: null, duration: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  for (const report of reports) {
    const s = report.stats ?? {};
    if (s.startTime && (stats.startTime === null || s.startTime < stats.startTime)) {
      stats.startTime = s.startTime;
    }
    stats.duration += s.duration ?? 0;
    for (const key of ["expected", "skipped", "unexpected", "flaky"]) stats[key] += s[key] ?? 0;
  }
  return {
    ...reports[0],
    config: reports[0].config,
    suites: reports.flatMap((report) => report.suites ?? []),
    errors: reports.flatMap((report) => report.errors ?? []),
    stats,
  };
}
