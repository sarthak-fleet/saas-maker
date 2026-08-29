#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 16;
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
const USER_AGENT = 'FleetLinkGraphAudit/1.0 (+https://sassmaker.com)';

export async function auditLinkGraph(options = {}) {
  const sitemap = requiredUrl(options.sitemap, 'sitemap');
  const localOrigin = normalizedOrigin(options.localOrigin ?? sitemap.origin);
  const canonicalOrigin = normalizedOrigin(options.canonicalOrigin ?? sitemap.origin);
  const maxPages = boundedInteger(options.maxPages ?? 2_000, 1, 10_000, 'maxPages');
  const concurrency = boundedInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    1,
    64,
    'concurrency',
  );
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    1_000,
    60_000,
    'timeoutMs',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const sitemapResult = await collectSitemapPages({
    sitemap,
    localOrigin,
    canonicalOrigin,
    maxPages,
    timeoutMs,
    fetchImpl,
  });
  const pageChecks = await mapConcurrent(sitemapResult.pages, concurrency, async (canonicalUrl) => {
    const localUrl = toLocalUrl(canonicalUrl, localOrigin, canonicalOrigin);
    const response = await inspect(localUrl, { fetchImpl, timeoutMs, readBody: true });
    return { canonicalUrl, localUrl, ...response };
  });

  const discoveredInternal = new Set(sitemapResult.pages);
  const external = new Set();
  const internalSources = new Map();
  const externalSources = new Map();
  for (const page of pageChecks) {
    if (!page.body || page.status < 200 || page.status >= 300) continue;
    for (const href of extractAnchorHrefs(page.body, page.canonicalUrl)) {
      if (href.origin === canonicalOrigin || href.origin === localOrigin) {
        const target = toCanonicalUrl(href, canonicalOrigin, localOrigin);
        discoveredInternal.add(target);
        addSource(internalSources, target, page.canonicalUrl);
      } else {
        const target = withoutHash(href).href;
        external.add(target);
        addSource(externalSources, target, page.canonicalUrl);
      }
    }
  }

  const internalChecks = await mapConcurrent(
    [...discoveredInternal].sort(),
    concurrency,
    async (canonicalUrl) => ({
      url: canonicalUrl,
      sources: [...(internalSources.get(canonicalUrl) ?? [])].sort(),
      ...(await inspect(toLocalUrl(canonicalUrl, localOrigin, canonicalOrigin), {
        fetchImpl,
        timeoutMs,
      })),
    }),
  );
  const externalChecks = options.external
    ? await mapConcurrentByHost([...external].sort(), concurrency, 2, async (url) => ({
      url,
      sources: [...(externalSources.get(url) ?? [])].sort(),
      ...(await inspect(url, { fetchImpl, timeoutMs })),
    }))
    : [];

  const sitemapSet = new Set(sitemapResult.pages);
  const internalErrors = internalChecks.filter(isError);
  const internalRedirects = internalChecks.filter(isRedirect);
  const externalErrors = externalChecks.filter(isError);
  const externalRedirects = externalChecks.filter(isRedirect);
  const externalUnverified = externalChecks.filter(isRateLimited);
  const orphanCandidates = [...discoveredInternal]
    .filter((url) => !sitemapSet.has(withoutSearch(url)) && isHtmlLikeUrl(url))
    .sort();

  return {
    schema: 'fleet.link-graph-audit.v1',
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    sitemap: sitemap.href,
    localOrigin,
    canonicalOrigin,
    summary: {
      sitemapPages: sitemapResult.pages.length,
      sitemapFiles: sitemapResult.sitemaps.length,
      crawledPages: pageChecks.length,
      discoveredInternal: internalChecks.length,
      internalErrors: internalErrors.length,
      internalRedirects: internalRedirects.length,
      orphanCandidates: orphanCandidates.length,
      discoveredExternal: external.size,
      checkedExternal: externalChecks.length,
      externalErrors: externalErrors.length,
      externalRedirects: externalRedirects.length,
      externalUnverified: externalUnverified.length,
    },
    issues: {
      sitemap: sitemapResult.issues,
      pages: pageChecks.filter((entry) => isError(entry) || isRedirect(entry)),
      internalErrors,
      internalRedirects,
      orphanCandidates,
      externalErrors,
      externalRedirects,
      externalUnverified,
    },
  };
}

export function extractAnchorHrefs(html, baseUrl) {
  const urls = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/giu)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw || raw.startsWith('#') || /^(?:mailto|tel|sms|javascript|data):/iu.test(raw)) continue;
    try {
      const url = withoutHash(new URL(raw, baseUrl));
      if (!/^https?:$/u.test(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      urls.push(url);
    } catch {
      // Malformed links are handled by the on-page audit's href validation.
    }
  }
  return urls;
}

async function collectSitemapPages(options) {
  const queue = [options.sitemap.href];
  const seen = new Set();
  const pages = new Set();
  const issues = [];
  while (queue.length > 0 && seen.size < 64 && pages.size < options.maxPages) {
    const canonicalSitemap = queue.shift();
    if (seen.has(canonicalSitemap)) continue;
    seen.add(canonicalSitemap);
    const response = await inspect(
      toLocalUrl(canonicalSitemap, options.localOrigin, options.canonicalOrigin),
      { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, readBody: true },
    );
    if (response.status !== 200 || !response.body) {
      issues.push({ url: canonicalSitemap, status: response.status, error: response.error });
      continue;
    }
    for (const raw of response.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)) {
      let url;
      try {
        url = new URL(decodeHtml(raw[1]), options.canonicalOrigin);
      } catch {
        issues.push({ url: raw[1], status: null, error: 'invalid sitemap URL' });
        continue;
      }
      const canonical = toCanonicalUrl(url, options.canonicalOrigin, options.localOrigin);
      if (/sitemap(?:[-_.]|\/|$)/iu.test(url.pathname)) queue.push(canonical);
      else if (pages.size < options.maxPages) pages.add(canonical);
    }
  }
  return { pages: [...pages].sort(), sitemaps: [...seen].sort(), issues };
}

async function inspect(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: HTML_ACCEPT, 'User-Agent': USER_AGENT },
    });
    const body = options.readBody && typeof response.text === 'function'
      ? await response.text()
      : '';
    if (!options.readBody && response.body?.cancel) await response.body.cancel();
    return {
      status: Number(response.status) || null,
      location: response.headers?.get?.('location') ?? null,
      contentType: response.headers?.get?.('content-type') ?? '',
      body,
      error: null,
    };
  } catch (error) {
    return {
      status: null,
      location: null,
      contentType: '',
      body: '',
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function mapConcurrentByHost(values, concurrency, perHostConcurrency, mapper) {
  const indexedGroups = new Map();
  for (const [index, value] of values.entries()) {
    const host = new URL(value).host;
    if (!indexedGroups.has(host)) indexedGroups.set(host, []);
    indexedGroups.get(host).push({ index, value });
  }
  const output = new Array(values.length);
  await mapConcurrent([...indexedGroups.values()], concurrency, async (group) => {
    await mapConcurrent(group, perHostConcurrency, async ({ index, value }) => {
      output[index] = await mapper(value, index);
    });
  });
  return output;
}

function toLocalUrl(value, localOrigin, canonicalOrigin) {
  const url = new URL(value, canonicalOrigin);
  if (url.origin === canonicalOrigin || url.origin === localOrigin) {
    return `${localOrigin}${url.pathname}${url.search}`;
  }
  return url.href;
}

function toCanonicalUrl(value, canonicalOrigin, localOrigin) {
  const url = withoutHash(new URL(value, canonicalOrigin));
  if (url.origin === canonicalOrigin || url.origin === localOrigin) {
    return `${canonicalOrigin}${url.pathname}${url.search}`;
  }
  return url.href;
}

function normalizedOrigin(value) {
  return requiredUrl(value, 'origin').origin;
}

function requiredUrl(value, label) {
  try {
    return new URL(String(value ?? ''));
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function withoutHash(value) {
  const url = new URL(value.href);
  url.hash = '';
  return url;
}

function isError(entry) {
  return entry.status == null || (entry.status >= 400 && !isRateLimited(entry));
}

function isRedirect(entry) {
  return entry.status >= 300 && entry.status < 400;
}

function isRateLimited(entry) {
  return entry.status === 429;
}

function isHtmlLikeUrl(value) {
  return !/\.(?:css|m?js|json|xml|txt|md|csv|tsv|png|jpe?g|webp|avif|gif|svg|ico|pdf|zip|woff2?|ttf)(?:$|\?)/iu.test(
    new URL(value).pathname,
  );
}

function withoutSearch(value) {
  const url = new URL(value);
  url.search = '';
  return url.href;
}

function addSource(map, target, source) {
  if (!map.has(target)) map.set(target, new Set());
  map.get(target).add(source);
}

function decodeHtml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&#38;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (!argv[index + 1]) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

export async function main(argv = process.argv.slice(2)) {
  const sitemap = argument(argv, '--sitemap');
  if (!sitemap) {
    process.stderr.write(
      'usage: link-graph-audit.mjs --sitemap <url> [--local-origin <url>] [--canonical-origin <url>] [--external] [--max-pages <n>]\n',
    );
    process.exitCode = 2;
    return null;
  }
  const result = await auditLinkGraph({
    sitemap,
    localOrigin: argument(argv, '--local-origin') ?? undefined,
    canonicalOrigin: argument(argv, '--canonical-origin') ?? undefined,
    maxPages: argument(argv, '--max-pages') ?? undefined,
    concurrency: argument(argv, '--concurrency') ?? undefined,
    timeoutMs: argument(argv, '--timeout-ms') ?? undefined,
    external: argv.includes('--external'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const failed = result.summary.internalErrors > 0 ||
    result.summary.internalRedirects > 0 ||
    result.summary.externalErrors > 0 ||
    result.summary.externalRedirects > 0 ||
    result.issues.sitemap.length > 0;
  if (failed) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
