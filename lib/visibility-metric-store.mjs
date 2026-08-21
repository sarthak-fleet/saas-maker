import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const VISIBILITY_METRIC_SCHEMA = 'fleet.visibility-metric.v1';

export function defaultVisibilityMetricPath({ home = process.env.HOME ?? '' } = {}) {
  return join(home, '.fleet', 'visibility-metrics', 'ledger.jsonl');
}

function normalizedObservation(observation) {
  if (
    observation?.schemaVersion !== VISIBILITY_METRIC_SCHEMA ||
    typeof observation.projectId !== 'string' ||
    !['agent', 'crawl', 'seo', 'coverage'].includes(observation.family) ||
    !Number.isFinite(Date.parse(observation.observedAt)) ||
    !Array.isArray(observation.metrics)
  ) return null;
  const metrics = observation.metrics.flatMap((metric) => {
    const value = Number(metric?.value);
    if (!metric?.label || !Number.isFinite(value)) return [];
    return [{
      label: String(metric.label),
      value,
      unit: metric.unit ? String(metric.unit) : null,
      direction: metric.direction ? String(metric.direction) : null,
    }];
  });
  if (metrics.length === 0) return null;
  return {
    schemaVersion: VISIBILITY_METRIC_SCHEMA,
    projectId: observation.projectId,
    family: observation.family,
    observedAt: observation.observedAt,
    status: String(observation.status ?? 'recorded'),
    summary: String(observation.summary ?? 'Audit recorded.').slice(0, 500),
    metrics,
  };
}

export function appendVisibilityMetric(
  observation,
  { path = defaultVisibilityMetricPath() } = {},
) {
  const normalized = normalizedObservation(observation);
  if (!normalized) throw new Error('invalid visibility metric observation');
  const directory = join(path, '..');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return normalized;
}

export function readVisibilityMetrics(
  { path = defaultVisibilityMetricPath() } = {},
) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const observation = normalizedObservation(JSON.parse(line));
        return observation ? [observation] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}
