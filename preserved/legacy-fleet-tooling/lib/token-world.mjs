const FORBIDDEN_KEYS = new Set([
  'prompt', 'completion', 'body', 'headers', 'cookies', 'userId', 'user_id',
  'email', 'ip', 'ipAddress', 'latitude', 'longitude', 'coordinates',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function buildTokenWorldProjection(seed, previous = null, options = {}) {
  validateSeed(seed);
  if (previous) validateProjection(previous);

  const sameDay = previous?.snapshotDate === seed.snapshotDate;
  if (sameDay && previous.lifetimeTokens !== seed.lifetimeTokens && !options.correctionNote) {
    throw new Error('snapshot conflicts with the already published snapshot for this date');
  }
  const previousLifetime = sameDay
    ? previous.previousLifetimeTokens
    : previous?.lifetimeTokens ?? Math.max(0, seed.lifetimeTokens - seed.todayTokens);
  const correction = seed.lifetimeTokens < previousLifetime;
  if (correction && !options.correctionNote) {
    throw new Error('lifetimeTokens cannot decrease without --correction-note');
  }
  if (previous && seed.snapshotDate < previous.snapshotDate) {
    throw new Error('snapshotDate cannot precede the published snapshot');
  }

  const projectTotal = seed.projects.reduce((sum, project) => sum + project.tokens, 0);
  if (projectTotal !== seed.lifetimeTokens) {
    throw new Error(`project token sum ${projectTotal} does not equal lifetimeTokens ${seed.lifetimeTokens}`);
  }

  const publicPulses = seed.pulses
    .filter((pulse) => pulse.events >= seed.publicAggregationFloor)
    .map((pulse) => ({
      project: pulse.project,
      country: pulse.country,
      locality: pulse.locality || null,
      tokens: roundForPublic(pulse.tokens),
      day: seed.snapshotDate,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.project.localeCompare(b.project))
    .slice(0, 12);

  const countries = new Set(publicPulses.map((pulse) => pulse.country));
  return {
    schemaVersion: 1,
    snapshotDate: seed.snapshotDate,
    lastUpdatedAt: seed.lastUpdatedAt,
    previousLifetimeTokens: correction ? seed.lifetimeTokens : Math.min(previousLifetime, seed.lifetimeTokens),
    lifetimeTokens: seed.lifetimeTokens,
    todayTokens: seed.todayTokens,
    countriesServed: countries.size,
    projectsContributing: seed.projects.filter((project) => project.tokens > 0).length,
    coverage: seed.coverage,
    pulses: publicPulses,
  };
}

function validateSeed(seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('seed must be an object');
  rejectForbiddenKeys(seed);
  expectExactKeys(seed, [
    'schemaVersion', 'snapshotDate', 'lastUpdatedAt', 'authoritative', 'lifetimeTokens', 'todayTokens',
    'publicAggregationFloor', 'coverage', 'projects', 'pulses', 'provenance',
  ], 'seed');
  if (seed.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (!DATE_RE.test(seed.snapshotDate)) throw new Error('snapshotDate must be YYYY-MM-DD');
  if (!ISO_TIMESTAMP_RE.test(seed.lastUpdatedAt) || Number.isNaN(Date.parse(seed.lastUpdatedAt))) {
    throw new Error('lastUpdatedAt must be an ISO timestamp with an explicit timezone');
  }
  if (seed.authoritative !== true) throw new Error('seed must be explicitly authoritative');
  expectCount(seed.lifetimeTokens, 'lifetimeTokens');
  expectCount(seed.todayTokens, 'todayTokens');
  if (seed.todayTokens > seed.lifetimeTokens) throw new Error('todayTokens cannot exceed lifetimeTokens');
  if (!Number.isInteger(seed.publicAggregationFloor) || seed.publicAggregationFloor < 2) {
    throw new Error('publicAggregationFloor must be an integer of at least 2');
  }
  if (typeof seed.coverage !== 'string' || seed.coverage.length < 20 || seed.coverage.length > 240) {
    throw new Error('coverage must be 20-240 characters');
  }
  if (!Array.isArray(seed.projects) || seed.projects.length === 0) throw new Error('projects must be non-empty');
  const projectNames = new Set();
  for (const [index, project] of seed.projects.entries()) {
    expectExactKeys(project, ['id', 'name', 'tokens'], `projects[${index}]`);
    if (!SLUG_RE.test(project.id)) throw new Error(`projects[${index}].id is invalid`);
    if (typeof project.name !== 'string' || !project.name.trim()) throw new Error(`projects[${index}].name is required`);
    expectCount(project.tokens, `projects[${index}].tokens`);
    if (projectNames.has(project.name)) throw new Error(`duplicate project name: ${project.name}`);
    projectNames.add(project.name);
  }
  if (!Array.isArray(seed.pulses)) throw new Error('pulses must be an array');
  for (const [index, pulse] of seed.pulses.entries()) {
    expectExactKeys(pulse, ['project', 'country', 'locality', 'tokens', 'events'], `pulses[${index}]`);
    if (!projectNames.has(pulse.project)) throw new Error(`pulses[${index}].project is not registered`);
    if (!COUNTRY_RE.test(pulse.country)) throw new Error(`pulses[${index}].country must be ISO alpha-2`);
    if (pulse.locality !== null && (typeof pulse.locality !== 'string' || pulse.locality.length > 60)) {
      throw new Error(`pulses[${index}].locality is invalid`);
    }
    expectCount(pulse.tokens, `pulses[${index}].tokens`);
    expectCount(pulse.events, `pulses[${index}].events`);
  }
  if (!seed.provenance || typeof seed.provenance !== 'object' || Array.isArray(seed.provenance)) {
    throw new Error('provenance must be an object');
  }
}

function validateProjection(projection) {
  if (!projection || typeof projection !== 'object') throw new Error('projection must be an object');
  for (const key of ['previousLifetimeTokens', 'lifetimeTokens', 'todayTokens', 'countriesServed', 'projectsContributing']) {
    expectCount(projection[key], key);
  }
  if (!DATE_RE.test(projection.snapshotDate)) throw new Error('published snapshotDate is invalid');
  if (!ISO_TIMESTAMP_RE.test(projection.lastUpdatedAt) || Number.isNaN(Date.parse(projection.lastUpdatedAt))) {
    throw new Error('published lastUpdatedAt is invalid');
  }
  if (projection.previousLifetimeTokens > projection.lifetimeTokens) throw new Error('published lifetime total regresses');
}

function expectExactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unsupported field(s): ${extras.join(', ')}`);
}

function expectCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function rejectForbiddenKeys(value, path = 'seed') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${key} is forbidden`);
    rejectForbiddenKeys(child, `${path}.${key}`);
  }
}

function roundForPublic(tokens) {
  if (tokens < 1_000) return tokens;
  const magnitude = 10 ** Math.max(2, Math.floor(Math.log10(tokens)) - 2);
  return Math.round(tokens / magnitude) * magnitude;
}
