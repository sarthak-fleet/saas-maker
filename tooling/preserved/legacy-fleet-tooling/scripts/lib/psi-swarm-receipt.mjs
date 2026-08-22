/**
 * Adapt PSI Swarm distribution output into a Foundry performance receipt.
 */

import { percentileSet } from './performance-evidence.mjs';

function finite(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function vitalsFromSamples(samples, key) {
  const values = samples.map((s) => finite(s?.[key] ?? s?.metrics?.[key])).filter((v) => v != null);
  if (values.length === 0) return undefined;
  return percentileSet(values, [90]);
}

/**
 * @param {object} input
 * @param {string} input.projectId
 * @param {string} input.surfaceId
 * @param {Array<object>} input.runs - individual Lighthouse/PSI run summaries
 * @param {string} [input.diagnosticRef]
 * @param {string} [input.revision]
 * @param {string} [input.environment]
 */
export function buildPsiSwarmReceipt(input) {
  const runs = Array.isArray(input.runs) ? input.runs : [];
  if (runs.length === 0) throw new Error('PSI Swarm receipt requires at least one run');

  const observedStart = input.windowStart ?? runs[0]?.observedAt ?? new Date().toISOString();
  const observedEnd = input.windowEnd ?? runs[runs.length - 1]?.observedAt ?? observedStart;

  const lcp = vitalsFromSamples(runs, 'lcpMs') ?? vitalsFromSamples(runs, 'lcp_ms');
  const inp = vitalsFromSamples(runs, 'inpMs') ?? vitalsFromSamples(runs, 'inp_ms');
  const cls = vitalsFromSamples(runs, 'cls');
  const fcp = vitalsFromSamples(runs, 'fcpMs') ?? vitalsFromSamples(runs, 'fcp_ms');
  const ttfb = vitalsFromSamples(runs, 'ttfbMs') ?? vitalsFromSamples(runs, 'ttfb_ms');

  const web_vitals = {};
  if (lcp) web_vitals.lcp_ms = lcp;
  if (inp) web_vitals.inp_ms = inp;
  if (cls) web_vitals.cls = cls;
  if (fcp) web_vitals.fcp_ms = fcp;
  if (ttfb) web_vitals.ttfb_ms = ttfb;

  const totals = runs
    .map((r) => finite(r.lcpMs ?? r.lcp_ms ?? r.totalMs))
    .filter((v) => v != null);

  return {
    schema_version: 1,
    idempotency_key:
      input.idempotencyKey ??
      `psi-swarm:${input.surfaceId}:${String(observedEnd).slice(0, 13)}`,
    project_id: input.projectId,
    kind: 'web',
    surface: input.surfaceId,
    environment: input.environment ?? 'production',
    source: 'psi-swarm',
    revision: input.revision ?? null,
    window_start: new Date(observedStart).toISOString(),
    window_end: new Date(observedEnd).toISOString(),
    sample_count: runs.length,
    error_count: runs.filter((r) => r.failed || r.error).length,
    sampling_rate: 1,
    probe_mode: null,
    probe_origin: input.probeOrigin ?? 'psi-swarm',
    method: 'GET',
    route_template: input.routeTemplate ?? '/',
    latency_ms: totals.length ? percentileSet(totals, [90]) : null,
    phases: null,
    web_vitals: Object.keys(web_vitals).length ? web_vitals : null,
    diagnostic_ref: input.diagnosticRef ?? null,
  };
}
