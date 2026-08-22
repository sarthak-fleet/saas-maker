const LOCAL_SITE_AUDIT_SCHEMA = 'fleet.local-site-audit.v1';
const SKIP_PATH =
  /(?:\.(?:md|txt|xml|json|pdf|svg|png|jpe?g|webp|ico)$)|(?:^\/(?:api|openapi)(?:\/|$))|(?:llms(?:-full)?\.txt$)|(?:sitemap)/iu;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/iu;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu;
const CANONICAL_RE = /<link[^>]+rel=["']canonical["'][^>]*>/iu;
const HTML_HINT_RE = /<html[\s>]|<body[\s>]/iu;

export function isAuditableHtmlPage(url) {
  try {
    const path = new URL(url).pathname;
    return !SKIP_PATH.test(path);
  } catch {
    return false;
  }
}

export function classifyPage(input) {
  const status = input.status;
  const contentType = String(input.contentType ?? '').toLowerCase();
  const body = String(input.body ?? '');
  const url = input.url;
  const issues = [];

  if (status == null) {
    return [{ code: 'fetch-error', severity: 'error', action: 'Restore a reachable public HTML response' }];
  }
  if (status >= 400) {
    return [{
      code: `http-${status}`,
      severity: 'error',
      action: 'Restore the page or remove the URL from the sitemap',
    }];
  }
  if (!isAuditableHtmlPage(url)) return [];
  if (contentType.includes('json') || contentType.includes('text/plain') || contentType.includes('xml')) {
    return [];
  }
  if (contentType && !contentType.includes('html') && !HTML_HINT_RE.test(body)) {
    return [];
  }

  const title = stripTags(body.match(TITLE_RE)?.[1] ?? '');
  const h1 = stripTags(body.match(H1_RE)?.[1] ?? '');
  if (!title) {
    issues.push({ code: 'missing-title', severity: 'error', action: 'Add a unique non-empty HTML title' });
  }
  if (!h1) {
    issues.push({ code: 'missing-h1', severity: 'error', action: 'Add one visible page-level h1' });
  }
  if (!CANONICAL_RE.test(body)) {
    issues.push({ code: 'missing-canonical', severity: 'warning', action: 'Add a self-referencing canonical link' });
  }
  return issues;
}

export async function collectLocalSiteAudit(options = {}) {
  const brands = Array.isArray(options.brands) ? options.brands : [];
  if (brands.length === 0) {
    return emptyLocalResult(options.now);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxPagesPerRoot = clampInteger(options.maxPagesPerRoot ?? 40, 1, 100);
  const now = new Date(options.now ?? Date.now()).toISOString();
  const observations = [];

  for (const brand of brands) {
    const rootDomain = String(brand.rootDomain ?? '').trim();
    const origin = `https://${rootDomain}`;
    const sitemapUrls = await collectSitemapUrls(origin, fetchImpl, maxPagesPerRoot);
    const pages = [];
    for (const url of sitemapUrls) {
      const page = await inspectPage(url, fetchImpl);
      const issues = classifyPage(page);
      if (issues.length > 0) {
        pages.push({
          url,
          status: page.status,
          issues,
        });
      }
    }
    observations.push({
      canonicalName: brand.canonicalName ?? rootDomain,
      rootDomain,
      crawled: sitemapUrls.length,
      issuePages: pages.length,
      pages,
    });
  }

  const actions = observations.flatMap((entry) =>
    entry.pages.flatMap((page) =>
      page.issues.map((issue) => ({
        rootDomain: entry.rootDomain,
        canonicalName: entry.canonicalName,
        url: page.url,
        status: page.status,
        code: issue.code,
        severity: issue.severity,
        action: issue.action,
      })),
    ),
  );

  return {
    schema: LOCAL_SITE_AUDIT_SCHEMA,
    generatedAt: now,
    summary: {
      roots: observations.length,
      crawled: observations.reduce((sum, entry) => sum + entry.crawled, 0),
      issuePages: observations.reduce((sum, entry) => sum + entry.issuePages, 0),
      errorActions: actions.filter((action) => action.severity === 'error').length,
      warningActions: actions.filter((action) => action.severity === 'warning').length,
    },
    observations,
    actions,
  };
}

export function renderLocalSiteAuditMarkdown(local) {
  if (local?.schema !== LOCAL_SITE_AUDIT_SCHEMA) return '';
  const actionRows = local.actions.length === 0
    ? '| – | – | – | – | No source actions from the local crawl. |'
    : local.actions.map((action) =>
      `| ${escapeCell(action.canonicalName)} | ${action.severity} | ${escapeCell(action.code)} | ${escapeCell(action.url)} | ${escapeCell(action.action)} |`
    ).join('\n');
  return `
## Local crawl and source actions

Generated ${local.generatedAt} from each root sitemap. Agent surfaces such as Markdown alternates, \`llms.txt\`, and \`/api/*\` are skipped. This is the remediation input when Ahrefs Site Audit is unavailable.

**Crawled ${local.summary.crawled} URLs across ${local.summary.roots} roots. ${local.summary.errorActions} error actions, ${local.summary.warningActions} warnings.**

| brand | severity | issue | url | action |
|---|---|---|---|---|
${actionRows}

Apply every **error** action in the owning source repository. Do not deploy. Do not invent review scores or ratings. Warnings may wait unless they share a page already being edited.
`;
}

async function collectSitemapUrls(origin, fetchImpl, limit) {
  const seeds = [`${origin}/sitemap.xml`, `${origin}/sitemap-index.xml`];
  const seenSitemaps = new Set();
  const urls = [];
  const queue = [...seeds];
  while (queue.length > 0 && seenSitemaps.size < 8 && urls.length < limit) {
    const sitemapUrl = queue.shift();
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const page = await inspectPage(sitemapUrl, fetchImpl);
    if (page.status !== 200 || !page.body) continue;
    const { pages, nested } = parseSitemap(page.body);
    queue.push(...nested);
    for (const url of pages) {
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= limit) break;
    }
  }
  if (urls.length === 0) urls.push(`${origin}/`);
  return urls.slice(0, limit);
}

function parseSitemap(body) {
  const pages = [];
  const nested = [];
  for (const match of String(body).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/giu)) {
    const loc = match[1].trim();
    if (/sitemap/iu.test(loc)) nested.push(loc);
    else pages.push(loc);
  }
  return { pages, nested };
}

async function inspectPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    });
    const contentType = response.headers?.get?.('content-type') ?? response.headers?.['content-type'] ?? '';
    const body = typeof response.text === 'function' ? await response.text() : '';
    return { url, status: Number(response.status) || null, contentType, body };
  } catch {
    return { url, status: null, contentType: '', body: '' };
  }
}

function emptyLocalResult(now) {
  return {
    schema: LOCAL_SITE_AUDIT_SCHEMA,
    generatedAt: new Date(now ?? Date.now()).toISOString(),
    summary: { roots: 0, crawled: 0, issuePages: 0, errorActions: 0, warningActions: 0 },
    observations: [],
    actions: [],
  };
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clampInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
