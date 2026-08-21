#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const fleetOpsRoot = resolve(moduleDir, "..");
const cronRoot = resolve(fleetOpsRoot, "automation/codex-cron");
const logsRoot = resolve(cronRoot, "logs");
const installer = resolve(fleetOpsRoot, "scripts/agent-bin/install-codex-cron");
const notify = resolve(fleetOpsRoot, "scripts/agent-bin/fleet-notify");

function parseTsv(path, kind) {
  const [header, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  const keys = header.split("\t");
  return rows.map((row) => ({ kind, ...Object.fromEntries(keys.map((key, index) => [key, row.split("\t")[index] || ""])) }));
}

function fieldMatches(field, value) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= start && value <= end;
    }
    return Number(part) === value;
  });
}

function nextRun(cron, from = new Date()) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/);
  let candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate = new Date(candidate.getTime() + 60_000);
  const limit = 370 * 24 * 60;
  for (let count = 0; count < limit; count += 1) {
    if (fieldMatches(minute, candidate.getMinutes()) &&
        fieldMatches(hour, candidate.getHours()) &&
        fieldMatches(dayOfMonth, candidate.getDate()) &&
        fieldMatches(month, candidate.getMonth() + 1) &&
        fieldMatches(dayOfWeek, candidate.getDay())) return candidate.toISOString();
    candidate = new Date(candidate.getTime() + 60_000);
  }
  return null;
}

function lastRun(id) {
  if (!existsSync(logsRoot)) return null;
  const matches = readdirSync(logsRoot)
    .filter((name) => name.startsWith(`${id}-`) && name.endsWith(".log"))
    .map((name) => ({ path: resolve(logsRoot, name), name }))
    .sort((left, right) => statSync(right.path).mtimeMs - statSync(left.path).mtimeMs);
  if (!matches.length) return null;
  const latest = matches[0];
  const body = readFileSync(latest.path, "utf8");
  const status = body.match(/^exit_status:\s*(\d+)$/m)?.[1];
  return { at: statSync(latest.path).mtime.toISOString(), exitStatus: status == null ? null : Number(status), log: latest.path };
}

function installedIds() {
  const result = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (result.status !== 0) return new Set();
  const managed = result.stdout.match(/# BEGIN FLEET OPS CODEX CRON([\s\S]*?)# END FLEET OPS CODEX CRON/)?.[1] || "";
  const ids = new Set();
  for (const line of managed.split("\n")) {
    const match = line.match(/run-(?:clean-main-codex|codex|system)-cron\s+([a-z0-9-]+)/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

const jobs = [
  ...parseTsv(resolve(cronRoot, "jobs.tsv"), "codex"),
  ...parseTsv(resolve(cronRoot, "system-jobs.tsv"), "system")
];
const check = spawnSync(installer, ["--check"], { encoding: "utf8" });
const installed = installedIds();
const notification = spawnSync(notify, ["status", "--json"], { encoding: "utf8" });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scheduler: {
    definitionsValid: check.status === 0,
    validationError: check.status === 0 ? null : (check.stderr || check.stdout).trim(),
    installed: installed.size > 0,
    configuredJobs: jobs.filter((job) => job.enabled === "yes").length,
    installedJobs: installed.size
  },
  jobs: jobs.map((job) => ({
    id: job.id,
    name: job.name,
    kind: job.kind,
    enabled: job.enabled === "yes",
    installed: installed.has(job.id),
    schedule: job.cron,
    nextRun: nextRun(job.cron),
    lastRun: lastRun(job.id),
    receiptLocation: job.kind === "codex" ? `${logsRoot}/${job.id}-*.log` : `${logsRoot}/${job.id}-*.log`
  })),
  notifications: notification.status === 0 ? JSON.parse(notification.stdout) : { error: (notification.stderr || notification.stdout).trim() }
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.scheduler.definitionsValid ? 0 : 1;
