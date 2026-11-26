// Type declarations for ops/lemcentre-runner/merge-shard-reports.mjs
// (consumed by tests/unit/ops/merge-shard-reports.test.ts; the .mjs
// implementation is the single truth).

export class ShardMergeError extends Error {}

export interface ShardStats {
  startTime?: string | null;
  duration?: number;
  expected?: number;
  skipped?: number;
  unexpected?: number;
  flaky?: number;
}

export interface MergedReport {
  config: Record<string, unknown> & { shard: null };
  suites: Array<Record<string, unknown>>;
  errors: unknown[];
  stats: Required<ShardStats>;
  shards: Array<{ current: number; total: number; stats: ShardStats | null }>;
}

export function mergeShardReports(reports: unknown[], labels?: string[]): MergedReport;
