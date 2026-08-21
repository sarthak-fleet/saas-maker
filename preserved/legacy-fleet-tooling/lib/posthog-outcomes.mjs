const POSTHOG_API = 'https://us.i.posthog.com';

export const DEFAULT_POSTHOG_PROJECT_ID = 110635;

const EVENT_TAXONOMY = ['page_view', 'signup', 'activated', 'core_action', 'returned'];

/**
 * Live products still emit historical `project_id` values that predate the
 * canonical catalog id. Query both so the Query API collector does not
 * report empty windows against the shared PostHog project.
 */
const POSTHOG_PROJECT_ID_ALIASES = {
  rolepatch: ['resume-tailor'],
  karte: ['linkchat'],
};

export function posthogProjectIdValues(project) {
  const canonical = project?.posthogProjectId ?? project?.id;
  if (!canonical) return [];
  const aliases = POSTHOG_PROJECT_ID_ALIASES[project.id] ?? [];
  return [...new Set([canonical, ...aliases])];
}

/**
 * Property filters that exclude non-production traffic so development,
 * synthetic monitoring, and known bot/internal-operator events cannot
 * contaminate the aggregate user-metrics ledger.
 *
 * Each filter targets a PostHog event property. Products should set
 * `$environment` (or `environment`) to 'production' | 'development' and
 * `$lib` is automatically set by posthog-js. Synthetic monitors should
 * set `synthetic_monitor: true`.
 */
const TRAFFIC_EXCLUSION_FILTERS = [
  // Exclude events explicitly tagged as non-production
  {
    key: '$environment',
    operator: 'is_not',
    value: ['production'],
    type: 'event',
  },
  // Exclude PostHog test/CI library markers
  {
    key: '$lib',
    operator: 'is_not',
    value: ['test', 'ci'],
    type: 'event',
  },
  // Exclude synthetic monitoring traffic
  {
    key: 'synthetic_monitor',
    operator: 'is_not',
    value: [true],
    type: 'event',
  },
];

/**
 * Collect read-only PostHog aggregate user-metrics grouped by project_id property.
 *
 * Uses the PostHog Query API (/api/projects/:id/query/) with TrendsQuery — the
 * legacy /insights/trend/ endpoint is deprecated and returns 403.
 *
 * The collector uses a PostHog personal API key (POSTHOG_PERSONAL_API_KEY) with
 * read-only access. It never writes events, never reads raw event payloads,
 * and never stores PII — only aggregate counts per project_id are emitted as
 * visibility outcome observations.
 *
 * Non-production traffic is excluded via property filters: events tagged with
 * `$environment` other than 'production', synthetic monitor events, and test
 * library markers are filtered out so development and CI traffic cannot
 * contaminate the production metrics ledger.
 *
 * @param {object} options
 * @param {Array} options.projects - Canonical Fleet projects with PostHog instrumentation.
 * @param {string} options.personalApiKey - PostHog personal API key (read-only).
 * @param {number} [options.projectId] - PostHog project ID (numeric).
 * @param {Function} [options.fetchImpl] - Fetch implementation (for testing).
 * @param {Date} [options.now] - Current timestamp.
 * @param {number} [options.reportingWindowDays] - Reporting window (default 7).
 * @param {number} [options.maxEventsPerProject] - Cost guardrail: warn when a project's
 *   total event count exceeds this threshold (default 100_000). The collector
 *   still returns the observation but includes a `costWarning` field.
 */
export async function collectPosthogOutcomes({
  projects,
  personalApiKey,
  projectId = DEFAULT_POSTHOG_PROJECT_ID,
  fetchImpl = fetch,
  now = new Date(),
  reportingWindowDays = 7,
  maxEventsPerProject = 100_000,
}) {
  if (!personalApiKey) throw new Error('PostHog personal API key is required');
  if (!Number.isInteger(reportingWindowDays) || reportingWindowDays < 1 || reportingWindowDays > 90) {
    throw new Error('PostHog reporting window must be 1-90 days');
  }

  const observedAt = now.toISOString();
  const runId = observedAt.replace(/[^0-9]/g, '');
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (reportingWindowDays - 1));

  const period = {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };

  const observations = [];
  const unavailable = [];
  const costWarnings = [];

  for (const project of projects ?? []) {
    if (!project.id) continue;
    const projectIdProperties = posthogProjectIdValues(project);
    if (projectIdProperties.length === 0) continue;

    try {
      const metrics = await queryProjectMetrics({
        fetchImpl,
        personalApiKey,
        posthogProjectId: projectId,
        projectIdProperties,
        startDate,
        endDate,
      });

      if (metrics.length === 0) {
        unavailable.push({ projectId: project.id, reason: 'no-events' });
        continue;
      }

      // Cost guardrail: check total event volume across all metrics
      const totalEvents = metrics.reduce((sum, m) => sum + (Number(m.value) || 0), 0);
      if (maxEventsPerProject > 0 && totalEvents > maxEventsPerProject) {
        costWarnings.push({
          projectId: project.id,
          totalEvents,
          threshold: maxEventsPerProject,
          message: `Project ${project.id} exceeded event volume guardrail (${totalEvents} > ${maxEventsPerProject})`,
        });
      }

      const scope = project.domains?.[0] ?? project.id;
      observations.push({
        id: `user-metrics-posthog-${project.id}-${runId}`,
        projectId: project.id,
        family: 'user-metrics',
        provider: 'posthog-insights',
        scope,
        observedAt,
        period,
        metrics,
      });
    } catch (error) {
      unavailable.push({
        projectId: project.id,
        reason: 'api-error',
        detail: error?.message ?? String(error),
      });
    }
  }

  return {
    bundle: {
      schema: 'fleet.visibility-outcome-bundle.v1',
      observations,
    },
    projectCount: projects?.length ?? 0,
    observationCount: observations.length,
    unavailable,
    costWarnings,
    period,
  };
}

async function queryProjectMetrics({
  fetchImpl,
  personalApiKey,
  posthogProjectId,
  projectIdProperties,
  startDate,
  endDate,
}) {
  const dateFrom = startDate.toISOString().slice(0, 10);
  const dateTo = endDate.toISOString().slice(0, 10);
  const propertyFilter = [
    {
      key: 'project_id',
      operator: 'exact',
      value: projectIdProperties,
      type: 'event',
    },
    ...TRAFFIC_EXCLUSION_FILTERS,
  ];

  const metrics = [];

  // Visitors: unique users who triggered page_view
  const visitors = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: 'page_view',
    propertyFilter,
    math: 'dau',
  });
  if (visitors > 0) metrics.push({ label: 'Visitors', value: visitors });

  // Identified users: unique users across all 5 events
  const identifiedUsers = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: null,
    propertyFilter,
    math: 'dau',
  });
  if (identifiedUsers > 0) metrics.push({ label: 'Identified users', value: identifiedUsers });

  // Signup count
  const signups = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: 'signup',
    propertyFilter,
    math: 'total',
  });
  if (signups > 0) metrics.push({ label: 'Accounts', value: signups });

  // Activation rate: activated / signup (as percent)
  const activated = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: 'activated',
    propertyFilter,
    math: 'dau',
  });
  if (signups > 0 && activated > 0) {
    metrics.push({
      label: 'Activation rate',
      value: Number(((activated / signups) * 100).toFixed(1)),
    });
  }

  // Core actions count
  const coreActions = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: 'core_action',
    propertyFilter,
    math: 'total',
  });
  if (coreActions > 0) metrics.push({ label: 'Core actions', value: coreActions });

  // D7 retention: users who returned after 7+ days
  const returned = await queryTrend({
    fetchImpl,
    personalApiKey,
    posthogProjectId,
    dateFrom,
    dateTo,
    event: 'returned',
    propertyFilter,
    math: 'dau',
  });
  if (signups > 0 && returned > 0) {
    metrics.push({
      label: 'D7 retention',
      value: Number(((returned / signups) * 100).toFixed(1)),
    });
  }

  return metrics;
}

/**
 * Query the PostHog Query API (/api/projects/:id/query/) with a TrendsQuery.
 * The legacy /insights/trend/ endpoint is deprecated and returns 403.
 *
 * Response shape: { results: [{ data: [number, ...], labels: [date, ...] }, ...] }
 */
async function queryTrend({
  fetchImpl,
  personalApiKey,
  posthogProjectId,
  dateFrom,
  dateTo,
  event,
  propertyFilter,
  math,
}) {
  const events = event ? [event] : EVENT_TAXONOMY;
  const body = {
    query: {
      kind: 'TrendsQuery',
      series: events.map((eventName) => ({
        event: eventName,
        math,
      })),
      dateRange: {
        date_from: dateFrom,
        date_to: dateTo,
      },
      properties: propertyFilter,
      interval: 'day',
    },
  };

  const response = await fetchImpl(`${POSTHOG_API}/api/projects/${posthogProjectId}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${personalApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('PostHog rate limit exceeded');
    throw new Error(`PostHog API returned ${response.status}`);
  }

  const data = await response.json();
  const results = data?.results ?? [];
  let total = 0;
  for (const result of results) {
    const values = result?.data ?? [];
    for (const value of values) {
      if (typeof value === 'number') total += value;
    }
  }
  return total;
}
