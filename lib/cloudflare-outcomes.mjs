const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export const DEFAULT_CLOUDFLARE_ACCOUNT_ID = '7d048325699a5acddb44d3be31cf6ba9';

const AI_REFERRERS = new Set([
  'chat.openai.com',
  'chatgpt.com',
  'claude.ai',
  'copilot.microsoft.com',
  'gemini.google.com',
  'mistral.ai',
  'perplexity.ai',
  'www.perplexity.ai',
  'you.com',
]);

const CRAWLER_NAMES = [
  ['OAI-SearchBot', /OAI-SearchBot/i],
  ['ChatGPT-User', /ChatGPT-User/i],
  ['Claude-SearchBot', /Claude-SearchBot/i],
  ['ClaudeBot', /ClaudeBot/i],
  ['PerplexityBot', /PerplexityBot/i],
  ['GPTBot', /GPTBot/i],
  ['Google-Extended', /Google-Extended/i],
  ['Bytespider', /Bytespider/i],
];

const ACCOUNT_ANALYTICS_QUERY = `
  query FleetCloudflareAccount($accountTag: string!, $start: Date!, $end: Date!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        totals: rumPageloadEventsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end, bot: 0 }
        ) {
          count
          sum { visits }
          dimensions { requestHost }
        }
        pages: rumPageloadEventsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end, bot: 0 }
        ) {
          count
          dimensions { requestHost requestPath }
        }
        referrers: rumPageloadEventsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end, bot: 0 }
        ) {
          count
          sum { visits }
          dimensions { requestHost refererHost }
        }
        vitals: rumWebVitalsEventsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end, bot: 0 }
        ) {
          count
          dimensions { requestHost }
          quantiles {
            largestContentfulPaintP75
            interactionToNextPaintP75
            cumulativeLayoutShiftP75
            timeToFirstByteP75
          }
        }
      }
    }
  }
`;

const ZONE_AI_QUERY = `
  query FleetCloudflareAi($zoneTag: string!, $start: Date!, $end: Date!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        requests: httpRequestsAdaptiveGroups(
          limit: 10000
          filter: {
            date_geq: $start
            date_leq: $end
            OR: [
              { verifiedBotCategory_in: ["AI Crawler", "AI Assistant"] }
              { userAgent_like: "%OAI-SearchBot%" }
              { userAgent_like: "%Claude-SearchBot%" }
              { userAgent_like: "%PerplexityBot%" }
            ]
          }
        ) {
          count
          dimensions {
            clientRequestHTTPHost
            clientRequestPath
            edgeResponseStatus
            userAgent
            verifiedBotCategory
          }
        }
      }
    }
  }
`;

function day(date) {
  return date.toISOString().slice(0, 10);
}

function shiftedDay(value, amount) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return day(date);
}

function normalizedHost(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
}

function valueMap(rows, key) {
  const map = new Map();
  for (const row of rows ?? []) {
    const host = normalizedHost(row?.dimensions?.requestHost ?? row?.dimensions?.clientRequestHTTPHost);
    if (!host) continue;
    const values = map.get(host) ?? [];
    values.push(row);
    map.set(host, values);
  }
  if (!key) return map;
  return new Map([...map].map(([host, values]) => [host, values[0]?.[key] ?? null]));
}

function topValues(rows, label, value, limit = 10) {
  const totals = new Map();
  for (const row of rows ?? []) {
    const itemLabel = String(label(row) ?? '').replace(/\s+/g, ' ').trim();
    const itemValue = Number(value(row) ?? 0);
    if (!itemLabel || !Number.isFinite(itemValue) || itemValue <= 0) continue;
    totals.set(itemLabel, (totals.get(itemLabel) ?? 0) + itemValue);
  }
  return [...totals]
    .map(([itemLabel, itemValue]) => ({ label: itemLabel, value: itemValue }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function breakdown(id, label, unit, values) {
  return values.length > 0 ? { id, label, unit, values } : null;
}

function isAiReferrer(value) {
  const host = normalizedHost(value);
  return AI_REFERRERS.has(host) || [...AI_REFERRERS].some((candidate) => host.endsWith(`.${candidate}`));
}

const SEARCH_REFERRER_PATTERNS = [
  /^(?:www\.)?google\.[a-z.]+$/,
  /^(?:www\.)?bing\.com$/,
  /^(?:www\.)?duckduckgo\.com$/,
  /^(?:search\.)?yahoo\.[a-z.]+$/,
  /^(?:www\.)?yandex\.[a-z.]+$/,
  /^(?:www\.)?baidu\.com$/,
];

function isSearchReferrer(value) {
  const host = normalizedHost(value);
  return SEARCH_REFERRER_PATTERNS.some((pattern) => pattern.test(host));
}

function crawlerName(userAgent, category) {
  const match = CRAWLER_NAMES.find(([, pattern]) => pattern.test(String(userAgent ?? '')));
  return match?.[0] ?? String(category || 'Other AI crawler');
}

function microsecondsToMilliseconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric / 1000 : null;
}

async function responseJson(response, label) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned an unreadable response`);
  }
  if (!response.ok || body?.errors?.length || body?.success === false) {
    throw new Error(`${label} failed (${response.status})`);
  }
  return body;
}

async function listZones({ token, fetchImpl }) {
  const response = await fetchImpl(`${CLOUDFLARE_API}/zones?per_page=50`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await responseJson(response, 'Cloudflare zone inventory');
  return (body.result ?? []).flatMap((zone) => {
    const id = String(zone?.id ?? '');
    const name = normalizedHost(zone?.name);
    return id && name && zone?.status === 'active' ? [{ id, name }] : [];
  });
}

async function graphql({ token, fetchImpl, query, variables, label }) {
  const response = await fetchImpl(`${CLOUDFLARE_API}/graphql`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await responseJson(response, label)).data;
}

export function selectCloudflareZone(host, zones) {
  const normalized = normalizedHost(host);
  return [...(zones ?? [])]
    .filter((zone) => normalized === zone.name || normalized.endsWith(`.${zone.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
}

export function cloudflareProviderUrls(accountId, zoneId) {
  const base = `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/${encodeURIComponent(zoneId)}`;
  return {
    traffic: `${base}/analytics/traffic`,
    performance: `${base}/speed/observatory`,
    ai: `${base}/ai`,
  };
}

export async function collectCloudflareOutcomes({
  projects,
  token,
  accountId = DEFAULT_CLOUDFLARE_ACCOUNT_ID,
  fetchImpl = fetch,
  now = new Date(),
  reportingWindowDays = 28,
}) {
  if (!token) throw new Error('Cloudflare read credentials are required');
  if (!Number.isInteger(reportingWindowDays) || reportingWindowDays < 1 || reportingWindowDays > 180) {
    throw new Error('Cloudflare reporting window must be 1-180 days');
  }
  const observedAt = now.toISOString();
  const runId = observedAt.replace(/[^0-9]/g, '');
  const endDate = shiftedDay(day(now), -1);
  const startDate = shiftedDay(endDate, -(reportingWindowDays - 1));
  const zones = await listZones({ token, fetchImpl });
  const targets = (projects ?? []).flatMap((project) => {
    const host = normalizedHost(project?.domains?.[0]);
    const zone = selectCloudflareZone(host, zones);
    return host && zone ? [{ project, host, zone }] : [];
  });
  const unavailable = (projects ?? []).flatMap((project) => {
    const host = normalizedHost(project?.domains?.[0]);
    return host && selectCloudflareZone(host, zones)
      ? []
      : [{ projectId: project.id, domain: host || null, reason: 'zone-unavailable' }];
  });

  const accountData = await graphql({
    token,
    fetchImpl,
    query: ACCOUNT_ANALYTICS_QUERY,
    variables: { accountTag: accountId, start: startDate, end: endDate },
    label: 'Cloudflare Web Analytics',
  });
  const account = accountData?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare Web Analytics account is unavailable');

  const totalsByHost = new Map((account.totals ?? []).map((row) => [
    normalizedHost(row?.dimensions?.requestHost),
    row,
  ]));
  const pagesByHost = valueMap(account.pages);
  const referrersByHost = valueMap(account.referrers);
  const vitalsByHost = new Map((account.vitals ?? []).map((row) => [
    normalizedHost(row?.dimensions?.requestHost),
    row,
  ]));

  const aiRowsByHost = new Map();
  const queriedZones = new Set();
  for (const { zone } of targets) {
    if (queriedZones.has(zone.id)) continue;
    queriedZones.add(zone.id);
    const zoneData = await graphql({
      token,
      fetchImpl,
      query: ZONE_AI_QUERY,
      variables: { zoneTag: zone.id, start: endDate, end: endDate },
      label: `Cloudflare AI Crawl Control for ${zone.name}`,
    });
    for (const [host, rows] of valueMap(zoneData?.viewer?.zones?.[0]?.requests)) {
      aiRowsByHost.set(host, rows);
    }
  }

  const observations = [];
  for (const { project, host, zone } of targets) {
    const urls = cloudflareProviderUrls(accountId, zone.id);
    const total = totalsByHost.get(host);
    const pageRows = pagesByHost.get(host) ?? [];
    const referrerRows = referrersByHost.get(host) ?? [];
    const vital = vitalsByHost.get(host);
    const aiRows = aiRowsByHost.get(host) ?? [];
    const period = {
      start: `${startDate}T00:00:00.000Z`,
      end: `${endDate}T23:59:59.999Z`,
    };

    if (total) {
      const searchReferralVisits = referrerRows
        .filter((row) => isSearchReferrer(row?.dimensions?.refererHost))
        .reduce((sum, row) => sum + Number(row?.sum?.visits ?? 0), 0);
      observations.push({
        id: `web-traffic-${project.id}-${endDate}-${runId}`,
        projectId: project.id,
        family: 'web-traffic',
        provider: 'cloudflare-web-analytics',
        providerUrl: urls.traffic,
        scope: host,
        observedAt,
        period,
        metrics: [
          { label: 'Web visits', value: Number(total?.sum?.visits ?? 0) },
          { label: 'Web page views', value: Number(total?.count ?? 0) },
          { label: 'Search referral visits', value: searchReferralVisits },
        ],
        breakdowns: [
          breakdown('top-pages', 'Top pages', 'page views', topValues(
            pageRows,
            (row) => row?.dimensions?.requestPath,
            (row) => row?.count,
          )),
          breakdown('top-referrers', 'Top referrers', 'visits', topValues(
            referrerRows,
            (row) => row?.dimensions?.refererHost,
            (row) => row?.sum?.visits,
          )),
        ].filter(Boolean),
      });

      const aiReferrerRows = referrerRows.filter((row) => isAiReferrer(row?.dimensions?.refererHost));
      observations.push({
        id: `ai-referral-${project.id}-${endDate}-${runId}`,
        projectId: project.id,
        family: 'ai-referral',
        provider: 'cloudflare-web-analytics',
        providerUrl: urls.traffic,
        scope: host,
        observedAt,
        period,
        metrics: [
          { label: 'AI referral visits', value: aiReferrerRows.reduce((sum, row) => sum + Number(row?.sum?.visits ?? 0), 0) },
          { label: 'AI referral page views', value: aiReferrerRows.reduce((sum, row) => sum + Number(row?.count ?? 0), 0) },
        ],
        breakdowns: [breakdown('ai-referrers', 'AI referrers', 'visits', topValues(
          aiReferrerRows,
          (row) => row?.dimensions?.refererHost,
          (row) => row?.sum?.visits,
        ))].filter(Boolean),
      });
    }

    if (vital && Number(vital.count) > 0) {
      const p75 = vital.quantiles ?? {};
      const metrics = [
        ['Field LCP', microsecondsToMilliseconds(p75.largestContentfulPaintP75)],
        ['Field INP', microsecondsToMilliseconds(p75.interactionToNextPaintP75)],
        ['Field CLS', Number.isFinite(Number(p75.cumulativeLayoutShiftP75)) ? Number(p75.cumulativeLayoutShiftP75) : null],
        ['Field TTFB', microsecondsToMilliseconds(p75.timeToFirstByteP75)],
        ['RUM samples', Number(vital.count)],
      ].flatMap(([label, value]) => Number.isFinite(value) ? [{ label, value }] : []);
      observations.push({
        id: `web-vitals-${project.id}-${endDate}-${runId}`,
        projectId: project.id,
        family: 'web-vitals',
        provider: 'cloudflare-web-analytics',
        providerUrl: urls.performance,
        scope: host,
        observedAt,
        period,
        metrics,
      });
    }

    observations.push({
      id: `ai-crawl-${project.id}-${endDate}-${runId}`,
      projectId: project.id,
      family: 'ai-crawl',
      provider: 'cloudflare-ai-crawl-control',
      providerUrl: urls.ai,
      scope: host,
      observedAt,
      period: {
        start: `${endDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      },
      metrics: [
        { label: 'AI crawler requests', value: aiRows.reduce((sum, row) => sum + Number(row?.count ?? 0), 0) },
        { label: 'AI crawled URLs', value: new Set(aiRows.map((row) => row?.dimensions?.clientRequestPath).filter(Boolean)).size },
      ],
      breakdowns: [
        breakdown('ai-crawlers', 'AI crawlers', 'requests', topValues(
          aiRows,
          (row) => crawlerName(row?.dimensions?.userAgent, row?.dimensions?.verifiedBotCategory),
          (row) => row?.count,
        )),
        breakdown('ai-paths', 'Top AI-crawled paths', 'requests', topValues(
          aiRows,
          (row) => row?.dimensions?.clientRequestPath,
          (row) => row?.count,
        )),
        breakdown('ai-statuses', 'AI response statuses', 'requests', topValues(
          aiRows,
          (row) => String(row?.dimensions?.edgeResponseStatus ?? ''),
          (row) => row?.count,
        )),
      ].filter(Boolean),
    });
  }

  return {
    bundle: { schema: 'fleet.visibility-outcome-bundle.v1', observations },
    unavailable,
    zoneCount: queriedZones.size,
    projectCount: targets.length,
    period: { start: startDate, end: endDate, aiDay: endDate },
  };
}
