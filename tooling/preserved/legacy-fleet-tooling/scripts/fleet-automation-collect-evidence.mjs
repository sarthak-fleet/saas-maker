#!/usr/bin/env node

/**
 * Collect evidence from existing Fleet artifacts into the normalized evidence
 * inbox consumed by `fleet-automation-coverage.mjs`.
 *
 * Reads already-generated artifacts (resilience audit JSON, site-health
 * scorecard, cron health, marketing program) and writes per-source evidence
 * JSON files to the evidence inbox directory. Does NOT re-run expensive
 * operations or require credentials.
 *
 * Usage:
 *   node foundry/ops/scripts/fleet-automation-collect-evidence.mjs
 *   node foundry/ops/scripts/fleet-automation-collect-evidence.mjs --evidence-dir <path>
 *   node foundry/ops/scripts/fleet-automation-collect-evidence.mjs --dry-run
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { loadAutomationRegistry } from '../lib/fleet-automation/registry.mjs';
import { loadMarketingProgram } from '../lib/marketing-program.mjs';
import {
  cloudflareDeployAdapter,
  cronJobAdapter,
  marketingReceiptAdapter,
  performanceAdapter,
  siteHealthAdapter,
} from '../lib/fleet-automation/adapters.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fleetRoot = resolve(scriptDir, '../../..');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
const evidenceDir = resolve(option('--evidence-dir',
  process.env.FLEET_AUTOMATION_EVIDENCE_DIR ||
  resolve(homedir(), 'Library/Application Support/Fleet Ops/automation-evidence/inbox')));
const dryRun = args.includes('--dry-run');

const resilienceArtifact = resolve(fleetRoot, '.symphony/cloudflare-resilience/latest.json');
const siteHealthArtifact = resolve(fleetRoot, 'foundry/ops/data/site-health/latest.json');
const marketingProgramPath = resolve(fleetRoot, 'foundry/ops/config/marketing-program.json');
const healthScript = resolve(scriptDir, 'fleet-automation-health.mjs');
const psiSwarmArtifact = resolve(fleetRoot, 'foundry/ops/data/psi-swarm/latest.json');

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function atomicWrite(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
}

try {
  const registry = loadAutomationRegistry();
  const inScope = registry.entries.filter((e) =>
    ['my-work', 'toolbox', 'foundry'].includes(e.attention));

  const resilience = readJsonIfExists(resilienceArtifact);
  const siteHealth = readJsonIfExists(siteHealthArtifact);
  const marketingProgram = existsSync(marketingProgramPath)
    ? loadMarketingProgram(marketingProgramPath) : null;
  const psiSwarm = readJsonIfExists(psiSwarmArtifact);

  let cronHealth = null;
  if (existsSync(healthScript)) {
    const result = spawnSync(process.execPath, [healthScript], { encoding: 'utf8' });
    if (result.status === 0 || result.stdout) {
      try { cronHealth = JSON.parse(result.stdout); } catch { /* empty */ }
    }
  }

  const bySource = {};
  for (const entry of inScope) {
    if (resilience) {
      const records = cloudflareDeployAdapter(resilience, entry);
      if (records.length) { (bySource.cloudflareResilience ??= []).push(...records); }
    }
    if (siteHealth && siteHealth[entry.id]) {
      const records = siteHealthAdapter(siteHealth[entry.id], entry);
      if (records.length) { (bySource.siteHealth ??= []).push(...records); }
    }
    if (cronHealth) {
      const records = cronJobAdapter(cronHealth, entry);
      if (records.length) { (bySource.cronReceipts ??= []).push(...records); }
    }
    if (marketingProgram) {
      const records = marketingReceiptAdapter(marketingProgram, entry);
      if (records.length) { (bySource.marketingReceipts ??= []).push(...records); }
    }
    if (psiSwarm) {
      const results = Array.isArray(psiSwarm.results) ? psiSwarm.results : [];
      for (const result of results) {
        const matches = (entry.surfaces || []).some((s) => {
          try { return new URL(s).hostname === new URL(result.url).hostname; }
          catch { return false; }
        });
        if (!matches) continue;
        const records = performanceAdapter(result, entry);
        if (records.length) { (bySource.performance ??= []).push(...records); }
      }
    }
  }

  const summary = { sources: [], totalRecords: 0 };
  for (const [source, records] of Object.entries(bySource)) {
    summary.totalRecords += records.length;
    summary.sources.push({ source, count: records.length });
    if (!dryRun) {
      atomicWrite(
        resolve(evidenceDir, `${source}.json`),
        `${JSON.stringify(records, null, 2)}\n`
      );
    }
  }

  console.log(JSON.stringify({
    collectedAt: new Date().toISOString(),
    dryRun,
    evidenceDir: dryRun ? null : evidenceDir,
    ...summary
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
