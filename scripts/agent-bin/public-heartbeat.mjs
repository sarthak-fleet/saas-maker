#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultOutput = `${process.env.HOME}/Library/Application Support/Fleet Ops/ops-console/runtime.json`;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const fleetOpsRoot = resolve(scriptDir, "../..");
const fleetRoot = resolve(fleetOpsRoot, "../..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : defaultOutput;

if (!outputPath) {
  console.error("usage: public-heartbeat [--output <path>]");
  process.exit(2);
}

function run(command, args = [], timeout = 3000) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout
    }).trim();
  } catch {
    return "";
  }
}

function commandExists(command) {
  return Boolean(run("/bin/zsh", ["-lc", `command -v ${command}`], 1200));
}

function launchdRunning(label) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  return /state = running/.test(run("/bin/launchctl", ["print", `gui/${uid}/${label}`], 1500));
}

function tailscaleRunning() {
  if (!commandExists("tailscale")) return false;
  const socket = `${process.env.HOME}/Library/Application Support/Fleet Ops/mobile-control/tailscale/tailscaled.sock`;
  const status = run("tailscale", ["--socket", socket, "status"], 2500) || run("tailscale", ["status"], 2500);
  return Boolean(status) && !/failed to connect|not running|stopped|logged out/i.test(status);
}

function localHealthy() {
  return run("curl", ["-fsS", "--max-time", "2", "http://127.0.0.1:4329/healthz"], 2500) === "ok";
}

function notificationSummary() {
  const root = `${process.env.HOME}/Library/Application Support/Fleet Ops/notifications`;
  const read = (bucket) => {
    const dir = `${root}/${bucket}`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(`${dir}/${name}`, "utf8"))];
      } catch {
        return [];
      }
    });
  };
  const pending = read("pending");
  return {
    pending: pending.length,
    critical: pending.filter((event) => event.severity === "critical").length,
    blocked: pending.filter((event) => event.state === "blocked").length,
    deadLetter: read("dead").length
  };
}

function domainSummary() {
  const drankPath = resolve(fleetRoot, "drank/data/fleet-dr.json");
  let drank = {};
  try { drank = JSON.parse(readFileSync(drankPath, "utf8")); } catch {}
  const dbPath = `${process.env.HOME}/.psi-swarm/history.db`;
  const raw = existsSync(dbPath)
    ? run("sqlite3", ["-json", dbPath, "SELECT url, started_at, lcp, cls, performance_score FROM runs WHERE error IS NULL AND tag = 'fleet-weekly' ORDER BY started_at DESC LIMIT 200"], 5000)
    : "";
  let runs = [];
  try { runs = JSON.parse(raw || "[]"); } catch {}
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  };
  return Object.entries(drank.domains || {}).map(([domain, entry]) => {
    const rating = (entry.history || []).at(-1);
    const domainRuns = runs.filter((item) => {
      try { return new URL(String(item.url)).hostname.replace(/^www\./, "") === domain; } catch { return false; }
    }).slice(0, 3);
    const rawScore = median(domainRuns.map((item) => Number(item.performance_score)).filter(Number.isFinite));
    return {
      domain,
      domainRating: typeof rating?.dr === "number" ? rating.dr : null,
      domainRatingUpdatedAt: rating?.ts ? new Date(rating.ts).toISOString() : drank.lastUpdated || null,
      performanceScore: rawScore !== null && rawScore <= 1 ? rawScore * 100 : rawScore,
      lcpMs: median(domainRuns.map((item) => Number(item.lcp)).filter(Number.isFinite)),
      cls: median(domainRuns.map((item) => Number(item.cls)).filter(Number.isFinite)),
      psiUpdatedAt: domainRuns[0]?.started_at ? new Date(Number(domainRuns[0].started_at)).toISOString() : null
    };
  }).sort((left, right) => left.domain.localeCompare(right.domain));
}

const services = [
  { id: "console", label: "Fleet dashboard", status: localHealthy() ? "running" : "stopped" },
  { id: "openclaw", label: "OpenClaw", status: launchdRunning("ai.openclaw.gateway") ? "running" : "stopped" },
  { id: "hermes", label: "Hermes", status: launchdRunning("ai.hermes.gateway") ? "running" : "stopped" },
  { id: "tailscale", label: "Private mobile access", status: tailscaleRunning() ? "running" : "needs-setup" }
];

const heartbeat = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cadenceSeconds: 60,
  notifications: notificationSummary(),
  domains: domainSummary(),
  node: {
    id: process.env.FLEET_NODE_ID || "primary-mac",
    label: process.env.FLEET_NODE_LABEL || "Primary Fleet machine",
    role: process.env.FLEET_NODE_ROLE || "Coordinator and limited workload host",
    status: services.slice(0, 3).every((service) => service.status === "running") ? "online" : "degraded",
    publicWorkloads: ["Fleet project information"],
    services
  }
};

mkdirSync(dirname(outputPath), { recursive: true });
const tempPath = `${outputPath}.${process.pid}.tmp`;
writeFileSync(tempPath, `${JSON.stringify(heartbeat, null, 2)}\n`, { mode: 0o644 });
renameSync(tempPath, outputPath);
console.log(heartbeat.generatedAt);
