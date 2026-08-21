import { createProjectResolver } from './marketing-program.mjs';

const KINDS = new Set(['package', 'media', 'postiz-draft', 'postiz-scheduled', 'postiz-published', 'postiz-analytics', 'failure']);

export function buildMarketingSnapshot(events, registry, options = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const now = new Date(options.now ?? new Date());
  if (!Number.isFinite(now.getTime())) throw new TypeError('now must be a valid date');
  const canonicalize = createProjectResolver(registry);
  const grouped = new Map(registry.projects.map((project) => [project.slug, []]));
  let unmapped = 0;

  for (const input of events) {
    const event = normalizeEvent(input, canonicalize);
    if (!event || !grouped.has(event.projectSlug)) {
      unmapped += 1;
      continue;
    }
    grouped.get(event.projectSlug).push(event);
  }

  const projects = registry.projects.map((program) => summarizeProject(
    program,
    grouped.get(program.slug),
    now,
    registry.defaults.freshnessHours,
  ));
  const totals = projects.reduce((result, project) => {
    for (const stage of ['packages', 'produced', 'drafts', 'scheduled', 'published', 'measured']) {
      result[stage] += project.stages[stage];
    }
    result.failures += project.failures;
    result.reviewDebt += project.reviewDebt;
    return result;
  }, { packages: 0, produced: 0, drafts: 0, scheduled: 0, published: 0, measured: 0, failures: 0, reviewDebt: 0 });

  return Object.freeze({
    schemaVersion: 2,
    registryVersion: registry.version,
    generatedAt: now.toISOString(),
    totals: Object.freeze({ ...totals, unmapped }),
    projects: projects.map(Object.freeze),
  });
}

function normalizeEvent(input, canonicalize) {
  if (!input || typeof input !== 'object' || !KINDS.has(input.kind)) return null;
  const projectSlug = canonicalize(input.projectSlug ?? input.project_slug);
  const recordedAt = timestamp(input.recordedAt ?? input.recorded_at);
  if (!projectSlug || !recordedAt) return null;
  return {
    projectSlug,
    kind: input.kind,
    recordedAt: new Date(recordedAt).toISOString(),
    requestId: string(input.requestId ?? input.request_id) ?? `${input.kind}:${recordedAt}`,
  };
}

function summarizeProject(program, events, now, freshnessHours) {
  const byRequest = new Map();
  for (const event of events) {
    if (!byRequest.has(event.requestId)) byRequest.set(event.requestId, new Set());
    byRequest.get(event.requestId).add(event.kind);
  }
  const count = (kind) => events.filter((event) => event.kind === kind).length;
  const reviewDebt = [...byRequest.values()].filter((kinds) => kinds.has('postiz-draft') && !kinds.has('postiz-scheduled') && !kinds.has('postiz-published')).length;
  const latestAt = events.length ? events.map((event) => event.recordedAt).sort().at(-1) : null;
  const latestAgeHours = latestAt ? roundHours(now.getTime() - Date.parse(latestAt)) : null;
  const freshness = latestAgeHours === null ? 'empty' : latestAgeHours > freshnessHours ? 'stale' : 'fresh';
  const stages = {
    packages: count('package'),
    produced: count('media'),
    drafts: count('postiz-draft'),
    scheduled: count('postiz-scheduled'),
    published: count('postiz-published'),
    measured: count('postiz-analytics'),
  };
  const failures = count('failure');
  return {
    slug: program.slug,
    mode: program.mode,
    sourceBacked: Boolean(program.contentBase),
    publicMarketing: program.publicMarketing,
    stages,
    reviewDebt,
    latestActivityAt: latestAt,
    latestActivityAgeHours: latestAgeHours,
    freshness,
    failures,
    nextAction: nextAction({ program, stages, failures, reviewDebt, freshness }),
  };
}

function nextAction({ program, stages, failures, reviewDebt, freshness }) {
  if (failures > 0) return 'Inspect failed marketing handoff';
  if (reviewDebt > 0) return 'Review drafts in Postiz';
  if (stages.packages > stages.produced) return 'Produce approved media';
  if (stages.produced > stages.drafts) return 'Create Postiz drafts';
  if (stages.published > stages.measured) return 'Refresh Postiz results';
  if (program.mode === 'focus' && freshness !== 'fresh') return 'Propose a current focus experiment';
  if (!program.publicMarketing) return 'No public marketing action';
  return 'Monitor program freshness';
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function string(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function roundHours(milliseconds) {
  return Math.max(0, Math.round(milliseconds / 36_000) / 100);
}
