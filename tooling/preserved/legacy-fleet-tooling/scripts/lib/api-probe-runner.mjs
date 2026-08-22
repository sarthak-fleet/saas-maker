/**
 * Bounded synthetic API probe runner.
 * Only GET/HEAD against catalog-declared surfaces. Schedules stay inert until host approval.
 */

import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateProbeSegment, percentileSet } from './performance-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const MAX_RESPONSE_BYTES = 1_048_576;

function privateIp(hostname) {
  if (isIP(hostname) === 4) {
    const [first, second] = hostname.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }
  if (isIP(hostname) === 6) {
    const value = hostname.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || /^fe[89ab]/.test(value);
  }
  return false;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export async function loadPerformanceSurfaces(
  catalogPath = path.join(REPO_ROOT, 'foundry/ops/config/performance-surfaces.json'),
) {
  const raw = JSON.parse(await readFile(catalogPath, 'utf8'));
  const surfaces = [];
  for (const project of raw.projects ?? []) {
    for (const surface of project.surfaces ?? []) {
      if (surface.kind === 'api') surfaces.push({ ...surface, projectName: project.name });
    }
  }
  return { policy: raw.policy, surfaces };
}

function assertSafeSurface(surface) {
  const method = String(surface.method ?? 'GET').toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    throw new Error(`refusing unsafe method ${method} for surface ${surface.id}`);
  }
  let url;
  try {
    url = new URL(surface.url);
  } catch {
    throw new Error(`surface ${surface.id} must use an absolute URL`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`surface ${surface.id} must use a credential-free HTTPS URL without query or fragment`);
  }
  if (url.port && url.port !== '443') throw new Error(`surface ${surface.id} must use port 443`);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') ||
      hostname.endsWith('.internal') || privateIp(hostname)) {
    throw new Error(`surface ${surface.id} must use a public hostname`);
  }
  const statuses = surface.expectedStatuses ?? [200];
  if (!Array.isArray(statuses) || statuses.length === 0 ||
      statuses.some((status) => !Number.isInteger(status) || status < 200 || status > 399)) {
    throw new Error(`surface ${surface.id} expected statuses must be bounded 2xx/3xx values`);
  }
  return method;
}

async function drainBounded(response, maximumBytes) {
  if (!response.body) return;
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new Error('response_too_large');
  }
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error('response_too_large');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Probe a single URL. phases unavailable are left undefined (not zero).
 */
export async function probeOnce(url, { method = 'GET', timeoutMs = 10_000, fetchImpl = fetch, maximumResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  boundedInteger(timeoutMs, 'timeoutMs', 250, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let status = null;
  let ok = false;
  let timedOut = false;
  let errorCode = null;
  let ttfb = null;
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'fleet-synthetic-probe/1.0' },
    });
    status = response.status;
    ok = response.ok && ![301, 302, 303, 307, 308].includes(response.status);
    ttfb = performance.now() - started;
    if (method !== 'HEAD') await drainBounded(response, maximumResponseBytes);
  } catch (error) {
    timedOut = error?.name === 'AbortError';
    errorCode = timedOut ? 'timeout' : error?.message === 'response_too_large' ? 'response_too_large' : 'network_error';
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  const total = performance.now() - started;
  return {
    ok,
    status,
    timedOut,
    errorCode,
    timingsMs: {
      // DNS/connect/TLS are unavailable in plain fetch; mark by omission.
      ttfb: ttfb == null ? undefined : Number(ttfb.toFixed(3)),
      total: Number(total.toFixed(3)),
    },
  };
}

export async function runSurfaceProbe(surface, options = {}) {
  const method = assertSafeSurface(surface);
  const coldSamples = options.coldSamples ?? 5;
  const warmSamples = options.warmSamples ?? 15;
  const timeoutMs = surface.timeoutMs ?? options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const concurrency = boundedInteger(options.concurrency ?? 2, 'concurrency', 1, 8);
  boundedInteger(coldSamples, 'coldSamples', 1, 10);
  boundedInteger(warmSamples, 'warmSamples', 1, 30);
  if (coldSamples + warmSamples > 40) throw new Error('maximum samples per surface is 40');
  const expected = new Set(surface.expectedStatuses ?? [200]);

  const windowStart = new Date().toISOString();
  const cold = [];
  for (let i = 0; i < coldSamples; i++) {
    cold.push(await probeOnce(surface.url, { method, timeoutMs, fetchImpl }));
  }

  const warm = [];
  // Bounded concurrency warm pool
  let index = 0;
  async function worker() {
    while (index < warmSamples) {
      const i = index++;
      warm[i] = await probeOnce(surface.url, { method, timeoutMs, fetchImpl });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, warmSamples) }, () => worker()));

  const annotate = (samples, mode) =>
    samples.map((sample) => ({
      ...sample,
      ok: sample.ok && expected.has(sample.status),
      probeMode: mode,
    }));

  const coldSeg = aggregateProbeSegment(annotate(cold, 'cold'));
  const warmSeg = aggregateProbeSegment(annotate(warm, 'warm'));
  const all = [...annotate(cold, 'cold'), ...annotate(warm, 'warm')];
  const allSeg = aggregateProbeSegment(all);
  const totals = all.map((s) => s.timingsMs?.total).filter((v) => typeof v === 'number');
  const errorCount = all.filter((s) => !s.ok).length;

  const observedAt = new Date().toISOString();
  const receipt = {
    schema_version: 1,
    idempotency_key: `synthetic-api:${surface.id}:${observedAt.slice(0, 13)}`,
    project_id: surface.projectId,
    kind: 'api',
    surface: surface.id,
    environment: options.environment ?? 'production',
    source: 'synthetic-api',
    revision: options.revision ?? null,
    window_start: windowStart,
    window_end: observedAt,
    sample_count: all.length,
    error_count: errorCount,
    sampling_rate: 1,
    probe_mode: 'mixed',
    probe_origin: options.probeOrigin ?? 'local-ops',
    method,
    route_template: new URL(surface.url).pathname,
    latency_ms: percentileSet(totals),
    phases: {
      ttfb: allSeg.timings.ttfb,
      total: allSeg.timings.total,
      dns: allSeg.timings.dns,
      connect: allSeg.timings.connect,
      tls: allSeg.timings.tls,
    },
    diagnostic_ref: null,
  };

  return {
    surfaceId: surface.id,
    projectId: surface.projectId,
    cold: coldSeg,
    warm: warmSeg,
    receipt,
    probeOrigin: options.probeOrigin ?? 'local-ops',
  };
}

export async function runCatalogApiProbes(options = {}) {
  const { policy, surfaces } = await loadPerformanceSurfaces(options.catalogPath);
  if (policy?.synthetic?.schedulesActive && !options.force) {
    // schedulesActive true is blocked by catalog validation; still guard here.
    throw new Error('synthetic schedules are active — refusing dual-run without --force');
  }
  if (policy?.synthetic?.schedulesActive === false && options.requireActive) {
    throw new Error('schedules remain inert; pass requireActive:false for manual runs');
  }

  const selected = options.only
    ? surfaces.filter((s) => options.only.includes(s.id) || options.only.includes(s.projectId))
    : surfaces;
  if (selected.length > 100) throw new Error('maximum API surfaces per run is 100');

  const results = [];
  for (const surface of selected) {
    results.push(
      await runSurfaceProbe(surface, {
        coldSamples: policy?.synthetic?.api?.coldSamples ?? 5,
        warmSamples: policy?.synthetic?.api?.warmSamples ?? 15,
        ...options,
      })
    );
  }
  return { policy, results };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('api-probe-runner.mjs')) {
  const onlyArg = process.argv.find((_argument, i) => process.argv[i - 1] === '--only');
  const fixture = process.argv.includes('--fixture');
  if (fixture) {
    const fakeFetch = async () =>
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    const demo = await runSurfaceProbe(
      {
        id: 'demo-api',
        projectId: 'demo',
        url: 'https://example.com/health',
        method: 'GET',
        expectedStatuses: [200],
        timeoutMs: 5000,
      },
      { coldSamples: 2, warmSamples: 3, fetchImpl: fakeFetch }
    );
    console.log(JSON.stringify(demo, null, 2));
  } else {
    const out = await runCatalogApiProbes({
      only: onlyArg ? onlyArg.split(',') : undefined,
      coldSamples: 1,
      warmSamples: 1,
    });
    console.log(JSON.stringify({ count: out.results.length, results: out.results }, null, 2));
  }
}
