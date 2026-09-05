#!/usr/bin/env node
// Rank a PSI Swarm portfolio distribution against Core Web Vitals thresholds.
//
// Reads a psi-swarm history database and a caller-supplied target list, then
// reports which surfaces miss the thresholds, ranked by impact against effort.
//
// This repository is public. The target list is an input, never a constant:
// private catalogs stay with Site Health and are passed in per run.
//
//   node psi-portfolio-delta.mjs \
//     --history ~/.psi-swarm/history.db \
//     --targets targets.json \
//     --tag console-portfolio --since 2026-09-05T00:00:00Z
//
// targets.json is `fleet.psi-portfolio-targets.v1`:
//   [{ "projectId": "codevetter", "domain": "codevetter.com",
//      "name": "CodeVetter", "priority": "P1" }]
// Only projectId and domain are required.

import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Core Web Vitals bands. TBT is the lab stand-in for INP, which needs real
// user input and is not measured in navigation mode.
const THRESHOLDS = Object.freeze({
  score: { good: 90, poor: 50, unit: '', higherIsBetter: true, label: 'Perf score' },
  lcp: { good: 2500, poor: 4000, unit: 'ms', higherIsBetter: false, label: 'LCP' },
  cls: { good: 0.1, poor: 0.25, unit: '', higherIsBetter: false, label: 'CLS' },
  tbt: { good: 200, poor: 600, unit: 'ms', higherIsBetter: false, label: 'TBT' },
});

const PRIORITY_WEIGHT = Object.freeze({ P0: 4, P1: 3, P2: 2, P3: 1, P4: 0.5 });
const DEFAULT_PRIORITY_WEIGHT = 2;

// Which failing metric dominates tells you what the fix costs. Effort is the
// shape of the work, not an estimate of hours.
const EFFORT_BY_CAUSE = Object.freeze({
  ttfb: { effort: 3, label: 'origin/edge', fix: 'Slow server response — caching, edge placement, or origin work.' },
  tbt: { effort: 2, label: 'javascript', fix: 'Main-thread blocking — defer, split, or drop client JavaScript.' },
  render: { effort: 2, label: 'render path', fix: 'Late largest paint — preload the hero asset, inline critical CSS, cut render-blocking requests.' },
  cls: { effort: 1, label: 'layout', fix: 'Layout shift — reserve dimensions for images, embeds, and late-injected UI.' },
  paint: { effort: 1, label: 'paint timing', fix: 'Core Web Vitals all pass; the composite score is held down by FCP/Speed Index.' },
});

// Core Web Vitals proper. The Lighthouse composite score is reported alongside
// them but is not a vital — a surface can miss 90 with every vital passing.
const VITALS = Object.freeze(['lcp', 'cls', 'tbt']);

function parseArguments(argv) {
  const options = { tag: null, since: null, json: false, history: null, targets: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') options.json = true;
    else if (flag === '--history') options.history = argv[index += 1];
    else if (flag === '--targets') options.targets = argv[index += 1];
    else if (flag === '--tag') options.tag = argv[index += 1];
    else if (flag === '--since') options.since = argv[index += 1];
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.history) throw new Error('--history <psi-swarm history.db> is required');
  if (!options.targets) throw new Error('--targets <targets.json> is required');
  if (!existsSync(options.history)) throw new Error(`history database not found: ${options.history}`);
  return options;
}

export function readTargets(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const targets = Array.isArray(parsed) ? parsed : parsed.targets;
  if (!Array.isArray(targets)) throw new Error('targets file must be an array or { targets: [] }');
  return targets.map((target) => {
    if (!target.projectId || !target.domain) {
      throw new Error('each target needs projectId and domain');
    }
    return {
      projectId: target.projectId,
      domain: String(target.domain).replace(/^www\./, ''),
      name: target.name ?? target.projectId,
      priority: target.priority ?? null,
    };
  });
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function readDistribution(historyPath, { tag = null, since = null } = {}) {
  const database = new DatabaseSync(historyPath, { readOnly: true });
  try {
    const filters = ['error IS NULL'];
    const parameters = [];
    if (tag) {
      filters.push('tag = ?');
      parameters.push(tag);
    }
    if (since) {
      filters.push('started_at >= ?');
      parameters.push(Date.parse(since));
    }
    const rows = database
      .prepare(`SELECT url, preset, started_at, performance_score, lcp, cls, tbt, ttfb, fcp, si
                FROM runs WHERE ${filters.join(' AND ')} ORDER BY started_at`)
      .all(...parameters);
    const byDomain = new Map();
    for (const row of rows) {
      const domain = hostOf(row.url);
      if (!domain) continue;
      const bucket = byDomain.get(domain) ?? { runs: [], observedAt: null };
      bucket.runs.push(row);
      bucket.observedAt = new Date(Number(row.started_at)).toISOString();
      byDomain.set(domain, bucket);
    }
    return byDomain;
  } finally {
    database.close();
  }
}

function verdict(metric, value) {
  const band = THRESHOLDS[metric];
  if (value === null || !Number.isFinite(value)) return 'not-measured';
  if (band.higherIsBetter) {
    if (value >= band.good) return 'good';
    return value >= band.poor ? 'needs-improvement' : 'poor';
  }
  if (value <= band.good) return 'good';
  return value <= band.poor ? 'needs-improvement' : 'poor';
}

// How far past the threshold, normalised so metrics on different scales compare.
function overshoot(metric, value) {
  const band = THRESHOLDS[metric];
  if (value === null || !Number.isFinite(value)) return 0;
  if (band.higherIsBetter) {
    return value >= band.good ? 0 : (band.good - value) / band.good;
  }
  return value <= band.good ? 0 : (value - band.good) / band.good;
}

function dominantCause(measured) {
  if (verdict('cls', measured.cls) !== 'good' && overshoot('cls', measured.cls) >= 1) return 'cls';
  if (verdict('tbt', measured.tbt) !== 'good') return 'tbt';
  // A slow origin drags LCP with it; separate that from client-side render cost.
  if (Number.isFinite(measured.ttfb) && measured.ttfb > 800) return 'ttfb';
  if (verdict('lcp', measured.lcp) !== 'good') return 'render';
  if (verdict('cls', measured.cls) !== 'good') return 'cls';
  // Every vital passes, so the only thing left is composite paint timing.
  return 'paint';
}

export function buildDelta(targets, byDomain) {
  return targets.map((target) => {
    const bucket = byDomain.get(target.domain) ?? null;
    const runs = bucket?.runs ?? [];
    const measured = {
      score: percentile(runs.map((run) => Number(run.performance_score)).filter(Number.isFinite), 0.5),
      lcp: percentile(runs.map((run) => Number(run.lcp)).filter(Number.isFinite), 0.75),
      cls: percentile(runs.map((run) => Number(run.cls)).filter(Number.isFinite), 0.75),
      tbt: percentile(runs.map((run) => Number(run.tbt)).filter(Number.isFinite), 0.75),
      ttfb: percentile(runs.map((run) => Number(run.ttfb)).filter(Number.isFinite), 0.75),
      fcp: percentile(runs.map((run) => Number(run.fcp)).filter(Number.isFinite), 0.75),
      si: percentile(runs.map((run) => Number(run.si)).filter(Number.isFinite), 0.75),
    };
    const verdicts = Object.fromEntries(
      Object.keys(THRESHOLDS).map((metric) => [metric, verdict(metric, measured[metric])]),
    );
    const failing = Object.entries(verdicts)
      .filter(([, state]) => state === 'poor' || state === 'needs-improvement')
      .map(([metric]) => metric);
    const failingVitals = failing.filter((metric) => VITALS.includes(metric));
    const measuredAny = runs.length > 0;
    const cause = measuredAny && failing.length > 0 ? dominantCause(measured) : null;
    const severity = Object.keys(THRESHOLDS)
      .reduce((total, metric) => total + overshoot(metric, measured[metric]), 0);
    const weight = PRIORITY_WEIGHT[target.priority] ?? DEFAULT_PRIORITY_WEIGHT;
    const effort = cause ? EFFORT_BY_CAUSE[cause].effort : 0;
    return {
      ...target,
      runCount: runs.length,
      observedAt: bucket?.observedAt ?? null,
      measured,
      verdicts,
      failing,
      failingVitals,
      status: !measuredAny
        ? 'not-measured'
        : failing.length === 0
          ? 'fast-enough'
          : failingVitals.length === 0
            ? 'score-only'
            : failingVitals.some((metric) => verdicts[metric] === 'poor')
              ? 'poor'
              : 'needs-improvement',
      cause,
      effort: cause ? EFFORT_BY_CAUSE[cause].label : null,
      fix: cause ? EFFORT_BY_CAUSE[cause].fix : null,
      impact: Number((severity * weight).toFixed(3)),
      // Impact per unit of effort — what to do first.
      leverage: cause ? Number(((severity * weight) / effort).toFixed(3)) : 0,
    };
  }).sort((left, right) => right.leverage - left.leverage || right.impact - left.impact);
}

function formatMetric(metric, value) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (metric === 'cls') return value.toFixed(3);
  if (metric === 'score') return String(Math.round(value));
  return `${Math.round(value)}ms`;
}

function describe(row) {
  return [
    `${row.name} (${row.domain})  [${row.status}] leverage ${row.leverage}`,
    `  score ${formatMetric('score', row.measured.score)}`
    + `  LCP ${formatMetric('lcp', row.measured.lcp)}`
    + `  CLS ${formatMetric('cls', row.measured.cls)}`
    + `  TBT ${formatMetric('tbt', row.measured.tbt)}`
    + `  TTFB ${formatMetric('ttfb', row.measured.ttfb)}`
    + `  FCP ${formatMetric('fcp', row.measured.fcp)}`
    + `  SI ${formatMetric('si', row.measured.si)}`,
    `  ${row.effort}: ${row.fix}`,
    '',
  ];
}

function report(rows) {
  const measured = rows.filter((row) => row.status !== 'not-measured');
  const behindVitals = measured.filter((row) => row.failingVitals.length > 0);
  const scoreOnly = measured.filter((row) => row.status === 'score-only');
  const lines = [
    `Measured ${measured.length}/${rows.length} targets — `
    + `${behindVitals.length} below Core Web Vitals, ${scoreOnly.length} passing vitals but under a 90 score, `
    + `${measured.length - behindVitals.length - scoreOnly.length} clear.`,
    '',
    'Below Core Web Vitals, ranked by impact against effort:',
    '',
  ];
  for (const row of behindVitals) lines.push(...describe(row));
  if (scoreOnly.length > 0) {
    lines.push('Vitals pass, composite score under 90 (cosmetic against CWV):', '');
    for (const row of scoreOnly) lines.push(...describe(row));
  }
  const unmeasured = rows.filter((row) => row.status === 'not-measured');
  if (unmeasured.length > 0) {
    lines.push(`Not measured: ${unmeasured.map((row) => row.projectId).join(', ')}`);
  }
  return lines.join('\n');
}

if (import.meta.filename === process.argv[1]) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const rows = buildDelta(
      readTargets(options.targets),
      readDistribution(options.history, { tag: options.tag, since: options.since }),
    );
    console.log(options.json
      ? JSON.stringify({ schema: 'fleet.psi-portfolio-delta.v1', rows }, null, 2)
      : report(rows));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
