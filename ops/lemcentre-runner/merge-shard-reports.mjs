#!/usr/bin/env node
// ops/lemcentre-runner/merge-shard-reports.mjs
//
// Merge the per-shard Playwright JSON reports of one sharded e2e-linux-shadow
// run into the single PR-suite report (reports/e2e-pr.json shape) that
// summarize-e2e.mjs, compare-shadow.mjs and acceptance-collect.mjs already
// read. lem-reader#2 item 4: the whole three-engine PR suite outlives the
// guest harness's per-step limit, so the lane runs it as Playwright shards
// i/n, one guest boot each, and this merge is where the lane proves the
// shards add up to ONE complete run:
//
//   - every report is a shard of the same total n (config.shard);
//   - shards 1..n are each present exactly once, and nothing else is;
//   - no test (project + spec id) appears in two shards.
//
// Any violation is a refusal (exit 1, nothing written): a partial or
// mismatched set must never read as a whole suite.
//
// Usage: node ops/lemcentre-runner/merge-shard-reports.mjs --out <merged.json> <shard.json>...
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export class ShardMergeError extends Error {}

function shardOf(report, label) {
  const shard = report?.config?.shard;
  if (
    !shard ||
    !Number.isInteger(shard.current) ||
    !Number.isInteger(shard.total) ||
    shard.current < 1 ||
    shard.current > shard.total
  ) {
    throw new ShardMergeError(
      `${label}: not a sharded run (config.shard is ${JSON.stringify(shard)})`,
    );
  }
  return shard;
}

function* testIdentities(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield `${test.projectName}|${spec.id}`;
  }
  for (const child of suite.suites ?? []) yield* testIdentities(child);
}

/**
 * Merge the shard reports (any order). `labels` name them in errors.
 * Returns the merged report; throws ShardMergeError on any violation.
 */
export function mergeShardReports(reports, labels = reports.map((_, i) => `report ${i + 1}`)) {
  if (reports.length === 0) throw new ShardMergeError("no shard reports given");
  const shards = reports.map((report, i) => shardOf(report, labels[i]));
  const total = shards[0].total;
  const seen = new Map();
  shards.forEach((shard, i) => {
    if (shard.total !== total) {
      throw new ShardMergeError(
        `${labels[i]}: shard ${shard.current}/${shard.total} does not belong to a ${total}-shard run`,
      );
    }
    if (seen.has(shard.current)) {
      throw new ShardMergeError(
        `shard ${shard.current}/${total} appears twice (${seen.get(shard.current)}, ${labels[i]})`,
      );
    }
    seen.set(shard.current, labels[i]);
  });
  const missing = [];
  for (let current = 1; current <= total; current += 1) {
    if (!seen.has(current)) missing.push(`${current}/${total}`);
  }
  if (missing.length > 0) {
    throw new ShardMergeError(`incomplete run: shard(s) ${missing.join(", ")} missing`);
  }

  const owner = new Map();
  reports.forEach((report, i) => {
    for (const suite of report.suites ?? []) {
      for (const identity of testIdentities(suite)) {
        if (owner.has(identity)) {
          throw new ShardMergeError(
            `test ${identity} is in two shards (${owner.get(identity)}, ${labels[i]})`,
          );
        }
        owner.set(identity, labels[i]);
      }
    }
  });

  const ordered = reports
    .map((report, i) => ({ report, shard: shards[i] }))
    .sort((a, b) => a.shard.current - b.shard.current);
  const stats = { startTime: null, duration: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  for (const { report } of ordered) {
    const s = report.stats ?? {};
    if (s.startTime && (stats.startTime === null || s.startTime < stats.startTime)) {
      stats.startTime = s.startTime;
    }
    // Shards run one after another on the guest: the suite's wall time is
    // their sum (each shard's own wall time stays in `shards` below).
    stats.duration += s.duration ?? 0;
    for (const key of ["expected", "skipped", "unexpected", "flaky"]) stats[key] += s[key] ?? 0;
  }
  return {
    config: { ...ordered[0].report.config, shard: null },
    suites: ordered.flatMap(({ report }) => report.suites ?? []),
    errors: ordered.flatMap(({ report }) => report.errors ?? []),
    stats,
    shards: ordered.map(({ report, shard }) => ({
      current: shard.current,
      total: shard.total,
      stats: report.stats ?? null,
    })),
  };
}

function main(argv) {
  const outIndex = argv.indexOf("--out");
  if (outIndex === -1 || !argv[outIndex + 1]) {
    console.error("usage: merge-shard-reports.mjs --out <merged.json> <shard.json>...");
    return 2;
  }
  const out = argv[outIndex + 1];
  const inputs = argv.filter((_, i) => i !== outIndex && i !== outIndex + 1);
  try {
    const reports = inputs.map((path) => {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw new ShardMergeError(`${path}: unreadable report (${error.message})`);
      }
    });
    const merged = mergeShardReports(reports, inputs);
    writeFileSync(out, JSON.stringify(merged) + "\n");
    console.log(
      `merged ${inputs.length} shard reports: ${merged.stats.expected} expected, ` +
        `${merged.stats.unexpected} unexpected, ${merged.stats.flaky} flaky, ${merged.stats.skipped} skipped`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof ShardMergeError)) throw error;
    console.error(`merge-shard-reports: refused: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
