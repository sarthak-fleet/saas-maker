const AHREFS_SITE_AUDIT_ENDPOINT =
  'https://api.ahrefs.com/v3/site-audit/projects';
const AHREFS_SITE_AUDIT_SCHEMA =
  'fleet.ahrefs-site-audit-health.v1';

const METRIC_FIELDS = [
  'health_score',
  'total',
  'urls_with_errors',
  'urls_with_warnings',
  'urls_with_notices',
];

export class AhrefsSiteAuditError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AhrefsSiteAuditError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
  }
}

export async function collectAhrefsSiteAuditHealth(options = {}) {
  const apiKey = String(options.apiKey ?? '').trim();
  if (!apiKey) {
    throw new AhrefsSiteAuditError(
      'missing-api-key',
      'AHREFS_API_KEY is required for Ahrefs Site Audit project health',
    );
  }
  const brands = normalizeBrands(options.brands);
  const maxAgeDays = boundedInteger(options.maxAgeDays ?? 14, 1, 365, 'maxAgeDays');
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) {
    throw new AhrefsSiteAuditError('invalid-now', 'now must be a valid timestamp');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new AhrefsSiteAuditError('missing-fetch', 'a fetch implementation is required');
  }

  let response;
  try {
    response = await fetchImpl(AHREFS_SITE_AUDIT_ENDPOINT, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (cause) {
    throw new AhrefsSiteAuditError(
      'request-failed',
      'Ahrefs Site Audit request failed before a provider response was received',
      { cause },
    );
  }
  if (!response?.ok) {
    const status = Number(response?.status) || null;
    const code = status === 401 || status === 403 ? 'auth-entitlement-error' : 'provider-error';
    throw new AhrefsSiteAuditError(
      code,
      `Ahrefs Site Audit API returned ${status ?? 'an unknown status'}${response?.statusText ? ` ${response.statusText}` : ''}`,
      { httpStatus: status },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AhrefsSiteAuditError(
      'invalid-response',
      'Ahrefs Site Audit API did not return valid JSON',
      { cause },
    );
  }
  if (!Array.isArray(payload?.healthscores)) {
    throw new AhrefsSiteAuditError(
      'invalid-response',
      'Ahrefs Site Audit response must contain a healthscores array',
    );
  }

  const projects = payload.healthscores.map(normalizeProject);
  const observations = brands.map((brand) => mapBrand(brand, projects, now, maxAgeDays));
  const statusCounts = Object.fromEntries(
    [...new Set(observations.map((entry) => entry.status))]
      .sort()
      .map((status) => [status, observations.filter((entry) => entry.status === status).length]),
  );
  return {
    schema: AHREFS_SITE_AUDIT_SCHEMA,
    status: observations.every((entry) => entry.status === 'fresh')
      ? 'complete'
      : 'partial',
    generatedAt: now.toISOString(),
    provider: {
      name: 'Ahrefs',
      metric: 'Ahrefs Site Audit Health Score',
      endpoint: AHREFS_SITE_AUDIT_ENDPOINT,
      maxAgeDays,
    },
    summary: {
      canonicalRoots: observations.length,
      fresh: observations.filter((entry) => entry.status === 'fresh').length,
      statusCounts,
    },
    observations,
  };
}

export function renderAhrefsSiteAuditMarkdown(result) {
  if (result?.schema !== AHREFS_SITE_AUDIT_SCHEMA) {
    throw new AhrefsSiteAuditError('invalid-result', 'cannot render an invalid Site Audit result');
  }
  const rows = result.observations.map((entry) => {
    const metric = entry.siteAudit;
    return `| ${escapeCell(entry.canonicalName)} | ${entry.rootDomain} | ${entry.status} | ${formatMetric(metric.healthScore)} | ${formatDate(metric.crawlDate)} | ${formatMetric(metric.totalCrawledInternalUrls)} | ${formatMetric(metric.urlsWithErrors)} | ${formatMetric(metric.urlsWithWarnings)} | ${formatMetric(metric.urlsWithNotices)} | ${escapeCell(entry.project?.name ?? '–')} |`;
  });
  return `# Ahrefs Site Audit health — canonical roots

Generated ${result.generatedAt} from the unit-free Ahrefs Site Audit project-health endpoint.

**Status: ${result.status}. Fresh coverage: ${result.summary.fresh}/${result.summary.canonicalRoots}. Maximum crawl age: ${result.provider.maxAgeDays} days.**

| brand | root | state | Ahrefs Health Score | crawl finished | crawled internal URLs | errors | warnings | notices | Ahrefs project |
|---|---|---|---:|---|---:|---:|---:|---:|---|
${rows.join('\n')}

Ahrefs Health Score is a Site Audit crawl metric. It is not Ahrefs Domain Rating, a Fleet on-page check, a PageSpeed score, or a ranking guarantee. Null and unavailable provider fields remain null; they are never rendered as zero.
`;
}

export function renderAhrefsSiteAuditErrorMarkdown(error, options = {}) {
  const generatedAt = new Date(options.now ?? Date.now()).toISOString();
  const code = error?.code ?? 'unknown-error';
  const http = error?.httpStatus ? ` (HTTP ${error.httpStatus})` : '';
  return `# Ahrefs Site Audit health — canonical roots

Generated ${generatedAt}.

**Status: blocked — ${code}${http}.**

${error?.message ?? 'Ahrefs Site Audit collection failed.'}

No Site Audit metric is reported as zero. Domain Rating, Fleet on-page checks, and PageSpeed remain separate metrics.
`;
}

function normalizeBrands(input) {
  const brands = Array.isArray(input) ? input : input?.brands;
  if (!Array.isArray(brands) || brands.length === 0) {
    throw new AhrefsSiteAuditError('invalid-brands', 'canonical root brands are required');
  }
  const roots = new Set();
  return brands.map((entry, index) => {
    const rootDomain = normalizeHostname(entry?.rootDomain);
    if (!rootDomain) {
      throw new AhrefsSiteAuditError('invalid-brands', `brand ${index} has an invalid rootDomain`);
    }
    if (roots.has(rootDomain)) {
      throw new AhrefsSiteAuditError('invalid-brands', `duplicate canonical root: ${rootDomain}`);
    }
    roots.add(rootDomain);
    return {
      rootDomain,
      canonicalName: requiredString(entry?.canonicalName, `brand ${rootDomain} canonicalName`),
    };
  });
}

function normalizeProject(input, index) {
  const targetUrl = requiredString(input?.target_url, `healthscores[${index}].target_url`);
  const targetDomain = normalizeHostname(targetUrl);
  if (!targetDomain) {
    throw new AhrefsSiteAuditError('invalid-response', `healthscores[${index}] has an invalid target_url`);
  }
  const metrics = {};
  for (const field of METRIC_FIELDS) metrics[field] = nullableNumber(input?.[field], `healthscores[${index}].${field}`);
  const date = input?.date == null ? null : String(input.date);
  if (date != null && !Number.isFinite(Date.parse(date))) {
    throw new AhrefsSiteAuditError('invalid-response', `healthscores[${index}].date is invalid`);
  }
  return {
    id: requiredString(String(input?.project_id ?? ''), `healthscores[${index}].project_id`),
    name: requiredString(input?.project_name, `healthscores[${index}].project_name`),
    targetUrl,
    targetDomain,
    targetMode: input?.target_mode == null ? null : String(input.target_mode),
    targetProtocol: input?.target_protocol == null ? null : String(input.target_protocol),
    date,
    status: input?.status == null ? null : String(input.status),
    ...metrics,
  };
}

function mapBrand(brand, projects, now, maxAgeDays) {
  const matches = projects
    .filter((project) => project.targetDomain === brand.rootDomain)
    .sort((a, b) => (Date.parse(b.date ?? 0) - Date.parse(a.date ?? 0)) || a.id.localeCompare(b.id));
  if (matches.length === 0) {
    return emptyObservation(brand, 'missing-project');
  }
  const project = matches[0];
  const ageDays = project.date == null
    ? null
    : (now.getTime() - Date.parse(project.date)) / 86_400_000;
  let status = 'fresh';
  if (matches.length > 1) status = 'ambiguous-project';
  else if (project.date == null) status = 'no-completed-crawl';
  else if (ageDays < -1 / 24) status = 'future-crawl';
  else if (project.status !== 'Completed') status = 'crawl-not-completed';
  else if (ageDays > maxAgeDays) status = 'stale-crawl';
  return {
    canonicalName: brand.canonicalName,
    rootDomain: brand.rootDomain,
    status,
    project: {
      id: project.id,
      name: project.name,
      targetUrl: project.targetUrl,
      targetMode: project.targetMode,
      targetProtocol: project.targetProtocol,
      duplicateMatches: matches.length,
    },
    siteAudit: {
      metric: 'Ahrefs Site Audit Health Score',
      healthScore: project.health_score,
      crawlDate: project.date,
      crawlStatus: project.status,
      crawlAgeDays: ageDays == null ? null : Number(ageDays.toFixed(2)),
      totalCrawledInternalUrls: project.total,
      urlsWithErrors: project.urls_with_errors,
      urlsWithWarnings: project.urls_with_warnings,
      urlsWithNotices: project.urls_with_notices,
    },
  };
}

function emptyObservation(brand, status) {
  return {
    canonicalName: brand.canonicalName,
    rootDomain: brand.rootDomain,
    status,
    project: null,
    siteAudit: {
      metric: 'Ahrefs Site Audit Health Score',
      healthScore: null,
      crawlDate: null,
      crawlStatus: null,
      crawlAgeDays: null,
      totalCrawledInternalUrls: null,
      urlsWithErrors: null,
      urlsWithWarnings: null,
      urlsWithNotices: null,
    },
  };
}

function normalizeHostname(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const hostname = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/\.$/, '');
    return hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function nullableNumber(value, label) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new AhrefsSiteAuditError('invalid-response', `${label} must be a number or null`);
  }
  return number;
}

function requiredString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new AhrefsSiteAuditError('invalid-response', `${label} is required`);
  }
  return normalized;
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new AhrefsSiteAuditError('invalid-option', `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function formatMetric(value) {
  return value == null ? '–' : String(value);
}

function formatDate(value) {
  return value == null ? '–' : escapeCell(value);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
