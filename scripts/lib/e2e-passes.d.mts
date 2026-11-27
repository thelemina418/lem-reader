// Types for scripts/lib/e2e-passes.mjs.

/** A Playwright JSON report, as far as the pass merge reads it. */
export interface PassReport {
  config?: Record<string, unknown> & { shard?: { current: number; total: number } | null };
  suites?: unknown[];
  errors?: unknown[];
  stats?: {
    startTime?: string | null;
    duration?: number;
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  };
  [key: string]: unknown;
}

export const TIMING_TAG: "@timing";

export function passArgv(
  args: string[],
  outputDir?: string,
): { parallel: string[]; timing: string[] };

/** The merged report: the parallel pass's config, both passes' suites and summed stats. */
export interface MergedReport extends PassReport {
  config: PassReport["config"];
  suites: Array<{ file?: string }>;
  errors: unknown[];
  stats: Required<NonNullable<PassReport["stats"]>>;
}

export function mergePassReports(
  parallel: PassReport | null,
  timing: PassReport | null,
): MergedReport | null;
