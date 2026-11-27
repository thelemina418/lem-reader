// tests/unit/e2e-passes.test.ts — the two-pass browser suite split and the
// report merge behind scripts/e2e-passes.mjs (lem-reader #2, attempt 4).
import { describe, expect, it } from "vitest";
import { mergePassReports, passArgv, TIMING_TAG } from "../../scripts/lib/e2e-passes.mjs";

const report = (
  file: string,
  tests: Array<[project: string, id: string]>,
  stats: Record<string, unknown>,
) => ({
  config: { shard: { current: 1, total: 3 } },
  suites: [
    {
      title: file,
      file,
      specs: tests.map(([projectName, id]) => ({ id, title: id, tests: [{ projectName }] })),
    },
  ],
  errors: [],
  stats,
});

describe("passArgv", () => {
  it("splits on the @timing tag and gives the timing pass one worker", () => {
    const { parallel, timing } = passArgv([
      "--config=playwright.pr.config.ts",
      "--shard=2/3",
      "--reporter=line,json",
    ]);
    expect(parallel).toContain(`--grep-invert=${TIMING_TAG}`);
    expect(parallel).not.toContain("--workers=1");
    expect(timing).toContain(`--grep=${TIMING_TAG}`);
    expect(timing).toContain("--workers=1");
    expect(timing).toContain("--pass-with-no-tests");
    // The caller's arguments reach both passes, so a shard slices both.
    for (const argv of [parallel, timing]) {
      expect(argv.slice(1, 4)).toEqual([
        "--config=playwright.pr.config.ts",
        "--shard=2/3",
        "--reporter=line,json",
      ]);
    }
  });

  it("puts the timing pass's flags after the caller's, so --workers=1 wins", () => {
    const { timing } = passArgv(["--workers=3"]);
    expect(timing.lastIndexOf("--workers=1")).toBeGreaterThan(timing.indexOf("--workers=3"));
  });

  it("keeps the parallel pass's test-results out of the timing pass's output dir", () => {
    expect(passArgv([]).timing).toContain("--output=test-results/timing");
    expect(passArgv([]).parallel.some((a) => a.startsWith("--output"))).toBe(false);
  });
});

describe("mergePassReports", () => {
  const parallel = report(
    "a.spec.ts",
    [
      ["chromium", "a1"],
      ["webkit", "a1"],
    ],
    {
      startTime: "2026-11-27T10:00:00.000Z",
      duration: 1000,
      expected: 1,
      skipped: 0,
      unexpected: 1,
      flaky: 0,
    },
  );
  const timing = report("measurement/longtask-smoke.spec.ts", [["chromium", "t1"]], {
    startTime: "2026-11-27T10:20:00.000Z",
    duration: 200,
    expected: 0,
    skipped: 2,
    unexpected: 0,
    flaky: 1,
  });

  it("concatenates suites, sums stats and keeps the parallel pass's config", () => {
    const merged = mergePassReports(parallel, timing)!;
    expect(merged.suites.map((s) => s.file)).toEqual([
      "a.spec.ts",
      "measurement/longtask-smoke.spec.ts",
    ]);
    expect(merged.stats).toEqual({
      startTime: "2026-11-27T10:00:00.000Z",
      duration: 1200,
      expected: 1,
      skipped: 2,
      unexpected: 1,
      flaky: 1,
    });
    // The shard identity survives, so merge-shard-reports.mjs still accepts it.
    expect(merged.config?.shard).toEqual({ current: 1, total: 3 });
  });

  it("returns the one report when the other pass wrote none", () => {
    expect(mergePassReports(parallel, null)!.suites).toHaveLength(1);
    expect(mergePassReports(null, timing)!.stats.flaky).toBe(1);
    expect(mergePassReports(null, null)).toBeNull();
  });

  it("refuses a test that ran in both passes", () => {
    const leaked = report("a.spec.ts", [["chromium", "a1"]], {});
    expect(() => mergePassReports(parallel, leaked)).toThrow(/chromium a1 ran in both/);
  });
});
