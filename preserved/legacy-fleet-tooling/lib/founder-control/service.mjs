import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { cloudflareAccessAuthorized } from './access.mjs';
import { buildFleetConnections, readSkillRunOutput } from './connections.mjs';
import { createMetricRunController } from './metric-runs.mjs';
import {
  evaluateAiVisibilityScheduleActivation,
  loadAiVisibilityPortfolio,
} from './ai-visibility-registry.mjs';

const MAX_REQUEST_BYTES = 32 * 1024;

function json(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
  });
  response.end(encoded);
  return true;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function mutationAuthorized(
  request,
  { ownerToken, trustAccessHeaders = false, trustLoopback = false, ownerEmail } = {},
) {
  if (
    trustLoopback &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)
  ) return true;
  if (ownerToken) {
    const authorization = request.headers.authorization ?? '';
    return authorization.startsWith('Bearer ') && safeEqual(authorization.slice(7), ownerToken);
  }
  if (trustAccessHeaders) {
    return cloudflareAccessAuthorized(request, { ownerEmail });
  }
  return false;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { statusCode: 400 });
  }
}

function projectionFor(store) {
  return store.rebuildProjections();
}

function boundedSignal(signal, { includeSeries = false } = {}) {
  if (!signal) return null;
  const { series, ...bounded } = signal;
  return includeSeries
    ? { ...bounded, series: (series ?? []).slice(-60) }
    : bounded;
}

function boundedText(value, maximum) {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, maximum);
}

function boundedTrackedQuery(query) {
  const liveSearch = { state: query.liveSearch?.state === 'observed' ? 'observed' : 'not-observed' };
  if (liveSearch.state === 'observed') {
    liveSearch.class = ['A', 'B', 'C'].includes(query.liveSearch?.class)
      ? query.liveSearch.class
      : null;
    liveSearch.observedAt = Number.isFinite(Date.parse(query.liveSearch?.observedAt))
      ? query.liveSearch.observedAt
      : null;
  }

  const searchConsole = {
    state: query.searchConsole?.state === 'observed' ? 'observed' : 'not-observed',
  };
  if (searchConsole.state === 'observed') {
    for (const key of ['impressions', 'clicks', 'position']) {
      const value = Number(query.searchConsole?.[key]);
      searchConsole[key] = Number.isFinite(value) ? value : null;
    }
  }

  const collisionState = ['clear', 'ambiguous'].includes(query.collision?.state)
    ? query.collision.state
    : null;
  return {
    id: boundedText(query.id, 160),
    kind: boundedText(query.kind, 40),
    text: boundedText(query.text, 240),
    rootDomain: boundedText(query.rootDomain, 240),
    collision: collisionState
      ? { state: collisionState, note: boundedText(query.collision?.note, 320) }
      : null,
    liveSearch,
    searchConsole,
  };
}

function outcomeProjection(connections, family) {
  const outcomes = connections.outputs?.ownerOutcomes ?? {};
  let rows = [];
  if (family === 'domains') {
    rows = (outcomes.domains ?? []).map((row) => ({
      ...row,
      signal: boundedSignal(row.signal, { includeSeries: true }),
    }));
  } else if (family === 'ai-awareness') {
    rows = (outcomes.coreAi ?? []).map((row) => ({
      ...row,
      mention: boundedSignal(row.mention),
      recommendation: boundedSignal(row.recommendation),
      citation: boundedSignal(row.citation),
      averageRank: boundedSignal(row.averageRank),
      questions: (row.questions ?? []).slice(0, 12).map((question) => ({
        id: question.id,
        setId: question.setId,
        text: question.text,
      })),
      coverage: row.coverage
        ? {
            configured: Number(row.coverage.configured ?? 0),
            completed: Number(row.coverage.completed ?? 0),
            unavailable: Number(row.coverage.unavailable ?? 0),
            timedOut: Number(row.coverage.timedOut ?? 0),
            failed: Number(row.coverage.failed ?? 0),
          }
        : null,
      attempts: (row.attempts ?? []).slice(0, 24).map((attempt) => ({
        promptId: attempt.promptId,
        persona: attempt.persona,
        providerId: attempt.providerId,
        model: attempt.model,
        status: attempt.status,
      })),
      citationSources: {
        total: Number(row.citationSources?.total ?? 0),
        owned: Number(row.citationSources?.owned ?? 0),
        external: Number(row.citationSources?.external ?? 0),
        unclassified: Number(row.citationSources?.unclassified ?? 0),
        sources: (row.citationSources?.sources ?? []).slice(0, 50).map((source) => ({
          url: source.url,
          host: source.host,
          ownership: source.ownership,
        })),
      },
      crawlerRequests: boundedSignal(row.crawlerRequests, { includeSeries: true }),
      aiReferralVisits: boundedSignal(row.aiReferralVisits, { includeSeries: true }),
    }));
  } else if (family === 'performance') {
    rows = (outcomes.performance ?? []).map((row) => ({
      ...row,
      psi: boundedSignal(row.psi),
      lcp: boundedSignal(row.lcp),
      fieldLcp: boundedSignal(row.fieldLcp, { includeSeries: true }),
      fieldInp: boundedSignal(row.fieldInp, { includeSeries: true }),
      fieldCls: boundedSignal(row.fieldCls, { includeSeries: true }),
      fieldTtfb: boundedSignal(row.fieldTtfb, { includeSeries: true }),
      rumSamples: boundedSignal(row.rumSamples),
    }));
  } else if (family === 'search') {
    rows = (outcomes.search ?? []).map((row) => ({
      ...row,
      trackedQueries: (row.trackedQueries ?? []).slice(0, 12).map(boundedTrackedQuery),
      impressions: boundedSignal(row.impressions, { includeSeries: true }),
      clicks: boundedSignal(row.clicks, { includeSeries: true }),
      ctr: boundedSignal(row.ctr, { includeSeries: true }),
      averagePosition: boundedSignal(row.averagePosition, { includeSeries: true }),
    }));
  } else {
    return null;
  }
  return {
    schemaVersion: 'fleet.owner-outcome.v1',
    generatedAt: connections.generatedAt,
    family,
    rows,
    ...(family === 'performance'
      ? { thresholds: outcomes.performanceThresholds ?? {} }
      : {}),
  };
}

export function buildMarketingProjection(projections, portfolio, scheduleActivation = {}) {
  const projectedProjects = new Map(
    projections.aiVisibility.projects.map((project) => [project.projectId, project]),
  );
  return {
    generatedAt: projections.generatedAt,
    outcomes: [],
    providerEvidence: 'linked-only',
    aiVisibility: {
      projects: portfolio.eligible.map((project) => ({
        projectId: project.slug,
        name: project.name,
        attention: project.attention,
        questions: project.promptSets.flatMap((set) =>
          set.prompts.map((prompt) => ({
            id: `${set.id}:${prompt.id}`,
            setId: set.id,
            text: prompt.text,
          }))),
        latest: projectedProjects.get(project.slug)?.latest ?? null,
        previous: projectedProjects.get(project.slug)?.previous ?? null,
        comparison: projectedProjects.get(project.slug)?.comparison ?? null,
        history: projectedProjects.get(project.slug)?.history ?? [],
      })),
      scheduleIntent: {
        ...portfolio.scheduleIntent,
        activation: evaluateAiVisibilityScheduleActivation({
          scheduleIntent: portfolio.scheduleIntent,
          ...scheduleActivation,
        }),
      },
    },
  };
}

export function createFounderControlHandler({
  store,
  ownerToken,
  trustAccessHeaders = false,
  trustLoopback = false,
  ownerEmail,
  now = () => new Date().toISOString(),
  visibilityPortfolio = loadAiVisibilityPortfolio(),
  visibilityScheduleActivation = {},
  connectionsProvider = buildFleetConnections,
  prewarmConnections = false,
  skillRunOutputProvider = readSkillRunOutput,
  metricRunController,
}) {
  const resolvedMetricRunController = metricRunController ?? createMetricRunController({
    projects: store.projects,
  });
  let connectionCache = null;
  const completedMetricRuns = new Set();
  const rebuildConnections = (projections = projectionFor(store)) => {
    const marketing = buildMarketingProjection(
      projections,
      visibilityPortfolio,
      visibilityScheduleActivation,
    );
    const payload = connectionsProvider({
      marketing,
      now: now(),
    });
    connectionCache = { payload };
    return payload;
  };
  const cachedConnections = (projections) => {
    if (!connectionCache) return rebuildConnections(projections);
    return connectionCache.payload;
  };
  if (prewarmConnections) rebuildConnections();
  const handleEarlyRoutes = (url, method, response) => {
    if (method === 'GET' && url.pathname === '/health') {
      return json(response, 200, { ok: true, service: 'founder-control', database: 'available' });
    }
    const skillRunOutputMatch = url.pathname.match(/^\/v1\/skill-runs\/([^/]+)\/output$/);
    if (method === 'GET' && skillRunOutputMatch) {
      return json(
        response,
        200,
        skillRunOutputProvider({ runId: decodeURIComponent(skillRunOutputMatch[1]) }),
      );
    }
    const metricRunMatch = url.pathname.match(/^\/v1\/metric-runs\/([^/]+)$/);
    if (method === 'GET' && metricRunMatch) {
      const run = resolvedMetricRunController.get(decodeURIComponent(metricRunMatch[1]));
      if (run && run.state !== 'running' && !completedMetricRuns.has(run.runId)) {
        completedMetricRuns.add(run.runId);
        connectionCache = null;
      }
      return run
        ? json(response, 200, run)
        : json(response, 404, { error: 'metric run not found' });
    }
    return false;
  };
  const handleProjectionReadRoutes = (url, projections, response) => {
    if (url.pathname === '/v1/home') return json(response, 200, projections.home);
    if (url.pathname === '/v1/activity') return json(response, 200, projections.activity);
    if (url.pathname === '/v1/projects') return json(response, 200, projections.projects);
    if (url.pathname === '/v1/schedules') return json(response, 200, projections.schedules);
    if (url.pathname === '/v1/marketing') {
      return json(
        response,
        200,
        buildMarketingProjection(projections, visibilityPortfolio, visibilityScheduleActivation),
      );
    }
    const outcomeMatch = url.pathname.match(
      /^\/v1\/outcomes\/(domains|search|ai-awareness|performance)$/,
    );
    if (outcomeMatch) {
      return json(
        response,
        200,
        outcomeProjection(cachedConnections(projections), outcomeMatch[1]),
      );
    }
    if (url.pathname === '/v1/connections') {
      return json(response, 200, cachedConnections(projections));
    }
    return false;
  };
  const handleMetricRunMutations = async (url, method, request, response) => {
    if (method === 'POST' && url.pathname === '/v1/metric-runs') {
      const body = await readBody(request);
      return json(response, 202, resolvedMetricRunController.start({
        family: String(body.family ?? ''),
        projectId: String(body.projectId ?? ''),
        scope: String(body.scope ?? 'project'),
      }));
    }
    return false;
  };
  const handleProjectionMutations = async (url, method, response) => {
    if (method === 'POST' && url.pathname === '/v1/projections/rebuild') {
      const rebuilt = projectionFor(store);
      rebuildConnections(rebuilt);
      return json(response, 200, rebuilt);
    }
    return false;
  };
  return async function founderControlHandler(request, response) {
    try {
      const url = new URL(request.url, 'http://foundry.local');
      const method = request.method ?? 'GET';
      if (handleEarlyRoutes(url, method, response)) return;

      const projections = projectionFor(store);
      if (method === 'GET' && handleProjectionReadRoutes(url, projections, response)) return;

      if (
        method !== 'GET' &&
        !mutationAuthorized(request, {
          ownerToken,
          trustAccessHeaders,
          trustLoopback,
          ownerEmail,
        })
      ) {
        return json(response, 401, { error: 'owner authentication required' });
      }

      if (await handleMetricRunMutations(url, method, request, response)) return;
      if (await handleProjectionMutations(url, method, response)) return;
      return json(response, 404, { error: 'route not found' });
    } catch (error) {
      return json(response, error.statusCode ?? (error.code ? 422 : 500), {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
  };
}

export function startFounderControlService({
  store,
  host = '127.0.0.1',
  port = 4187,
  ownerToken,
  trustAccessHeaders = false,
  trustLoopback = false,
  ownerEmail,
  visibilityPortfolio,
  visibilityScheduleActivation,
  connectionsProvider,
  prewarmConnections = false,
  skillRunOutputProvider,
  metricRunController,
} = {}) {
  const server = createServer(
    createFounderControlHandler({
      store,
      ownerToken,
      trustAccessHeaders,
      trustLoopback,
      ownerEmail,
      ...(visibilityPortfolio ? { visibilityPortfolio } : {}),
      ...(visibilityScheduleActivation ? { visibilityScheduleActivation } : {}),
      ...(connectionsProvider ? { connectionsProvider } : {}),
      prewarmConnections,
      ...(skillRunOutputProvider ? { skillRunOutputProvider } : {}),
      ...(metricRunController ? { metricRunController } : {}),
    }),
  );
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
