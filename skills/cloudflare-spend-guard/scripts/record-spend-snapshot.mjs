#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const fleetRoot = resolve(moduleDir, '../../../../..');
const defaultStateDir = resolve(
  fleetRoot,
  'foundry/ops/automation/codex-cron/state/spend-guard',
);

const PROVIDERS = new Set(['cloudflare', 'turso']);
const SPEND_STATES = new Set([
  'paying-now',
  'likely-this-cycle',
  'watch',
  'unlikely-on-current-evidence',
  'unknown',
]);
const EVIDENCE_STATES = new Set(['available', 'partial', 'unavailable']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const COST_KINDS = new Set(['fixed', 'usage', 'credit', 'tax']);
const DECISIONS = new Set(['keep', 'optimize', 'pause-candidate', 'insufficient-evidence']);
const FORBIDDEN_KEY = /secret|token|credential|password|authorization|cookie|raw|sql|database.?url|connection/i;
const FORBIDDEN_VALUE =
  /libsql:\/\/|bearer\s+|(?:api[_-]?key|token|password)\s*[:=]|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i;

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(value, allowed, context) {
  if (!isObject(value)) fail(`${context} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${context} contains unsupported field: ${key}`);
  }
}

function assertNoSensitiveShapes(value, context = 'snapshot') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveShapes(item, `${context}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail(`${context} contains a secret-shaped field: ${key}`);
      assertNoSensitiveShapes(child, `${context}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) {
    fail(`${context} contains a secret-shaped value`);
  }
}

function stringValue(value, context, { optional = false, max = 300 } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > max) {
    fail(`${context} must be a non-empty trimmed string of at most ${max} characters`);
  }
  if (/[\r\n\0]/.test(value)) fail(`${context} must be a single line`);
  return value;
}

function enumValue(value, allowed, context) {
  if (!allowed.has(value)) fail(`${context} is invalid`);
  return value;
}

function isoValue(value, context, { optional = false } = {}) {
  if (value == null && optional) return null;
  const parsed = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed)) fail(`${context} must be an ISO date`);
  return new Date(parsed).toISOString();
}

function finiteNumber(value, context, { minimum = -Infinity, exclusiveMinimum = false } = {}) {
  if (!Number.isFinite(value)) fail(`${context} must be a finite number`);
  if (exclusiveMinimum ? value <= minimum : value < minimum) {
    fail(`${context} is below its allowed minimum`);
  }
  return value;
}

function normalizePeriod(value, context) {
  assertKeys(value, new Set(['label', 'start', 'end', 'resetAt']), context);
  return {
    label: stringValue(value.label, `${context}.label`, { max: 120 }),
    start: isoValue(value.start, `${context}.start`, { optional: true }),
    end: isoValue(value.end, `${context}.end`, { optional: true }),
    resetAt: isoValue(value.resetAt, `${context}.resetAt`, { optional: true }),
  };
}

function normalizeCost(value, context) {
  assertKeys(value, new Set(['kind', 'amount', 'currency']), context);
  const kind = enumValue(value.kind, COST_KINDS, `${context}.kind`);
  const amount = finiteNumber(value.amount, `${context}.amount`);
  if (kind !== 'credit' && amount < 0) fail(`${context}.amount cannot be negative for ${kind}`);
  return {
    kind,
    amount,
    currency: stringValue(value.currency, `${context}.currency`, { max: 12 }).toUpperCase(),
  };
}

function normalizeQuota(value, context) {
  assertKeys(value, new Set(['metric', 'used', 'limit', 'unit', 'resetAt']), context);
  const used = finiteNumber(value.used, `${context}.used`, { minimum: 0 });
  const limit = finiteNumber(value.limit, `${context}.limit`, {
    minimum: 0,
    exclusiveMinimum: true,
  });
  return {
    metric: stringValue(value.metric, `${context}.metric`, { max: 100 }),
    used,
    limit,
    unit: stringValue(value.unit, `${context}.unit`, { max: 40 }),
    percent: Number(((used / limit) * 100).toFixed(2)),
    resetAt: isoValue(value.resetAt, `${context}.resetAt`, { optional: true }),
  };
}

function normalizeProvider(value, index) {
  const context = `providers[${index}]`;
  assertKeys(
    value,
    new Set([
      'provider',
      'spendState',
      'evidenceStatus',
      'confidence',
      'period',
      'costs',
      'quotas',
      'evidenceGaps',
    ]),
    context,
  );
  return {
    provider: enumValue(value.provider, PROVIDERS, `${context}.provider`),
    spendState: enumValue(value.spendState, SPEND_STATES, `${context}.spendState`),
    evidenceStatus: enumValue(
      value.evidenceStatus,
      EVIDENCE_STATES,
      `${context}.evidenceStatus`,
    ),
    confidence: enumValue(value.confidence, CONFIDENCE, `${context}.confidence`),
    period: normalizePeriod(value.period, `${context}.period`),
    costs: (value.costs ?? []).map((cost, costIndex) =>
      normalizeCost(cost, `${context}.costs[${costIndex}]`),
    ),
    quotas: (value.quotas ?? []).map((quota, quotaIndex) =>
      normalizeQuota(quota, `${context}.quotas[${quotaIndex}]`),
    ),
    evidenceGaps: (value.evidenceGaps ?? []).map((gap, gapIndex) =>
      stringValue(gap, `${context}.evidenceGaps[${gapIndex}]`),
    ),
  };
}

function normalizeRecommendation(value, index) {
  const context = `recommendations[${index}]`;
  assertKeys(value, new Set(['projectId', 'resource', 'decision', 'nextStep']), context);
  return {
    projectId: stringValue(value.projectId, `${context}.projectId`, { max: 100 }),
    resource: stringValue(value.resource, `${context}.resource`, { max: 160 }),
    decision: enumValue(value.decision, DECISIONS, `${context}.decision`),
    nextStep: stringValue(value.nextStep, `${context}.nextStep`),
  };
}

export function normalizeSnapshot(input) {
  assertNoSensitiveShapes(input);
  assertKeys(
    input,
    new Set(['schemaVersion', 'runId', 'observedAt', 'providers', 'recommendations']),
    'snapshot',
  );
  if (input.schemaVersion !== 1) fail('snapshot.schemaVersion must be 1');
  if (!Array.isArray(input.providers) || input.providers.length === 0) {
    fail('snapshot.providers must be a non-empty array');
  }
  const providers = input.providers.map(normalizeProvider);
  if (new Set(providers.map((provider) => provider.provider)).size !== providers.length) {
    fail('snapshot.providers contains a duplicate provider');
  }
  return {
    schemaVersion: 1,
    runId: stringValue(input.runId, 'snapshot.runId', { max: 120 }),
    observedAt: isoValue(input.observedAt, 'snapshot.observedAt'),
    providers,
    recommendations: (input.recommendations ?? []).map(normalizeRecommendation),
  };
}

function positiveCost(provider) {
  return provider.costs
    .filter((cost) => cost.kind === 'fixed' || cost.kind === 'usage')
    .reduce((sum, cost) => sum + Math.max(0, cost.amount), 0);
}

function deriveAlert(snapshot, previous) {
  const reasons = [];
  for (const provider of snapshot.providers) {
    for (const quota of provider.quotas) {
      if (quota.percent >= 95) {
        reasons.push({
          severity: 'critical',
          provider: provider.provider,
          code: 'quota-critical',
          detail: `${quota.metric} is ${quota.percent}% used`,
        });
      } else if (quota.percent >= 85) {
        reasons.push({
          severity: 'warning',
          provider: provider.provider,
          code: 'quota-warning',
          detail: `${quota.metric} is ${quota.percent}% used`,
        });
      }
    }
    if (provider.evidenceStatus === 'unavailable') {
      reasons.push({
        severity: 'warning',
        provider: provider.provider,
        code: 'evidence-unavailable',
        detail: 'Consequential provider evidence is unavailable',
      });
    }
    const currentPositive = positiveCost(provider);
    const prior = previous?.providers?.find((item) => item.provider === provider.provider);
    if (currentPositive > 0 && (!prior || positiveCost(prior) <= 0)) {
      reasons.push({
        severity: 'warning',
        provider: provider.provider,
        code: 'new-positive-cost',
        detail: 'A fixed or usage cost became positive',
      });
    }
  }
  const severity = reasons.some((reason) => reason.severity === 'critical')
    ? 'critical'
    : reasons.length
      ? 'warning'
      : 'ok';
  return { severity, reasons };
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        fail(`ledger contains invalid JSON on line ${index + 1}`);
      }
    });
}

function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, path);
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|');
}

function renderMarkdown(snapshot) {
  const lines = [
    '# Fleet Spend Guard',
    '',
    `Observed: ${snapshot.observedAt}`,
    `Alert: ${snapshot.alert.severity}`,
    '',
    '| Provider | Spend state | Evidence | Period | Confirmed costs | Highest quota |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const provider of snapshot.providers) {
    const costs = provider.costs.length
      ? provider.costs.map((cost) => `${cost.kind} ${cost.currency} ${cost.amount}`).join(', ')
      : 'none confirmed';
    const highestQuota = provider.quotas
      .slice()
      .sort((left, right) => right.percent - left.percent)[0];
    lines.push(
      `| ${provider.provider} | ${provider.spendState} | ${provider.evidenceStatus} (${provider.confidence}) | ${markdownCell(provider.period.label)} | ${markdownCell(costs)} | ${
        highestQuota ? `${markdownCell(highestQuota.metric)} ${highestQuota.percent}%` : 'not available'
      } |`,
    );
  }
  if (snapshot.alert.reasons.length) {
    lines.push('', '## Alerts', '');
    for (const reason of snapshot.alert.reasons) {
      lines.push(`- ${reason.severity}: ${reason.provider} — ${reason.detail}`);
    }
  }
  if (snapshot.recommendations.length) {
    lines.push('', '## Recommendations', '');
    for (const item of snapshot.recommendations) {
      lines.push(
        `- ${item.projectId} / ${item.resource}: ${item.decision} — ${item.nextStep}`,
      );
    }
  }
  lines.push('', 'No provider or production mutation was performed.', '');
  return lines.join('\n');
}

export function recordSpendSnapshot(input, { stateDir = defaultStateDir } = {}) {
  const normalized = normalizeSnapshot(input);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const ledgerPath = resolve(stateDir, 'ledger.jsonl');
  const latestJsonPath = resolve(stateDir, 'latest.json');
  const latestMarkdownPath = resolve(stateDir, 'latest.md');
  const ledger = readLedger(ledgerPath);
  const inputHash = stableHash(normalized);
  const duplicate = ledger.find((entry) => entry.runId === normalized.runId);
  if (duplicate) {
    if (duplicate.inputHash !== inputHash) fail(`runId conflict: ${normalized.runId}`);
    atomicWrite(latestJsonPath, `${JSON.stringify(duplicate, null, 2)}\n`);
    atomicWrite(latestMarkdownPath, renderMarkdown(duplicate));
    return { duplicate: true, snapshot: duplicate, paths: { ledgerPath, latestJsonPath, latestMarkdownPath } };
  }

  const previous = ledger.at(-1) ?? null;
  const snapshot = {
    ...normalized,
    inputHash,
    alert: deriveAlert(normalized, previous),
  };
  appendFileSync(ledgerPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  atomicWrite(latestJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  atomicWrite(latestMarkdownPath, renderMarkdown(snapshot));
  return { duplicate: false, snapshot, paths: { ledgerPath, latestJsonPath, latestMarkdownPath } };
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
}

function usage() {
  return 'Usage: record-spend-snapshot.mjs --input PATH [--state-dir PATH] [--json]';
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const allowed = new Set(['--input', '--state-dir', '--json']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    if (!allowed.has(token)) fail(`Unknown option: ${token}`);
    if (token !== '--json') index += 1;
  }
  const inputPath = argument(argv, '--input');
  if (!inputPath) fail('--input is required');
  const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  const result = recordSpendSnapshot(input, {
    stateDir: resolve(argument(argv, '--state-dir') ?? defaultStateDir),
  });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.snapshot.alert.severity}: ${result.snapshot.runId}${result.duplicate ? ' (duplicate)' : ''}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
  });
}
