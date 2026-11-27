#!/usr/bin/env node
// scripts/e2e-passes.mjs — `npm run test:e2e` and `test:e2e:pr`: a browser
// suite in two passes, merged into one JSON report (see
// scripts/lib/e2e-passes.mjs). The package script names the --config.
//
// Why: the giant-article longtask check (250ms budget) passed alone at
// 180-215ms and failed at 261-484ms when heavy specs ran beside it in other
// workers (lem-reader #2, attempt 4). Wall-clock budget checks carry the
// @timing tag and run after the parallel pass, one at a time.
//
// Arguments pass through to both passes. PLAYWRIGHT_JSON_OUTPUT_FILE, when
// set, receives the merged report; each pass writes its own to a temporary
// directory, so a collected report directory holds only the merged one. The
// exit code is non-zero when either pass failed. The timing pass runs even
// after a failed parallel pass, so a red run still carries its evidence.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mergePassReports, passArgv } from "./lib/e2e-passes.mjs";

const args = process.argv.slice(2);
const out = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
const passes = passArgv(args);
const passDir = out ? mkdtempSync(join(tmpdir(), "e2e-passes-")) : null;
const status = {};
const reportOf = {};

for (const name of ["parallel", "timing"]) {
  const env = { ...process.env };
  if (out) {
    reportOf[name] = join(passDir, `${name}.json`);
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = reportOf[name];
  }
  console.log(`[e2e-passes] ${name} pass: playwright ${passes[name].join(" ")}`);
  const result = spawnSync("npx", ["playwright", ...passes[name]], { stdio: "inherit", env });
  status[name] = result.status ?? 1;
}

if (out) {
  const read = (path) => (path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  try {
    const merged = mergePassReports(read(reportOf.parallel), read(reportOf.timing));
    if (merged) {
      // Playwright's JSON reporter creates the report's directory itself;
      // the merged report must too (the hosted shadow's .test-reports/).
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(merged, null, 2));
    } else console.error("[e2e-passes] neither pass wrote a JSON report");
  } catch (error) {
    console.error(`[e2e-passes] report merge failed: ${error.message}`);
    status.merge = 1;
  } finally {
    rmSync(passDir, { recursive: true, force: true });
  }
}

console.log(
  `[e2e-passes] parallel pass exit ${status.parallel}, timing pass exit ${status.timing}`,
);
process.exit(status.parallel || status.timing || status.merge || 0);
