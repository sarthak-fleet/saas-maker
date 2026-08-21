import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const VISIBILITY_OUTCOME_BUNDLE_SCHEMA = 'fleet.visibility-outcome-bundle.v1';
const VISIBILITY_OUTCOME_SCHEMA = 'fleet.visibility-outcome.v1';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const MAX_SEARCH_QUERY_LENGTH = 2_048;
const FAMILY_CONTRACTS = {
  search: {
    provider: 'google-search-console',
    metrics: {
      'Search impressions': { unit: 'impressions', direction: 'higher-is-better' },
      'Search clicks': { unit: 'clicks', direction: 'higher-is-better' },
      'Search CTR': { unit: 'percent', direction: 'higher-is-better', maximum: 100 },
      'Search average position': {
        unit: 'rank',
        direction: 'lower-is-better',
        exclusiveMinimum: 0,
      },
    },
  },
  'ai-crawl': {
    provider: 'cloudflare-ai-crawl-control',
    metrics: {
      'AI crawler requests': { unit: 'requests', direction: 'higher-is-better' },
      'AI crawled URLs': { unit: 'urls', direction: 'higher-is-better' },
    },
  },
  'ai-referral': {
    provider: 'cloudflare-web-analytics',
    metrics: {
      'AI referral visits': { unit: 'visits', direction: 'higher-is-better' },
      'AI referral page views': { unit: 'page views', direction: 'higher-is-better' },
    },
  },
  'web-traffic': {
    provider: 'cloudflare-web-analytics',
    metrics: {
      'Web visits': { unit: 'visits', direction: 'higher-is-better' },
      'Web page views': { unit: 'page views', direction: 'higher-is-better' },
      'Search referral visits': { unit: 'visits', direction: 'higher-is-better' },
    },
  },
  'web-vitals': {
    provider: 'cloudflare-web-analytics',
    metrics: {
      'Field LCP': { unit: 'milliseconds', direction: 'lower-is-better' },
      'Field INP': { unit: 'milliseconds', direction: 'lower-is-better' },
      'Field CLS': { unit: 'score', direction: 'lower-is-better' },
      'Field TTFB': { unit: 'milliseconds', direction: 'lower-is-better' },
      'RUM samples': { unit: 'samples', direction: 'higher-is-better' },
    },
  },
};

function allowedProviders(contract) {
  if (Array.isArray(contract.providers)) return new Set(contract.providers);
  return new Set([contract.provider]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertKnownKeys(value, keys, path) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  for (const key of Object.keys(value)) {
    assert(keys.has(key), `${path}.${key} is not allowed`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeTimestamp(value, path) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${path} must be ISO-8601`);
  return new Date(value).toISOString();
}

function normalizeProviderUrl(value) {
  if (value === undefined) return null;
  assert(typeof value === 'string' && value.length <= 2048, 'observation.providerUrl must be an HTTPS URL');
  try {
    const url = new URL(value);
    assert(url.protocol === 'https:', 'observation.providerUrl must be an HTTPS URL');
    assert(!url.username && !url.password, 'observation.providerUrl must not contain credentials');
    return url.href;
  } catch (error) {
    if (error?.message?.startsWith('observation.providerUrl')) throw error;
    throw new Error('observation.providerUrl must be an HTTPS URL');
  }
}

function normalizeBreakdowns(value) {
  if (value === undefined) return [];
  assert(Array.isArray(value) && value.length <= 6, 'observation.breakdowns must contain at most 6 entries');
  const breakdowns = value.map((breakdown, index) => {
    const path = `observation.breakdowns[${index}]`;
    assertKnownKeys(breakdown, new Set(['id', 'label', 'unit', 'values']), path);
    assert(typeof breakdown.id === 'string' && IDENTIFIER.test(breakdown.id), `${path}.id is invalid`);
    const label = String(breakdown.label ?? '').replace(/\s+/g, ' ').trim();
    const unit = String(breakdown.unit ?? '').replace(/\s+/g, ' ').trim();
    assert(label.length > 0 && label.length <= 80, `${path}.label must be 1-80 characters`);
    assert(unit.length > 0 && unit.length <= 40, `${path}.unit must be 1-40 characters`);
    assert(Array.isArray(breakdown.values) && breakdown.values.length <= 20, `${path}.values must contain at most 20 entries`);
    const values = breakdown.values.map((item, valueIndex) => {
      const valuePath = `${path}.values[${valueIndex}]`;
      assertKnownKeys(item, new Set(['label', 'value']), valuePath);
      const itemLabel = String(item.label ?? '').replace(/\s+/g, ' ').trim();
      const itemValue = Number(item.value);
      assert(itemLabel.length > 0 && itemLabel.length <= 300, `${valuePath}.label must be 1-300 characters`);
      assert(Number.isFinite(itemValue) && itemValue >= 0, `${valuePath}.value must be a non-negative finite number`);
      return { label: itemLabel, value: itemValue };
    });
    assert(new Set(values.map((item) => item.label)).size === values.length, `${path}.values contains duplicate labels`);
    return { id: breakdown.id, label, unit, values };
  });
  assert(new Set(breakdowns.map((item) => item.id)).size === breakdowns.length, 'observation.breakdowns contains duplicate ids');
  return breakdowns;
}

function normalizeMetric(metric, contract, path) {
  assertKnownKeys(metric, new Set(['label', 'value']), path);
  const definition = contract.metrics[metric.label];
  assert(definition, `${path}.label is not supported for ${contract.provider}`);
  const value = Number(metric.value);
  assert(Number.isFinite(value) && value >= 0, `${path}.value must be a non-negative finite number`);
  if (definition.maximum !== undefined) {
    assert(value <= definition.maximum, `${path}.value exceeds ${definition.maximum}`);
  }
  if (definition.exclusiveMinimum !== undefined) {
    assert(value > definition.exclusiveMinimum, `${path}.value must exceed ${definition.exclusiveMinimum}`);
  }
  return {
    label: metric.label,
    value,
    unit: definition.unit,
    direction: definition.direction,
  };
}

function normalizeSearchTerms(searchTerms, family) {
  if (searchTerms === undefined) return [];
  assert(family === 'search', 'searchTerms is only supported for Search Console outcomes');
  assert(Array.isArray(searchTerms), 'observation.searchTerms must be an array');
  assert(searchTerms.length <= 50, 'observation.searchTerms exceeds 50 entries');
  const normalized = searchTerms.map((term, index) => {
    const path = `observation.searchTerms[${index}]`;
    assertKnownKeys(term, new Set(['query', 'landingPage', 'impressions', 'clicks', 'ctr', 'position']), path);
    const query = String(term.query ?? '').replace(/\s+/g, ' ').trim();
    assert(
      query.length > 0 && query.length <= MAX_SEARCH_QUERY_LENGTH,
      `${path}.query must be 1-${MAX_SEARCH_QUERY_LENGTH} characters`,
    );
    let landingPage = null;
    if (term.landingPage !== undefined && term.landingPage !== null) {
      assert(typeof term.landingPage === 'string', `${path}.landingPage must be a URL`);
      assert(term.landingPage.length <= 2048, `${path}.landingPage is too long`);
      try {
        const url = new URL(term.landingPage);
        assert(['http:', 'https:'].includes(url.protocol), `${path}.landingPage must use HTTP or HTTPS`);
        assert(!url.username && !url.password, `${path}.landingPage must not contain credentials`);
        landingPage = url.href;
      } catch (error) {
        if (error?.message?.startsWith(`${path}.landingPage`)) throw error;
        throw new Error(`${path}.landingPage must be a URL`);
      }
    }
    const impressions = Number(term.impressions);
    const clicks = Number(term.clicks);
    const ctr = Number(term.ctr);
    const position = Number(term.position);
    assert(Number.isFinite(impressions) && impressions >= 0, `${path}.impressions is invalid`);
    assert(Number.isFinite(clicks) && clicks >= 0, `${path}.clicks is invalid`);
    assert(Number.isFinite(ctr) && ctr >= 0 && ctr <= 100, `${path}.ctr is invalid`);
    assert(Number.isFinite(position) && position > 0, `${path}.position is invalid`);
    return {
      query,
      ...(landingPage ? { landingPage } : {}),
      impressions,
      clicks,
      ctr,
      position,
    };
  });
  assert(
    new Set(normalized.map((term) => `${term.query}\n${term.landingPage ?? ''}`)).size === normalized.length,
    'observation.searchTerms contains duplicate query-page rows',
  );
  return normalized;
}

function normalizeHttpsUrl(value, path) {
  assert(typeof value === 'string' && value.length <= 2048, `${path} must be an HTTPS URL`);
  try {
    const url = new URL(value);
    assert(url.protocol === 'https:' && !url.username && !url.password, `${path} must be an HTTPS URL`);
    return url.href;
  } catch (error) {
    if (error?.message?.startsWith(path)) throw error;
    throw new Error(`${path} must be an HTTPS URL`);
  }
}

function normalizeIndexInspection(value, family) {
  if (value === undefined) return null;
  assert(family === 'search', 'indexInspection is only supported for Search Console outcomes');
  const path = 'observation.indexInspection';
  assertKnownKeys(value, new Set([
    'inspectedUrl', 'state', 'verdict', 'coverageState', 'robotsTxtState',
    'indexingState', 'pageFetchState', 'lastCrawlTime', 'userCanonical',
    'googleCanonical', 'sitemapUrls', 'sitemapSubmissionState',
    'sitemapSubmittedAt', 'failureReason',
  ]), path);
  const states = new Set(['indexed', 'not-indexed', 'unknown', 'unavailable']);
  assert(states.has(value.state), `${path}.state is invalid`);
  const optionalText = (field, maximum = 300) => {
    const entry = value[field];
    if (entry === null || entry === undefined) return null;
    assert(typeof entry === 'string' && entry.trim().length > 0 && entry.length <= maximum, `${path}.${field} is invalid`);
    return entry.trim();
  };
  const sitemapUrls = value.sitemapUrls === undefined ? [] : value.sitemapUrls;
  assert(Array.isArray(sitemapUrls) && sitemapUrls.length <= 10, `${path}.sitemapUrls is invalid`);
  const hasSitemapSubmissionState = value.sitemapSubmissionState !== undefined;
  const hasSitemapSubmittedAt = value.sitemapSubmittedAt !== undefined;
  assert(
    hasSitemapSubmissionState === hasSitemapSubmittedAt,
    `${path} must include sitemapSubmissionState and sitemapSubmittedAt together`,
  );
  const normalized = {
    inspectedUrl: normalizeHttpsUrl(value.inspectedUrl, `${path}.inspectedUrl`),
    state: value.state,
    verdict: optionalText('verdict', 40),
    coverageState: optionalText('coverageState'),
    robotsTxtState: optionalText('robotsTxtState', 80),
    indexingState: optionalText('indexingState', 80),
    pageFetchState: optionalText('pageFetchState', 80),
  };
  if (value.failureReason !== undefined) normalized.failureReason = optionalText('failureReason');
  if (value.lastCrawlTime !== undefined) normalized.lastCrawlTime = normalizeTimestamp(value.lastCrawlTime, `${path}.lastCrawlTime`);
  if (value.userCanonical !== undefined) normalized.userCanonical = normalizeHttpsUrl(value.userCanonical, `${path}.userCanonical`);
  if (value.googleCanonical !== undefined) normalized.googleCanonical = normalizeHttpsUrl(value.googleCanonical, `${path}.googleCanonical`);
  if (sitemapUrls.length > 0) normalized.sitemapUrls = [...new Set(sitemapUrls.map((url) => normalizeHttpsUrl(url, `${path}.sitemapUrls`)))];
  if (hasSitemapSubmissionState) {
    assert(
      new Set(['submitted', 'already-submitted']).has(value.sitemapSubmissionState),
      `${path}.sitemapSubmissionState is invalid`,
    );
    normalized.sitemapSubmissionState = value.sitemapSubmissionState;
    normalized.sitemapSubmittedAt = normalizeTimestamp(value.sitemapSubmittedAt, `${path}.sitemapSubmittedAt`);
  }
  return normalized;
}

function normalizeVisibilityOutcome(observation, { allowedProjectIds } = {}) {
  assertKnownKeys(
    observation,
    new Set(['id', 'projectId', 'family', 'provider', 'providerUrl', 'scope', 'observedAt', 'period', 'metrics', 'searchTerms', 'indexInspection', 'breakdowns']),
    'observation',
  );
  assert(typeof observation.id === 'string' && IDENTIFIER.test(observation.id), 'observation.id is invalid');
  assert(
    typeof observation.projectId === 'string' && IDENTIFIER.test(observation.projectId),
    'observation.projectId is invalid',
  );
  if (allowedProjectIds) {
    assert(allowedProjectIds.has(observation.projectId), `unknown visibility project: ${observation.projectId}`);
  }
  const contract = FAMILY_CONTRACTS[observation.family];
  assert(contract, `unsupported visibility outcome family: ${observation.family}`);
  const providers = allowedProviders(contract);
  assert(providers.has(observation.provider), `${observation.family} requires one of: ${[...providers].join(', ')}`);
  assert(
    typeof observation.scope === 'string' && observation.scope.length > 0 && observation.scope.length <= 300,
    'observation.scope must be 1-300 characters',
  );
  assertKnownKeys(observation.period, new Set(['start', 'end']), 'observation.period');
  const periodStart = normalizeTimestamp(observation.period.start, 'observation.period.start');
  const periodEnd = normalizeTimestamp(observation.period.end, 'observation.period.end');
  assert(Date.parse(periodStart) <= Date.parse(periodEnd), 'observation period must not end before it starts');
  const observedAt = normalizeTimestamp(observation.observedAt, 'observation.observedAt');
  assert(Date.parse(observedAt) >= Date.parse(periodEnd), 'observation must not precede its reporting period');
  assert(Array.isArray(observation.metrics) && observation.metrics.length > 0, 'observation.metrics is required');
  assert(observation.metrics.length <= Object.keys(contract.metrics).length, 'observation.metrics has too many entries');
  const metrics = observation.metrics.map((metric, index) =>
    normalizeMetric(metric, contract, `observation.metrics[${index}]`));
  assert(new Set(metrics.map((metric) => metric.label)).size === metrics.length, 'observation.metrics contains duplicates');
  const searchTerms = normalizeSearchTerms(observation.searchTerms, observation.family);
  const indexInspection = normalizeIndexInspection(observation.indexInspection, observation.family);
  const providerUrl = normalizeProviderUrl(observation.providerUrl);
  const breakdowns = normalizeBreakdowns(observation.breakdowns);
  return {
    schemaVersion: VISIBILITY_OUTCOME_SCHEMA,
    id: observation.id,
    projectId: observation.projectId,
    family: observation.family,
    provider: observation.provider,
    ...(providerUrl ? { providerUrl } : {}),
    scope: observation.scope,
    observedAt,
    period: { start: periodStart, end: periodEnd },
    metrics,
    ...(observation.family === 'search' ? { searchTerms } : {}),
    ...(indexInspection ? { indexInspection } : {}),
    ...(breakdowns.length > 0 ? { breakdowns } : {}),
  };
}

function prepareVisibilityOutcomeBundle(bundle, { allowedProjectIds } = {}) {
  assertKnownKeys(bundle, new Set(['schema', 'observations']), 'bundle');
  assert(bundle.schema === VISIBILITY_OUTCOME_BUNDLE_SCHEMA, 'unsupported visibility outcome bundle schema');
  assert(Array.isArray(bundle.observations) && bundle.observations.length > 0, 'bundle.observations is required');
  assert(bundle.observations.length <= 500, 'bundle.observations exceeds 500 entries');
  const observations = bundle.observations.map((observation) =>
    normalizeVisibilityOutcome(observation, { allowedProjectIds }));
  assert(new Set(observations.map((observation) => observation.id)).size === observations.length, 'bundle reuses an observation id');
  return observations;
}

export function defaultVisibilityOutcomePath({ home = process.env.HOME ?? '' } = {}) {
  return join(home, '.fleet', 'visibility-outcomes', 'ledger.jsonl');
}

export function readVisibilityOutcomes({ path = defaultVisibilityOutcomePath() } = {}) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        if (value?.schemaVersion !== VISIBILITY_OUTCOME_SCHEMA) return [];
        return [normalizeVisibilityOutcome({
          id: value.id,
          projectId: value.projectId,
          family: value.family,
          provider: value.provider,
          providerUrl: value.providerUrl,
          scope: value.scope,
          observedAt: value.observedAt,
          period: value.period,
          metrics: Array.isArray(value.metrics)
            ? value.metrics.map((metric) => ({ label: metric?.label, value: metric?.value }))
            : value.metrics,
          searchTerms: value.searchTerms,
          indexInspection: value.indexInspection,
          breakdowns: value.breakdowns,
        })];
      } catch {
        return [];
      }
    })
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}

export function appendVisibilityOutcomeBundle(
  bundle,
  { path = defaultVisibilityOutcomePath(), allowedProjectIds } = {},
) {
  const observations = prepareVisibilityOutcomeBundle(bundle, { allowedProjectIds });
  const existing = readVisibilityOutcomes({ path });
  const byId = new Map(existing.map((observation) => [observation.id, observation]));
  const pending = [];
  let duplicates = 0;
  for (const observation of observations) {
    const previous = byId.get(observation.id);
    if (!previous) {
      pending.push(observation);
      continue;
    }
    assert(stableJson(previous) === stableJson(observation), `observation id conflict: ${observation.id}`);
    duplicates += 1;
  }
  if (pending.length > 0) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${pending.map((observation) => JSON.stringify(observation)).join('\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    chmodSync(path, 0o600);
  }
  return {
    schema: 'fleet.visibility-outcome-ingest-receipt.v1',
    recorded: pending.length,
    duplicates,
    observations,
  };
}
