import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RUN_SCHEMA_VERSION = 'fleet.skill-run.v1';
export const METRIC_SCHEMA_VERSION = 'fleet.skill-metric.v1';
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;

const RUN_SOURCES = new Set([
  'wrapped',
  'codex-hook',
  'devin-wrapper',
  'host-receipt',
  'explicit-receipt',
  'backfill',
]);
const CAPTURE_COMPLETENESS = new Set(['exact-streams', 'final-response', 'summary-only']);
const RUN_STATUSES = new Set([
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'unknown',
  'backfilled',
]);
const DIRECTIONS = new Set(['higher-is-better', 'lower-is-better', 'neutral']);
const OUTPUT_NAMES = new Set(['stdout', 'stderr', 'output']);
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SECRET_DIMENSION_KEY =
  /(^|[_-])(api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|credential|password|private[_-]?key|secret|token)($|[_-])/i;

const REDACTION_PATTERNS = [
  {
    pattern: /\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
    replace: '$1[REDACTED]',
  },
  {
    pattern:
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|private[_-]?key|secret|token)\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
    replace: '$1[REDACTED]',
  },
  {
    pattern:
      /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replace: '[REDACTED]',
  },
  {
    pattern: /(https?:\/\/[^:/\s]+:)[^@\s/]+(@)/gi,
    replace: '$1[REDACTED]$2',
  },
];

class SkillRunValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkillRunValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SkillRunValidationError(code, message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, field) {
  if (!isPlainObject(value)) fail('INVALID_FIELD', `${field} must be an object`);
}

function assertNonemptyString(value, field, maxLength = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail('INVALID_FIELD', `${field} must be a nonempty string of at most ${maxLength} characters`);
  }
}

function assertJsonValue(value, field) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('not serializable');
    JSON.parse(serialized);
  } catch {
    fail('INVALID_FIELD', `${field} must be JSON serializable`);
  }
}

function assertIsoTime(value, field) {
  assertNonemptyString(value, field);
  if (!Number.isFinite(Date.parse(value))) fail('INVALID_FIELD', `${field} must be an ISO date-time`);
}

function assertActorOrHost(value, field) {
  if (typeof value === 'string') {
    assertNonemptyString(value, field, 256);
    return;
  }
  assertPlainObject(value, field);
  assertJsonValue(value, field);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeStatus(status) {
  if (status === 'success' || status === 'completed') return 'succeeded';
  if (status === 'error') return 'failed';
  return status;
}

function outputLimitFromEnvironment(env) {
  const value = Number.parseInt(env.FLEET_SKILL_RUN_MAX_BYTES ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_OUTPUT_LIMIT_BYTES;
}

function takeUtf8Head(text, byteBudget) {
  let result = '';
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > byteBudget) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function takeUtf8Tail(text, byteBudget) {
  const characters = Array.from(text);
  let result = '';
  let bytes = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > byteBudget) break;
    result = character + result;
    bytes += characterBytes;
  }
  return result;
}

export function defaultSkillRunsRoot({
  env = process.env,
  home = env.HOME || homedir(),
} = {}) {
  if (env.FLEET_SKILL_RUNS_DIR) return resolve(env.FLEET_SKILL_RUNS_DIR);
  if (!home) fail('MISSING_HOME', 'HOME is required to resolve the skill-run store');
  return join(home, 'Library', 'Application Support', 'Fleet Ops', 'skill-runs');
}

export function sanitizeOutput(input, { limitBytes = DEFAULT_OUTPUT_LIMIT_BYTES } = {}) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    fail('INVALID_OUTPUT_LIMIT', 'limitBytes must be a positive safe integer');
  }

  const raw = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  const originalBytes = Buffer.byteLength(raw);
  let sanitized = raw;
  let redactionCount = 0;
  for (const { pattern, replace } of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, (...args) => {
      redactionCount += 1;
      return typeof replace === 'function' ? replace(...args) : replace.replace(
        /\$(\d+)/g,
        (_, index) => args[Number(index)] ?? '',
      );
    });
  }

  const sanitizedBytes = Buffer.byteLength(sanitized);
  let content = sanitized;
  let truncated = false;
  if (sanitizedBytes > limitBytes) {
    truncated = true;
    const marker = takeUtf8Head('\n...[TRUNCATED]...\n', limitBytes);
    const payloadBudget = Math.max(0, limitBytes - Buffer.byteLength(marker));
    const headBytes = Math.ceil(payloadBudget / 2);
    const tailBytes = Math.floor(payloadBudget / 2);
    content = `${takeUtf8Head(sanitized, headBytes)}${marker}${takeUtf8Tail(
      sanitized,
      tailBytes,
    )}`;
  }
  const stored = Buffer.from(content);

  return {
    content,
    metadata: {
      originalBytes,
      sanitizedBytes,
      storedBytes: stored.length,
      sha256: digest(stored),
      redactionCount,
      truncated,
      limitBytes,
    },
  };
}

function validateOutputMetadata(outputs) {
  assertPlainObject(outputs, 'outputs');
  for (const [name, metadata] of Object.entries(outputs)) {
    if (!OUTPUT_NAMES.has(name)) fail('INVALID_OUTPUT', `unsupported output stream ${name}`);
    assertPlainObject(metadata, `outputs.${name}`);
    assertNonemptyString(metadata.path, `outputs.${name}.path`);
    if (isAbsolute(metadata.path) || metadata.path.split(/[\\/]/).includes('..')) {
      fail('INVALID_OUTPUT', `outputs.${name}.path must be a store-relative path`);
    }
    for (const field of ['originalBytes', 'sanitizedBytes', 'storedBytes', 'redactionCount', 'limitBytes']) {
      if (!Number.isSafeInteger(metadata[field]) || metadata[field] < 0) {
        fail('INVALID_OUTPUT', `outputs.${name}.${field} must be a nonnegative safe integer`);
      }
    }
    if (!SHA256.test(metadata.sha256)) {
      fail('INVALID_OUTPUT', `outputs.${name}.sha256 must be a SHA-256 digest`);
    }
    if (typeof metadata.truncated !== 'boolean') {
      fail('INVALID_OUTPUT', `outputs.${name}.truncated must be boolean`);
    }
  }
}

export function validateMetricObservation(metric) {
  assertPlainObject(metric, 'metric');
  if (metric.schemaVersion !== METRIC_SCHEMA_VERSION) {
    fail('UNSUPPORTED_METRIC_SCHEMA', `metric schemaVersion must be ${METRIC_SCHEMA_VERSION}`);
  }
  for (const field of ['runId', 'projectId', 'skillId', 'metricName', 'entityKind', 'entityId']) {
    assertNonemptyString(metric[field], field, 256);
  }
  if (!SAFE_RUN_ID.test(metric.runId)) fail('INVALID_RUN_ID', 'metric runId is not path safe');
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    fail('INVALID_METRIC_VALUE', 'metric value must be a finite number');
  }
  if (metric.unit !== undefined) assertNonemptyString(metric.unit, 'unit', 128);
  if (!DIRECTIONS.has(metric.direction)) {
    fail('INVALID_METRIC_DIRECTION', `metric direction must be one of ${[...DIRECTIONS].join(', ')}`);
  }
  assertIsoTime(metric.observedAt, 'observedAt');
  if (
    !(
      (typeof metric.provenance === 'string' && metric.provenance.length > 0) ||
      isPlainObject(metric.provenance)
    )
  ) {
    fail('INVALID_METRIC_PROVENANCE', 'metric provenance must be a nonempty string or object');
  }
  assertJsonValue(metric.provenance, 'provenance');
  if (metric.dimensions !== undefined) {
    assertPlainObject(metric.dimensions, 'dimensions');
    for (const [key, value] of Object.entries(metric.dimensions)) {
      if (SECRET_DIMENSION_KEY.test(key)) {
        fail('SENSITIVE_METRIC_DIMENSION', `metric dimension key ${key} is credential-shaped`);
      }
      if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
        fail('INVALID_METRIC_DIMENSION', `metric dimension ${key} must be scalar`);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        fail('INVALID_METRIC_DIMENSION', `metric dimension ${key} must be finite`);
      }
    }
  }
  return metric;
}

export function validateRunEnvelope(run) {
  assertPlainObject(run, 'run');
  if (run.schemaVersion !== RUN_SCHEMA_VERSION) {
    fail('UNSUPPORTED_RUN_SCHEMA', `run schemaVersion must be ${RUN_SCHEMA_VERSION}`);
  }
  assertNonemptyString(run.runId, 'runId', 128);
  if (!SAFE_RUN_ID.test(run.runId)) fail('INVALID_RUN_ID', 'runId is not path safe');
  for (const field of ['skillId', 'projectId', 'idempotencyKey']) {
    assertNonemptyString(run[field], field);
  }
  if (run.skillVersion !== undefined) assertNonemptyString(run.skillVersion, 'skillVersion', 128);
  if (run.projectRoot !== undefined) assertNonemptyString(run.projectRoot, 'projectRoot', 4096);
  assertActorOrHost(run.actor, 'actor');
  assertActorOrHost(run.host, 'host');
  if (!RUN_SOURCES.has(run.source)) {
    fail('INVALID_SOURCE', `source must be one of ${[...RUN_SOURCES].join(', ')}`);
  }
  if (!CAPTURE_COMPLETENESS.has(run.captureCompleteness)) {
    fail(
      'INVALID_CAPTURE_COMPLETENESS',
      `captureCompleteness must be one of ${[...CAPTURE_COMPLETENESS].join(', ')}`,
    );
  }
  if (!RUN_STATUSES.has(run.status)) {
    fail('INVALID_STATUS', `status must be one of ${[...RUN_STATUSES].join(', ')}`);
  }
  for (const field of ['startedAt', 'finishedAt', 'observedAt']) assertIsoTime(run[field], field);
  if (Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
    fail('INVALID_TIMING', 'finishedAt cannot precede startedAt');
  }
  if (!Number.isFinite(run.durationMs) || run.durationMs < 0) {
    fail('INVALID_TIMING', 'durationMs must be a nonnegative finite number');
  }
  if (run.exitCode !== null && run.exitCode !== undefined && !Number.isSafeInteger(run.exitCode)) {
    fail('INVALID_EXIT_CODE', 'exitCode must be a safe integer or null');
  }
  if (run.correlationId !== undefined) assertNonemptyString(run.correlationId, 'correlationId');
  if (run.sourceReference !== undefined) {
    if (typeof run.sourceReference === 'string') {
      assertNonemptyString(run.sourceReference, 'sourceReference', 4096);
    } else {
      assertPlainObject(run.sourceReference, 'sourceReference');
      assertJsonValue(run.sourceReference, 'sourceReference');
    }
  }
  if (run.reconstructionConfidence !== undefined) {
    assertNonemptyString(run.reconstructionConfidence, 'reconstructionConfidence', 128);
  }
  if (run.metadata !== undefined) {
    assertPlainObject(run.metadata, 'metadata');
    assertJsonValue(run.metadata, 'metadata');
  }
  validateOutputMetadata(run.outputs ?? {});
  if (!Array.isArray(run.metrics)) fail('INVALID_METRICS', 'metrics must be an array');
  for (const metric of run.metrics) {
    validateMetricObservation(metric);
    if (
      metric.runId !== run.runId ||
      metric.projectId !== run.projectId ||
      metric.skillId !== run.skillId
    ) {
      fail('METRIC_LINK_MISMATCH', 'metric run, project, and skill ids must match the run envelope');
    }
  }
  return run;
}

function normalizeRunDraft(input, now) {
  assertPlainObject(input, 'run');
  const startedAt = input.startedAt ?? input.observedAt ?? now;
  const finishedAt = input.finishedAt ?? input.observedAt ?? now;
  const observedAt = input.observedAt ?? finishedAt;
  const idempotencyKey = input.idempotencyKey;
  assertNonemptyString(idempotencyKey, 'idempotencyKey');
  return {
    ...input,
    schemaVersion: input.schemaVersion ?? RUN_SCHEMA_VERSION,
    runId:
      input.runId ??
      `run_${digest(idempotencyKey).slice(0, 32)}`,
    actor: input.actor ?? 'unknown',
    host: input.host ?? hostname(),
    status: normalizeStatus(input.status ?? 'unknown'),
    startedAt,
    finishedAt,
    observedAt,
    durationMs: input.durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    exitCode: input.exitCode ?? null,
    outputs: {},
    metrics: [],
  };
}

function normalizeMetric(input, run) {
  assertPlainObject(input, 'metric');
  return {
    ...input,
    schemaVersion: input.schemaVersion ?? METRIC_SCHEMA_VERSION,
    runId: input.runId ?? run.runId,
    projectId: input.projectId ?? run.projectId,
    skillId: input.skillId ?? run.skillId,
    observedAt: input.observedAt ?? run.observedAt,
    dimensions: input.dimensions ?? {},
  };
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function writeOwnerFile(path, content, { exclusive = false } = {}) {
  writeFileSync(path, content, { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
  chmodSync(path, 0o600);
}

function assertInsideRoot(root, path) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('INVALID_STORE_PATH', `path escapes skill-run store: ${path}`);
  }
}

function walkRunJsonFiles(runsRoot) {
  if (!existsSync(runsRoot)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.tmp-')) visit(path);
      } else if (entry.isFile() && entry.name === 'run.json') {
        found.push(path);
      }
    }
  };
  visit(runsRoot);
  return found;
}

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseJsonLines(path) {
  if (!existsSync(path)) return { records: [], errors: [] };
  const records = [];
  const errors = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      errors.push(`${path}:${index + 1}: ${error.message}`);
    }
  });
  return { records, errors };
}

function atomicWrite(path, content) {
  ensureDirectory(dirname(path));
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeOwnerFile(temp, content, { exclusive: true });
    renameSync(temp, path);
    chmodSync(path, 0o600);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function canonicalSort(a, b) {
  return (
    Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
    a.runId.localeCompare(b.runId) ||
    (a.metricName ?? '').localeCompare(b.metricName ?? '')
  );
}

export class SkillRunStore {
  constructor({
    root,
    env = process.env,
    home,
    maxOutputBytes,
    maxBytesPerOutput,
  } = {}) {
    this.root = root ? resolve(root) : defaultSkillRunsRoot({ env, home });
    this.runsRoot = join(this.root, 'runs');
    this.indexPath = join(this.root, 'index.jsonl');
    this.metricsIndexPath = join(this.root, 'metrics.jsonl');
    this.maxOutputBytes =
      maxOutputBytes ?? maxBytesPerOutput ?? outputLimitFromEnvironment(env);
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) {
      fail('INVALID_OUTPUT_LIMIT', 'maxOutputBytes must be a positive safe integer');
    }
    ensureDirectory(this.root);
    ensureDirectory(this.runsRoot);
  }

  canonicalRunDirectory(run) {
    const date = new Date(run.observedAt);
    const directory = join(
      this.runsRoot,
      String(date.getUTCFullYear()).padStart(4, '0'),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      run.runId,
    );
    assertInsideRoot(this.runsRoot, directory);
    return directory;
  }

  scanCanonicalRuns({ includeInvalid = false } = {}) {
    const runs = [];
    const errors = [];
    for (const path of walkRunJsonFiles(this.runsRoot)) {
      try {
        const run = parseJsonFile(path);
        validateRunEnvelope(run);
        const expected = join(this.canonicalRunDirectory(run), 'run.json');
        if (resolve(path) !== resolve(expected)) {
          throw new Error(`noncanonical run path; expected ${expected}`);
        }
        runs.push(run);
      } catch (error) {
        errors.push({ path, error: error.message });
      }
    }
    runs.sort(canonicalSort);
    return includeInvalid ? { runs, errors } : runs;
  }

  findByIdempotencyKey(idempotencyKey) {
    return this.scanCanonicalRuns().find((run) => run.idempotencyKey === idempotencyKey) ?? null;
  }

  record({ run: runInput, stdout, stderr, output, metrics = [] } = {}) {
    const now = new Date().toISOString();
    const run = normalizeRunDraft(runInput, now);
    const duplicate = this.findByIdempotencyKey(run.idempotencyKey);
    if (duplicate) {
      return { run: duplicate, metrics: duplicate.metrics, duplicate: true, warnings: [] };
    }
    if (!Array.isArray(metrics)) fail('INVALID_METRICS', 'metrics must be an array');

    const runDirectory = this.canonicalRunDirectory(run);
    const relativeRunDirectory = relative(this.root, runDirectory);
    const artifacts = {};
    const inputs = { stdout, stderr, output };
    for (const [name, value] of Object.entries(inputs)) {
      if (value === undefined || value === null) continue;
      const sanitized = sanitizeOutput(value, { limitBytes: this.maxOutputBytes });
      artifacts[name] = {
        content: sanitized.content,
        metadata: {
          path: join(relativeRunDirectory, `${name === 'output' ? 'output.txt' : `${name}.log`}`),
          ...sanitized.metadata,
        },
      };
    }
    run.outputs = Object.fromEntries(
      Object.entries(artifacts).map(([name, artifact]) => [name, artifact.metadata]),
    );
    run.metrics = metrics.map((metric) => normalizeMetric(metric, run));
    validateRunEnvelope(run);

    ensureDirectory(dirname(runDirectory));
    const tempDirectory = mkdtempSync(join(dirname(runDirectory), `.tmp-${run.runId}-`));
    chmodSync(tempDirectory, 0o700);
    try {
      for (const [name, artifact] of Object.entries(artifacts)) {
        const filename = name === 'output' ? 'output.txt' : `${name}.log`;
        writeOwnerFile(join(tempDirectory, filename), artifact.content, { exclusive: true });
      }
      writeOwnerFile(
        join(tempDirectory, 'run.json'),
        `${JSON.stringify(run, null, 2)}\n`,
        { exclusive: true },
      );
      try {
        renameSync(tempDirectory, runDirectory);
      } catch (error) {
        if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
          const existing = parseJsonFile(join(runDirectory, 'run.json'));
          if (existing.idempotencyKey === run.idempotencyKey) {
            return { run: existing, metrics: existing.metrics, duplicate: true, warnings: [] };
          }
          fail('RUN_ID_CONFLICT', `run id ${run.runId} already exists`);
        }
        throw error;
      }
    } finally {
      if (existsSync(tempDirectory)) rmSync(tempDirectory, { recursive: true, force: true });
    }

    const warnings = [];
    try {
      appendFileSync(this.indexPath, `${JSON.stringify(run)}\n`, { encoding: 'utf8', mode: 0o600 });
      chmodSync(this.indexPath, 0o600);
      if (run.metrics.length > 0) {
        appendFileSync(
          this.metricsIndexPath,
          `${run.metrics.map((metric) => JSON.stringify(metric)).join('\n')}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
        chmodSync(this.metricsIndexPath, 0o600);
      }
    } catch (error) {
      warnings.push(`run was stored but indexes need rebuild: ${error.message}`);
    }
    return { run, metrics: run.metrics, duplicate: false, warnings };
  }

  list({
    projectId,
    skillId,
    source,
    status,
    since,
    until,
    limit = Number.POSITIVE_INFINITY,
    order = 'desc',
  } = {}) {
    if (!(limit === Number.POSITIVE_INFINITY || (Number.isSafeInteger(limit) && limit >= 0))) {
      fail('INVALID_LIMIT', 'limit must be a nonnegative safe integer');
    }
    const { records, errors } = parseJsonLines(this.indexPath);
    if (errors.length > 0) fail('MALFORMED_INDEX', errors.join('; '));
    const seen = new Set();
    const runs = [];
    for (const run of records) {
      validateRunEnvelope(run);
      if (seen.has(run.runId)) continue;
      seen.add(run.runId);
      if (projectId && run.projectId !== projectId) continue;
      if (skillId && run.skillId !== skillId) continue;
      if (source && run.source !== source) continue;
      if (status && run.status !== status) continue;
      if (since && Date.parse(run.observedAt) < Date.parse(since)) continue;
      if (until && Date.parse(run.observedAt) > Date.parse(until)) continue;
      runs.push(run);
    }
    runs.sort(canonicalSort);
    if (order === 'desc') runs.reverse();
    else if (order !== 'asc') fail('INVALID_ORDER', 'order must be asc or desc');
    return runs.slice(0, limit);
  }

  show(runId) {
    assertNonemptyString(runId, 'runId', 128);
    if (!SAFE_RUN_ID.test(runId)) fail('INVALID_RUN_ID', 'runId is not path safe');
    const run = this.scanCanonicalRuns().find((candidate) => candidate.runId === runId);
    if (!run) fail('RUN_NOT_FOUND', `run ${runId} was not found`);
    return run;
  }

  output(runId, stream = 'output') {
    if (!OUTPUT_NAMES.has(stream)) fail('INVALID_OUTPUT', `unsupported output stream ${stream}`);
    const run = this.show(runId);
    const metadata = run.outputs[stream];
    if (!metadata) fail('OUTPUT_NOT_FOUND', `run ${runId} has no ${stream} output`);
    const path = resolve(this.root, metadata.path);
    assertInsideRoot(this.root, path);
    return readFileSync(path, 'utf8');
  }

  metrics({ projectId, skillId, metricName, unit, direction, entityKind, entityId } = {}) {
    const { records, errors } = parseJsonLines(this.metricsIndexPath);
    if (errors.length > 0) fail('MALFORMED_METRICS_INDEX', errors.join('; '));
    return records
      .map((metric) => validateMetricObservation(metric))
      .filter((metric) => !projectId || metric.projectId === projectId)
      .filter((metric) => !skillId || metric.skillId === skillId)
      .filter((metric) => !metricName || metric.metricName === metricName)
      .filter((metric) => !unit || metric.unit === unit)
      .filter((metric) => !direction || metric.direction === direction)
      .filter((metric) => !entityKind || metric.entityKind === entityKind)
      .filter((metric) => !entityId || metric.entityId === entityId)
      .sort(canonicalSort);
  }

  status() {
    const runs = this.scanCanonicalRuns();
    const metrics = runs.flatMap((run) => run.metrics);
    let outputBytes = 0;
    for (const run of runs) {
      for (const output of Object.values(run.outputs)) outputBytes += output.storedBytes;
    }
    let totalBytes = 0;
    const visit = (path) => {
      if (!existsSync(path)) return;
      const stat = lstatSync(path);
      if (stat.isFile()) {
        totalBytes += stat.size;
        return;
      }
      if (stat.isDirectory()) {
        for (const entry of readdirSync(path)) visit(join(path, entry));
      }
    };
    visit(this.root);
    return {
      schemaVersion: 'fleet.skill-run-status.v1',
      root: this.root,
      runCount: runs.length,
      metricCount: metrics.length,
      outputBytes,
      totalBytes,
      oldestRunAt: runs[0]?.observedAt ?? null,
      newestRunAt: runs.at(-1)?.observedAt ?? null,
    };
  }

  doctor() {
    const errors = [];
    const warnings = [];
    const canonical = this.scanCanonicalRuns({ includeInvalid: true });
    errors.push(...canonical.errors.map(({ path, error }) => `${path}: ${error}`));
    const runsById = new Map(canonical.runs.map((run) => [run.runId, run]));
    const metrics = canonical.runs.flatMap((run) => run.metrics);

    for (const run of canonical.runs) {
      const runDirectory = this.canonicalRunDirectory(run);
      for (const [name, metadata] of Object.entries(run.outputs)) {
        const path = resolve(this.root, metadata.path);
        try {
          assertInsideRoot(runDirectory, path);
          const content = readFileSync(path);
          if (content.length !== metadata.storedBytes) {
            errors.push(`${path}: stored byte count does not match run.json`);
          }
          if (digest(content) !== metadata.sha256) {
            errors.push(`${path}: SHA-256 does not match run.json`);
          }
          if ((statSync(path).mode & 0o077) !== 0) errors.push(`${path}: file is not owner-only`);
        } catch (error) {
          errors.push(`${path}: ${error.message}`);
        }
      }
      if ((statSync(runDirectory).mode & 0o077) !== 0) {
        errors.push(`${runDirectory}: directory is not owner-only`);
      }
    }

    const runIndex = parseJsonLines(this.indexPath);
    errors.push(...runIndex.errors);
    const indexedRunIds = new Set();
    for (const run of runIndex.records) {
      try {
        validateRunEnvelope(run);
        if (indexedRunIds.has(run.runId)) errors.push(`duplicate run index entry: ${run.runId}`);
        indexedRunIds.add(run.runId);
        if (!runsById.has(run.runId)) errors.push(`run index references missing run: ${run.runId}`);
      } catch (error) {
        errors.push(`invalid run index entry: ${error.message}`);
      }
    }
    for (const runId of runsById.keys()) {
      if (!indexedRunIds.has(runId)) errors.push(`run missing from index: ${runId}`);
    }

    const metricIndex = parseJsonLines(this.metricsIndexPath);
    errors.push(...metricIndex.errors);
    const canonicalMetricFingerprints = new Set(metrics.map(stableJson));
    const indexedMetricFingerprints = new Set();
    for (const metric of metricIndex.records) {
      try {
        validateMetricObservation(metric);
        const fingerprint = stableJson(metric);
        if (indexedMetricFingerprints.has(fingerprint)) errors.push('duplicate metric index entry');
        indexedMetricFingerprints.add(fingerprint);
        if (!canonicalMetricFingerprints.has(fingerprint)) {
          errors.push(`metric index references a noncanonical observation for run ${metric.runId}`);
        }
      } catch (error) {
        errors.push(`invalid metric index entry: ${error.message}`);
      }
    }
    for (const fingerprint of canonicalMetricFingerprints) {
      if (!indexedMetricFingerprints.has(fingerprint)) errors.push('canonical metric missing from index');
    }

    for (const path of [this.root, this.runsRoot, this.indexPath, this.metricsIndexPath]) {
      if (existsSync(path) && (statSync(path).mode & 0o077) !== 0) {
        errors.push(`${path}: path is not owner-only`);
      }
    }

    return {
      schemaVersion: 'fleet.skill-run-doctor.v1',
      healthy: errors.length === 0,
      runCount: canonical.runs.length,
      metricCount: metrics.length,
      errors,
      warnings,
    };
  }

  rebuild() {
    const canonical = this.scanCanonicalRuns({ includeInvalid: true });
    if (canonical.errors.length > 0) {
      fail(
        'INVALID_CANONICAL_RUN',
        canonical.errors.map(({ path, error }) => `${path}: ${error}`).join('; '),
      );
    }
    const runs = canonical.runs.sort(canonicalSort);
    const metrics = runs.flatMap((run) => run.metrics).sort(canonicalSort);
    atomicWrite(
      this.indexPath,
      runs.length > 0 ? `${runs.map((run) => JSON.stringify(run)).join('\n')}\n` : '',
    );
    atomicWrite(
      this.metricsIndexPath,
      metrics.length > 0 ? `${metrics.map((metric) => JSON.stringify(metric)).join('\n')}\n` : '',
    );
    return {
      schemaVersion: 'fleet.skill-run-rebuild.v1',
      runCount: runs.length,
      metricCount: metrics.length,
    };
  }
}

function asStore(storeOrOptions) {
  return storeOrOptions instanceof SkillRunStore
    ? storeOrOptions
    : new SkillRunStore(storeOrOptions ?? {});
}

export function recordSkillRun(storeOrOptions, request) {
  return asStore(storeOrOptions).record(request);
}

export function listSkillRuns(storeOrOptions, filters) {
  return asStore(storeOrOptions).list(filters);
}

export function readSkillRunOutput(storeOrOptions, runId, stream) {
  return asStore(storeOrOptions).output(runId, stream);
}

export function querySkillMetrics(storeOrOptions, filters) {
  return asStore(storeOrOptions).metrics(filters);
}

export function skillRunStatus(storeOrOptions) {
  return asStore(storeOrOptions).status();
}

export function doctorSkillRunStore(storeOrOptions) {
  return asStore(storeOrOptions).doctor();
}

export function rebuildSkillRunIndexes(storeOrOptions) {
  return asStore(storeOrOptions).rebuild();
}
