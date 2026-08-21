#!/usr/bin/env node

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadAutomationRegistry, validateAutomationRegistry } from "../lib/fleet-automation/registry.mjs";
import { freshestEvidence, loadEvidenceDirectory, loadLastKnownGood, saveLastKnownGood } from "../lib/fleet-automation/evidence.mjs";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const registryPath = option("--registry", undefined);
const evidenceDir = resolve(option("--evidence-dir", process.env.FLEET_AUTOMATION_EVIDENCE_DIR || resolve(homedir(), "Library/Application Support/Fleet Ops/automation-evidence/inbox")));
const stateDir = resolve(option("--state-dir", process.env.FLEET_AUTOMATION_STATE_DIR || resolve(homedir(), "Library/Application Support/Fleet Ops/automation-evidence")));
const outDir = resolve(option("--out", resolve(stateDir, "reports")));
const noState = args.includes("--no-state");
const jsonOnly = args.includes("--json");
const now = new Date(option("--now", new Date().toISOString()));

function atomicWrite(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
}

function exceptionFor(entry, contract) {
  return entry.exceptions.find((exception) => exception.contract === contract || exception.contract === "all") || null;
}

function evaluateContract(registry, entry, contract, records) {
  const direct = freshestEvidence(records, entry.id, contract);
  const exception = exceptionFor(entry, contract);
  if (!direct) {
    if (exception) return { contract, status: "accepted-exception", observedAt: registry.updatedAt, summary: exception.reason, source: "registry", reference: null };
    return { contract, status: "blocked", observedAt: null, summary: "No normalized evidence is available", source: null, reference: null };
  }
  const freshnessHours = registry.defaults.freshnessHours[contract];
  const ageHours = (now.getTime() - Date.parse(direct.observedAt)) / 3_600_000;
  if (direct.status === "pass" && Number.isFinite(freshnessHours) && ageHours > freshnessHours) {
    return { ...direct, status: "stale", summary: `${direct.summary} (evidence is ${Math.floor(ageHours)}h old; limit ${freshnessHours}h)` };
  }
  return direct;
}

function markdown(report) {
  const lines = [
    "# Fleet automation coverage",
    "",
    `Generated: ${report.generatedAt}`,
    `Registry: ${report.registry}`,
    "",
    "## Summary",
    "",
    `- In-scope entries: ${report.summary.inScope}`,
    `- Excluded entries: ${report.summary.excluded}`,
    `- Contracts: ${report.summary.contracts}`,
    `- Passing: ${report.summary.pass}`,
    `- Actionable: ${report.summary.actionable}`,
    `- Accepted exceptions: ${report.summary["accepted-exception"]}`,
    `- Not applicable: ${report.summary["not-applicable"]}`,
    "",
    "## Coverage",
    "",
    "| Attention | Project | Contract | Status | Observed | Evidence |",
    "|---|---|---|---|---|---|"
  ];
  for (const entry of report.entries) {
    for (const contract of entry.contracts) {
      lines.push(`| ${entry.attention} | ${entry.name} | ${contract.contract} | ${contract.status} | ${contract.observedAt || "-"} | ${(contract.summary || "-").replaceAll("|", "\\|")} |`);
    }
  }
  lines.push("", "## Excluded", "");
  for (const entry of report.excluded) lines.push(`- **${entry.name}** (${entry.attention}): ${entry.reason}`);
  lines.push("");
  return lines.join("\n");
}

try {
  const registry = loadAutomationRegistry(registryPath);
  const validation = validateAutomationRegistry(registry);
  if (validation.errors.length) throw new Error(`Registry validation failed:\n${validation.errors.join("\n")}`);
  const direct = loadEvidenceDirectory(evidenceDir);
  const lkgPath = resolve(stateDir, "last-known-good.json");
  const lastKnownGood = loadLastKnownGood(lkgPath);
  const evidence = [...lastKnownGood, ...direct];
  const inScope = registry.entries.filter((entry) => ["my-work", "toolbox", "foundry"].includes(entry.attention));
  const entries = inScope.map((entry) => ({
    id: entry.id,
    name: entry.name,
    attention: entry.attention,
    contracts: entry.contracts.map((contract) => evaluateContract(registry, entry, contract, evidence))
  }));
  const contracts = entries.flatMap((entry) => entry.contracts);
  const statuses = Object.fromEntries(["pass", "fail", "stale", "blocked", "accepted-exception", "not-applicable"].map((status) => [status, contracts.filter((contract) => contract.status === status).length]));
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    registry: registryPath || "foundry/ops/config/automation-registry.json",
    evidenceDirectory: evidenceDir,
    summary: {
      inScope: inScope.length,
      excluded: registry.entries.length - inScope.length,
      contracts: contracts.length,
      ...statuses,
      actionable: statuses.fail + statuses.stale + statuses.blocked
    },
    entries,
    excluded: registry.entries.filter((entry) => entry.attention === "ignored").map((entry) => ({ id: entry.id, name: entry.name, attention: entry.attention, reason: entry.exceptions[0]?.reason || "excluded" }))
  };
  if (!noState) saveLastKnownGood(lkgPath, direct);
  if (!jsonOnly) {
    atomicWrite(resolve(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    atomicWrite(resolve(outDir, "latest.md"), markdown(report));
    console.log(`Coverage report: ${resolve(outDir, "latest.md")}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  process.exitCode = report.summary.actionable > 0 ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
