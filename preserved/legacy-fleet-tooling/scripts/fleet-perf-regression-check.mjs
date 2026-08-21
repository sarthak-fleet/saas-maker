#!/usr/bin/env node
/**
 * Compare the latest perf scoreboard against the previous one.
 * Flags projects where LCP p90 regressed by more than a threshold.
 *
 * Usage:
 *   node scripts/fleet-perf-regression-check.mjs [baseline.json] [latest.json] [--threshold 15]
 *
 * Defaults:
 *   baseline = second-newest fleet-perf-scoreboard-*.json in docs/
 *   latest   = newest fleet-perf-scoreboard-*.json in docs/
 *   threshold = 15 (% regression to flag)
 *
 * Exit code 0 = no regressions, 1 = regressions found.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'docs');

const arg = (flag) => process.argv.find((a, i) => process.argv[i - 1] === flag);
const thresholdPct = Number(arg('--threshold') ?? 15);

function findScoreboards() {
  return readdirSync(docsDir)
    .filter((f) => f.startsWith('fleet-perf-scoreboard-') && f.endsWith('.json'))
    .sort();
}

const files = findScoreboards();
if (files.length < 2) {
  console.error('Need at least 2 scoreboard files to compare. Found:', files.length);
  process.exit(0);
}

const baselinePath = arg('baseline') ?? join(docsDir, files[files.length - 2]);
const latestPath = arg('latest') ?? join(docsDir, files[files.length - 1]);

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const latest = JSON.parse(readFileSync(latestPath, 'utf8'));

const baselineBySlug = new Map((baseline.results ?? []).map((r) => [r.slug, r]));
const latestBySlug = new Map((latest.results ?? []).map((r) => [r.slug, r]));

const regressions = [];
const improvements = [];
const newSites = [];
const dropped = [];

for (const [slug, latestRow] of latestBySlug) {
  const baseRow = baselineBySlug.get(slug);
  if (!baseRow) {
    newSites.push(slug);
    continue;
  }
  if (!latestRow.ok || !baseRow.ok) continue;
  const baseMs = baseRow.p90ms;
  const latestMs = latestRow.p90ms;
  if (baseMs == null || latestMs == null) continue;

  const delta = latestMs - baseMs;
  const pct = (delta / baseMs) * 100;

  if (pct > thresholdPct) {
    regressions.push({ slug, name: latestRow.name, baseMs, latestMs, delta, pct });
  } else if (pct < -thresholdPct) {
    improvements.push({ slug, name: latestRow.name, baseMs, latestMs, delta, pct });
  }
}

for (const [slug] of baselineBySlug) {
  if (!latestBySlug.has(slug)) dropped.push(slug);
}

console.log(`Perf regression check: ${baselinePath} → ${latestPath}`);
console.log(`Threshold: ${thresholdPct}%\n`);

if (regressions.length === 0) {
  console.log('No regressions detected.');
} else {
  console.log(`REGRESSIONS (${regressions.length}):`);
  for (const r of regressions) {
    console.log(`  ${r.slug.padEnd(22)} ${Math.round(r.baseMs)}ms → ${Math.round(r.latestMs)}ms  (+${Math.round(r.pct)}%)  ${r.name}`);
  }
}

if (improvements.length > 0) {
  console.log(`\nIMPROVEMENTS (${improvements.length}):`);
  for (const r of improvements) {
    console.log(`  ${r.slug.padEnd(22)} ${Math.round(r.baseMs)}ms → ${Math.round(r.latestMs)}ms  (${Math.round(r.pct)}%)  ${r.name}`);
  }
}

if (newSites.length > 0) console.log(`\nNew sites: ${newSites.join(', ')}`);
if (dropped.length > 0) console.log(`\nDropped: ${dropped.join(', ')}`);

process.exit(regressions.length > 0 ? 1 : 0);
