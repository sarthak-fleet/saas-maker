/**
 * Sanitized evidence envelope and freshness evaluation for the Significant
 * Hobbies Toolbox family.
 *
 * The envelope is the only shape that ever leaves a child product and enters
 * a fleet/Foundry report. It carries:
 *   - productId, domain, runtime, revision
 *   - build / live / indexing / errors status (each pass|fail|unknown|not-applicable)
 *   - activation: { type, status: pass|fail|unknown|not-applicable, count?, freshness? }
 *   - backgroundJobs: [{ id, cadence, lastSuccess?, lastFailure?, status, stale }]
 *   - redacted: boolean (true when the builder removed a private payload)
 *
 * It never carries:
 *   - article bodies, PDF content, annotations, AI prompts/completions
 *   - personal watchlists, saved searches, collections contents
 *   - learning answers, drill submissions, notes, per-user progress
 *   - saved games, PGN move history, coaching conversation bodies
 *   - daily journal bodies, habit checkin answers, private notes
 *   - localStorage watched state, credentials, user-identifying state
 *
 * The redactor enforces this by category. Callers pass raw evidence with a
 * `privateCategories` array (from the registry); any field whose key matches
 * a private category is dropped and the envelope is marked `redacted: true`.
 */
import { CADENCES } from './registry.mjs';

export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNKNOWN: 'unknown',
  NOT_APPLICABLE: 'not-applicable',
  PASS_WITH_CHILD_FAILURES: 'pass-with-child-failures',
});

const PRIVATE_PAYLOAD_KEYS = new Set([
  'article-bodies',
  'pdf-content',
  'annotations',
  'ai-chat-prompts',
  'ai-chat-completions',
  'ai-prompts',
  'ai-completions',
  'retrieved-chunks',
  'user-library-contents',
  'personal-watchlists',
  'saved-searches',
  'collections-contents',
  'learning-answers',
  'drill-submissions',
  'notes',
  'progress-per-user',
  'saved-games',
  'pgn-move-history',
  'coaching-conversation-bodies',
  'localStorage-state',
  'watched-state-localStorage',
  'daily-journal-bodies',
  'habit-checkin-answers',
  'private-notes',
  'user-identifying-state',
  'credentials',
]);

/**
 * Build a sanitized child evidence envelope from a raw evidence input.
 *
 * @param {object} registry validated registry
 * @param {string} productId
 * @param {object} rawEvidence
 *   - revision?: string
 *   - build?: { status, detail? }
 *   - live?: { status, detail? }
 *   - indexing?: { status, detail? }
 *   - errors?: { status, detail? }
 *   - activation?: { status, count?, detail? }
 *   - backgroundJobs?: [{ id, lastSuccess?, lastFailure?, detail? }]
 *   - private?: object — any keys matching the product's excludedCategories
 * @param {string|Date} [now]
 * @returns {object} sanitized envelope
 */
export function buildChildEvidence(registry, productId, rawEvidence, now = new Date()) {
  const product = registry.products.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`unknown product id: ${productId}`);
  }
  const raw = rawEvidence ?? {};
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('now must be a valid date or ISO string');
  }

  const envelope = {
    schema: 'fleet.toolbox-evidence.v1',
    productId,
    name: product.name,
    domain: product.domain,
    runtime: product.runtime,
    revision: sanitizeString(raw.revision),
    build: normalizeStatusBlock(raw.build),
    live: normalizeStatusBlock(raw.live),
    indexing: normalizeStatusBlock(raw.indexing),
    errors: normalizeStatusBlock(raw.errors),
    activation: normalizeActivation(raw.activation, product.activation),
    backgroundJobs: normalizeBackgroundJobs(raw.backgroundJobs, product.backgroundJobs, nowMs),
    redacted: false,
    generatedAt: new Date(nowMs).toISOString(),
  };

  // Privacy redaction: drop any private-category key from the raw input and
  // mark the envelope redacted. The raw private payload is never copied.
  if (raw.private && typeof raw.private === 'object') {
    const excluded = new Set(product.privacy.excludedCategories);
    const dropped = [];
    for (const key of Object.keys(raw.private)) {
      if (excluded.has(key) || PRIVATE_PAYLOAD_KEYS.has(key)) {
        dropped.push(key);
      }
    }
    if (dropped.length > 0) {
      envelope.redacted = true;
      envelope.redactedCategories = dropped;
    }
  }

  return envelope;
}

/**
 * Build a family-level snapshot from per-child envelopes. A failure in one
 * child does NOT mark the family failed — the family status is the worst
 * non-failed status across children, with `failed` only when ALL children
 * fail. The snapshot always preserves per-child status.
 *
 * @param {object} registry validated registry
 * @param {Array<object>} childEnvelopes
 * @param {object} [options]
 * @param {string|Date} [options.now]
 * @returns {object}
 */
export function buildFamilySnapshot(registry, childEnvelopes, options = {}) {
  const now = options.now ? (typeof options.now === 'string' ? Date.parse(options.now) : options.now.getTime()) : Date.now();
  const envelopes = Array.isArray(childEnvelopes) ? childEnvelopes : [];

  const expected = new Set(registry.products.map((p) => p.id));
  const seen = new Set(envelopes.map((e) => e.productId));
  const missing = [...expected].filter((id) => !seen.has(id));

  const perChild = {};
  for (const env of envelopes) {
    perChild[env.productId] = summarizeChildStatus(env);
  }
  for (const id of missing) {
    perChild[id] = { status: STATUS.UNKNOWN, reason: 'missing-evidence' };
  }

  const statuses = Object.values(perChild).map((s) => s.status);
  const failing = statuses.filter((s) => s === STATUS.FAIL);
  const familyStatus =
    failing.length === statuses.length
      ? STATUS.FAIL
      : failing.length > 0
        ? STATUS.PASS_WITH_CHILD_FAILURES
        : statuses.includes('stale')
          ? 'stale'
          : statuses.includes(STATUS.UNKNOWN)
            ? STATUS.UNKNOWN
            : statuses.every((status) => status === STATUS.NOT_APPLICABLE)
              ? STATUS.NOT_APPLICABLE
              : STATUS.PASS;

  const digest = buildDigest(registry, perChild);

  return {
    schema: 'fleet.toolbox-family-snapshot.v1',
    family: registry.family.id,
    generatedAt: new Date(now).toISOString(),
    familyStatus,
    oneChildFailureDoesNotMarkFamilyFailed: registry.digest.oneChildFailureDoesNotMarkFamilyFailed,
    perChild,
    digest,
    missing,
    childCount: registry.products.length,
    envelopeCount: envelopes.length,
  };
}

/**
 * Evaluate whether a background job is fresh, stale, or unknown relative to
 * its declared cadence. A quarterly job is NOT stale merely because no daily
 * run exists — see spec scenario "Quarterly job is within cadence".
 *
 * @param {object} job registry job (with cadence + declaredFreshnessDays)
 * @param {object} observed { lastSuccess?: string|Date, lastFailure?: string|Date }
 * @param {string|Date} [now]
 * @returns {{ status: 'pass'|'fail'|'stale'|'unknown', lastSuccess?: string, lastFailure?: string, ageDays?: number, freshnessWindowDays: number }}
 */
export function evaluateFreshness(job, observed, now = new Date()) {
  if (!job || !Number.isSafeInteger(job.declaredFreshnessDays)) {
    throw new TypeError('job must declare declaredFreshnessDays');
  }
  const nowMs = typeof now === 'number'
    ? now
    : typeof now === 'string'
      ? Date.parse(now)
      : now.getTime();
  const lastSuccessMs = observed?.lastSuccess
    ? typeof observed.lastSuccess === 'string'
      ? Date.parse(observed.lastSuccess)
      : observed.lastSuccess.getTime()
    : null;
  const lastFailureMs = observed?.lastFailure
    ? typeof observed.lastFailure === 'string'
      ? Date.parse(observed.lastFailure)
      : observed.lastFailure.getTime()
    : null;

  const result = {
    status: STATUS.UNKNOWN,
    freshnessWindowDays: job.declaredFreshnessDays,
    cadence: job.cadence,
  };
  if (lastSuccessMs && Number.isFinite(lastSuccessMs)) {
    result.lastSuccess = new Date(lastSuccessMs).toISOString();
    const ageDays = Math.max(0, Math.floor((nowMs - lastSuccessMs) / 86_400_000));
    result.ageDays = ageDays;
    if (ageDays <= job.declaredFreshnessDays) {
      result.status = STATUS.PASS;
    } else {
      result.status = 'stale';
    }
  }
  if (lastFailureMs && Number.isFinite(lastFailureMs)) {
    result.lastFailure = new Date(lastFailureMs).toISOString();
    // An unresolved failure within the freshness window is a fail regardless
    // of how recently the last success happened.
    if (!lastSuccessMs || lastFailureMs > lastSuccessMs) {
      result.status = STATUS.FAIL;
    }
  }
  return result;
}

/**
 * Verify that a candidate evidence object contains no private payloads. Used
 * by privacy tests and by the redactor's second line of defense. Returns the
 * list of offending keys (empty when clean).
 *
 * @param {object} candidate
 * @param {string[]} [extraCategories] additional product-specific categories
 * @returns {string[]}
 */
export function findPrivatePayloadLeaks(candidate, extraCategories = []) {
  const forbidden = new Set([...PRIVATE_PAYLOAD_KEYS, ...extraCategories]);
  const leaks = [];
  walk(candidate, '', (key, value, path) => {
    if (forbidden.has(key)) {
      leaks.push(path);
    }
    // Heuristic: catch obvious credential-shaped values.
    if (typeof value === 'string' &&
        /^(pk_|sk_|Bearer |ghp_|gho_|xoxb-|AKIA)/.test(value)) {
      leaks.push(`${path} (credential-shaped value)`);
    }
  });
  return leaks;
}

function walk(value, path, visit) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v, path ? `${path}.${k}` : k);
      walk(v, path ? `${path}.${k}` : k, visit);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  }
}

function normalizeStatusBlock(input) {
  if (!input) return { status: STATUS.UNKNOWN };
  const status = validStatus(input.status) ? input.status : STATUS.UNKNOWN;
  const out = { status };
  if (typeof input.detail === 'string' && input.detail.trim()) {
    out.detail = sanitizeString(input.detail);
  }
  return out;
}

function normalizeActivation(input, declared) {
  if (declared.notApplicable) {
    return {
      type: declared.type,
      status: STATUS.NOT_APPLICABLE,
      definition: declared.definition,
    };
  }
  if (!input) return { type: declared.type, status: STATUS.UNKNOWN, definition: declared.definition };
  const status = validStatus(input.status) ? input.status : STATUS.UNKNOWN;
  const out = {
    type: declared.type,
    status,
    definition: declared.definition,
  };
  if (typeof input.count === 'number' && Number.isFinite(input.count)) {
    out.count = Math.max(0, Math.floor(input.count));
  }
  if (typeof input.detail === 'string' && input.detail.trim()) {
    out.detail = sanitizeString(input.detail);
  }
  return out;
}

function normalizeBackgroundJobs(input, declaredJobs, nowMs) {
  const declared = new Map((declaredJobs ?? []).map((j) => [j.id, j]));
  const observed = new Map((Array.isArray(input) ? input : []).map((j) => [j?.id, j]));
  const out = [];
  for (const [id, declaredJob] of declared) {
    const observedJob = observed.get(id) ?? {};
    const freshness = evaluateFreshness(declaredJob, observedJob, nowMs);
    out.push({
      id,
      cadence: declaredJob.cadence,
      freshnessWindowDays: declaredJob.declaredFreshnessDays,
      status: freshness.status,
      lastSuccess: freshness.lastSuccess,
      lastFailure: freshness.lastFailure,
      ageDays: freshness.ageDays,
    });
  }
  // Surface any observed job ids that are not in the registry — these are
  // drift, not evidence.
  for (const [id, observedJob] of observed) {
    if (!declared.has(id) && id) {
      out.push({
        id,
        cadence: 'on-demand',
        status: STATUS.UNKNOWN,
        drift: true,
      });
    }
  }
  return out;
}

function summarizeChildStatus(env) {
  const blocks = [env.build, env.live, env.indexing, env.errors, env.activation];
  const jobStatuses = (env.backgroundJobs ?? []).map((j) => j.status);
  const all = [...blocks.map((b) => b?.status).filter(Boolean), ...jobStatuses];
  if (all.includes(STATUS.FAIL)) {
    return { status: STATUS.FAIL, reason: 'one-or-more-blocks-failed' };
  }
  if (all.includes('stale')) {
    return { status: 'stale', reason: 'background-job-stale' };
  }
  if (all.includes(STATUS.UNKNOWN)) {
    return { status: STATUS.UNKNOWN, reason: 'evidence-incomplete' };
  }
  if (all.length === 0 || all.every((s) => s === STATUS.NOT_APPLICABLE)) {
    return { status: STATUS.NOT_APPLICABLE, reason: 'no-applicable-contracts' };
  }
  return { status: STATUS.PASS };
}

function buildDigest(registry, perChild) {
  const failing = [];
  const stale = [];
  const unknown = [];
  for (const [id, summary] of Object.entries(perChild)) {
    if (summary.status === STATUS.FAIL) failing.push(id);
    else if (summary.status === 'stale') stale.push(id);
    else if (summary.status === STATUS.UNKNOWN) unknown.push(id);
  }
  const pageOnlyOn = new Set(registry.digest.pageOnlyOn);
  const page = failing.length > 0 && failing.some((id) => {
    // Only page when a child failure looks like data/security risk or
    // prolonged outage. Routine Toolbox failures are deduplicated.
    return pageOnlyOn.has('data-risk') || pageOnlyOn.has('security-risk') || pageOnlyOn.has('prolonged-outage');
  }) && failing.length === registry.products.length;
  return {
    policy: registry.digest.policy,
    failing,
    stale,
    unknown,
    page,
    deduplicated: failing.length > 0 && !page,
  };
}

function validStatus(s) {
  return s === STATUS.PASS || s === STATUS.FAIL || s === STATUS.UNKNOWN || s === STATUS.NOT_APPLICABLE;
}

function sanitizeString(s) {
  if (typeof s !== 'string') return undefined;
  const trimmed = s.trim();
  return trimmed ? trimmed.slice(0, 280) : undefined;
}
