#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'sites']);
const SITE_KEYS = new Set(['id', 'url', 'probePath']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 15_000;

function exactKeys(value, allowed, label) {
  const keys = Object.keys(value);
  const extras = keys.filter((key) => !allowed.has(key));
  const missing = [...allowed].filter((key) => !keys.includes(key));
  if (extras.length || missing.length) {
    throw new Error(`${label} keys invalid: extras=${extras.join(',') || 'none'} missing=${missing.join(',') || 'none'}`);
  }
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Manifest must be an object.');
  }
  exactKeys(value, TOP_LEVEL_KEYS, 'manifest');
  if (value.schemaVersion !== 1) throw new Error('schemaVersion must be 1.');
  if (!Array.isArray(value.sites) || value.sites.length === 0) {
    throw new Error('sites must be a non-empty array.');
  }

  const ids = new Set();
  const targets = new Set();
  const sites = value.sites.map((site, index) => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
      throw new Error(`sites[${index}] must be an object.`);
    }
    exactKeys(site, SITE_KEYS, `sites[${index}]`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.id)) {
      throw new Error(`sites[${index}].id is invalid.`);
    }
    if (ids.has(site.id)) throw new Error(`Duplicate site id: ${site.id}`);
    ids.add(site.id);

    const base = new URL(site.url);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error(`sites[${index}].url must be a credential-free HTTPS URL without query or fragment.`);
    }
    if (!site.probePath.startsWith('/') || site.probePath.includes('..')) {
      throw new Error(`sites[${index}].probePath must be an absolute safe path.`);
    }
    const target = new URL(site.probePath, base);
    if (target.protocol !== 'https:') throw new Error(`sites[${index}] target must remain HTTPS.`);
    if (targets.has(target.href)) throw new Error(`Duplicate probe target: ${target.href}`);
    targets.add(target.href);
    return { id: site.id, url: base.origin, probePath: site.probePath };
  });

  return { schemaVersion: 1, sites };
}

export function loadManifest(path) {
  return validateManifest(JSON.parse(readFileSync(path, 'utf8')));
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function errorCategory(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}

export async function probeOnce(site, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readBody = options.readBody ?? false;
  let current = new URL(site.probePath, site.url);
  const started = performance.now();
  const redirects = [];

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'sass-maker-workflows/1.0 (+https://github.com/sass-maker/workflows)' },
      });
      const headersMs = roundMs(performance.now() - started);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) {
          return { ok: false, status: response.status, finalUrl: current.href, headersMs, totalMs: headersMs, redirects, error: 'redirect-without-location' };
        }
        const next = new URL(location, current);
        if (next.protocol !== 'https:') {
          return { ok: false, status: response.status, finalUrl: current.href, headersMs, totalMs: headersMs, redirects, error: 'insecure-redirect' };
        }
        redirects.push({ status: response.status, from: current.href, to: next.href });
        current = next;
        continue;
      }

      if (readBody) await response.arrayBuffer();
      else await response.body?.cancel();
      const totalMs = roundMs(performance.now() - started);
      return {
        ok: response.status >= 200 && response.status < 400,
        status: response.status,
        finalUrl: current.href,
        headersMs,
        totalMs,
        redirects,
      };
    }
    return { ok: false, status: null, finalUrl: current.href, redirects, error: 'too-many-redirects' };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: current.href,
      redirects,
      error: errorCategory(error),
      totalMs: roundMs(performance.now() - started),
    };
  }
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

async function mapPool(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function runAudit(manifest, options = {}) {
  const mode = options.mode ?? 'availability';
  const runs = options.runs ?? (mode === 'performance' ? 3 : 1);
  const probe = options.probe ?? probeOnce;
  if (!['availability', 'performance'].includes(mode)) throw new Error('mode must be availability or performance.');
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('runs must be an integer from 1 to 5.');

  const results = await mapPool(manifest.sites, MAX_CONCURRENCY, async (site) => {
    const attempts = [];
    for (let run = 0; run < runs; run += 1) {
      attempts.push(await probe(site, { readBody: mode === 'performance' }));
    }
    const successful = attempts.filter((attempt) => attempt.ok);
    return {
      id: site.id,
      target: new URL(site.probePath, site.url).href,
      ok: successful.length === attempts.length,
      attempts,
      metrics: {
        headersP50Ms: percentile(successful.map((attempt) => attempt.headersMs), 0.5),
        headersP90Ms: percentile(successful.map((attempt) => attempt.headersMs), 0.9),
        totalP50Ms: percentile(successful.map((attempt) => attempt.totalMs), 0.5),
        totalP90Ms: percentile(successful.map((attempt) => attempt.totalMs), 0.9),
      },
    };
  });

  const passed = results.filter((result) => result.ok).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    runs,
    summary: { sites: results.length, passed, failed: results.length - passed },
    results,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const manifestPath = resolve(argument('--manifest') ?? 'config/sites.json');
  const manifest = loadManifest(manifestPath);
  if (process.argv.includes('--validate-only')) {
    console.log(`Valid public manifest: ${manifest.sites.length} sites`);
    return;
  }

  const mode = argument('--mode') ?? 'availability';
  const runs = Number(argument('--runs') ?? (mode === 'performance' ? 3 : 1));
  const date = new Date().toISOString().slice(0, 10);
  const outputPath = resolve(argument('--output') ?? `reports/${mode}/${date}.json`);
  const report = await runAudit(manifest, { mode, runs });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(dirname(outputPath), 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${mode}: ${report.summary.passed}/${report.summary.sites} sites passed; wrote ${outputPath}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
