// tests/unit/ops/merge-shard-reports.test.ts
// lem-reader#2 item 4 — the sharded e2e-linux-shadow lane proves its
// shards add up to one complete PR-suite run before it reports anything.
import { describe, expect, it } from "vitest";
import {
  mergeShardReports,
  ShardMergeError,
} from "../../../ops/lemcentre-runner/merge-shard-reports.mjs";

function shard(current: number, total: number, ids: string[], unexpected = 0) {
  return {
    config: { shard: { current, total }, workers: 3, version: "1.61.1" },
    suites: [
      {
        title: `file-${current}.spec.ts`,
        file: `file-${current}.spec.ts`,
        specs: ids.map((id) => ({
          id,
          title: id,
          tests: ["chromium", "webkit"].map((projectName) => ({ projectName, status: "expected" })),
        })),
        suites: [],
      },
    ],
    errors: [],
    stats: {
      startTime: `2026-11-25T0${current}:00:00.000Z`,
      duration: 1000 * current,
      expected: ids.length * 2 - unexpected,
      skipped: 0,
      unexpected,
      flaky: 0,
    },
  };
}

describe("merge-shard-reports", () => {
  it("merges a complete shard set into one report in shard order", () => {
    const merged = mergeShardReports([
      shard(2, 3, ["b"], 1),
      shard(1, 3, ["a"]),
      shard(3, 3, ["c"]),
    ]);
    expect(merged.config.shard).toBeNull();
    expect(merged.suites.map((s) => s["file"])).toEqual([
      "file-1.spec.ts",
      "file-2.spec.ts",
      "file-3.spec.ts",
    ]);
    expect(merged.stats).toEqual({
      startTime: "2026-11-25T01:00:00.000Z",
      duration: 6000,
      expected: 5,
      skipped: 0,
      unexpected: 1,
      flaky: 0,
    });
    expect(merged.shards.map((s) => s.current)).toEqual([1, 2, 3]);
  });

  it("refuses a missing shard", () => {
    expect(() => mergeShardReports([shard(1, 3, ["a"]), shard(3, 3, ["c"])])).toThrow(
      /shard\(s\) 2\/3 missing/,
    );
  });

  it("refuses a repeated shard", () => {
    expect(() => mergeShardReports([shard(1, 2, ["a"]), shard(1, 2, ["b"])])).toThrow(
      /appears twice/,
    );
  });

  it("refuses shards of different totals", () => {
    expect(() => mergeShardReports([shard(1, 2, ["a"]), shard(2, 3, ["b"])])).toThrow(
      /does not belong to a 2-shard run/,
    );
  });

  it("refuses an unsharded report", () => {
    const whole = { ...shard(1, 1, ["a"]), config: { shard: null } };
    expect(() => mergeShardReports([whole])).toThrow(ShardMergeError);
  });

  it("refuses a test that ran in two shards", () => {
    expect(() => mergeShardReports([shard(1, 2, ["a", "x"]), shard(2, 2, ["x"])])).toThrow(
      /chromium\|x is in two shards/,
    );
  });

  it("refuses an empty set", () => {
    expect(() => mergeShardReports([])).toThrow(/no shard reports/);
  });
});
