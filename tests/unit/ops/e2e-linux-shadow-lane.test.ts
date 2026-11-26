// tests/unit/ops/e2e-linux-shadow-lane.test.ts
// Issue #281 — the e2e-linux-shadow workflow's lane contract, asserted
// against the real workflow text: a DISTINCT, temporary, NON-AUTHORITATIVE
// shadow producer for the PR browser suite inside the Lemcentre browser
// guest. The Mac's e2e-reference stays authoritative; nothing here may
// become a required check, attach to main's SHA, or duplicate the
// e2e-reference check name. Until lemfleet#21 provisions the guest + the
// browser-suite launcher, the lane must stay honestly red (receipt check
// exit 33; launcher-absence exit 34) — never silently green.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "e2e-linux-shadow.yml");
const text = readFileSync(workflowPath, "utf8");
const doc = parseYaml(text);

// The suite runs as Playwright shards (#2 item 4): every shard job keeps
// the single-run lane contract; the e2e-linux-shadow job merges them.
const job = doc.jobs["e2e-linux-shadow-shard"];
const aggregate = doc.jobs["e2e-linux-shadow"];

function stepNames(): string[] {
  return job.steps.map(
    (step: { name?: string; uses?: string }) => step.name ?? step.uses ?? "(unnamed)",
  );
}

describe("e2e-linux-shadow lane contract", () => {
  it("produces a check name distinct from the authoritative e2e-reference", () => {
    expect(doc.name).toBe("e2e-linux-shadow");
    expect(aggregate.name ?? "e2e-linux-shadow").toBe("e2e-linux-shadow");
    expect(String(job.name)).not.toBe("e2e-linux-shadow");
    expect(String(job.name)).not.toBe("e2e-reference");
    expect(doc.name).not.toBe("e2e-reference");
  });

  it("is workflow_dispatch-only today; the pull_request trigger is a documented, commented owner gate", () => {
    // YAML 1.1 parses the bare `on:` key as boolean true; normalize.
    const triggerKeys = Object.keys(doc).filter((key) => key === "on" || key === "true");
    const triggers = triggerKeys.length === 1 ? doc[triggerKeys[0] as "on"] : {};
    expect(Object.keys(triggers ?? {})).toEqual(["workflow_dispatch"]);
    // The activation block must exist as COMMENTS with an unmissable marker.
    expect(text).toMatch(/#\s*pull_request:/);
    expect(text).toMatch(/OWNER[- ]ACTIVATION/i);
    expect(text).toMatch(/shadow-validation/i);
    // And no active pull_request key anywhere in the parsed document.
    expect(JSON.stringify(doc)).not.toMatch(/"pull_request"\s*:/);
  });

  it("never attaches to main: job-level skip guard + lemcentre runner", () => {
    expect(String(job.if).replace(/\s+/g, " ")).toBe("github.ref_name != 'main'");
    expect(job["runs-on"]).toEqual(["self-hosted", "lemcentre"]);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(String(aggregate.if).replace(/\s+/g, " ")).toBe("always() && github.ref_name != 'main'");
    expect(aggregate["runs-on"]).toEqual(["self-hosted", "lemcentre"]);
  });

  it("runs the suite as every shard i/n of one total, one at a time", () => {
    expect(job.strategy?.["fail-fast"]).toBe(false);
    expect(job.strategy?.["max-parallel"]).toBe(1);
    const shards: number[] = job.strategy?.matrix?.shard;
    expect(shards).toEqual(shards.map((_: number, i: number) => i + 1));
    expect(shards.length).toBeGreaterThan(1);
    // the total is the matrix size itself, never a second literal
    const launch = job.steps.find((step: { id?: string }) => step.id === "launch");
    expect(launch.env.SHARD).toBe("${{ matrix.shard }}/${{ strategy.job-total }}");
    // a per-shard concurrency group: one shared group would let a queued
    // shard replace its pending sibling
    expect(String(job.concurrency?.group)).toContain("${{ matrix.shard }}");
  });

  it("merges the shard reports and is green only when every shard is green and they add up", () => {
    expect(aggregate.needs).toBe("e2e-linux-shadow-shard");
    const merge = aggregate.steps.find((step: { id?: string }) => step.id === "merge");
    expect(String(merge.run)).toContain("merge-shard-reports.mjs");
    const upload = aggregate.steps.find(
      (step: { uses?: string; with?: { name?: string } }) =>
        step.uses?.startsWith("actions/upload-artifact") &&
        step.with?.name === "e2e-linux-shadow-report",
    );
    expect(upload?.with?.path).toBe(".guest-reports/e2e-pr.json");
    expect(upload?.with?.["retention-days"]).toBe(7);
    const conclude = aggregate.steps.find((step: { name?: string }) =>
      /conclude/i.test(String(step.name)),
    );
    expect(conclude?.if).toBe("always()");
    expect(conclude?.env?.SHARDS_RESULT).toBe("${{ needs.e2e-linux-shadow-shard.result }}");
    expect(String(conclude?.run)).toMatch(/SHARDS_RESULT" != "success"/);
    expect(String(conclude?.run)).toMatch(/MERGED" != "true"/);
  });

  it("keeps the two prior lanes' trust shape: receipt-vs-pin BEFORE any launcher step", () => {
    const names = stepNames();
    const receiptIdx = names.findIndex((n) => /environment receipt/i.test(String(n)));
    const launcherGateIdx = names.findIndex((n) =>
      /browser-suite launcher.*provisioned|launcher.*34/i.test(String(n)),
    );
    const runIdx = names.findIndex((n) => /inside the confined guest/i.test(String(n)));
    expect(receiptIdx).toBeGreaterThanOrEqual(0);
    expect(launcherGateIdx).toBeGreaterThan(receiptIdx);
    expect(runIdx).toBeGreaterThan(launcherGateIdx);
    const receiptStep = job.steps[receiptIdx];
    expect(String(receiptStep.run)).toContain("verify-environment-receipt.py");
    expect(String(receiptStep.run)).toContain("/usr/local/libexec/factory-ci/lemfleet-rev");
  });

  it("requires the launcher explicitly (exit 34 until lemfleet#21 provisions it)", () => {
    const gate = job.steps.find((step: { run?: string }) =>
      /browser-suite/.test(String(step.run ?? "")),
    );
    expect(gate?.run).toMatch(/\/usr\/local\/libexec\/factory-ci\/browser-suite/);
    expect(gate?.run).toMatch(/exit 34/);
  });

  it("invokes the trusted launcher with the head SHA and the checkout dir", () => {
    const launch = job.steps.find((step: { run?: string }) =>
      /browser-suite "--shard=\$SHARD" "\$HEAD_SHA" "\$GITHUB_WORKSPACE"/.test(
        String(step.run ?? ""),
      ),
    );
    expect(launch).toBeTruthy();
    // The launch step must CAPTURE the exit code (set -uo pipefail, || code=$?)
    // so diagnostics and the summary can be produced on the red path too.
    expect(String(launch?.run)).toMatch(/\|\| code=\$\?/);
    expect(String(launch?.run)).toMatch(/set -uo pipefail/);
  });

  it("verifies the diagnostics bundle with the #279 verifier and uploads with 7-day retention", () => {
    const names = stepNames();
    const verifyIdx = names.findIndex((n) => /[Vv]erify.*diagnostics bundle/i.test(String(n)));
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
    expect(String(job.steps[verifyIdx].run)).toContain("verify-diagnostics-bundle.py");
    const upload = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact"),
    );
    expect(upload?.with?.["retention-days"]).toBe(7);
  });

  it("extracts the suite report from the verified bundle and renders per-engine results into the step summary", () => {
    const names = stepNames();
    const extractIdx = names.findIndex((n) =>
      /[Ee]xport.*suite report|extract.*report/i.test(String(n)),
    );
    expect(extractIdx).toBeGreaterThanOrEqual(0);
    expect(String(job.steps[extractIdx].run)).toContain("extract-bundle-member.py");
    expect(String(job.steps[extractIdx].run)).toContain("reports/e2e-pr.json");
    const summaryIdx = names.findIndex((n) => /per-engine/i.test(String(n)));
    expect(summaryIdx).toBeGreaterThan(extractIdx);
    expect(String(job.steps[summaryIdx].run)).toContain("summarize-e2e.mjs");
    expect(String(job.steps[summaryIdx].run)).toContain("GITHUB_STEP_SUMMARY");
  });

  it("records the candidate SHA and the environment identity in the summary", () => {
    const identityStep = job.steps.find((step: { name?: string }) =>
      /candidate SHA and environment identity/i.test(String(step.name)),
    );
    const run = String(identityStep?.run);
    expect(run).toContain("GITHUB_STEP_SUMMARY");
    expect(run).toContain("browser-guest-env.json");
    expect(run).toContain("lemfleet-rev");
  });

  it("concludes honestly: green only for launcher exit 0; named exit codes for 6 (lease) and others", () => {
    const conclude = job.steps.find((step: { name?: string }) =>
      /conclude/i.test(String(step.name)),
    );
    expect(conclude?.if).toBe("always()");
    const run = String(conclude?.run);
    expect(run).toMatch(/exit 6|LAUNCH_EXIT.*6/);
    expect(run).toMatch(/lease/i);
    expect(run).toMatch(/exit "\$LAUNCH_EXIT"|exit \$\{?LAUNCH_EXIT\}?/);
  });

  it("fails the lane when the per-engine report is missing or unreadable (infrastructure, not optional)", () => {
    // Per-engine results are a ticket requirement (#281): a cap-dropped or
    // absent reports/e2e-pr.json may never conclude green "recorded
    // honestly" — the conclude step must fail with an
    // infrastructure-flavored message.
    const conclude = job.steps.find((step: { name?: string }) =>
      /conclude/i.test(String(step.name)),
    );
    const run = String(conclude?.run);
    expect(run).toMatch(/REPORT_PRESENT|steps\.report\.outputs\.present/);
    expect(run).toMatch(/infrastructure/i);
    const extract = job.steps.find((step: { name?: string }) =>
      /[Ee]xport.*suite report|extract.*report/i.test(String(step.name)),
    );
    expect(String(extract?.run)).not.toMatch(/recorded honestly/);
    const render = job.steps.find((step: { name?: string }) =>
      /per-engine/i.test(String(step.name)),
    );
    expect(String(render?.run)).not.toMatch(/recorded honestly/);
  });

  it("uses the pinned checkout action, at the dispatch SHA", () => {
    const checkout = job.steps.find((step: { uses?: string }) =>
      step.uses?.includes("actions/checkout"),
    );
    expect(checkout?.with?.ref).toBe("${{ github.sha }}");
    expect(checkout?.uses).toMatch(/@[0-9a-f]{40}/);
  });
});
