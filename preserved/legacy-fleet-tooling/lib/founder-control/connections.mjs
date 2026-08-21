import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SkillRunStore, defaultSkillRunsRoot } from '../skill-run-store.mjs';
import { validateDesignReviewEvidence } from '../design-workflow.mjs';
import {
  sha256,
  validateDesignReviewSnapshot,
} from '../design-review-snapshot.mjs';
import {
  defaultVisibilityMetricPath,
  readVisibilityMetrics,
} from '../visibility-metric-store.mjs';
import {
  defaultVisibilityOutcomePath,
  readVisibilityOutcomes,
} from '../visibility-outcome-store.mjs';
import { searchConsoleProjects, visibilityProjects } from '../visibility-projects.mjs';
import { searchConsoleProviderUrl } from '../search-console.mjs';
import { validateRootBrandContract } from '../root-brand-contract.mjs';
import {
  activeObservatoryQueries,
  mergeRootSearchQueriesIntoObservatory,
  validateRootSearchQueryContract,
} from '../root-search-query-contract.mjs';
import {
  defaultSearchIndexingRequestPath,
  readSearchIndexingRequests,
} from '../search-indexing-request-store.mjs';
import {
  defaultSearchChangeReceiptPath,
  readSearchChangeReceipts,
} from '../search-change-receipt-store.mjs';
import {
  isDomainStrengthProject,
  isPublicMetricProject,
  normalizedDomain,
  registrableDomain,
} from './domain-scope.mjs';

export const CONNECTIONS_SCHEMA_VERSION = 'fleet.connections.v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const SITEMAP_INDEXING_GRACE_DAYS = 14;
const SITEMAP_REMEASUREMENT_DAYS = 7;
const SUCCESSFUL_SITEMAP_STATES = new Set(['submitted', 'already-submitted']);

export const SEARCH_ACTION_SAMPLE_FLOORS = Object.freeze({
  project: 20,
  query: 10,
});

function daysAfter(timestamp, days) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? new Date(value + days * DAY_MS).toISOString() : null;
}

export function searchAction({
  observed,
  impressions,
  clicks,
  position,
  sampleFloor,
  inspection = null,
  observedAt = null,
  indexingRequestedAt = null,
}) {
  if (!observed) {
    return {
      id: 'measure-search',
      label: 'Measure now',
      stage: 'measure',
      reason: 'No completed Google Search observation is available.',
      priority: 7,
    };
  }
  if (impressions === 0) {
    if (inspection?.state === 'indexed') {
      const nextMeasurementAt = daysAfter(observedAt, 7);
      return {
        id: 'wait-indexed',
        label: 'Wait, then measure',
        stage: 'wait',
        reason: 'Google reports the canonical homepage as indexed; wait for search demand and the next completed data window.',
        ...(nextMeasurementAt ? { nextMeasurementAt } : {}),
        priority: 6,
      };
    }
    if (inspection?.state === 'not-indexed' || inspection?.state === 'unknown') {
      const requestTime = Date.parse(indexingRequestedAt);
      const inspectionTime = Date.parse(observedAt);
      if (
        Number.isFinite(requestTime) &&
        Number.isFinite(inspectionTime) &&
        requestTime > inspectionTime
      ) {
        const nextMeasurementAt = daysAfter(indexingRequestedAt, SITEMAP_REMEASUREMENT_DAYS);
        return {
          id: 'wait-after-indexing-request',
          label: 'Wait, then measure',
          stage: 'wait',
          reason: 'Google accepted an indexing request after the latest inspection; wait for its next crawl.',
          ...(nextMeasurementAt ? { nextMeasurementAt } : {}),
          priority: 6,
        };
      }
      const sitemapSubmittedAt = Date.parse(inspection.sitemapSubmittedAt);
      const observationTime = Date.parse(observedAt);
      const sitemapAge = observationTime - sitemapSubmittedAt;
      if (
        SUCCESSFUL_SITEMAP_STATES.has(inspection.sitemapSubmissionState) &&
        Number.isFinite(sitemapAge) &&
        sitemapAge >= 0 &&
        sitemapAge <= SITEMAP_INDEXING_GRACE_DAYS * DAY_MS
      ) {
        const nextMeasurementAt = daysAfter(observedAt, SITEMAP_REMEASUREMENT_DAYS);
        return {
          id: 'wait-after-sitemap',
          label: 'Wait, then measure',
          stage: 'wait',
          reason: 'Fleet submitted the sitemap; Google has not discovered the canonical homepage yet.',
          ...(nextMeasurementAt ? { nextMeasurementAt } : {}),
          priority: 6,
        };
      }
      return {
        id: 'fix-indexing',
        label: 'Fix indexing',
        stage: 'change',
        reason: inspection.coverageState ?? 'Google did not return a passing index verdict for the canonical homepage.',
        priority: 1,
      };
    }
    return {
      id: 'inspection-unavailable',
      label: 'Inspection unavailable',
      stage: 'measure',
      reason: 'Google URL Inspection did not complete for the canonical homepage.',
      priority: 1,
    };
  }
  if (impressions < sampleFloor) {
    return {
      id: 'collect-more-data',
      label: 'Collect more data',
      stage: 'wait',
      reason: `${impressions} impressions is below the ${sampleFloor}-impression action floor.`,
      priority: 6,
    };
  }
  if (position <= 10 && clicks > 0) {
    return {
      id: 'protect-and-expand',
      label: 'Protect and expand',
      stage: 'change',
      reason: 'This result already ranks on page one and earns clicks.',
      priority: 5,
    };
  }
  if (position <= 10) {
    return {
      id: 'improve-snippet',
      label: 'Improve snippet',
      stage: 'change',
      reason: 'This result ranks on page one but has not earned a click.',
      priority: 2,
    };
  }
  if (position <= 30) {
    return {
      id: 'strengthen-ranking-page',
      label: 'Strengthen ranking page',
      stage: 'change',
      reason: 'This result is within reach of page one.',
      priority: 3,
    };
  }
  return {
    id: 'build-search-relevance',
    label: 'Build search relevance',
    stage: 'change',
    reason: 'This result is visible but ranks beyond position 30.',
    priority: 4,
  };
}

function isAuditSearchQuery(value) {
  return /(^|\s|-)site:/i.test(String(value ?? '').trim());
}

export function projectSearchAction({
  observed,
  impressions,
  clicks,
  position,
  inspection = null,
  observedAt = null,
  indexingRequestedAt = null,
  searchTerms = [],
  changeReceipt = null,
}) {
  const aggregateAction = searchAction({
    observed,
    impressions,
    clicks,
    position,
    sampleFloor: SEARCH_ACTION_SAMPLE_FLOORS.project,
    inspection,
    observedAt,
    indexingRequestedAt,
  });
  if (!observed || impressions === 0) return aggregateAction;

  const evidenceBackedChange = searchTerms
    .filter((term) => !isAuditSearchQuery(term.query))
    .filter((term) => term.action?.stage === 'change')
    .sort((left, right) => (
      Number(left.action.priority) - Number(right.action.priority) ||
      Number(right.impressions) - Number(left.impressions)
    ))[0];
  if (evidenceBackedChange) {
    const changedAfterObservation = (
      changeReceipt?.actionId === evidenceBackedChange.action.id &&
      changeReceipt?.query === evidenceBackedChange.query &&
      Number.isFinite(Date.parse(changeReceipt?.changedAt)) &&
      Number.isFinite(Date.parse(observedAt)) &&
      Date.parse(changeReceipt.changedAt) > Date.parse(observedAt)
    );
    if (changedAfterObservation) {
      return {
        id: 'wait-after-search-change',
        label: 'Wait, then measure',
        stage: 'wait',
        reason: `Fleet updated the landing page for “${evidenceBackedChange.query}”; wait for a new completed Search Console window.`,
        nextMeasurementAt: daysAfter(changeReceipt.changedAt, SITEMAP_REMEASUREMENT_DAYS),
        priority: 6,
      };
    }
    return {
      ...evidenceBackedChange.action,
      reason: `“${evidenceBackedChange.query}” has ${evidenceBackedChange.impressions} impressions at average position ${Number(evidenceBackedChange.position).toFixed(1)}.`,
    };
  }

  return {
    id: 'collect-more-data',
    label: 'Collect more data',
    stage: 'wait',
    reason: `No retained non-audit query meets the ${SEARCH_ACTION_SAMPLE_FLOORS.query}-impression action floor; ${impressions} aggregate impressions are not enough to prescribe a page change.`,
    priority: 6,
  };
}

const BUCKETS = [
  {
    id: 'helpers',
    label: 'Helpers',
    purpose: 'Focused supporting products',
    components: ['ai-visibility', 'drank', 'psi-swarm'],
  },
  {
    id: 'skills',
    label: 'Skills',
    purpose: 'Agent-operated capabilities',
    components: ['fleet-skills', 'skill-run-store'],
  },
  {
    id: 'public-apps',
    label: 'Public apps',
    purpose: 'Public product surfaces',
    components: ['public-directory'],
  },
  {
    id: 'dashboard',
    label: 'Fleet Console',
    purpose: 'Cross-bucket owner interfaces',
    components: ['fleet-console'],
  },
];

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function finiteDatabaseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalVisibilityProjectId(value) {
  const aliases = {
    'knowledgebase-app': 'knowledge-base',
    'saas-maker': 'fleet-workspace',
    'saas-maker-showcase': 'fleet-workspace',
  };
  return aliases[value] ?? value;
}

function validatedRootSearchQueries(fleetRoot, projectCatalog) {
  const brandContract = readJson(resolve(fleetRoot, 'foundry/ops/config/root-brands.json'));
  const rootQueryContract = readJson(resolve(fleetRoot, 'foundry/ops/config/root-search-queries.json'));
  if (!brandContract && !rootQueryContract) return new Map();
  if (!brandContract || !rootQueryContract) {
    throw new Error('root brand and root search query contracts must be present together');
  }
  const brandMap = validateRootBrandContract(
    brandContract,
    projectCatalog.projects ?? [],
  );
  return validateRootSearchQueryContract(
    rootQueryContract,
    brandMap,
    projectCatalog.projects ?? [],
  );
}

function searchVisibilityEvidence(fleetRoot, projectCatalog, rootsByDomain = null) {
  const baseConfig = readJson(
    resolve(fleetRoot, 'foundry/ops/config/geo-observatory.json'),
    { products: [] },
  );
  let config = baseConfig;
  const rootQueries = rootsByDomain ?? validatedRootSearchQueries(fleetRoot, projectCatalog);
  if (rootQueries.size > 0) {
    config = mergeRootSearchQueriesIntoObservatory(baseConfig, rootQueries);
  }
  const configured = new Map();
  for (const product of config.products ?? []) {
    const projectId = canonicalVisibilityProjectId(product.id);
    const queries = configured.get(projectId) ?? [];
    queries.push(...activeObservatoryQueries(product).map((query) => ({
      id: query.qid,
      kind: query.kind ?? 'unknown',
      text: query.q,
      rootDomain: query.rootDomain ?? null,
      collision: query.collision ?? null,
    })));
    configured.set(projectId, queries);
  }
  const ledger = readJsonLines(
    resolve(fleetRoot, 'foundry/ops/data/geo-observatory/ledger.jsonl'),
  );
  const byProjectAndDate = new Map();
  const byProjectAndQuery = new Map();
  for (const item of ledger) {
    if (!['A', 'B', 'C'].includes(item?.class) || !item?.date || !item?.product) continue;
    const projectId = canonicalVisibilityProjectId(item.product);
    const key = `${projectId}\u0000${item.date}`;
    const entry = byProjectAndDate.get(key) ?? {
      projectId,
      observedAt: `${item.date}T12:00:00.000Z`,
      values: [],
    };
    entry.values.push({ A: 3, B: 2, C: 1 }[item.class]);
    byProjectAndDate.set(key, entry);
    if (item.qid) {
      const queryKey = `${projectId}\u0000${item.qid}`;
      const queryHistory = byProjectAndQuery.get(queryKey) ?? [];
      queryHistory.push({
        observedAt: `${item.date}T12:00:00.000Z`,
        class: item.class,
        top: Array.isArray(item.top) ? item.top.slice(0, 5) : [],
      });
      byProjectAndQuery.set(queryKey, queryHistory);
    }
  }
  const projects = new Map();
  for (const entry of byProjectAndDate.values()) {
    const project = projects.get(entry.projectId) ?? {
      projectId: entry.projectId,
      configured: configured.has(entry.projectId),
      series: [],
    };
    project.series.push({
      observedAt: entry.observedAt,
      value: Math.min(...entry.values),
    });
    projects.set(entry.projectId, project);
  }
  for (const projectId of configured.keys()) {
    if (!projects.has(projectId)) {
      projects.set(projectId, { projectId, configured: true, series: [] });
    }
  }
  return [...projects.values()].map((project) => ({
    ...project,
    queries: (configured.get(project.projectId) ?? []).map((query) => ({
      ...query,
      history: (byProjectAndQuery.get(`${project.projectId}\u0000${query.id}`) ?? [])
        .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)),
    })),
    series: project.series.sort(
      (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
    ),
  }));
}

function visibilityMetricEvidence(home) {
  const observations = readVisibilityMetrics({
    path: defaultVisibilityMetricPath({ home }),
  });
  const projects = new Map();
  for (const observation of observations) {
    if (!['agent', 'crawl', 'coverage'].includes(observation.family)) continue;
    const project = projects.get(observation.projectId) ?? {
      projectId: observation.projectId,
      families: {},
    };
    const family = project.families[observation.family] ?? {
      latest: null,
      metrics: new Map(),
    };
    family.latest = observation;
    for (const metric of observation.metrics) {
      const values = family.metrics.get(metric.label) ?? {
        label: metric.label,
        unit: metric.unit,
        direction: metric.direction,
        series: [],
      };
      values.series.push({
        observedAt: observation.observedAt,
        value: metric.value,
      });
      family.metrics.set(metric.label, values);
    }
    project.families[observation.family] = family;
    projects.set(observation.projectId, project);
  }
  return [...projects.values()].map((project) => ({
    ...project,
    families: Object.fromEntries(
      Object.entries(project.families).map(([familyId, family]) => [
        familyId,
        {
          latest: family.latest,
          metrics: [...family.metrics.values()],
        },
      ]),
    ),
  }));
}

function visibilityOutcomeEvidence(home) {
  const observations = readVisibilityOutcomes({
    path: defaultVisibilityOutcomePath({ home }),
  });
  const projects = new Map();
  for (const observation of observations) {
    const project = projects.get(observation.projectId) ?? {
      projectId: observation.projectId,
      families: {},
    };
    const family = project.families[observation.family] ?? {
      latest: null,
      latestByProvider: {},
      latestIndexInspection: null,
      metrics: new Map(),
      observations: 0,
    };
    family.latest = !family.latest || Date.parse(observation.observedAt) >= Date.parse(family.latest.observedAt)
      ? observation
      : family.latest;
    // Track latest observation per provider for cross-source comparison
    const prev = family.latestByProvider[observation.provider];
    if (!prev || Date.parse(observation.observedAt) >= Date.parse(prev.observedAt)) {
      family.latestByProvider[observation.provider] = observation;
    }
    family.observations += 1;
    if (
      observation.family === 'search' &&
      observation.indexInspection?.state !== 'unavailable' &&
      (!family.latestIndexInspection || Date.parse(observation.observedAt) >= Date.parse(family.latestIndexInspection.observedAt))
    ) {
      family.latestIndexInspection = observation;
    }
    for (const metric of observation.metrics) {
      const values = family.metrics.get(metric.label) ?? {
        label: metric.label,
        unit: metric.unit,
        direction: metric.direction,
        source: observation.provider,
        series: [],
      };
      values.series.push({
        observedAt: observation.observedAt,
        value: metric.value,
        provider: observation.provider,
      });
      family.metrics.set(metric.label, values);
    }
    project.families[observation.family] = family;
    projects.set(observation.projectId, project);
  }
  return [...projects.values()].map((project) => ({
    ...project,
    families: Object.fromEntries(
      Object.entries(project.families).map(([familyId, family]) => [
        familyId,
        {
          latest: family.latest,
          latestByProvider: family.latestByProvider,
          latestIndexInspection: family.latestIndexInspection,
          observations: family.observations,
          metrics: [...family.metrics.values()].map((metric) => ({
            ...metric,
            series: metric.series.sort(
              (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
            ),
          })),
        },
      ]),
    ),
  }));
}

function observedState(observedAt, now, maxAgeMs) {
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return 'unknown';
  return Date.parse(now) - Date.parse(observedAt) > maxAgeMs ? 'stale' : 'fresh';
}

function safeSqliteSummary(databasePath) {
  if (!existsSync(databasePath)) return null;
  try {
    const raw = execFileSync(
      'sqlite3',
      [
        '-json',
        databasePath,
        "SELECT COUNT(*) AS run_count, MAX(started_at) AS newest_at, COUNT(DISTINCT tag) AS tag_count FROM runs WHERE error IS NULL",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 },
    );
    return JSON.parse(raw || '[]')[0] ?? null;
  } catch {
    return null;
  }
}

function safeSqliteProjectHistory(databasePath) {
  if (!existsSync(databasePath)) return [];
  try {
    const raw = execFileSync(
      'sqlite3',
      [
        '-json',
        databasePath,
        `WITH ranked AS (
          SELECT
            url,
            started_at,
            performance_score,
            lcp,
            cls,
            ROW_NUMBER() OVER (PARTITION BY url ORDER BY started_at DESC) AS position,
            COUNT(*) OVER (PARTITION BY url) AS run_count
          FROM runs
          WHERE error IS NULL
        )
        SELECT url, started_at, performance_score, lcp, cls, position, run_count
        FROM ranked
        WHERE position <= 30
        ORDER BY url, position`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 },
    );
    const byDomain = new Map();
    for (const row of JSON.parse(raw || '[]')) {
      let domain;
      try {
        domain = new URL(row.url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      const existing = byDomain.get(domain) ?? { domain, runs: 0, observations: [] };
      if (Number(row.position) === 1) existing.runs += Number(row.run_count ?? 0);
      const observation = {
        observedAt: Number.isFinite(Number(row.started_at))
          ? new Date(Number(row.started_at)).toISOString()
          : null,
        performanceScore: finiteDatabaseNumber(row.performance_score),
        lcp: finiteDatabaseNumber(row.lcp),
        cls: finiteDatabaseNumber(row.cls),
      };
      if (
        observation.performanceScore !== null
        || observation.lcp !== null
        || observation.cls !== null
      ) {
        existing.observations.push(observation);
      }
      byDomain.set(domain, existing);
    }
    return [...byDomain.values()].map((entry) => {
      const observations = entry.observations
        .filter((item) => item.observedAt)
        .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
        .slice(-30);
      const latest = observations.at(-1) ?? null;
      const previous = observations.at(-2) ?? null;
      return {
        domain: entry.domain,
        runs: entry.runs,
        latest,
        previous,
        series: observations,
        performanceDelta:
          Number.isFinite(latest?.performanceScore) && Number.isFinite(previous?.performanceScore)
            ? latest.performanceScore - previous.performanceScore
            : null,
      };
    });
  } catch {
    return [];
  }
}

function pathComponent({
  id,
  name,
  bucketId,
  path,
  root,
  headline,
  ownerPath,
  audience = null,
}) {
  const present = existsSync(resolve(root, path));
  return {
    id,
    name,
    bucketId,
    sourcePath: path,
    audience,
    status: present ? 'connected' : 'unavailable',
    headline: present ? headline : 'Source is unavailable on this checkout.',
    ownerPath,
    freshness: 'not-applicable',
  };
}

function connection({
  id,
  provider,
  consumer,
  transport,
  status,
  detail,
  evidence = [],
  ownerPath = '/connections',
  priority = 50,
}) {
  return {
    id,
    provider,
    consumer,
    transport,
    status,
    detail,
    evidence,
    ownerPath,
    priority,
    freshness:
      evidence.some((item) => item.freshness === 'stale')
        ? 'stale'
        : evidence.some((item) => item.freshness === 'unavailable')
          ? 'unavailable'
          : evidence.some((item) => item.freshness === 'fresh')
            ? 'fresh'
            : 'not-applicable',
  };
}

function workflowEvidence(root, now) {
  const availability = readJson(
    resolve(root, 'foundry/ops/workflows/reports/availability/latest.json'),
  );
  const performance = readJson(
    resolve(root, 'foundry/ops/workflows/reports/performance/latest.json'),
  );
  const summaries = [
    ['availability', availability],
    ['performance', performance],
  ].flatMap(([kind, report]) => {
    if (!report?.summary) return [];
    return [{
      provider: `public-workflows:${kind}`,
      label: `${report.summary.passed}/${report.summary.sites} sites passed`,
      observedAt: report.generatedAt ?? null,
      freshness: observedState(report.generatedAt, now, 8 * DAY_MS),
    }];
  });
  const projects = new Map();
  for (const [kind, report] of [
    ['availability', availability],
    ['performance', performance],
  ]) {
    for (const result of report?.results ?? []) {
      if (typeof result.id !== 'string') continue;
      const project = projects.get(result.id) ?? { projectId: result.id };
      project[kind] = {
        ok: result.ok === true,
        observedAt: report.generatedAt ?? null,
        freshness: observedState(report.generatedAt, now, 8 * DAY_MS),
        ...(kind === 'performance'
          ? {
              totalP50Ms: Number(result.metrics?.totalP50Ms ?? 0),
              totalP90Ms: Number(result.metrics?.totalP90Ms ?? 0),
            }
          : {}),
      };
      projects.set(result.id, project);
    }
  }
  return {
    readable: summaries.length > 0,
    summaries,
    sites: availability?.summary?.sites ?? performance?.summary?.sites ?? 0,
    failed: Math.max(
      Number(availability?.summary?.failed ?? 0),
      Number(performance?.summary?.failed ?? 0),
    ),
    projects: [...projects.values()],
  };
}

function skillEvidence(home, now) {
  const root = defaultSkillRunsRoot({ home, env: {} });
  if (!existsSync(root)) {
    return {
      readable: false,
      status: null,
      recent: [],
      runs: [],
      metrics: [],
      projects: [],
      history: [],
      projectHistory: [],
      outputCount: 0,
      outputBytes: 0,
    };
  }
  try {
    const store = new SkillRunStore({ root, env: {} });
    const status = store.status();
    const runs = store.list({ order: 'desc' });
    const metrics = store.metrics();
    const outputSummary = (run) => {
      const outputs = Object.entries(run.outputs ?? {});
      return {
        outputCount: outputs.length,
        outputBytes: outputs.reduce(
          (total, [, output]) => total + Number(output.storedBytes ?? 0),
          0,
        ),
        outputKinds: outputs.map(([kind]) => kind),
        outputRedactions: outputs.reduce(
          (total, [, output]) => total + Number(output.redactionCount ?? 0),
          0,
        ),
        outputTruncated: outputs.some(([, output]) => output.truncated === true),
      };
    };
    const safeStoredSummary = (run, output) => {
      if (output.outputRedactions > 0 || output.outputTruncated) return null;
      const orderedKinds = [
        ...(run.status === 'failed' ? ['stderr'] : []),
        'output',
        'stdout',
      ].filter((kind, index, values) =>
        values.indexOf(kind) === index && output.outputKinds.includes(kind),
      );
      for (const kind of orderedKinds) {
        let retained;
        try {
          retained = store.output(run.runId, kind);
        } catch {
          continue;
        }
        for (const rawLine of retained.split(/\r?\n/)) {
          const candidate = rawLine
            .replace(/\u001b\[[0-9;]*m/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^[\s>*#`~\-+]+/, '')
            .replace(/`/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (candidate.length < 12 || candidate.length > 240) continue;
          if (/^[{[<]|[}\]>]$/.test(candidate)) continue;
          if (/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|[A-Za-z]:\\)/.test(candidate)) continue;
          if (/\b[\w.-]+\/[\w./-]+\b/.test(candidate)) continue;
          if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(candidate)) continue;
          if (/(?:password|secret|credential|api[_ -]?key)\s*[:=]/i.test(candidate)) continue;
          if (/^(?:oai-mem-citation|citation_entries|rollout_ids)\b/i.test(candidate)) continue;
          const bounded = candidate.length > 180
            ? `${candidate.slice(0, 177).replace(/\s+\S*$/, '')}…`
            : candidate;
          return /[.!?…]$/.test(bounded) ? bounded : `${bounded}.`;
        }
      }
      return null;
    };
    const resultSummary = (run, output) => {
      const metricNames = [...new Set(
        (run.metrics ?? []).map((metric) => metric.metricName.replaceAll('-', ' ')),
      )];
      if (metricNames.length > 0) {
        const visible = metricNames.slice(0, 2).join(' and ');
        return {
          text: `Recorded ${visible}${metricNames.length > 2 ? ` and ${metricNames.length - 2} more` : ''}.`,
          kind: 'structured-metrics',
        };
      }
      const storedSummary = safeStoredSummary(run, output);
      if (storedSummary) return { text: storedSummary, kind: 'sanitized-excerpt' };
      if (run.captureCompleteness === 'curated-summary') {
        return { text: 'Curated historical result retained privately.', kind: 'unavailable' };
      }
      if (run.captureCompleteness === 'final-response') {
        return { text: 'Final assistant result retained privately.', kind: 'unavailable' };
      }
      if (output.outputKinds.includes('output')) {
        return { text: 'Result artifact retained privately.', kind: 'unavailable' };
      }
      if (output.outputKinds.some((kind) => ['stdout', 'stderr'].includes(kind))) {
        return { text: 'Command output retained privately.', kind: 'unavailable' };
      }
      return { text: 'No retained result artifact.', kind: 'unavailable' };
    };
    const projectMap = new Map();
    const historyMap = new Map();
    const projectHistoryMap = new Map();
    let outputCount = 0;
    let outputBytes = 0;
    for (const run of runs) {
      const output = outputSummary(run);
      outputCount += output.outputCount;
      outputBytes += output.outputBytes;
      const project = projectMap.get(run.projectId) ?? {
        projectId: run.projectId,
        runCount: 0,
        succeeded: 0,
        failed: 0,
        outputCount: 0,
        outputBytes: 0,
        metricCount: 0,
        skills: new Set(),
        newestRunAt: null,
      };
      project.runCount += 1;
      if (['succeeded', 'backfilled'].includes(run.status)) project.succeeded += 1;
      if (run.status === 'failed') project.failed += 1;
      project.outputCount += output.outputCount;
      project.outputBytes += output.outputBytes;
      project.metricCount += run.metrics?.length ?? 0;
      project.skills.add(run.skillId);
      if (!project.newestRunAt || Date.parse(run.observedAt) > Date.parse(project.newestRunAt)) {
        project.newestRunAt = run.observedAt;
      }
      projectMap.set(run.projectId, project);

      const day = run.observedAt.slice(0, 10);
      const period = historyMap.get(day) ?? {
        period: day,
        runs: 0,
        succeeded: 0,
        failed: 0,
        outputs: 0,
        metrics: 0,
      };
      period.runs += 1;
      if (['succeeded', 'backfilled'].includes(run.status)) period.succeeded += 1;
      if (run.status === 'failed') period.failed += 1;
      period.outputs += output.outputCount;
      period.metrics += run.metrics?.length ?? 0;
      historyMap.set(day, period);
      if (run.projectId) {
        const projectPeriods = projectHistoryMap.get(run.projectId) ?? new Map();
        const projectPeriod = projectPeriods.get(day) ?? {
          period: day,
          runs: 0,
          succeeded: 0,
          failed: 0,
          outputs: 0,
          metrics: 0,
        };
        projectPeriod.runs += 1;
        if (['succeeded', 'backfilled'].includes(run.status)) projectPeriod.succeeded += 1;
        if (run.status === 'failed') projectPeriod.failed += 1;
        projectPeriod.outputs += output.outputCount;
        projectPeriod.metrics += run.metrics?.length ?? 0;
        projectPeriods.set(day, projectPeriod);
        projectHistoryMap.set(run.projectId, projectPeriods);
      }
    }
    const metricsByProject = new Map();
    for (const metric of metrics) {
      const values = metricsByProject.get(metric.projectId) ?? [];
      values.push({
        skillId: metric.skillId,
        metricName: metric.metricName,
        value: metric.value,
        unit: metric.unit ?? null,
        direction: metric.direction,
        observedAt: metric.observedAt,
      });
      metricsByProject.set(metric.projectId, values);
    }
    const projectedRuns = runs.map((run) => {
      const output = outputSummary(run);
      const summary = resultSummary(run, output);
      return {
        runId: run.runId,
        skillId: run.skillId,
        projectId: run.projectId ?? null,
        status: run.status,
        source: run.source,
        captureCompleteness: run.captureCompleteness,
        durationMs: run.durationMs ?? null,
        observedAt: run.observedAt,
        metricCount: run.metrics?.length ?? 0,
        metrics: (run.metrics ?? []).map((metric) => ({
          metricName: metric.metricName,
          value: metric.value,
          unit: metric.unit ?? null,
        })),
        resultSummary: summary.text,
        resultSummaryKind: summary.kind,
        ...output,
      };
    });
    return {
      readable: true,
      status,
      outputCount,
      outputBytes,
      recent: projectedRuns.slice(0, 10),
      runs: projectedRuns,
      projects: [...projectMap.values()].map((project) => ({
        ...project,
        skills: [...project.skills].sort(),
        metrics: metricsByProject.get(project.projectId) ?? [],
      })),
      history: [...historyMap.values()]
        .sort((left, right) => left.period.localeCompare(right.period))
        .slice(-14),
      projectHistory: [...projectHistoryMap.entries()].map(([projectId, periods]) => ({
        projectId,
        periods: [...periods.values()]
          .sort((left, right) => left.period.localeCompare(right.period))
          .slice(-14),
      })),
      metrics: metrics.slice(-24).map((metric) => ({
        skillId: metric.skillId,
        projectId: metric.projectId ?? null,
        metricName: metric.metricName,
        value: metric.value,
        unit: metric.unit ?? null,
        direction: metric.direction,
        observedAt: metric.observedAt,
      })),
      freshness: observedState(status.newestRunAt, now, 7 * DAY_MS),
    };
  } catch {
    return {
      readable: false,
      status: null,
      recent: [],
      runs: [],
      metrics: [],
      projects: [],
      history: [],
      projectHistory: [],
      outputCount: 0,
      outputBytes: 0,
    };
  }
}

function boundedOwnerOutput(value, limitBytes) {
  const sanitized = String(value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(?:\/Users|\/home|\/private|\/tmp)\/[^\s"'`<>]+/g, '[private path]')
    .replace(/[A-Za-z]:\\[^\s"'`<>]+/g, '[private path]');
  const encoded = Buffer.from(sanitized);
  if (encoded.length <= limitBytes) return { content: sanitized, truncated: false };
  return {
    content: encoded.subarray(0, limitBytes).toString('utf8').replace(/\uFFFD$/, ''),
    truncated: true,
  };
}

export function readSkillRunOutput({
  home,
  runId,
  maxResponseBytes = 16 * 1024,
  maxStreamBytes = 8 * 1024,
} = {}) {
  const root = defaultSkillRunsRoot({ home, env: {} });
  const store = new SkillRunStore({ root, env: {} });
  const run = store.show(runId);
  const streams = [];
  let remainingBytes = maxResponseBytes;
  for (const kind of ['output', 'stdout', 'stderr']) {
    const metadata = run.outputs?.[kind];
    if (!metadata || remainingBytes <= 0) continue;
    const retained = store.output(run.runId, kind);
    const limit = Math.min(maxStreamBytes, remainingBytes);
    const bounded = boundedOwnerOutput(retained, limit);
    const storedBytes = Buffer.byteLength(bounded.content);
    remainingBytes -= storedBytes;
    streams.push({
      kind,
      content: bounded.content,
      truncated: metadata.truncated === true || bounded.truncated,
    });
  }
  return {
    runId: run.runId,
    streams,
    outputCount: streams.length,
    truncated: streams.some((stream) => stream.truncated) || remainingBytes <= 0,
  };
}

function drankEvidence(root, now) {
  const payload = readJson(
    resolve(root, 'drank/data/fleet-dr.json'),
  );
  const domainCount = Object.keys(payload?.domains ?? {}).length;
  return {
    readable: Boolean(payload),
    domainCount,
    observedAt: payload?.lastUpdated ?? null,
    freshness: payload
      ? observedState(payload.lastUpdated, now, 14 * DAY_MS)
      : 'unavailable',
    domains: Object.entries(payload?.domains ?? {}).map(([domain, value]) => {
      const history = [...(value.history ?? [])].sort((left, right) => left.ts - right.ts);
      const latest = history.at(-1) ?? null;
      const previous = history.at(-2) ?? null;
      return {
        domain,
        observations: history.length,
        rating: Number.isFinite(Number(latest?.dr)) ? Number(latest.dr) : null,
        previousRating: Number.isFinite(Number(previous?.dr)) ? Number(previous.dr) : null,
        delta:
          Number.isFinite(Number(latest?.dr)) && Number.isFinite(Number(previous?.dr))
            ? Number(latest.dr) - Number(previous.dr)
            : null,
        observedAt: Number.isFinite(Number(latest?.ts))
          ? new Date(Number(latest.ts)).toISOString()
          : payload?.lastUpdated ?? null,
        series: history
          .filter((item) => Number.isFinite(Number(item?.ts)) && Number.isFinite(Number(item?.dr)))
          .map((item) => ({
            observedAt: new Date(Number(item.ts)).toISOString(),
            value: Number(item.dr),
          }))
          .slice(-60),
      };
    }),
  };
}

function psiEvidence(home, now) {
  const databasePath = resolve(home, '.psi-swarm/history.db');
  const summary = safeSqliteSummary(databasePath);
  const observedAt = summary?.newest_at
    ? new Date(Number(summary.newest_at)).toISOString()
    : null;
  return {
    readable: Boolean(summary),
    runCount: Number(summary?.run_count ?? 0),
    tagCount: Number(summary?.tag_count ?? 0),
    observedAt,
    freshness: summary ? observedState(observedAt, now, 7 * DAY_MS) : 'unavailable',
    domains: safeSqliteProjectHistory(databasePath),
  };
}

function bucketStatus(bucket, components) {
  const bucketComponents = bucket.components.map((id) => components.get(id));
  const states = bucketComponents.map((component) => component?.status ?? 'unavailable');
  if (bucketComponents.some((component) => component?.freshness === 'stale')) return 'partial';
  if (states.every((state) => state === 'connected')) return 'connected';
  if (states.every((state) => ['missing', 'unavailable'].includes(state))) return 'missing';
  return 'partial';
}

function connectionSummary(connections) {
  const counts = {
    connected: 0,
    partial: 0,
    missing: 0,
    unavailable: 0,
    stale: 0,
  };
  for (const item of connections) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (item.freshness === 'stale') counts.stale += 1;
    if (item.freshness === 'unavailable' && item.status !== 'unavailable') {
      counts.unavailable += 1;
    }
  }
  const total = connections.length;
  return {
    ...counts,
    total,
    coverage: total > 0 ? Math.round((counts.connected / total) * 100) : 0,
  };
}

function newestTimestamp(values) {
  return values
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function aiRunEvidenceMode(run) {
  return run?.evidenceMode ?? run?.evidence?.[0]?.summary?.evidenceMode ?? null;
}

function parsedHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function cloudflareSpeedProviderUrl(project, fieldOutcome) {
  const candidates = [
    fieldOutcome?.providerUrl,
    project.webTraffic?.outcome?.providerUrl,
    project.aiVisibility?.discovery?.crawler?.providerUrl,
  ];
  for (const candidate of candidates) {
    const url = parsedHttpUrl(candidate);
    if (!url || url.hostname !== 'dash.cloudflare.com') continue;
    const [accountId, zoneId] = url.pathname.split('/').filter(Boolean);
    if (!accountId || !zoneId) continue;
    url.pathname = `/${accountId}/${zoneId}/speed/observatory`;
    url.search = '';
    url.hash = '';
    return url.href;
  }
  return null;
}

function hostMatchesDomain(host, domain) {
  const normalizedHost = normalizedDomain(host);
  const normalizedProjectDomain = normalizedDomain(domain);
  return Boolean(
    normalizedHost
    && normalizedProjectDomain
    && (
      normalizedHost === normalizedProjectDomain
      || normalizedHost.endsWith(`.${normalizedProjectDomain}`)
    )
  );
}

function citationOwnership(url, project) {
  if (project.domains.some((domain) => hostMatchesDomain(url.hostname, domain))) {
    return 'owned';
  }
  const repository = parsedHttpUrl(project.repositoryUrl);
  if (!repository || url.origin !== repository.origin) return 'external';
  const repositoryPath = repository.pathname.replace(/\/?(?:\.git)?$/, '').replace(/\/$/, '');
  const citationPath = url.pathname.replace(/\/$/, '');
  return citationPath === repositoryPath || citationPath.startsWith(`${repositoryPath}/`)
    ? 'owned'
    : 'external';
}

function citationSourceSummary(project) {
  const citations = project.aiVisibility?.latest?.citations ?? {};
  const sources = [];
  const representedHosts = new Set();
  for (const value of citations.urls ?? []) {
    const url = parsedHttpUrl(value);
    if (!url) continue;
    const host = normalizedDomain(url.hostname);
    representedHosts.add(host);
    sources.push({
      url: url.href,
      host,
      ownership: citationOwnership(url, project),
    });
  }
  for (const value of citations.hosts ?? []) {
    const host = normalizedDomain(value);
    if (!host || representedHosts.has(host)) continue;
    sources.push({
      url: null,
      host,
      ownership: project.domains.some((domain) => hostMatchesDomain(host, domain))
        ? 'owned'
        : 'unclassified',
    });
  }
  const boundedSources = sources.slice(0, 50);
  return {
    total: Number.isFinite(Number(citations.total)) ? Number(citations.total) : 0,
    owned: boundedSources.filter((source) => source.ownership === 'owned').length,
    external: boundedSources.filter((source) => source.ownership === 'external').length,
    unclassified: boundedSources.filter((source) => source.ownership === 'unclassified').length,
    sources: boundedSources,
  };
}

function historicalSignal({ label, unit = null, direction = null, source = null, series = [] }) {
  const normalized = series
    .filter(
      (point) =>
        Number.isFinite(Number(point?.value)) &&
        point?.observedAt &&
        Number.isFinite(Date.parse(point.observedAt)),
    )
    .map((point) => ({
      observedAt: point.observedAt,
      value: Number(point.value),
    }))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
    .slice(-60);
  if (normalized.length === 0) return null;
  const latest = normalized.at(-1);
  const previous = normalized.at(-2) ?? null;
  return {
    label,
    value: latest.value,
    previousValue: previous?.value ?? null,
    delta: previous ? latest.value - previous.value : null,
    unit,
    direction,
    source,
    observedAt: latest.observedAt,
    history: previous ? 'comparable' : 'baseline-only',
    series: normalized,
  };
}

function metricSignals(metrics = []) {
  const grouped = new Map();
  for (const metric of metrics) {
    const key = `${metric.metricName}\u0000${metric.unit ?? ''}`;
    const values = grouped.get(key) ?? [];
    values.push(metric);
    grouped.set(key, values);
  }
  return [...grouped.values()]
    .map((values) => historicalSignal({
      label: values[0].metricName,
      unit: values[0].unit,
      direction: values[0].direction,
      series: values.map((value) => ({
        observedAt: value.observedAt,
        value: value.value,
      })),
    }))
    .filter(Boolean);
}

function designReviewEvidence(fleetRoot, projects) {
  const policyPath = resolve(fleetRoot, 'foundry/ops/config/design-workflow.json');
  const policy = readJson(policyPath);
  const snapshotPath = resolve(
    fleetRoot,
    'foundry/ops/data/design-reviews/latest.json',
  );
  const snapshotByProject = new Map();
  try {
    const snapshot = validateDesignReviewSnapshot(readJson(snapshotPath), {
      projectIds: projects.map((project) => project.id),
      policySha256: sha256(readFileSync(policyPath)),
    });
    for (const review of snapshot.projects) {
      snapshotByProject.set(review.projectId, {
        projectId: review.projectId,
        critique: review.critique.score,
        critiqueMaximum: review.critique.maximum,
        audit: review.audit.score,
        auditMaximum: review.audit.maximum,
        ownerDecision: review.ownerDecision,
        observedAt: null,
        evidenceSource: 'snapshot',
        receiptSha256: review.receiptSha256,
      });
    }
  } catch {}

  for (const project of projects) {
    if (!project.repo) continue;
    const projectRoot = project.id === 'fleet-workspace'
      ? resolve(fleetRoot, 'foundry/apps/dashboard/fleet-console')
      : resolve(fleetRoot, project.repo);
    const receiptPath = resolve(projectRoot, '.fleet/design-review.json');
    if (existsSync(receiptPath)) snapshotByProject.delete(project.id);
    const receipt = readJson(receiptPath);
    try {
      validateDesignReviewEvidence(receipt, policy, { projectRoot });
    } catch {
      continue;
    }
    let observedAt = null;
    try {
      observedAt = statSync(receiptPath).mtime.toISOString();
    } catch {}
    snapshotByProject.set(project.id, {
      projectId: project.id,
      critique: receipt.evidence.critique.score,
      critiqueMaximum: receipt.evidence.critique.maximum,
      audit: receipt.evidence.audit.score,
      auditMaximum: receipt.evidence.audit.maximum,
      ownerDecision: receipt.ownerFeedback?.decision ?? 'pending',
      observedAt,
      evidenceSource: 'direct',
    });
  }

  return projects.flatMap((project) => (
    snapshotByProject.has(project.id)
      ? [snapshotByProject.get(project.id)]
      : []
  ));
}

function outcomeFamilySummary(family) {
  if (!family?.latest) return null;
  const latestMetricLabels = new Set(family.latest.metrics.map((metric) => metric.label));
  return {
    observations: family.observations,
    provider: family.latest.provider,
    providerUrl: family.latest.providerUrl ?? null,
    scope: family.latest.scope,
    observedAt: family.latest.observedAt,
    period: family.latest.period,
    searchTerms: family.latest.searchTerms ?? [],
    indexInspection: family.latestIndexInspection?.indexInspection ?? family.latest.indexInspection ?? null,
    breakdowns: family.latest.breakdowns ?? [],
    metrics: family.metrics
      .filter((metric) => latestMetricLabels.has(metric.label))
      .map((metric) => ({
        label: metric.label,
        value: metric.series.at(-1)?.value ?? null,
        unit: metric.unit,
        direction: metric.direction,
      })),
  };
}

function signalByLabel(project, label) {
  return project.history.signals.find((signal) => signal.label === label) ?? null;
}

function latestFamilySignal(project, outcome, label) {
  if (!outcome) return null;
  const metric = outcome.metrics?.find((item) => item.label === label);
  if (!metric) return null;
  const history = signalByLabel(project, label);
  return {
    ...(history ?? {}),
    ...metric,
    label,
    value: metric.value,
    observedAt: outcome.observedAt,
    source: outcome.provider,
    providerUrl: outcome.providerUrl ?? null,
  };
}

function normalizedSearchQuery(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function latestTrackedQueries(project, searchTerms = []) {
  const termsByQuery = new Map();
  for (const term of searchTerms) {
    const key = normalizedSearchQuery(term.query);
    const current = termsByQuery.get(key);
    if (!current || Number(term.impressions ?? 0) > Number(current.impressions ?? 0)) {
      termsByQuery.set(key, term);
    }
  }
  return (project.searchVisibility?.queries ?? [])
    .map((query) => {
      const latest = query.history?.at(-1);
      const searchConsole = termsByQuery.get(normalizedSearchQuery(query.text));
      return {
        id: query.id,
        kind: query.kind,
        text: query.text,
        rootDomain: query.rootDomain,
        collision: query.collision,
        liveSearch: latest && ['A', 'B', 'C'].includes(latest.class)
          ? { state: 'observed', class: latest.class, observedAt: latest.observedAt }
          : { state: 'not-observed' },
        searchConsole: searchConsole
          ? {
              state: 'observed',
              impressions: Number(searchConsole.impressions ?? 0),
              clicks: Number(searchConsole.clicks ?? 0),
              position: Number(searchConsole.position),
              landingPage: searchConsole.landingPage ?? null,
            }
          : { state: 'not-observed' },
      };
    })
    .slice(0, 12);
}

function latestOutcomeSignal(project, outcome, label) {
  if (!outcome) return null;
  const history = signalByLabel(project, label);
  const metric = outcome.metrics?.find((item) => item.label === label);
  if (!metric) {
    if (!history) return null;
    return {
      ...history,
      value: null,
      observedAt: outcome.observedAt,
      source: 'Google Search Console',
    };
  }
  return {
    ...history,
    ...metric,
    label,
    value: metric.value,
    observedAt: outcome.observedAt,
    source: 'Google Search Console',
    series: history?.series ?? [{ observedAt: outcome.observedAt, value: metric.value }],
  };
}

function buildOwnerOutcomeProjection({
  projectOutputs,
  latestIndexingRequestByProject,
  latestSearchChangeByProject,
}) {
  const publicProjects = projectOutputs.filter(
    (project) => project.metricEligibility?.publicSite === true,
  );
  const searchProjects = projectOutputs.filter(
    (project) => project.metricEligibility?.searchConsole === true,
  );
  const domainProjects = projectOutputs.filter(
    (project) => project.metricEligibility?.domainCoverage === true,
  );
  const domainGroups = new Map();
  for (const project of domainProjects) {
    const authority = project.metricSemantics?.seo?.domainAuthority ?? {};
    const domain = authority.rootDomain ?? authority.domain ?? project.domains[0] ?? null;
    if (!domain) continue;
    const current = domainGroups.get(domain) ?? {
      domain,
      projects: [],
      signal: null,
      observedAt: null,
      source: authority.source ?? 'Drank · Ahrefs public endpoint',
    };
    if (project.metricEligibility?.publicSite === true) {
      current.projects.push({ projectId: project.projectId, name: project.name });
    }
    const signal = signalByLabel(project, 'Domain rating');
    const signalTime = signal?.observedAt ? Date.parse(signal.observedAt) : Number.NaN;
    const currentTime = current.signal?.observedAt
      ? Date.parse(current.signal.observedAt)
      : Number.NaN;
    if (
      signal &&
      (!current.signal || (Number.isFinite(signalTime) && signalTime > currentTime))
    ) {
      current.signal = signal;
      current.observedAt = signal.observedAt;
    }
    domainGroups.set(domain, current);
  }

  const performanceThresholds = {
    psiScore: 90,
    lcpMilliseconds: 2500,
    fieldLcpMilliseconds: 2500,
    fieldInpMilliseconds: 200,
    fieldCls: 0.1,
  };
  const performanceRows = publicProjects.map((project) => {
    const psi = signalByLabel(project, 'PSI performance');
    const lcp = signalByLabel(project, 'PSI LCP');
    const field = project.fieldPerformance?.outcome ?? null;
    const fieldLcp = latestFamilySignal(project, field, 'Field LCP');
    const fieldInp = latestFamilySignal(project, field, 'Field INP');
    const fieldCls = latestFamilySignal(project, field, 'Field CLS');
    let status = 'not-measured';
    let labPasses = false;
    if (psi && lcp) {
      status = 'needs-work';
      labPasses = (
        psi.value >= performanceThresholds.psiScore &&
        lcp.value <= performanceThresholds.lcpMilliseconds
      );
      if (labPasses) status = 'fast-enough';
    }
    const fieldFails = (
      (Number.isFinite(fieldLcp?.value) && fieldLcp.value > performanceThresholds.fieldLcpMilliseconds) ||
      (Number.isFinite(fieldInp?.value) && fieldInp.value > performanceThresholds.fieldInpMilliseconds) ||
      (Number.isFinite(fieldCls?.value) && fieldCls.value > performanceThresholds.fieldCls)
    );
    if (fieldFails) {
      const labObservedAt = newestTimestamp([psi?.observedAt, lcp?.observedAt]);
      const fieldObservedAt = field?.observedAt ?? null;
      const fieldPredatesPassingLab = (
        labPasses &&
        Number.isFinite(Date.parse(labObservedAt)) &&
        Number.isFinite(Date.parse(fieldObservedAt)) &&
        Date.parse(fieldObservedAt) < Date.parse(labObservedAt)
      );
      status = fieldPredatesPassingLab ? 'monitoring' : 'needs-work';
    }
    return {
      projectId: project.projectId,
      name: project.name,
      domain: project.domains[0] ?? null,
      status,
      psi,
      lcp,
      fieldLcp,
      fieldInp,
      fieldCls,
      fieldTtfb: latestFamilySignal(project, field, 'Field TTFB'),
      rumSamples: latestFamilySignal(project, field, 'RUM samples'),
      field,
      providerUrl: cloudflareSpeedProviderUrl(project, field),
      observedAt: newestTimestamp([
        project.metricSemantics?.performance?.observedAt,
        field?.observedAt,
      ]),
    };
  });

  const searchRows = searchProjects.map((project) => {
    const outcome = project.searchVisibility?.outcome ?? null;
    const impressions = latestOutcomeSignal(project, outcome, 'Search impressions');
    const clicks = latestOutcomeSignal(project, outcome, 'Search clicks');
    const averagePosition = latestOutcomeSignal(project, outcome, 'Search average position');
    let status = 'not-measured';
    if (outcome) status = 'zero-impressions';
    if (outcome && Number(impressions?.value) > 0) status = 'observed';
    const searchTerms = (outcome?.searchTerms ?? []).map((term) => ({
      ...term,
      action: searchAction({
        observed: true,
        impressions: Number(term.impressions),
        clicks: Number(term.clicks),
        position: Number(term.position),
        sampleFloor: SEARCH_ACTION_SAMPLE_FLOORS.query,
      }),
    }));
    const indexingRequest = latestIndexingRequestByProject.get(project.projectId) ?? null;
    const searchChangeReceipt = latestSearchChangeByProject.get(project.projectId) ?? null;
    const action = projectSearchAction({
      observed: Boolean(outcome),
      impressions: Number(impressions?.value ?? 0),
      clicks: Number(clicks?.value ?? 0),
      position: Number(averagePosition?.value ?? Number.POSITIVE_INFINITY),
      inspection: outcome?.indexInspection ?? null,
      observedAt: outcome?.observedAt ?? null,
      indexingRequestedAt: indexingRequest?.requestedAt ?? null,
      searchTerms,
      changeReceipt: searchChangeReceipt,
    });
    return {
      projectId: project.projectId,
      catalogProjectId: project.catalogProjectId,
      name: project.name,
      domain: project.domains[0] ?? null,
      status,
      action,
      impressions,
      clicks,
      ctr: latestOutcomeSignal(project, outcome, 'Search CTR'),
      averagePosition,
      observations: outcome?.observations ?? 0,
      searchTerms,
      indexInspection: outcome?.indexInspection ?? null,
      indexingRequest,
      searchChangeReceipt,
      trackedQueries: latestTrackedQueries(project, searchTerms),
      provider: outcome?.provider ?? null,
      providerUrl: outcome?.providerUrl ?? searchConsoleProviderUrl(
        String(outcome?.scope ?? '').split(' · page:')[0],
      ),
      scope: outcome?.scope ?? null,
      period: outcome?.period ?? null,
      observedAt: outcome?.observedAt ?? null,
    };
  });

  const coreAiRows = publicProjects
    .filter((project) => project.priority === 'P1' && project.lifecycle === 'maintained')
    .map((project) => {
      const mention = signalByLabel(project, 'AI mention rate');
      let status = 'not-measured';
      if (project.aiVisibility?.observations > 0 && Number.isFinite(mention?.value)) {
        status = 'not-known';
        if (mention.value > 0) status = 'known';
      }
      const crawler = project.aiVisibility?.discovery?.crawler ?? null;
      const referral = project.aiVisibility?.discovery?.referral ?? null;
      const citationSources = citationSourceSummary(project);
      return {
        projectId: project.projectId,
        name: project.name,
        domain: project.domains[0] ?? null,
        status,
        observations: project.aiVisibility?.observations ?? 0,
        observedAt: project.aiVisibility?.observedAt ?? null,
        discoveryObservedAt: newestTimestamp([
          crawler?.observedAt,
          referral?.observedAt,
        ]),
        mention,
        recommendation: signalByLabel(project, 'AI recommendation rate'),
        citation: signalByLabel(project, 'AI citation rate'),
        averageRank: signalByLabel(project, 'AI average rank'),
        questions: (project.aiVisibility?.questions ?? []).slice(0, 12),
        coverage: project.aiVisibility?.latest?.coverage ?? null,
        attempts: (project.aiVisibility?.latest?.attempts ?? []).slice(0, 24),
        citationSources,
        crawlerRequests: latestFamilySignal(project, crawler, 'AI crawler requests'),
        aiReferralVisits: latestFamilySignal(project, referral, 'AI referral visits'),
        discovery: { crawler, referral },
      };
    });

  const aiCoverageProjects = projectOutputs
    .filter(
      (project) =>
        project.lifecycle === 'maintained' && project.aiVisibility?.configured === true,
    )
    .map((project) => ({
      projectId: project.projectId,
      name: project.name,
      observed: (project.aiVisibility?.observations ?? 0) > 0,
      observations: project.aiVisibility?.observations ?? 0,
      observedAt: project.aiVisibility?.observedAt ?? null,
      evidenceMode: project.aiVisibility?.evidenceMode ?? null,
    }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const observedAiProjects = aiCoverageProjects.filter((project) => project.observed);
  const unobservedAiProjects = aiCoverageProjects.filter((project) => !project.observed);

  return {
    domains: [...domainGroups.values()]
      .map((entry) => ({
        ...entry,
        projects: entry.projects.sort((left, right) => left.name.localeCompare(right.name)),
        historyState: entry.signal?.history ?? 'unmeasured',
      }))
      .sort((left, right) => left.domain.localeCompare(right.domain)),
    coreAi: coreAiRows.sort((left, right) => left.name.localeCompare(right.name)),
    aiCoverage: {
      total: aiCoverageProjects.length,
      observedCount: observedAiProjects.length,
      unobservedCount: unobservedAiProjects.length,
      observed: observedAiProjects,
      unobserved: unobservedAiProjects,
    },
    performance: performanceRows.sort((left, right) => left.name.localeCompare(right.name)),
    search: searchRows.sort((left, right) => left.name.localeCompare(right.name)),
    performanceThresholds,
  };
}

function buildProjectOutputs({
  projects,
  skills,
  workflows,
  drank,
  psi,
  aiProjects,
  designReviews,
  searchVisibility,
  visibilityMetrics,
  visibilityOutcomes,
  searchConsoleProjectIds,
}) {
  const skillProjects = new Map(skills.projects.map((project) => [project.projectId, project]));
  const workflowProjects = new Map(
    workflows.projects.map((project) => [project.projectId, project]),
  );
  const drankDomains = new Map(
    drank.domains.map((domain) => [normalizedDomain(domain.domain), domain]),
  );
  const psiDomains = new Map(
    psi.domains.map((domain) => [normalizedDomain(domain.domain), domain]),
  );
  const aiByProject = new Map(aiProjects.map((project) => [project.projectId, project]));
  const designByProject = new Map(
    designReviews.map((review) => [review.projectId, review]),
  );
  const searchByProject = new Map(
    searchVisibility.map((project) => [project.projectId, project]),
  );
  const visibilityByProject = new Map(
    visibilityMetrics.map((project) => [project.projectId, project]),
  );
  const outcomesByProject = new Map(
    visibilityOutcomes.map((project) => [project.projectId, project]),
  );
  const domainRootCounts = new Map();
  for (const project of projects) {
    for (const domain of (project.domains ?? []).map(normalizedDomain).filter(Boolean)) {
      const root = registrableDomain(domain);
      domainRootCounts.set(root, (domainRootCounts.get(root) ?? 0) + 1);
    }
  }

  return projects
    .map((project) => {
      const domains = (project.domains ?? []).map(normalizedDomain).filter(Boolean);
      const publicMetricSite = isPublicMetricProject(project);
      const domainCoverage = isDomainStrengthProject(project);
      let projectId = project.id;
      if (project.lifecycle === 'past' || project.tier === 'non-product') {
        projectId = project.public?.id ?? project.id;
      }
      const skill = skillProjects.get(project.id) ?? null;
      const workflow = workflowProjects.get(project.id) ?? null;
      const domainRating = domains.map((domain) => drankDomains.get(domain)).find(Boolean) ?? null;
      const performance = domains.map((domain) => psiDomains.get(domain)).find(Boolean) ?? null;
      const ai = aiByProject.get(project.id) ?? null;
      const designReview = designByProject.get(project.id) ?? null;
      const search = searchByProject.get(project.id) ?? null;
      const readiness = visibilityByProject.get(project.id)?.families ?? {};
      const outcomes = outcomesByProject.get(project.id)?.families ?? {};
      const metrics = metricSignals(skill?.metrics ?? []);
      const aiHistory = [...(ai?.history ?? [])].sort(
        (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
      );
      const aiOutcomeHistory = aiHistory.filter(
        (item) => aiRunEvidenceMode(item) === 'provider-observation',
      );
      const aiFixtureHistory = aiHistory.filter((item) => aiRunEvidenceMode(item) === 'fixture');
      const latestAiOutcome = aiOutcomeHistory.at(-1) ?? null;
      const latestAiFixture = aiFixtureHistory.at(-1) ?? null;
      const aiSignals = [
        historicalSignal({
          label: 'AI visibility score',
          unit: 'score/100',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: item.metrics?.visibilityScore,
          })),
        }),
        historicalSignal({
          label: 'AI mention rate',
          unit: 'percent',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: Number(item.metrics?.mentionRate) * 100,
          })),
        }),
        historicalSignal({
          label: 'AI recommendation rate',
          unit: 'percent',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: Number(item.metrics?.recommendationRate) * 100,
          })),
        }),
        historicalSignal({
          label: 'AI citation rate',
          unit: 'percent',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: Number(item.metrics?.citationRate) * 100,
          })),
        }),
        historicalSignal({
          label: 'AI coverage rate',
          unit: 'percent',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: Number(item.metrics?.coverageRate) * 100,
          })),
        }),
        historicalSignal({
          label: 'AI average rank',
          unit: 'rank',
          direction: 'lower-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: item.metrics?.averagePosition,
          })),
        }),
        historicalSignal({
          label: 'AI citations',
          unit: 'citations',
          direction: 'higher-is-better',
          source: 'AI Visibility provider observation',
          series: aiOutcomeHistory.map((item) => ({
            observedAt: item.observedAt,
            value: item.citations?.total,
          })),
        }),
      ].filter(Boolean);
      const searchSignal = historicalSignal({
        label: 'Worst tracked query class',
        unit: 'class',
        direction: 'higher-is-better',
        source: 'GEO Observatory · current web search',
        series: search?.series ?? [],
      });
      const outcomeSignals = Object.values(outcomes).flatMap((family) =>
        family.metrics.map((metric) =>
          historicalSignal({
            label: metric.label,
            unit: metric.unit,
            direction: metric.direction,
            source: {
              'google-search-console': 'Google Search Console',
              'cloudflare-ai-crawl-control': 'Cloudflare AI Crawl Control',
              'cloudflare-web-analytics': 'Cloudflare Web Analytics',
            }[metric.source] ?? metric.source,
            series: metric.series,
          }),
        ),
      ).filter(Boolean);
      const readinessSignals = Object.entries(readiness).flatMap(([familyId, family]) =>
        family.metrics.map((metric) =>
          historicalSignal({
            label: metric.label,
            unit: metric.unit,
            direction: metric.direction,
            source: {
              agent: 'AI Agent Readiness audit',
              crawl: 'AI Crawlability audit',
              coverage: 'Content Coverage inventory',
            }[familyId] ?? 'Visibility audit',
            series: metric.series,
          }),
        ),
      ).filter(Boolean);
      const produced = [];
      if (skill) {
        produced.push({
          kind: 'skill',
          label: 'Skill runs',
          value: skill.runCount,
          detail: `${skill.outputCount} captured outputs · ${skill.metricCount} metrics`,
          observedAt: skill.newestRunAt,
          freshness: skills.freshness,
        });
      }
      if (workflow?.availability) {
        produced.push({
          kind: 'availability',
          label: 'Availability check',
          value: workflow.availability.ok ? 'Passed' : 'Failed',
          detail: workflow.availability.freshness,
          observedAt: workflow.availability.observedAt,
          freshness: workflow.availability.freshness,
        });
      }
      if (workflow?.performance) {
        produced.push({
          kind: 'http-performance',
          label: 'HTTP performance',
          value: `${Math.round(workflow.performance.totalP50Ms)} ms`,
          detail: `p50 · ${workflow.performance.ok ? 'passed' : 'failed'}`,
          observedAt: workflow.performance.observedAt,
          freshness: workflow.performance.freshness,
        });
      }
      if (performance) {
        produced.push({
          kind: 'psi',
          label: 'PSI measurements',
          value: performance.runs,
          detail: Number.isFinite(performance.latest?.performanceScore)
            ? `latest score ${Math.round(performance.latest.performanceScore)}`
            : 'score unavailable',
          observedAt: performance.latest?.observedAt ?? psi.observedAt,
          freshness: psi.freshness,
        });
      }
      if (domainRating) {
        produced.push({
          kind: 'domain-rating',
          label: 'Domain rating history',
          value: domainRating.observations,
          detail: Number.isFinite(domainRating.rating)
            ? `current rating ${domainRating.rating}`
            : 'rating unavailable',
          observedAt: domainRating.observedAt,
          freshness: drank.freshness,
        });
      }
      if (latestAiOutcome) {
        produced.push({
          kind: 'ai-visibility',
          label: 'AI visibility',
          value: aiOutcomeHistory.length,
          detail: 'provider-backed observation available',
          observedAt: latestAiOutcome.observedAt,
          freshness: latestAiOutcome.freshness ?? 'recorded',
        });
      }
      if (latestAiFixture) {
        produced.push({
          kind: 'ai-visibility-fixture',
          label: 'AI fixture canary',
          value: aiFixtureHistory.length,
          detail: 'runner evidence only · not a visibility outcome',
          observedAt: latestAiFixture.observedAt,
          freshness: latestAiFixture.freshness ?? 'recorded',
        });
      }
      if (designReview) {
        produced.push({
          kind: 'design-review',
          label: 'Design critique',
          value: `${designReview.critique}/${designReview.critiqueMaximum}`,
          detail: `audit ${designReview.audit}/${designReview.auditMaximum} · owner ${designReview.ownerDecision}`,
          observedAt: designReview.observedAt,
          freshness: 'fresh',
        });
      }
      if (searchSignal) {
        produced.push({
          kind: 'search-visibility',
          label: 'Search visibility',
          value: { 3: 'A', 2: 'B', 1: 'C' }[searchSignal.value] ?? '—',
          detail: `${searchSignal.series.length} dated query sets`,
          observedAt: searchSignal.observedAt,
          freshness: 'recorded',
        });
      }
      for (const [familyId, family] of Object.entries(outcomes)) {
        if (!family.latest) continue;
        produced.push({
          kind: `visibility-outcome-${familyId}`,
          label: {
            search: 'Search Console outcome',
            'ai-crawl': 'AI crawler activity',
            'ai-referral': 'AI referral traffic',
            'web-traffic': 'Web traffic',
            'web-vitals': 'Real-user performance',
          }[familyId] ?? familyId,
          value: family.observations,
          detail: `${family.latest.provider} · ${family.latest.scope}`,
          observedAt: family.latest.observedAt,
          freshness: 'recorded',
        });
      }
      for (const [familyId, family] of Object.entries(readiness)) {
        if (!family.latest) continue;
        produced.push({
          kind: `visibility-${familyId}`,
          label: {
            agent: 'AI Agent Readiness',
            crawl: 'AI Crawlability',
            coverage: 'Content Coverage',
          }[familyId] ?? familyId,
          value: family.latest.status,
          detail: family.latest.summary,
          observedAt: family.latest.observedAt,
          freshness: 'recorded',
        });
      }

      const historySignals = [
        ...metrics,
        historicalSignal({
          label: 'Design critique',
          unit: `score/${designReview?.critiqueMaximum ?? 40}`,
          direction: 'higher-is-better',
          source: 'Validated design-review receipt',
          series: designReview ? [{
            observedAt: designReview.observedAt,
            value: designReview.critique,
          }] : [],
        }),
        historicalSignal({
          label: 'Design audit',
          unit: `score/${designReview?.auditMaximum ?? 20}`,
          direction: 'higher-is-better',
          source: 'Validated design-review receipt',
          series: designReview ? [{
            observedAt: designReview.observedAt,
            value: designReview.audit,
          }] : [],
        }),
        historicalSignal({
          label: 'PSI performance',
          unit: 'score/100',
          direction: 'higher-is-better',
          source: 'PSI Swarm',
          series: (performance?.series ?? []).map((item) => ({
            observedAt: item.observedAt,
            value: item.performanceScore,
          })),
        }),
        historicalSignal({
          label: 'PSI LCP',
          unit: 'milliseconds',
          direction: 'lower-is-better',
          source: 'PSI Swarm',
          series: (performance?.series ?? []).map((item) => ({
            observedAt: item.observedAt,
            value: item.lcp,
          })),
        }),
        historicalSignal({
          label: 'PSI CLS',
          unit: 'score',
          direction: 'lower-is-better',
          source: 'PSI Swarm',
          series: (performance?.series ?? []).map((item) => ({
            observedAt: item.observedAt,
            value: item.cls,
          })),
        }),
        historicalSignal({
          label: 'Domain rating',
          unit: 'rating',
          direction: 'higher-is-better',
          source: 'Drank · Ahrefs public endpoint',
          series: domainRating?.series ?? [],
        }),
        searchSignal,
        ...outcomeSignals,
        ...readinessSignals,
        ...aiSignals,
      ].filter(Boolean);
      const webTrafficOutcome = outcomeFamilySummary(outcomes['web-traffic']);
      const webVitalsOutcome = outcomeFamilySummary(outcomes['web-vitals']);
      const aiVisibilityOutput = {
        configured: Boolean(ai),
        observations: aiOutcomeHistory.length,
        observedAt: latestAiOutcome?.observedAt ?? null,
        evidenceMode: aiRunEvidenceMode(latestAiOutcome),
        source: latestAiOutcome ? 'AI Visibility provider observation' : null,
        fixture: {
          observations: aiFixtureHistory.length,
          observedAt: latestAiFixture?.observedAt ?? null,
          source: 'AI Visibility fixture canary',
        },
        questions: ai?.questions ?? [],
        latest: latestAiOutcome
          ? {
              runId: latestAiOutcome.runId,
              promptSetId: latestAiOutcome.promptSetId ?? null,
              coverage: latestAiOutcome.coverage ?? null,
              citations: latestAiOutcome.citations ?? { total: 0, hosts: [], urls: [] },
              attempts: latestAiOutcome.attempts ?? [],
            }
          : null,
        discovery: {
          crawler: outcomeFamilySummary(outcomes['ai-crawl']),
          referral: outcomeFamilySummary(outcomes['ai-referral']),
        },
      };
      return {
        projectId,
        catalogProjectId: project.id,
        name: project.name ?? project.id,
        description: project.public?.description ?? null,
        priority: project.priority ?? null,
        tier: project.tier ?? null,
        attention: project.attention ?? null,
        lifecycle: project.lifecycle ?? null,
        status: project.status ?? null,
        domains,
        repositoryUrl: project.repositoryUrl ?? project.public?.repositoryUrl ?? null,
        metricEligibility: {
          publicSite: publicMetricSite,
          domainCoverage,
          searchConsole: searchConsoleProjectIds.has(project.id),
        },
        produced,
        skill: skill
          ? {
              runCount: skill.runCount,
              succeeded: skill.succeeded,
              failed: skill.failed,
              outputCount: skill.outputCount,
              outputBytes: skill.outputBytes,
              metricCount: skill.metricCount,
              skills: skill.skills,
              newestRunAt: skill.newestRunAt,
            }
          : null,
        public: workflow ?? null,
        performance,
        domainRating: domainRating
          ? {
              ...domainRating,
              source: 'Drank · Ahrefs public endpoint',
              rootDomain: registrableDomain(domainRating.domain),
              sharedRoot:
                (domainRootCounts.get(registrableDomain(domainRating.domain)) ?? 0) > 1,
              inherited: false,
            }
          : null,
        designReview,
        webTraffic: {
          outcome: webTrafficOutcome,
        },
        fieldPerformance: {
          outcome: webVitalsOutcome,
        },
        aiVisibility: aiVisibilityOutput,
        searchVisibility: {
          configured: search?.configured === true,
          observations: search?.series?.length ?? 0,
          observedAt: searchSignal?.observedAt ?? null,
          queries: search?.queries ?? [],
          outcome: outcomeFamilySummary(outcomes.search),
        },
        visibilityReadiness: Object.fromEntries(
          ['agent', 'crawl', 'coverage'].map((familyId) => [
            familyId,
            readiness[familyId]?.latest
              ? {
                  status: readiness[familyId].latest.status,
                  summary: readiness[familyId].latest.summary,
                  observedAt: readiness[familyId].latest.observedAt,
                  observations: readiness[familyId].metrics.reduce(
                    (maximum, metric) => Math.max(maximum, metric.series.length),
                    0,
                  ),
                }
              : null,
          ]),
        ),
        metricSemantics: {
          seo: {
            domainAuthority: domainRating
              ? {
                  kind: 'domain',
                  status: 'measured',
                  source: 'Drank · Ahrefs public endpoint',
                  observedAt: domainRating.observedAt,
                  domain: domainRating.domain,
                  rootDomain: registrableDomain(domainRating.domain),
                  sharedRoot:
                    (domainRootCounts.get(registrableDomain(domainRating.domain)) ?? 0) > 1,
                  inherited: false,
                }
              : {
                  kind: 'domain',
                  status: 'not-measured',
                  source: 'Drank · Ahrefs public endpoint',
                  observedAt: null,
                  domain: domains[0] ?? null,
                  rootDomain: registrableDomain(domains[0]),
                  sharedRoot: false,
                  inherited: false,
                },
            searchOutcome: {
              kind: 'outcome',
              status: outcomes.search?.latest ? 'measured' : 'not-measured',
              source: 'Google Search Console',
              observedAt: outcomes.search?.latest?.observedAt ?? null,
              reason: outcomes.search?.latest ? null : 'Search Console is not connected.',
            },
            trackedSearch: {
              kind: 'observation',
              status: searchSignal ? 'measured' : 'not-measured',
              source: 'GEO Observatory · current web search',
              observedAt: searchSignal?.observedAt ?? null,
            },
          },
          geo: {
            aiVisibility: {
              kind: 'outcome',
              status: latestAiOutcome ? 'measured' : 'not-measured',
              source: latestAiOutcome ? 'AI Visibility provider observation' : null,
              observedAt: latestAiOutcome?.observedAt ?? null,
              reason: latestAiOutcome ? null : 'No provider-backed observation.',
            },
            technicalReadiness: {
              kind: 'readiness',
              status: readiness.agent?.latest ? 'measured' : 'not-measured',
              source: 'AI Agent Readiness audit',
              observedAt: readiness.agent?.latest?.observedAt ?? null,
            },
            fixtureCanary: {
              kind: 'fixture',
              status: latestAiFixture ? 'recorded' : 'not-recorded',
              source: 'AI Visibility fixture canary',
              observedAt: latestAiFixture?.observedAt ?? null,
            },
            crawlerActivity: {
              kind: 'outcome',
              status: outcomes['ai-crawl']?.latest ? 'measured' : 'not-measured',
              source: 'Cloudflare AI Crawl Control',
              observedAt: outcomes['ai-crawl']?.latest?.observedAt ?? null,
            },
            referralTraffic: {
              kind: 'outcome',
              status: outcomes['ai-referral']?.latest ? 'measured' : 'not-measured',
              source: 'Cloudflare Web Analytics',
              observedAt: outcomes['ai-referral']?.latest?.observedAt ?? null,
            },
          },
          performance: {
            source: 'PSI Swarm',
            observedAt: performance?.latest?.observedAt ?? null,
          },
          design: {
            source: 'Validated design-review receipt',
            observedAt: designReview?.observedAt ?? null,
          },
        },
        history: {
          state: historySignals.some((signal) => signal.history === 'comparable')
            ? 'comparable'
            : historySignals.length > 0
              ? 'baseline-only'
              : 'none',
          signals: historySignals,
        },
        lastObservedAt: newestTimestamp([
          skill?.newestRunAt,
          workflow?.availability?.observedAt,
          workflow?.performance?.observedAt,
          performance?.latest?.observedAt,
          domainRating?.observedAt,
          ai?.latest?.observedAt,
          designReview?.observedAt,
          searchSignal?.observedAt,
          ...Object.values(outcomes).map((family) => family.latest?.observedAt),
          ...Object.values(readiness).map((family) => family.latest?.observedAt),
        ]),
      };
    })
    .sort((left, right) => {
      const producedDifference = right.produced.length - left.produced.length;
      return producedDifference || left.name.localeCompare(right.name);
    });
}

function buildImprovementActions({ projectOutputs, connections }) {
  const actions = [];
  for (const item of connections) {
    if (!['missing', 'partial', 'unavailable'].includes(item.status) && item.freshness !== 'stale') {
      continue;
    }
    actions.push({
      id: `connection:${item.id}`,
      scope: 'system',
      projectId: null,
      severity: item.status === 'missing' ? 'high' : 'medium',
      signal: item.detail,
      action:
        item.status === 'missing'
          ? `Implement ${item.provider} → ${item.consumer}`
          : `Complete ${item.provider} → ${item.consumer}`,
      ownerPath: item.ownerPath,
    });
  }
  for (const project of projectOutputs) {
    if (project.public?.availability?.ok === false) {
      actions.push({
        id: `project:${project.projectId}:availability`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'high',
        signal: 'Latest public availability check failed.',
        action: `Restore ${project.name}'s public surface`,
        ownerPath: `/projects/${project.projectId}`,
      });
    }
    if (
      project.public?.performance?.ok === false &&
      project.public?.availability?.ok !== false
    ) {
      actions.push({
        id: `project:${project.projectId}:http-performance`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'high',
        signal: 'Latest public HTTP performance check failed.',
        action: `Repair ${project.name}'s public response path`,
        ownerPath: `/projects/${project.projectId}`,
      });
    }
    const score = project.performance?.latest?.performanceScore;
    if (Number.isFinite(score) && score < 80) {
      actions.push({
        id: `project:${project.projectId}:psi-score`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'medium',
        signal: `Latest PSI performance score is ${Math.round(score)}.`,
        action: `Improve ${project.name}'s measured performance`,
        ownerPath: `/projects/${project.projectId}`,
      });
    } else if (
      Number.isFinite(project.performance?.performanceDelta) &&
      project.performance.performanceDelta <= -5
    ) {
      actions.push({
        id: `project:${project.projectId}:psi-regression`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'medium',
        signal: `PSI performance fell ${Math.abs(Math.round(project.performance.performanceDelta))} points.`,
        action: `Investigate ${project.name}'s performance regression`,
        ownerPath: `/projects/${project.projectId}`,
      });
    }
    if (Number.isFinite(project.domainRating?.delta) && project.domainRating.delta < 0) {
      actions.push({
        id: `project:${project.projectId}:domain-rating`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'medium',
        signal: `Domain rating fell ${Math.abs(project.domainRating.delta)} point.`,
        action: `Recover ${project.name}'s domain authority`,
        ownerPath: `/projects/${project.projectId}`,
      });
    }
    if (project.aiVisibility?.configured && project.aiVisibility.observations === 0) {
      actions.push({
        id: `project:${project.projectId}:ai-baseline`,
        scope: 'project',
        projectId: project.projectId,
        severity: 'medium',
        signal: 'AI Visibility is configured but has no recorded baseline.',
        action: `Run ${project.name}'s first AI visibility baseline`,
        ownerPath: '/marketing',
      });
    }
  }
  const severity = { high: 0, medium: 1, low: 2 };
  return actions
    .sort(
      (left, right) =>
        severity[left.severity] - severity[right.severity] ||
        left.action.localeCompare(right.action),
    )
    .slice(0, 12);
}

export function buildFleetConnections({
  fleetRoot = resolve(import.meta.dirname, '../../../..'),
  home = process.env.HOME ?? '',
  now = new Date().toISOString(),
  marketing = null,
} = {}) {
  const projectCatalog = readJson(
    resolve(fleetRoot, 'foundry/ops/config/projects.json'),
    { projects: [] },
  );
  const maintainedProjects = visibilityProjects(projectCatalog).map((project) => ({
    ...project,
    priority: project.portfolio?.priority ?? null,
  }));
  const rootSearchQueries = validatedRootSearchQueries(fleetRoot, projectCatalog);
  const searchProjects = searchConsoleProjects(projectCatalog, rootSearchQueries);
  const searchConsoleProjectIds = new Set(searchProjects.map((project) => project.id));
  const drank = drankEvidence(fleetRoot, now);
  const psi = psiEvidence(home, now);
  const skills = skillEvidence(home, now);
  const designReviews = designReviewEvidence(fleetRoot, maintainedProjects);
  const searchVisibility = searchVisibilityEvidence(fleetRoot, projectCatalog, rootSearchQueries);
  const visibilityMetrics = visibilityMetricEvidence(home);
  const visibilityOutcomes = visibilityOutcomeEvidence(home);
  const latestIndexingRequestByProject = new Map();
  for (const request of readSearchIndexingRequests({
    path: defaultSearchIndexingRequestPath({ home }),
  })) {
    latestIndexingRequestByProject.set(request.projectId, request);
  }
  const latestSearchChangeByProject = new Map();
  for (const receipt of readSearchChangeReceipts({
    path: defaultSearchChangeReceiptPath({ home }),
  })) {
    latestSearchChangeByProject.set(receipt.projectId, receipt);
  }
  const workflows = workflowEvidence(fleetRoot, now);
  const visibleAiProjects = marketing?.aiVisibility?.projects ?? [];
  const measuredAiProjects = visibleAiProjects.flatMap((project) => {
    const latest = [...(project.history ?? [])]
      .filter((run) => aiRunEvidenceMode(run) === 'provider-observation')
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
    return latest ? [{ ...project, latest }] : [];
  });
  const configuredAiProjects = visibleAiProjects.length;
  const maintainedProjectIds = new Set(maintainedProjects.map((project) => project.id));
  const drankDomains = new Set(
    drank.domains.map((entry) => normalizedDomain(entry.domain)).filter(Boolean),
  );
  const retainedDrankProjects = (projectCatalog.projects ?? []).filter(
    (project) =>
      !maintainedProjectIds.has(project.id) &&
      (project.domains ?? [])
        .map(normalizedDomain)
        .filter(Boolean)
        .some((domain) => drankDomains.has(domain)),
  );
  const projectOutputProjects = [...new Map(
    [...searchProjects, ...maintainedProjects, ...retainedDrankProjects]
      .map((project) => [project.id, project]),
  ).values()];

  const componentList = [
    {
      id: 'ai-visibility',
      name: 'AI Visibility',
      bucketId: 'helpers',
      status: configuredAiProjects > 0 ? 'connected' : 'partial',
      headline:
        configuredAiProjects > 0
          ? `Evidence: ${measuredAiProjects.length}/${configuredAiProjects} configured products have provider-backed observations.`
          : 'The helper exists, but no Console portfolio is configured.',
      ownerPath: '/marketing',
      freshness: measuredAiProjects.length > 0 ? 'fresh' : 'unknown',
    },
    pathComponent({
      id: 'fleet-skills',
      name: 'Fleet skills',
      bucketId: 'skills',
      path: 'foundry/ops/skills',
      root: fleetRoot,
      headline: 'Canonical skills are installed into supported agent runtimes.',
      ownerPath: '/connections#bucket-skills',
    }),
    {
      id: 'skill-run-store',
      name: 'Skill run history',
      bucketId: 'skills',
      status: skills.readable ? 'connected' : 'unavailable',
      headline: skills.readable
        ? `${skills.status.runCount} runs and ${skills.status.metricCount} numeric observations retained.`
        : 'No readable machine-local run store is available.',
      ownerPath: '/connections#skill-runs',
      freshness: skills.freshness ?? 'unavailable',
    },
    pathComponent({
      id: 'public-directory',
      name: 'Public Directory',
      bucketId: 'public-apps',
      path: 'saas-maker/apps/showcase',
      root: fleetRoot,
      headline: `${maintainedProjects.length} maintained project identities are available to projections.`,
      ownerPath: '/projects',
    }),
    {
      id: 'drank',
      name: 'Drank',
      bucketId: 'helpers',
      status: drank.readable ? 'connected' : 'unavailable',
      headline: drank.readable
        ? `${drank.domainCount} domains have rating history.`
        : 'Domain-rating evidence is unavailable.',
      ownerPath: '/connections#domain-intelligence',
      freshness: drank.freshness,
    },
    {
      id: 'psi-swarm',
      name: 'PSI Swarm',
      bucketId: 'helpers',
      status: psi.readable ? 'connected' : 'unavailable',
      headline: psi.readable
        ? `${psi.runCount} successful performance runs across ${psi.tagCount} tags.`
        : 'Performance history is unavailable on this machine.',
      ownerPath: '/connections#domain-intelligence',
      freshness: psi.freshness,
    },
    {
      id: 'fleet-console',
      name: 'Fleet Console',
      bucketId: 'dashboard',
      status: 'connected',
      headline: 'Owner control now aggregates connection evidence across all buckets.',
      ownerPath: '/connections',
      freshness: 'fresh',
    },
  ];
  const components = new Map(componentList.map((item) => [item.id, item]));

  const evidence = {
    projects: [{
      provider: 'project-catalog',
      label: `${maintainedProjects.length} maintained identities`,
      observedAt: projectCatalog._meta?.updated ?? null,
      freshness: 'fresh',
    }],
    drank: [{
      provider: 'drank',
      label: `${drank.domainCount} domain histories`,
      observedAt: drank.observedAt,
      freshness: drank.freshness,
    }],
    psi: [{
      provider: 'psi-swarm',
      label: psi.readable ? `${psi.runCount} successful runs` : 'No readable history',
      observedAt: psi.observedAt,
      freshness: psi.freshness,
    }],
    skills: [{
      provider: 'skill-run-store',
      label: skills.readable
        ? `${skills.status.runCount} runs · ${skills.status.metricCount} metrics`
        : 'Store unavailable',
      observedAt: skills.status?.newestRunAt ?? null,
      freshness: skills.freshness ?? 'unavailable',
    }],
    ai: [{
      provider: 'ai-visibility',
      label: `${measuredAiProjects.length}/${configuredAiProjects} provider-backed outcomes`,
      observedAt: measuredAiProjects
        .map((project) => project.latest?.observedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
      freshness: measuredAiProjects.length > 0 ? 'fresh' : 'unknown',
    }],
  };

  const connections = [
    connection({
      id: 'catalog-to-directory',
      provider: 'project-catalog',
      consumer: 'public-directory',
      transport: 'Generated sanitized product projection',
      status: maintainedProjects.length > 0 ? 'connected' : 'unavailable',
      detail: 'Canonical project identity feeds the public SaaS Maker directory.',
      evidence: evidence.projects,
      ownerPath: '/projects',
      priority: 10,
    }),
    connection({
      id: 'catalog-to-console',
      provider: 'project-catalog',
      consumer: 'fleet-console',
      transport: 'Founder Control project projection',
      status: maintainedProjects.length > 0 ? 'connected' : 'unavailable',
      detail: 'Project identity and lifecycle are available in the owner view.',
      evidence: evidence.projects,
      ownerPath: '/projects',
      priority: 10,
    }),
    connection({
      id: 'ai-visibility-to-console',
      provider: 'ai-visibility',
      consumer: 'fleet-console',
      transport: 'Normalized visibility ledger',
      status: configuredAiProjects > 0 ? 'connected' : 'partial',
      detail: 'History, cost, citations, and recommendations reach AI awareness.',
      evidence: evidence.ai,
      ownerPath: '/ai-awareness',
      priority: 20,
    }),
    connection({
      id: 'drank-to-console',
      provider: 'drank',
      consumer: 'fleet-console',
      transport: 'Fleet domain-rating JSON',
      status: drank.readable ? 'connected' : 'unavailable',
      detail: 'Domain-rating history is summarized without copying Drank logic.',
      evidence: evidence.drank,
      ownerPath: '/connections#domain-intelligence',
      priority: 20,
    }),
    connection({
      id: 'psi-to-console',
      provider: 'psi-swarm',
      consumer: 'fleet-console',
      transport: 'Machine-local SQLite summary',
      status: psi.readable ? 'connected' : 'unavailable',
      detail: 'Performance history is summarized without exposing the database.',
      evidence: evidence.psi,
      ownerPath: '/connections#domain-intelligence',
      priority: 20,
    }),
    connection({
      id: 'skills-to-runtimes',
      provider: 'fleet-skills',
      consumer: 'agent-runtimes',
      transport: 'Repo-local installed skill links',
      status: components.get('fleet-skills').status,
      detail: 'Canonical skills are exposed without duplicating their source.',
      ownerPath: '/connections#skills-to-runtimes',
      priority: 30,
    }),
    connection({
      id: 'skill-runs-to-console',
      provider: 'skill-run-store',
      consumer: 'fleet-console',
      transport: 'Sanitized run and metric summary',
      status: skills.readable ? 'connected' : 'unavailable',
      detail: 'Run history and numeric observations now reach the final dashboard.',
      evidence: evidence.skills,
      ownerPath: '/connections#skill-runs',
      priority: 15,
    }),
    connection({
      id: 'public-workflows-to-console',
      provider: 'public-workflows',
      consumer: 'fleet-console',
      transport: 'Sanitized latest availability and performance reports',
      status: workflows.readable ? 'connected' : 'unavailable',
      detail: workflows.readable
        ? `${workflows.sites} public surfaces are summarized; ${workflows.failed} currently fail at least one report.`
        : 'No readable public workflow report is available.',
      evidence: workflows.summaries,
      ownerPath: '/connections#public-evidence',
      priority: 15,
    }),
  ];

  const buckets = BUCKETS.map((bucket) => ({
    ...bucket,
    status: bucketStatus(bucket, components),
    components: bucket.components.map((id) => components.get(id)),
  }));
  const gaps = connections
    .filter(
      (item) =>
        ['missing', 'partial', 'unavailable'].includes(item.status) ||
        item.freshness === 'stale',
    )
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const projectOutputs = buildProjectOutputs({
    projects: projectOutputProjects,
    skills,
    workflows,
    drank,
    psi,
    aiProjects: visibleAiProjects,
    designReviews,
    searchVisibility,
    visibilityMetrics,
    visibilityOutcomes,
    searchConsoleProjectIds,
  });
  const ownerOutcomes = buildOwnerOutcomeProjection({
    projectOutputs,
    latestIndexingRequestByProject,
    latestSearchChangeByProject,
  });
  const improvements = buildImprovementActions({ projectOutputs, connections });
  const producingProjects = projectOutputs.filter((project) => project.produced.length > 0);
  const successfulSkillRuns = skills.history.reduce(
    (total, period) => total + period.succeeded,
    0,
  );
  const failedSkillRuns = skills.history.reduce(
    (total, period) => total + period.failed,
    0,
  );
  const otherSkillRuns = Math.max(
    0,
    (skills.status?.runCount ?? 0) - successfulSkillRuns - failedSkillRuns,
  );

  return {
    schemaVersion: CONNECTIONS_SCHEMA_VERSION,
    generatedAt: now,
    summary: {
      ...connectionSummary(connections),
      bucketCount: buckets.length,
      componentCount: componentList.length,
      highestPriorityGap: gaps[0]
        ? {
            id: gaps[0].id,
            provider: gaps[0].provider,
            consumer: gaps[0].consumer,
            status: gaps[0].status,
            detail: gaps[0].detail,
            ownerPath: gaps[0].ownerPath,
          }
        : null,
    },
    buckets,
    connections,
    outputs: {
      summary: {
        skillRuns: skills.status?.runCount ?? 0,
        successfulSkillRuns,
        failedSkillRuns,
        otherSkillRuns,
        capturedOutputs: skills.outputCount,
        capturedOutputBytes: skills.outputBytes,
        measuredValues: skills.status?.metricCount ?? 0,
        projectsProducing: producingProjects.length,
        projectsTracked: projectOutputs.length,
        historicalPeriods: skills.history.length,
        publicSites: workflows.sites,
        publicSitesPassed: Math.max(0, workflows.sites - workflows.failed),
        performanceRuns: psi.runCount,
        domainHistories: drank.domainCount,
      },
      recentRuns: skills.recent,
      skillRuns: skills.runs,
      skillHistoryByProject: skills.projectHistory,
      ownerOutcomes,
      projects: projectOutputs,
      history: skills.history,
      improvements,
      boundaries: {
        aiVisibility: {
          status: measuredAiProjects.length > 0 ? 'producing' : 'baseline-missing',
          configured: configuredAiProjects,
          observations: measuredAiProjects.length,
          detail:
            measuredAiProjects.length > 0
              ? 'Provider-backed project observations are available.'
              : 'Configured projects have fixture canaries only; real outcomes are not measured.',
        },
      },
    },
    evidence: {
      skillRuns: {
        runCount: skills.status?.runCount ?? 0,
        metricCount: skills.status?.metricCount ?? 0,
        outputCount: skills.outputCount,
        outputBytes: skills.outputBytes,
        newestRunAt: skills.status?.newestRunAt ?? null,
        recent: skills.recent,
        metrics: skills.metrics,
      },
      publicWorkflows: {
        sites: workflows.sites,
        failed: workflows.failed,
        reports: workflows.summaries,
      },
      domainIntelligence: {
        drank: {
          domains: drank.domainCount,
          observedAt: drank.observedAt,
          freshness: drank.freshness,
        },
        psi: {
          runs: psi.runCount,
          tags: psi.tagCount,
          observedAt: psi.observedAt,
          freshness: psi.freshness,
        },
      },
    },
  };
}
