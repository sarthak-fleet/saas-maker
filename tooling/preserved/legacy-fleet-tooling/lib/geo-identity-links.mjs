const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 6;

export function collectGeoIdentityLinks(catalog) {
  return (catalog.geoIdentities ?? []).flatMap((identity) => {
    const links = [
      link(identity, 'origin', identity.origin),
      identity.source?.state === 'public'
        ? link(identity, 'source', identity.source.url)
        : null,
      link(identity, 'docs', identity.docs?.url),
      ...(identity.officialProfiles ?? []).map((url) =>
        link(identity, 'official-profile', url),
      ),
      identity.availability?.appStore === 'listed'
        ? link(identity, 'app-store', identity.availability.appStoreUrl)
        : null,
      identity.pricing?.url ? link(identity, 'pricing', identity.pricing.url) : null,
    ].filter(Boolean);
    return dedupeLinks(links);
  });
}

export async function checkGeoIdentityLinks(catalog, {
  fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  concurrency = DEFAULT_CONCURRENCY,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error('GEO link concurrency must be an integer from 1 to 12');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('GEO link timeout must be an integer from 100 to 30000 ms');
  }

  const links = collectGeoIdentityLinks(catalog);
  const results = new Array(links.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < links.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await inspectLink(links[index], fetcher, timeoutMs);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, links.length) }, () => worker()),
  );

  const failures = results.filter((result) => result.status === 'fail');
  return {
    schema: 'fleet.geo-identity-link-audit.v1',
    observedAt,
    projectCount: new Set(results.map((result) => result.projectId)).size,
    linkCount: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
  };
}

async function inspectLink(linkValue, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(linkValue.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Fleet-GEO-Link-Audit/1.0' },
    });
    response.body?.cancel?.().catch?.(() => {});
    return {
      ...linkValue,
      status: response.ok ? 'pass' : 'fail',
      httpStatus: response.status,
      resolvedUrl: response.url || linkValue.url,
      reason: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      ...linkValue,
      status: 'fail',
      httpStatus: null,
      resolvedUrl: null,
      reason: timedOut ? `timeout after ${timeoutMs} ms` : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function link(identity, kind, url) {
  return { projectId: identity.id, kind, url };
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((item) => {
    const key = `${item.kind}\u0000${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
