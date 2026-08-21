import { randomUUID } from 'node:crypto';
import { accessSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPackageEntry = join(
  moduleDirectory,
  '..',
  '..',
  '..',
  'helpers',
  'ai-visibility',
  'dist',
  'index.js',
);
const defaultPackageSourceDirectory = join(
  moduleDirectory,
  '..',
  '..',
  '..',
  'helpers',
  'ai-visibility',
  'src',
);

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function temporaryPackageRuntime(sourceDirectory) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'foundry-ai-visibility-runtime-'));
  for (const file of readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(sourceDirectory, file), 'utf8');
    let transformed;
    try {
      transformed = stripTypeScriptTypes(source, {
        mode: 'transform',
        sourceMap: false,
      });
    } catch (error) {
      if (error?.code !== 'ERR_INVALID_ARG_VALUE') throw error;
      transformed = stripTypeScriptTypes(source, { mode: 'strip' });
    }
    transformed = transformed.replaceAll(/from "(\.\/[^"]+)\.js"/g, 'from "$1.mjs"');
    writeFileSync(join(outputDirectory, file.replace(/\.ts$/, '.mjs')), transformed, { mode: 0o600 });
  }
  return join(outputDirectory, 'index.mjs');
}

export async function loadAiVisibilityEngine({
  packageEntry = defaultPackageEntry,
  packageSourceDirectory = defaultPackageSourceDirectory,
} = {}) {
  try {
    accessSync(packageEntry);
    return import(pathToFileURL(packageEntry).href);
  } catch {}
  try {
    accessSync(packageSourceDirectory);
  } catch {
    throw new Error('The local @saas-maker/ai-visibility package source is unavailable');
  }
  return import(pathToFileURL(temporaryPackageRuntime(packageSourceDirectory)).href);
}

export function expandVisibilityPrompts(project, promptSetId) {
  const promptSet = project.promptSets.find((set) => set.id === (promptSetId ?? project.promptSets[0]?.id));
  if (!promptSet) throw new Error(`Unknown AI visibility prompt set: ${promptSetId}`);
  return {
    promptSetId: promptSet.id,
    prompts: promptSet.prompts.flatMap((prompt) =>
      project.personas.map((persona) => ({
        id: `${promptSet.id}/${prompt.id}/${persona.id}`,
        text: `${prompt.text}\nAnswer for ${persona.label}.`,
        persona: persona.id,
      })),
    ),
  };
}

function waitForFixture(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('fixture request aborted'), { name: 'AbortError' }));
      },
      { once: true },
    );
  });
}

export function createFixtureVisibilityProviders(fixture, engine) {
  if (fixture?.schema !== 'fleet.ai-visibility-fixture.v1' || !Array.isArray(fixture.providers)) {
    throw new Error('AI visibility fixture must use fleet.ai-visibility-fixture.v1');
  }
  return fixture.providers.map((provider) => {
    if (!provider?.id || !provider.model || !provider.responses || typeof provider.responses !== 'object') {
      throw new Error('AI visibility fixture provider is invalid');
    }
    return {
      id: provider.id,
      model: provider.model,
      grounded: Boolean(provider.grounded),
      fixture: true,
      estimateCostUsd: () => Number(provider.estimatedCostUsd ?? 0),
      execute: async ({ prompt, signal }) => {
        const response = provider.responses[prompt.id] ?? provider.responses.default;
        if (!response) throw new engine.ProviderUnavailableError(`No fixture response for ${prompt.id}`);
        await waitForFixture(Number(response.delayMs ?? 0), signal);
        if (response.status === 'unavailable') {
          throw new engine.ProviderUnavailableError('Fixture provider unavailable');
        }
        if (response.status === 'retryable') {
          throw new engine.RetryableProviderError('Fixture provider retryable failure');
        }
        if (response.status === 'failed') throw new Error('Fixture provider failure');
        return {
          text: String(response.text ?? ''),
          model: String(response.model ?? provider.model),
          observedCostUsd: Number(response.observedCostUsd ?? 0),
        };
      },
    };
  });
}

const PROVIDER_OBSERVATION_SCHEMA = 'fleet.ai-visibility-provider-observations.v1';
const PROVIDER_OBSERVATION_STATUSES = new Set(['completed', 'unavailable', 'failed']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be non-empty text`);
  }
  return value;
}

function requiredIsoTimestamp(value, label) {
  const timestamp = requiredString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function explicitCost(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be an explicit non-negative number`);
  }
  return value;
}

function validateProviderObservation(observation, label) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error(`${label} must be an object`);
  }
  const status = requiredString(observation.status, `${label}.status`);
  if (!PROVIDER_OBSERVATION_STATUSES.has(status)) {
    throw new Error(`${label}.status must be completed, unavailable, or failed`);
  }
  const capturedAt = requiredIsoTimestamp(observation.capturedAt, `${label}.capturedAt`);
  if (status !== 'completed') {
    return {
      status,
      capturedAt,
      ...(observation.providerRequestId
        ? { providerRequestId: requiredString(observation.providerRequestId, `${label}.providerRequestId`) }
        : {}),
    };
  }
  return {
    status,
    capturedAt,
    providerRequestId: requiredString(
      observation.providerRequestId,
      `${label}.providerRequestId`,
    ),
    responseText: requiredText(observation.responseText, `${label}.responseText`),
    observedCostUsd: explicitCost(observation.observedCostUsd, `${label}.observedCostUsd`),
  };
}

function createProviderObservationAdapter(provider, canonicalPromptIds, engine, label) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error(`${label} must be an object`);
  }
  const id = requiredString(provider.id, `${label}.id`);
  const model = requiredString(provider.model, `${label}.model`);
  if (!provider.observations || typeof provider.observations !== 'object' || Array.isArray(provider.observations)) {
    throw new Error(`${label}.observations must be an object`);
  }
  const observations = new Map();
  for (const [promptId, observation] of Object.entries(provider.observations)) {
    if (!canonicalPromptIds.has(promptId)) {
      throw new Error(`${label}.observations contains unknown prompt ${promptId}`);
    }
    observations.set(
      promptId,
      validateProviderObservation(observation, `${label}.observations.${promptId}`),
    );
  }
  if (observations.size === 0) {
    throw new Error(`${label}.observations must contain at least one canonical prompt`);
  }
  return {
    id,
    model,
    grounded: Boolean(provider.grounded),
    providerObservation: true,
    observationPromptIds: [...observations.keys()],
    estimateCostUsd: (prompt) => observations.get(prompt.id)?.observedCostUsd ?? 0,
    execute: async ({ prompt }) => {
      const observation = observations.get(prompt.id);
      if (!observation || observation.status === 'unavailable') {
        throw new engine.ProviderUnavailableError(`No completed provider observation for ${prompt.id}`);
      }
      if (observation.status === 'failed') {
        throw new Error(`Provider observation recorded a failed response for ${prompt.id}`);
      }
      return {
        text: observation.responseText,
        model,
        observedCostUsd: observation.observedCostUsd,
        providerRequestId: observation.providerRequestId,
      };
    },
    observationProvenance: {
      capturedAt: [...observations.values()].map((entry) => entry.capturedAt),
      completedCount: [...observations.values()]
        .filter((entry) => entry.status === 'completed')
        .length,
      requestIds: [...observations.values()]
        .map((entry) => entry.providerRequestId)
        .filter(Boolean),
    },
  };
}

export function prepareProviderObservationRuns({
  bundle,
  portfolio,
  engine,
  requireAll = false,
}) {
  if (bundle?.schema !== PROVIDER_OBSERVATION_SCHEMA || !Array.isArray(bundle.runs)) {
    throw new Error(`Provider observations must use ${PROVIDER_OBSERVATION_SCHEMA}`);
  }
  if (bundle.runs.length === 0) throw new Error('Provider observations must contain at least one run');
  const projectIds = bundle.runs.map((run, index) =>
    requiredString(run?.projectId, `runs[${index}].projectId`),
  );
  if (new Set(projectIds).size !== projectIds.length) {
    throw new Error('Provider observation project ids must be unique');
  }
  if (requireAll) {
    const expected = portfolio.eligible.map((project) => project.slug).sort();
    const received = [...projectIds].sort();
    if (JSON.stringify(received) !== JSON.stringify(expected)) {
      const expectedSet = new Set(expected);
      const receivedSet = new Set(received);
      const missing = expected.filter((projectId) => !receivedSet.has(projectId));
      const extra = received.filter((projectId) => !expectedSet.has(projectId));
      throw new Error(
        `Provider observations do not cover the canonical ${expected.length}: `
        + `missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      );
    }
  }

  return bundle.runs.map((input, runIndex) => {
    const project = portfolio.eligible.find((candidate) => candidate.slug === input.projectId);
    if (!project) throw new Error(`AI visibility is not configured for project ${input.projectId}`);
    const runId = requiredString(input.runId, `runs[${runIndex}].runId`);
    const observedAt = requiredIsoTimestamp(input.observedAt, `runs[${runIndex}].observedAt`);
    const { promptSetId, prompts } = expandVisibilityPrompts(project, input.promptSetId);
    const canonicalPromptIds = new Set(prompts.map((prompt) => prompt.id));
    if (!Array.isArray(input.providers) || input.providers.length === 0) {
      throw new Error(`runs[${runIndex}].providers must contain at least one provider`);
    }
    const providers = input.providers.map((provider, providerIndex) =>
      createProviderObservationAdapter(
        provider,
        canonicalPromptIds,
        engine,
        `runs[${runIndex}].providers[${providerIndex}]`,
      ),
    );
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
      throw new Error(`runs[${runIndex}].providers contains duplicate provider ids`);
    }
    const requiredCalls = prompts.length * providers.length;
    if (requiredCalls > project.runBudget.maxCalls) {
      throw new Error(
        `Provider observations for ${project.slug} require ${requiredCalls} calls, `
        + `exceeding maxCalls ${project.runBudget.maxCalls}`,
      );
    }
    const observedCostUsd = providers.reduce(
      (providerTotal, provider) =>
        providerTotal
        + prompts.reduce((promptTotal, prompt) => promptTotal + provider.estimateCostUsd(prompt), 0),
      0,
    );
    if (
      project.runBudget.maxEstimatedCostUsd !== undefined
      && observedCostUsd > project.runBudget.maxEstimatedCostUsd
    ) {
      throw new Error(
        `Provider observations for ${project.slug} report $${observedCostUsd.toFixed(6)}, `
        + `exceeding limit $${project.runBudget.maxEstimatedCostUsd.toFixed(6)}`,
      );
    }
    const capturedAt = providers
      .flatMap((provider) => provider.observationProvenance.capturedAt)
      .sort();
    const requestIds = providers
      .flatMap((provider) => provider.observationProvenance.requestIds);
    const completedObservationCount = providers.reduce(
      (count, provider) => count + provider.observationProvenance.completedCount,
      0,
    );
    return {
      project,
      promptSetId,
      providers,
      runId,
      observedAt,
      provenance: {
        source: 'operator-supplied-provider-export',
        providerIds: providers.map((provider) => provider.id).sort(),
        models: [...new Set(providers.map((provider) => provider.model))].sort(),
        observationCount: capturedAt.length,
        completedObservationCount,
        capturedAtRange: {
          first: capturedAt[0],
          last: capturedAt.at(-1),
        },
        providerRequestIdCount: requestIds.length,
      },
    };
  });
}

function assertProvidersAllowed(project, providers, providerKind) {
  if (providers.length === 0) throw new Error('At least one provider is required');
  const allowed = new Set(project.providerPolicy.allowedProviderIds);
  for (const provider of providers) {
    if (providerKind === 'fixture') {
      if (!allowed.has(provider.id)) {
        throw new Error(`Provider ${provider.id} is not allowed for ${project.slug}`);
      }
      if (provider.fixture !== true) {
        throw new Error(`Provider ${provider.id} is not marked as a fixture provider`);
      }
    } else if (providerKind === 'provider-observation') {
      if (provider.providerObservation !== true) {
        throw new Error(`Provider ${provider.id} is not a validated provider observation`);
      }
    } else {
      if (project.providerPolicy.liveProvidersAllowed !== true) {
        throw new Error(`Live providers are disabled for ${project.slug}`);
      }
      if (!allowed.has(provider.id)) {
        throw new Error(`Provider ${provider.id} is not allowed for ${project.slug}`);
      }
    }
  }
}

function normalizedRows(run, observedAt) {
  return run.attempts
    .filter((attempt) => ['completed', 'cached'].includes(attempt.status) && attempt.analysis)
    .map((attempt) => ({
      brandMentioned: attempt.analysis.brandMentioned,
      brandRecommended: attempt.analysis.brandRecommended,
      competitorsMentioned: attempt.analysis.competitorsMentioned
        .filter((competitor) => competitor.mentioned)
        .map((competitor) => competitor.name),
      citations: attempt.analysis.citations,
      brandCited: attempt.analysis.brandCited,
      platform: attempt.providerId,
      persona: attempt.persona,
      createdAt: observedAt,
    }));
}

function numericDeltas(current, previous) {
  if (!previous) return null;
  return Object.fromEntries(
    ['visibilityScore', 'mentionRate', 'recommendationRate', 'citationRate', 'coverageRate']
      .map((field) => [field, round(current[field] - Number(previous[field] ?? 0))]),
  );
}

function comparisonFor(current, citations, previousEvent) {
  if (!previousEvent) return null;
  const previousMetrics = previousEvent.payload.metrics ?? {};
  const previousCitations = previousEvent.payload.citations ?? {};
  const previousHosts = new Set(previousCitations.hosts ?? []);
  const currentHosts = new Set(citations.hosts);
  return {
    previousRunId: previousEvent.payload.runId,
    deltas: numericDeltas(current, previousMetrics),
    citationHostsAdded: [...currentHosts].filter((host) => !previousHosts.has(host)).sort(),
    citationHostsRemoved: [...previousHosts].filter((host) => !currentHosts.has(host)).sort(),
  };
}

function rankMetrics(run) {
  const positions = run.attempts
    .map((attempt) => attempt.analysis?.brandPosition)
    .filter((position) => Number.isFinite(position));
  return {
    rankedAnswers: positions.length,
    averagePosition: positions.length
      ? round(positions.reduce((sum, position) => sum + position, 0) / positions.length, 2)
      : null,
  };
}

function citationSummary(rows, engine) {
  const citations = rows.flatMap((row) => row.citations);
  const urls = [...new Set(citations.flatMap((value) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      url.hash = '';
      return [url.href];
    } catch {
      return [];
    }
  }))].slice(0, 50);
  return {
    total: citations.length,
    urls,
    hosts: [...new Set(urls.map(engine.hostOf).filter(Boolean))].sort(),
  };
}

function buildReport({ engine, project, rows, observedAt }) {
  const shareOfVoice = engine.computeShareOfVoice(rows, 30);
  const score = engine.computeVisibilityScore(shareOfVoice, rows);
  const perPersona = engine.computePersonaVisibility(rows);
  const identity = {
    brandUrl: project.domain,
    brandAliases: project.aliases,
    competitorUrls: project.competitors.map((competitor) => ({
      id: competitor.name,
      url: competitor.url,
    })),
  };
  const citationGaps = engine.computeCitationGaps(rows, identity);
  const trend = engine.computeTrends(rows, 30, Date.parse(observedAt));
  return engine.composeVisibilityReport({
    brandName: project.name,
    windowDays: 30,
    score,
    shareOfVoice,
    perPersona,
    citationGaps,
    matrix: [],
    trend,
    platforms: [...new Set(rows.map((row) => row.platform))].sort(),
  });
}

export async function runAiVisibilityCanary({
  project,
  providers,
  store,
  cache,
  engine,
  promptSetId,
  providerKind = 'fixture',
  provenance,
  now = () => new Date().toISOString(),
  runId = randomUUID(),
}) {
  assertProvidersAllowed(project, providers, providerKind);
  if (providerKind === 'provider-observation' && !provenance) {
    throw new Error('Provider observation provenance is required');
  }
  const observedAt = now();
  const { promptSetId: selectedPromptSet, prompts } = expandVisibilityPrompts(project, promptSetId);
  const costReceipts = [];
  const run = await engine.executeVisibilityRun({
    subject: {
      brandName: project.name,
      brandAliases: project.aliases,
      brandUrl: project.domain,
      competitors: project.competitors,
    },
    prompts,
    providers,
    policy: {
      ...project.runBudget,
      cacheTtlMs: project.cacheWindowHours * 60 * 60 * 1000,
    },
    cache: cache ? { adapter: cache, now: () => Date.parse(observedAt) } : undefined,
    hooks: {
      onCostReceipt: (receipt) => costReceipts.push(receipt),
    },
  });

  const rows = normalizedRows(run, observedAt);
  const report = buildReport({ engine, project, rows, observedAt });
  const coverageDenominator = run.coverage.configured || 1;
  const completedAnswers = run.coverage.completed + run.coverage.cached;
  const observedPromptKeys = new Set(
    providers.flatMap((provider) =>
      (provider.observationPromptIds ?? [])
        .map((promptId) => `${provider.id}\u0000${promptId}`),
    ),
  );
  const retainedCostReceipts = providerKind === 'provider-observation'
    ? costReceipts.filter((receipt) =>
      observedPromptKeys.has(`${receipt.providerId}\u0000${receipt.promptId}`),
    )
    : costReceipts;
  const metrics = {
    visibilityScore: report.score.score,
    mentionRate: round(report.shareOfVoice.brandMentionRate),
    recommendationRate: round(report.shareOfVoice.brandRecommendationRate),
    citationRate: round(report.shareOfVoice.brandCitationRate),
    coverageRate: round(completedAnswers / coverageDenominator),
    ...rankMetrics(run),
    competitorShare: Object.fromEntries(
      Object.entries(report.shareOfVoice.competitorShare).map(([name, value]) => [name, round(value)]),
    ),
  };
  const citations = citationSummary(rows, engine);
  const previousEvent = store
    .listEvents()
    .filter(
      (event) =>
        event.type === 'visibility.run-recorded'
        && event.projectId === project.slug
        && event.payload.evidenceMode === providerKind,
    )
    .at(-1);
  const comparison = comparisonFor(metrics, citations, previousEvent);
  const freshUntil = new Date(
    Date.parse(observedAt) + project.cacheWindowHours * 60 * 60 * 1000,
  ).toISOString();
  const evidence = [{
    provider: 'ai-visibility',
    kind: 'run',
    id: runId,
    state: completedAnswers > 0 ? 'verified' : 'unavailable',
    observedAt,
    freshUntil,
    summary: {
      projectId: project.slug,
      evidenceMode: providerKind,
      completedAnswers,
      configuredCalls: run.coverage.configured,
      visibilityScore: metrics.visibilityScore,
      observedCostUsd: round(run.cost.observedUsd),
    },
    confidence: metrics.coverageRate,
  }];
  const payload = {
    runId,
    evidenceMode: providerKind,
    promptSetId: selectedPromptSet,
    analyzerFingerprint: run.analyzerFingerprint,
    coverage: structuredClone(run.coverage),
    cost: {
      estimatedUsd: round(run.cost.estimatedUsd),
      observedUsd: round(run.cost.observedUsd),
      providerCalls: providerKind === 'provider-observation'
        ? retainedCostReceipts.length
        : run.cost.providerCalls,
      cacheHits: run.cost.cacheHits,
      receipts: retainedCostReceipts.map((receipt) => ({
        promptId: receipt.promptId,
        providerId: receipt.providerId,
        model: receipt.model,
        estimatedCostUsd: round(receipt.estimatedCostUsd),
        observedCostUsd: round(receipt.observedCostUsd),
        cached: receipt.cached,
      })),
    },
    cache: {
      windowHours: project.cacheWindowHours,
      hits: run.coverage.cached,
    },
    metrics,
    citations,
    attempts: run.attempts.map((attempt) => ({
      promptId: attempt.promptId,
      persona: attempt.persona,
      providerId: attempt.providerId,
      model: attempt.model,
      status: attempt.status,
      cached: attempt.cached,
      observedCostUsd: round(attempt.observedCostUsd),
      retryable: attempt.retryable,
    })),
    ...(provenance ? { provenance: structuredClone(provenance) } : {}),
    ...(comparison ? { comparison } : {}),
  };
  const recorded = store.append({
    type: 'visibility.run-recorded',
    actor: { type: 'automation', id: 'ai-visibility-canary', label: 'AI visibility canary' },
    projectId: project.slug,
    idempotencyKey: `ai-visibility-run/${runId}`,
    occurredAt: observedAt,
    payload,
    evidence,
  });

  return {
    event: recorded.event,
    duplicate: recorded.duplicate,
    projectId: project.slug,
    runId,
    evidenceMode: providerKind,
    observedAt,
    freshUntil,
    coverage: payload.coverage,
    cost: payload.cost,
    metrics,
    citations,
    comparison,
  };
}
