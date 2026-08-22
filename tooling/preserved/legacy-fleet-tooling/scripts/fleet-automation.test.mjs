#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadAutomationRegistry, validateAutomationRegistry } from "../lib/fleet-automation/registry.mjs";
import { normalizeEvidence, sanitizeEvidence } from "../lib/fleet-automation/evidence.mjs";
import { evaluateAction } from "../lib/fleet-automation/policy.mjs";

const fleetOpsRoot = resolve(import.meta.dirname, "..");
const coverageCli = resolve(fleetOpsRoot, "scripts/fleet-automation-coverage.mjs");
const installer = resolve(fleetOpsRoot, "scripts/agent-bin/install-codex-cron");

test("canonical registry has the current 40/27 attention scope", () => {
  const registry = loadAutomationRegistry();
  const validation = validateAutomationRegistry(registry);
  assert.deepEqual(validation.errors, []);
  assert.equal(registry.entries.length, 40);
  assert.equal(registry.entries.filter((entry) => ["my-work", "toolbox", "foundry"].includes(entry.attention)).length, 27);
});

test("registry validation rejects duplicate identities and domain ownership", () => {
  const registry = structuredClone(loadAutomationRegistry());
  registry.entries[1].id = registry.entries[0].id;
  registry.entries[1].surfaces = [...registry.entries[0].surfaces];
  const validation = validateAutomationRegistry(registry);
  assert.ok(validation.errors.some((error) => error.includes("duplicate identity")));
  assert.ok(validation.errors.some((error) => error.includes("conflicting surface ownership")));
});

test("evidence sanitizer removes credential-shaped and private content", () => {
  const sanitized = sanitizeEvidence({
    authorization: "Bearer abc.def.secret",
    providerError: "api_key=super-secret-value",
    emailBody: "private message",
    nested: { prompt: "unpublished prompt", summary: "safe" }
  });
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.emailBody, "[REDACTED]");
  assert.equal(sanitized.nested.prompt, "[REDACTED]");
  assert.match(sanitized.providerError, /\[REDACTED\]/);
  assert.equal(sanitized.nested.summary, "safe");
});

test("normalization rejects unknown evidence states", () => {
  assert.throws(() => normalizeEvidence({
    projectId: "codevetter",
    contract: "build",
    source: "fixture",
    observedAt: "2026-07-19T00:00:00Z",
    status: "green-ish",
    summary: "invalid"
  }), /unknown status/);
});

test("action policy allows safe refreshes and blocks consequential actions", () => {
  const registry = loadAutomationRegistry();
  const codevetter = registry.entries.find((entry) => entry.id === "codevetter");
  const ignored = registry.entries.find((entry) => entry.id === "saas-ideas");
  assert.equal(evaluateAction({ entry: codevetter, action: "refresh-snapshot" }).authorized, true);
  assert.equal(evaluateAction({ entry: codevetter, action: "deploy" }).authorized, false);
  assert.equal(evaluateAction({ entry: codevetter, action: "deploy", approved: true, approvalReference: "user:explicit" }).authorized, true);
  assert.equal(evaluateAction({ entry: ignored, action: "read-evidence" }).authorized, false);
});

test("coverage JSON and Markdown totals match with complete fixture evidence", () => {
  const scratch = mkdtempSync(resolve(tmpdir(), "fleet-automation-"));
  try {
    const evidenceDir = resolve(scratch, "evidence");
    const stateDir = resolve(scratch, "state");
    const outDir = resolve(scratch, "reports");
    const registry = loadAutomationRegistry();
    const evidence = registry.entries
      .filter((entry) => ["my-work", "toolbox", "foundry"].includes(entry.attention))
      .flatMap((entry) => entry.contracts.map((contract) => ({
        projectId: entry.id,
        contract,
        source: "fixture",
        observedAt: "2026-07-19T12:00:00.000Z",
        status: "pass",
        summary: `${entry.id} ${contract} verified`
      })));
    writeFileSync(resolve(scratch, "evidence.json"), `${JSON.stringify(evidence)}\n`);
    const makeDir = spawnSync("mkdir", ["-p", evidenceDir]);
    assert.equal(makeDir.status, 0);
    const move = spawnSync("mv", [resolve(scratch, "evidence.json"), resolve(evidenceDir, "fixture.json")]);
    assert.equal(move.status, 0);
    const result = spawnSync(process.execPath, [coverageCli, "--evidence-dir", evidenceDir, "--state-dir", stateDir, "--out", outDir, "--now", "2026-07-19T13:00:00.000Z"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(resolve(outDir, "latest.json"), "utf8"));
    const markdown = readFileSync(resolve(outDir, "latest.md"), "utf8");
    assert.equal(report.summary.actionable, 0);
    assert.equal(report.summary.pass, report.summary.contracts);
    assert.match(markdown, new RegExp(`Contracts: ${report.summary.contracts}`));
    assert.equal((markdown.match(/\| pass \|/g) || []).length, report.summary.pass);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("portable cron installer contains no checked-in user path", () => {
  const jobs = readFileSync(resolve(fleetOpsRoot, "automation/codex-cron/jobs.tsv"), "utf8");
  const systemJobs = readFileSync(resolve(fleetOpsRoot, "automation/codex-cron/system-jobs.tsv"), "utf8");
  assert.doesNotMatch(`${jobs}\n${systemJobs}`, /\/Users\//);
  assert.match(jobs, /\t@fleet\t/);
  assert.match(systemJobs, /\t@fleet\//);
  const check = spawnSync(installer, ["--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const printed = spawnSync(installer, ["--print"], { encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /FLEET_CRON_WORKSPACE_ROOT=/);
  const workspaceRunner = resolve(fleetOpsRoot, "scripts/agent-bin/run-codex-cron").replaceAll("/", "\\/");
  const cleanMainRunner = resolve(fleetOpsRoot, "scripts/agent-bin/run-clean-main-codex-cron").replaceAll("/", "\\/");
  assert.match(printed.stdout, new RegExp(`${workspaceRunner} daily-fleet-health-sentinel`));
  assert.match(printed.stdout, new RegExp(`${cleanMainRunner} weekly-geo-observatory`));
  assert.doesNotMatch(printed.stdout, new RegExp(`${cleanMainRunner} daily-fleet-health-sentinel`));
  const implicitInstall = spawnSync(installer, [], { encoding: "utf8" });
  assert.equal(implicitInstall.status, 2);
  assert.match(implicitInstall.stderr, /requires --workspace-root/);
});

test("weekly GEO cron is pinned to the atomic ten-root search contract", () => {
  const jobs = readFileSync(resolve(fleetOpsRoot, "automation/codex-cron/jobs.tsv"), "utf8");
  const weeklyJob = jobs.split("\n").find((line) => line.startsWith("weekly-geo-observatory\t"));
  const prompt = readFileSync(
    resolve(fleetOpsRoot, "automation/codex-cron/prompts/weekly-geo-observatory.md"),
    "utf8",
  );
  const policies = JSON.parse(readFileSync(resolve(fleetOpsRoot, "automation/job-policies.json"), "utf8"));
  const policy = policies.jobs.find((entry) => entry.id === "weekly-geo-observatory");

  assert.match(weeklyJob, /\tyes\t30 8 \* \* 1\t/);
  assert.match(weeklyJob, /\tprompts\/weekly-geo-observatory\.md\t/);
  assert.match(weeklyJob, /\tclean-main$/);
  assert.match(prompt, /root-search-queries\.json/);
  assert.match(prompt, /exactly 40\s+observations/);
  assert.match(prompt, /geo-observatory-record\.mjs --root-search/);
  assert.match(policy.bounds, /exactly 10 roots x 4 intents/);
  assert.match(policy.idempotency, /all 40 active contracted queries/);
});
