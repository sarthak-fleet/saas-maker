import { randomUUID } from 'node:crypto';

const EVENT_SCHEMA_VERSION = 1;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_EVIDENCE_POINTERS = 20;
const MAX_STRING_LENGTH = 2_000;

const EVENT_TYPES = new Set([
  'project.registered',
  'objective.created',
  'evidence.recorded',
  'evidence.stale',
  'deliverable.recorded',
  'outcome.recorded',
  'actor.status-recorded',
  'schedule.recorded',
  'visibility.run-recorded',
  'event.corrected',
]);

const ACTOR_TYPES = new Set(['owner', 'agent', 'automation', 'provider']);
const VISIBILITY_CLASSES = new Set(['private', 'aggregate-public']);
const EVIDENCE_STATES = new Set(['verified', 'unverified', 'stale', 'unavailable']);

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
const unsafeKeyPattern =
  /(?:^|_)(?:secret|token|password|authorization|cookie|api[_-]?key|private[_-]?key|raw[_-]?(?:body|payload|trace|log)|prompt|transcript|request[_-]?parameters?)(?:$|_)/i;

const requiredPayloadFields = {
  'project.registered': ['name', 'attention'],
  'objective.created': ['title', 'outcome'],
  'deliverable.recorded': ['title', 'kind'],
  'outcome.recorded': ['verdict', 'summary'],
  'actor.status-recorded': ['state', 'freshUntil'],
  'schedule.recorded': ['name', 'enabled', 'nextRunAt'],
  'visibility.run-recorded': ['runId', 'promptSetId', 'coverage', 'cost', 'metrics', 'citations', 'attempts'],
  'event.corrected': ['eventId', 'reason'],
};

export class FounderControlValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FounderControlValidationError';
    this.code = code;
  }
}

function assert(condition, code, message) {
  if (!condition) throw new FounderControlValidationError(code, message);
}

function assertIdentifier(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return;
  assert(typeof value === 'string' && identifierPattern.test(value), 'INVALID_IDENTIFIER', `${field} is invalid`);
}

function assertIsoDate(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return;
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'INVALID_TIMESTAMP', `${field} must be ISO-8601`);
}

function assertSafeValue(value, path = 'payload', depth = 0) {
  assert(depth <= 6, 'PAYLOAD_TOO_DEEP', `${path} exceeds maximum nesting`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'INVALID_NUMBER', `${path} must be finite`);
    return;
  }
  if (typeof value === 'string') {
    assert(value.length <= MAX_STRING_LENGTH, 'STRING_TOO_LONG', `${path} exceeds ${MAX_STRING_LENGTH} characters`);
    return;
  }
  if (Array.isArray(value)) {
    assert(value.length <= 100, 'ARRAY_TOO_LONG', `${path} exceeds 100 entries`);
    value.forEach((entry, index) => assertSafeValue(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  assert(value && typeof value === 'object', 'INVALID_PAYLOAD_VALUE', `${path} contains an unsupported value`);
  for (const [key, entry] of Object.entries(value)) {
    assert(!unsafeKeyPattern.test(key), 'PRIVATE_PAYLOAD_FIELD', `${path}.${key} is not allowed`);
    assertSafeValue(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeActor(actor) {
  assert(actor && typeof actor === 'object', 'ACTOR_REQUIRED', 'actor is required');
  assert(ACTOR_TYPES.has(actor.type), 'INVALID_ACTOR_TYPE', `unsupported actor type: ${actor.type}`);
  assertIdentifier(actor.id, 'actor.id');
  if (actor.label !== undefined) {
    assert(typeof actor.label === 'string', 'INVALID_ACTOR_LABEL', 'actor.label must be a string');
    assertSafeValue(actor.label, 'actor.label');
  }
  return { type: actor.type, id: actor.id, ...(actor.label ? { label: actor.label } : {}) };
}

function normalizeEvidence(pointer) {
  assert(pointer && typeof pointer === 'object', 'INVALID_EVIDENCE', 'evidence pointer must be an object');
  for (const field of ['provider', 'kind', 'id']) assertIdentifier(pointer[field], `evidence.${field}`);
  assert(EVIDENCE_STATES.has(pointer.state), 'INVALID_EVIDENCE_STATE', `unsupported evidence state: ${pointer.state}`);
  assertIsoDate(pointer.observedAt, 'evidence.observedAt');
  assertIsoDate(pointer.freshUntil, 'evidence.freshUntil', { optional: true });
  if (pointer.url !== undefined) {
    let parsedUrl;
    try {
      parsedUrl = new URL(pointer.url);
    } catch {
      throw new FounderControlValidationError('INVALID_EVIDENCE_URL', 'evidence URL must be valid HTTP(S)');
    }
    assert(['http:', 'https:'].includes(parsedUrl.protocol), 'INVALID_EVIDENCE_URL', 'evidence URL must use HTTP(S)');
    assert(!parsedUrl.username && !parsedUrl.password, 'PRIVATE_EVIDENCE_URL', 'evidence URL must not contain credentials');
    for (const key of parsedUrl.searchParams.keys()) {
      assert(!unsafeKeyPattern.test(key), 'PRIVATE_EVIDENCE_URL', 'evidence URL must not contain credential parameters');
    }
  }
  if (pointer.summary !== undefined) assertSafeValue(pointer.summary, 'evidence.summary');
  if (pointer.confidence !== undefined) {
    assert(Number.isFinite(pointer.confidence) && pointer.confidence >= 0 && pointer.confidence <= 1, 'INVALID_CONFIDENCE', 'confidence must be 0–1');
  }
  return {
    provider: pointer.provider,
    kind: pointer.kind,
    id: pointer.id,
    state: pointer.state,
    observedAt: pointer.observedAt,
    ...(pointer.freshUntil ? { freshUntil: pointer.freshUntil } : {}),
    ...(pointer.url ? { url: pointer.url } : {}),
    ...(pointer.summary ? { summary: pointer.summary } : {}),
    ...(pointer.confidence !== undefined ? { confidence: pointer.confidence } : {}),
  };
}

export function normalizeEvent(input, { now = new Date().toISOString() } = {}) {
  assert(input && typeof input === 'object', 'EVENT_REQUIRED', 'event input is required');
  assert(EVENT_TYPES.has(input.type), 'INVALID_EVENT_TYPE', `unsupported event type: ${input.type}`);
  const eventId = input.id ?? randomUUID();
  assertIdentifier(eventId, 'id');
  assertIdentifier(input.idempotencyKey, 'idempotencyKey');
  for (const field of ['projectId', 'objectiveId', 'correlationId']) {
    assertIdentifier(input[field], field, { optional: true });
  }

  const occurredAt = input.occurredAt ?? now;
  assertIsoDate(occurredAt, 'occurredAt');
  assertIsoDate(now, 'recordedAt');
  const visibility = input.visibility ?? 'private';
  assert(VISIBILITY_CLASSES.has(visibility), 'INVALID_VISIBILITY', `unsupported visibility: ${visibility}`);
  const payload = input.payload ?? {};
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_PAYLOAD', 'payload must be an object');
  for (const field of requiredPayloadFields[input.type] ?? []) {
    assert(payload[field] !== undefined, 'MISSING_PAYLOAD_FIELD', `${input.type} requires payload.${field}`);
  }
  assertSafeValue(payload);
  if (input.type === 'outcome.recorded') {
    assert(
      ['supported', 'unsupported', 'mixed', 'not-yet-measurable'].includes(payload.verdict),
      'INVALID_OUTCOME_VERDICT',
      'unsupported outcome verdict',
    );
  }

  const evidence = (input.evidence ?? []).map(normalizeEvidence);
  assert(evidence.length <= MAX_EVIDENCE_POINTERS, 'TOO_MUCH_EVIDENCE', `event exceeds ${MAX_EVIDENCE_POINTERS} evidence pointers`);

  const event = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: eventId,
    type: input.type,
    occurredAt,
    recordedAt: now,
    actor: normalizeActor(input.actor),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    idempotencyKey: input.idempotencyKey,
    visibility,
    payload: structuredClone(payload),
    evidence,
  };
  assert(Buffer.byteLength(JSON.stringify(event)) <= MAX_EVENT_BYTES, 'EVENT_TOO_LARGE', `event exceeds ${MAX_EVENT_BYTES} bytes`);
  return event;
}

export function redactForExport(value) {
  if (Array.isArray(value)) return value.map(redactForExport);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      unsafeKeyPattern.test(key) ? [] : [[key, redactForExport(entry)]],
    ),
  );
}
