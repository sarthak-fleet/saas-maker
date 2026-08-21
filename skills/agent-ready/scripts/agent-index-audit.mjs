#!/usr/bin/env node
/**
 * Local fleet agent-index auditor (GEO / LLM indexing).
 *
 * Spec: foundry/ops/docs/agent-indexing-standard.md
 *
 * Usage:
 *   node agent-index-audit.mjs https://rolepatch.com
 *   node agent-index-audit.mjs --all
 *   node agent-index-audit.mjs --all --json
 *   node agent-index-audit.mjs --all --summary-json
 *   node agent-index-audit.mjs --all --metric-json
 *   node agent-index-audit.mjs --project rolepatch
 *
 * Target membership and primary domains come from projects.json. Per-product
 * indexing metadata comes from agent-surfaces-registry.json and is validated
 * against that canonical list. Does NOT call isitagentready.com (rate limits).
 * Probes origins directly and detects SPA-fake HTML shells on agent paths.
 *
 * Required checks: llms.txt, /api/ai, homepage markdown, not-SPA-fake,
 * robots (User-agent + Sitemap line), AI-crawler access (GPTBot/ClaudeBot/
 * OAI-SearchBot/PerplexityBot not disallowed), sitemap (real XML, same-host
 * <loc> entries). If /api/ai advertises llmsFull, that URL must resolve.
 * Bonus (reported, not required): /skill.md, IndexNow key file.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistry,
  productOrigin as registryProductOrigin,
} from '../../../scripts/lib/registry.mjs';
import {
  configuredProbeConcurrency,
  withTransientRetries,
} from '../../../lib/agent-probe-retry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts → agent-ready → skills → ops → foundry → fleet root
const FLEET_ROOT = resolve(__dirname, '../../../../..');
const INDEXNOW_CONFIG_PATH = join(FLEET_ROOT, 'foundry/ops/config/indexnow.json');

const UA = 'fleet-agent-index-audit/2.0 (+https://sassmaker.com)';
const TIMEOUT_MS = 15_000;
const MAX_SITEMAPS = 50;
const MAX_PUBLIC_ROUTES = 50_000;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_ROUTE_PROBES = 250;
const MAX_CATALOG_SURFACES = 1_000;
const PROBE_CONCURRENCY = configuredProbeConcurrency(
  process.env.FLEET_AGENT_PROBE_CONCURRENCY,
);

// Answer-engine crawlers that must not be disallowed for GEO to work at all.
const CRITICAL_AI_BOTS = ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'PerplexityBot'];
// Reported when blocked, but not required (training-only or low-value bots).
const REPORTED_AI_BOTS = ['Google-Extended', 'CCBot', 'ChatGPT-User', 'Claude-Web'];

const REQUIRED_CHECKS = [
  'llms_txt',
  'api_ai',
  'homepage_md',
  'not_spa_fake',
  'robots',
  'ai_access',
  'sitemap',
  'route_markdown',
  'catalog_integrity',
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(args);

  if (targets.length === 0) {
    console.error('No targets. Pass a URL, --project <registry-id>, or --all.');
    process.exit(2);
  }

  const indexNowKey = loadIndexNowKey();

  const results = [];
  for (const t of targets) {
    process.stderr.write(`Auditing ${t.name} (${t.origin})…\n`);
    try {
      results.push(await auditOrigin(t, { indexNowKey }));
    } catch (err) {
      results.push({
        name: t.name,
        origin: t.origin,
        error: String(err?.message || err),
        tier: 'error',
        score: 0,
        checks: {},
      });
    }
  }

  if (args.json || args.summaryJson || args.metricJson) {
    let outputResults = results;
    if (args.summaryJson) outputResults = results.map(summarizeResult);
    if (args.metricJson) outputResults = results.map(metricResult);
    console.log(
      JSON.stringify(
        { generatedAt: new Date().toISOString(), results: outputResults },
        null,
        2,
      ),
    );
  } else {
    printScoreboard(results);
  }

  const sTier = results.filter((r) => r.tier === 'S').length;
  const failed = results.filter((r) => r.tier !== 'S' && r.tier !== 'error');
  process.stderr.write(
    `\n${sTier}/${results.length} S-tier. ${failed.length} need work.\n`
  );
  process.exit(sTier === results.length ? 0 : 1);
}

function parseArgs(argv) {
  const args = {
    json: false,
    summaryJson: false,
    metricJson: false,
    all: false,
    project: null,
    urls: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--summary-json') args.summaryJson = true;
    else if (a === '--metric-json') args.metricJson = true;
    else if (a === '--all') args.all = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('http://') || a.startsWith('https://')) {
      args.urls.push(a);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  agent-index-audit.mjs <url>
  agent-index-audit.mjs --project <registry-id>
  agent-index-audit.mjs --all [--json | --summary-json | --metric-json]

Targets: metric-eligible visibility projects from foundry/ops/config/projects.json
`);
}

function summarizeResult(result) {
  return {
    name: result.name,
    origin: result.origin,
    ...(result.id ? { id: result.id } : {}),
    ...(result.error ? { error: result.error } : {}),
    tier: result.tier,
    score: result.score,
    checks: Object.fromEntries(
      Object.entries(result.checks || {}).map(([id, check]) => [
        id,
        {
          status: check.status,
          detail: check.detail,
        },
      ]),
    ),
  };
}

/**
 * Return the bounded audit evidence needed by visibility-metric ingestion.
 * In particular, omit api_ai.data because a large surfaces catalog can make
 * the general-purpose --json response exceed child-process output buffers.
 */
function metricResult(result) {
  const includedData = new Set(['route_markdown', 'catalog_integrity']);
  return {
    ...summarizeResult(result),
    pass: result.pass,
    fail: result.fail,
    checks: Object.fromEntries(
      Object.entries(result.checks || {}).map(([id, check]) => [
        id,
        {
          status: check.status,
          detail: check.detail,
          ...(includedData.has(id) && check.data ? { data: check.data } : {}),
        },
      ]),
    ),
  };
}

function loadIndexNowKey() {
  try {
    if (!existsSync(INDEXNOW_CONFIG_PATH)) return null;
    const cfg = JSON.parse(readFileSync(INDEXNOW_CONFIG_PATH, 'utf8'));
    return typeof cfg.key === 'string' && cfg.key.length >= 16 ? cfg.key : null;
  } catch {
    return null;
  }
}

/**
 * Origin (protocol//host) for a product, via the shared registry preference
 * chain. Returns null when the product has no URL.
 */
function productOrigin(product) {
  const url = registryProductOrigin(product);
  return url ? originOf(url) : null;
}

function resolveTargets(args) {
  if (args.urls.length) {
    return args.urls.map((u) => ({
      name: hostOf(u),
      origin: originOf(u),
    }));
  }

  const registry = loadRegistry();
  const products = registry.products || [];

  if (args.project) {
    const p = products.find((x) => x.id === args.project);
    if (!p) {
      console.error(
        `No product '${args.project}' in registry. Known ids: ${products
          .map((x) => x.id)
          .join(', ')}`
      );
      process.exit(2);
    }
    const origin = productOrigin(p);
    if (!origin) {
      console.error(`Product ${p.id} has no url in the registry`);
      process.exit(2);
    }
    return [{ name: p.name || p.id, origin }];
  }

  if (args.all) {
    return products
      .map((p) => ({ name: p.name || p.id, origin: productOrigin(p), id: p.id }))
      .filter((t) => t.origin);
  }

  return [];
}

/**
 * @param {{ name: string, origin: string }} target
 */
async function auditOrigin(target, { indexNowKey } = {}) {
  const { origin, name } = target;
  const checks = {};

  // --- llms.txt ---
  const llms = await probe(`${origin}/llms.txt`);
  checks.llms_txt = gradeAgentText(llms, { requireHash: true });

  // --- SPA fake on llms ---
  checks.not_spa_fake = {
    status: llms.ok && !llms.isHtml ? 'pass' : 'fail',
    detail: llms.ok
      ? llms.isHtml
        ? 'SPA/HTML shell returned for /llms.txt'
        : 'not an HTML shell'
      : `llms status ${llms.status}`,
  };

  // --- /api/ai ---
  const apiAi = await probe(`${origin}/api/ai`, { accept: 'application/json' });
  checks.api_ai = gradeApiAi(apiAi);

  // --- advertised llms-full must resolve (skip if not advertised) ---
  checks.llms_full = await gradeAdvertisedLlmsFull(apiAi);

  // --- homepage markdown (negotiation or index.md) ---
  const neg = await probe(`${origin}/`, {
    accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.1',
  });
  const indexMd = await probe(`${origin}/index.md`, {
    accept: 'text/markdown, text/plain, */*',
  });
  checks.homepage_md = gradeHomepageMd(neg, indexMd);

  // --- robots + AI-crawler access ---
  const robots = await probe(`${origin}/robots.txt`);
  checks.robots = gradeRobots(robots);
  checks.ai_access = gradeAiAccess(robots);

  // --- sitemap (real XML, same-host locs) ---
  const sitemap = await inspectSitemap(origin, robots);
  checks.sitemap = sitemap.check;

  // --- public-route Markdown coverage + catalog integrity ---
  const cachedProbe = createProbeCache();
  checks.route_markdown = await gradeRouteMarkdown(
    origin,
    sitemap,
    apiAi,
    cachedProbe,
  );
  checks.catalog_integrity = await gradeCatalogIntegrity(
    origin,
    sitemap,
    apiAi,
    cachedProbe,
  );

  // Bonus (not required for S but reported)
  const skill = await probe(`${origin}/skill.md`);
  checks.skill_md = {
    status: skill.ok && !skill.isHtml ? 'pass' : 'skip',
    detail: skill.ok && !skill.isHtml ? 'present (S+)' : 'absent (ok for non-agent-native)',
  };

  // --- JSON-LD structured data (reported, not required) ---
  const homepage = await probe(`${origin}/`, { accept: 'text/html' });
  checks.jsonld = gradeJsonLd(homepage);

  if (indexNowKey) {
    const keyProbe = await probe(`${origin}/${indexNowKey}.txt`);
    const keyOk = keyProbe.ok && !keyProbe.isHtml && keyProbe.bodyFull?.trim() === indexNowKey;
    checks.indexnow_key = {
      status: keyOk ? 'pass' : 'skip',
      detail: keyOk
        ? 'key file live'
        : `key file not live (${keyProbe.status}${keyProbe.isHtml ? ', HTML shell' : ''}) — IndexNow submits for this host will fail`,
    };
  }

  // llms_full is required only when advertised (skip = not applicable)
  const applicable = [...REQUIRED_CHECKS];
  if (checks.llms_full.status !== 'skip') applicable.push('llms_full');

  const passCount = applicable.filter((k) => checks[k]?.status === 'pass').length;
  const failCount = applicable.filter((k) => checks[k]?.status === 'fail').length;
  const score = Math.round((passCount / applicable.length) * 100);
  const tier =
    failCount === 0 ? 'S' : passCount >= 5 ? 'A' : passCount >= 3 ? 'B' : 'C';

  return {
    name,
    origin,
    tier,
    score,
    pass: passCount,
    fail: failCount,
    checks,
  };
}

function gradeAgentText(probe, { requireHash }) {
  if (!probe.ok) {
    return { status: 'fail', detail: `HTTP ${probe.status || 'err'}` };
  }
  if (probe.isHtml) {
    return { status: 'fail', detail: 'HTML shell (SPA catch-all)' };
  }
  const ct = (probe.contentType || '').toLowerCase();
  if (!ct.includes('text/') && !ct.includes('markdown') && !ct.includes('json')) {
    // some CDNs omit type; allow if body looks like markdown
    if (!probe.bodyPreview?.trimStart().startsWith('#')) {
      return { status: 'fail', detail: `unexpected content-type ${ct || 'empty'}` };
    }
  }
  if (requireHash && !probe.bodyPreview?.trimStart().startsWith('#')) {
    return { status: 'fail', detail: 'body does not start with #' };
  }
  return {
    status: 'pass',
    detail: `${probe.bytes}B ${ct || 'no-ct'}`,
  };
}

function gradeApiAi(probe) {
  if (!probe.ok) {
    return { status: 'fail', detail: `HTTP ${probe.status || 'err'}` };
  }
  if (probe.isHtml) {
    return { status: 'fail', detail: 'HTML shell instead of JSON' };
  }
  try {
    const data = JSON.parse(probe.bodyFull || probe.bodyPreview || '{}');
    const missing = ['name', 'llms', 'sitemap', 'markdown', 'surfaces'].filter(
      (k) => data[k] == null,
    );
    if (missing.length) {
      return { status: 'fail', detail: `JSON missing ${missing.join(',')}` };
    }
    if (!Array.isArray(data.surfaces)) {
      return { status: 'fail', detail: 'surfaces is not an array' };
    }
    return {
      status: 'pass',
      detail: `${data.surfaces.length} surfaces, name=${data.name}`,
      data,
    };
  } catch {
    return { status: 'fail', detail: 'body is not JSON' };
  }
}

/** If /api/ai advertises an llmsFull URL, it must actually resolve. */
async function gradeAdvertisedLlmsFull(apiAiProbe) {
  let advertised = null;
  try {
    const data = JSON.parse(apiAiProbe.bodyFull || '{}');
    advertised = typeof data.llmsFull === 'string' ? data.llmsFull : null;
  } catch {
    /* api_ai check reports the JSON problem */
  }
  if (!advertised) {
    return { status: 'skip', detail: 'llmsFull not advertised' };
  }
  const full = await probe(advertised);
  if (!full.ok || full.isHtml) {
    return {
      status: 'fail',
      detail: `api/ai advertises ${advertised} but it returns ${
        full.isHtml ? 'HTML shell' : `HTTP ${full.status || 'err'}`
      }`,
    };
  }
  return { status: 'pass', detail: `advertised llms-full resolves (${full.bytes}B)` };
}

function gradeHomepageMd(neg, indexMd) {
  const negOk =
    neg.ok &&
    !neg.isHtml &&
    (isMarkdownType(neg.contentType) ||
      neg.bodyPreview?.trimStart().startsWith('#'));
  const indexOk =
    indexMd.ok &&
    !indexMd.isHtml &&
    (isMarkdownType(indexMd.contentType) ||
      indexMd.contentType?.includes('text/plain') ||
      indexMd.bodyPreview?.trimStart().startsWith('#'));

  if (negOk) {
    return { status: 'pass', detail: 'Accept: text/markdown negotiation' };
  }
  if (indexOk) {
    return { status: 'pass', detail: '/index.md present' };
  }
  if (neg.ok && neg.isHtml) {
    return { status: 'fail', detail: 'negotiation returned HTML' };
  }
  return {
    status: 'fail',
    detail: `no negotiation (${neg.status}) and no /index.md (${indexMd.status})`,
  };
}

/**
 * Check for JSON-LD structured data in the homepage HTML.
 * Reported (bonus), not required for S-tier. Detects:
 * - application/ld+json script tags
 * - fleet-jsonld marked block (generated by apply-agent-surfaces.mjs)
 * - @graph with Organization + SoftwareApplication/WebSite
 */
function gradeJsonLd(probe) {
  if (!probe.ok) {
    return { status: 'skip', detail: `homepage HTTP ${probe.status || 'err'}` };
  }
  if (!probe.isHtml) {
    return { status: 'skip', detail: 'homepage is not HTML' };
  }
  const body = probe.bodyFull || probe.bodyPreview || '';
  const blocks = [...body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) {
    return { status: 'skip', detail: 'no JSON-LD blocks found (bonus, not required)' };
  }
  const hasFleetMarked = body.includes('fleet-jsonld:start');
  let hasGraph = false;
  let hasOrg = false;
  let hasApp = false;
  let validJson = 0;
  for (const m of blocks) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      validJson++;
      if (json['@graph']) {
        hasGraph = true;
        const nodes = Array.isArray(json['@graph']) ? json['@graph'] : [json['@graph']];
        if (nodes.some((n) => n['@type'] === 'Organization')) hasOrg = true;
        if (nodes.some((n) => ['SoftwareApplication', 'WebSite', 'WebApplication'].includes(n['@type']))) hasApp = true;
      } else if (json['@type'] === 'Organization') {
        hasOrg = true;
      } else if (['SoftwareApplication', 'WebSite', 'WebApplication'].includes(json['@type'])) {
        hasApp = true;
      }
    } catch { /* invalid JSON in a block — skip it */ }
  }
  const parts = [];
  if (hasFleetMarked) parts.push('fleet-marked');
  if (hasGraph) parts.push('@graph');
  if (hasOrg) parts.push('Organization');
  if (hasApp) parts.push('App/WebSite');
  parts.push(`${validJson}/${blocks.length} valid`);
  return {
    status: 'pass',
    detail: parts.join(', '),
  };
}

function gradeRobots(probe) {
  if (!probe.ok) return { status: 'fail', detail: `HTTP ${probe.status || 'err'}` };
  if (probe.isHtml) return { status: 'fail', detail: 'HTML instead of robots.txt' };
  const text = probe.bodyFull || probe.bodyPreview || '';
  const hasUa = /user-agent:/i.test(text);
  const hasSitemap = /^\s*sitemap:/im.test(text);
  if (!hasUa) return { status: 'fail', detail: 'no User-agent directive' };
  if (!hasSitemap) return { status: 'fail', detail: 'no Sitemap: line' };
  return { status: 'pass', detail: 'has User-agent + Sitemap' };
}

/**
 * Fail when robots.txt disallows the answer-engine crawlers GEO depends on
 * (e.g. Cloudflare's managed "block AI bots" robots.txt). Serving llms.txt
 * while telling ClaudeBot/GPTBot `Disallow: /` defeats the whole surface.
 */
function gradeAiAccess(probe) {
  if (!probe.ok || probe.isHtml) {
    // No robots.txt (or broken) means nothing is blocked; robots check
    // already reports the problem itself.
    return { status: 'pass', detail: 'no parseable robots.txt — nothing blocked' };
  }
  const groups = parseRobotsGroups(probe.bodyFull || probe.bodyPreview || '');
  const blockedCritical = CRITICAL_AI_BOTS.filter((b) => isBotBlocked(groups, b));
  const blockedReported = REPORTED_AI_BOTS.filter((b) => isBotBlocked(groups, b));
  if (blockedCritical.length) {
    return {
      status: 'fail',
      detail: `robots disallows ${blockedCritical.join(', ')}${
        blockedReported.length ? ` (also: ${blockedReported.join(', ')})` : ''
      } — likely Cloudflare "block AI bots" zone setting`,
    };
  }
  if (blockedReported.length) {
    return {
      status: 'pass',
      detail: `answer-engine bots allowed (training-only blocked: ${blockedReported.join(', ')})`,
    };
  }
  return { status: 'pass', detail: 'AI crawlers allowed' };
}

/** Minimal robots.txt group parser (user-agent groups + allow/disallow). */
function parseRobotsGroups(text) {
  const groups = [];
  let cur = null;
  let lastWasUa = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasUa) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasUa = true;
    } else if (field === 'allow' || field === 'disallow') {
      if (cur) cur.rules.push({ type: field, path: value });
      lastWasUa = false;
    } else {
      lastWasUa = false;
    }
  }
  return groups;
}

function isBotBlocked(groups, bot) {
  const b = bot.toLowerCase();
  let g = groups.find((x) => x.agents.some((a) => a === b));
  if (!g) g = groups.find((x) => x.agents.includes('*'));
  if (!g) return false;
  const disallowRoot = g.rules.some((r) => r.type === 'disallow' && r.path === '/');
  const allowRoot = g.rules.some((r) => r.type === 'allow' && r.path === '/');
  return disallowRoot && !allowRoot;
}

/**
 * A sitemap only passes if it is real XML (urlset/sitemapindex) whose <loc>
 * entries live on the audited host — catches SPA HTML shells served with 200
 * and workers.dev/pages.dev host leaks.
 */
async function inspectSitemap(origin, robotsProbe) {
  const host = hostOf(origin);
  const candidates = [];
  const robotsText = robotsProbe?.bodyFull || '';
  for (const m of robotsText.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
    candidates.push(m[1]);
  }
  for (const p of ['/sitemap.xml', '/sitemap-index.xml']) {
    const u = `${origin}${p}`;
    if (!candidates.includes(u)) candidates.push(u);
  }

  const failures = [];
  for (const url of candidates) {
    const state = {
      host,
      visited: new Set(),
      routes: new Set(),
      failures: [],
      truncationReasons: new Set(),
    };
    await collectSitemap(url, state);
    if (state.routes.size > 0) {
      const routeCapped = state.truncationReasons.has('route-cap');
      const sitemapCapped = state.truncationReasons.has('sitemap-cap');
      const suffix = routeCapped ? `, capped at ${MAX_PUBLIC_ROUTES}` : '';
      return {
        check: {
          status: sitemapCapped ? 'fail' : 'pass',
          detail:
            `${new URL(url).pathname} (${state.visited.size} sitemap files, ` +
            `${state.routes.size} public routes${suffix})`,
        },
        urls: [...state.routes],
        truncated: sitemapCapped,
        routeCapped,
      };
    }
    failures.push(...state.failures);
  }
  return {
    check: {
      status: 'fail',
      detail: failures.length
        ? failures.slice(0, 5).join('; ')
        : 'no sitemap candidates found',
    },
    urls: [],
    truncated: false,
  };
}

async function collectSitemap(url, state) {
  if (state.visited.size >= MAX_SITEMAPS) {
    state.truncationReasons.add('sitemap-cap');
    return;
  }
  let parsed;
  try {
    parsed = new URL(decodeXml(url));
  } catch {
    state.failures.push(`${url}: unparseable URL`);
    return;
  }
  if (parsed.host !== state.host) {
    state.failures.push(`${url}: sitemap on foreign host ${parsed.host}`);
    return;
  }
  const normalized = parsed.toString();
  if (state.visited.has(normalized)) return;
  state.visited.add(normalized);

  const response = await probe(normalized, { retainFullBody: true });
  if (!response.ok) {
    state.failures.push(`${normalized}: HTTP ${response.status || 'err'}`);
    return;
  }
  if (response.isHtml) {
    state.failures.push(`${normalized}: HTML/SPA shell, not XML`);
    return;
  }
  const body = response.bodyFull || response.bodyPreview || '';
  const head = body.trimStart().slice(0, 500).toLowerCase();
  const isIndex = head.includes('<sitemapindex');
  const isUrlSet = head.includes('<urlset');
  if (!isIndex && !isUrlSet) {
    state.failures.push(`${normalized}: not sitemap XML`);
    return;
  }
  const locations = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()));
  if (locations.length === 0) {
    state.failures.push(`${normalized}: sitemap has zero <loc> entries`);
    return;
  }

  if (isIndex) {
    for (const location of locations) {
      if (state.truncationReasons.has('sitemap-cap')) break;
      await collectSitemap(location, state);
    }
    return;
  }

  for (const location of locations) {
    if (state.routes.size >= MAX_PUBLIC_ROUTES) {
      state.truncationReasons.add('route-cap');
      break;
    }
    try {
      const route = new URL(location);
      if (route.host !== state.host) {
        state.failures.push(`${location}: public route on foreign host ${route.host}`);
        continue;
      }
      route.hash = '';
      route.search = '';
      state.routes.add(route.toString());
    } catch {
      state.failures.push(`${location}: unparseable public route`);
    }
  }
}

async function gradeRouteMarkdown(origin, sitemap, apiAiProbe, cachedProbe) {
  const total = sitemap.urls.length;
  if (total === 0) {
    return {
      status: 'fail',
      detail: 'no public sitemap routes available for Markdown coverage',
      data: {
        readable: 0,
        checked: 0,
        total: 0,
        coveragePercent: 0,
        sampled: false,
        failures: [],
      },
    };
  }
  const catalog = apiSurfaceMarkdownMap(origin, apiAiProbe);
  const sampledRoutes = evenlySample(sitemap.urls, MAX_ROUTE_PROBES);
  const checked = sampledRoutes.length;
  const sampled = checked < total;
  const results = await mapLimit(sampledRoutes, PROBE_CONCURRENCY, (url) =>
    probeReadableRoute(origin, url, catalog, cachedProbe),
  );
  const readable = results.filter((result) => result.readable).length;
  const coveragePercent = percentage(readable, checked);
  const failures = results
    .filter((result) => !result.readable)
    .slice(0, 20)
    .map(({ path, reason }) => ({ path, reason }));
  return {
    status: readable === checked && !sitemap.truncated ? 'pass' : 'fail',
    detail:
      `${readable}/${checked} checked routes agent-readable (${coveragePercent}%)` +
      ` · ${total} public routes${sampled ? ' · deterministic sample' : ''}`,
    data: { readable, checked, total, coveragePercent, sampled, failures },
  };
}

async function gradeCatalogIntegrity(
  origin,
  sitemap,
  apiAiProbe,
  cachedProbe,
) {
  const data = parseApiAi(apiAiProbe);
  const surfaces = Array.isArray(data?.surfaces) ? data.surfaces : [];
  const configured = surfaces.length;
  if (configured === 0) {
    return {
      status: 'fail',
      detail: '0/0 catalog surfaces valid (empty surfaces array)',
      data: { valid: 0, configured: 0, integrityPercent: 0, failures: [] },
    };
  }
  const bounded = surfaces.slice(0, MAX_CATALOG_SURFACES);
  const publicRoutes = new Set(sitemap.urls.map(canonicalUrl));
  const results = await mapLimit(bounded, PROBE_CONCURRENCY, async (surface) => {
    const id = String(surface?.id ?? 'unnamed');
    if (typeof surface?.url !== 'string' || typeof surface?.md !== 'string') {
      return { id, valid: false, reason: 'missing url or md' };
    }
    const targets = resolveCatalogSurfaceTargets(origin, surface, sitemap.urls);
    if (!targets) {
      return { id, valid: false, reason: 'url or md is not same-origin' };
    }
    const { route, markdown, templated } = targets;
    if (!publicRoutes.has(canonicalUrl(route))) {
      return {
        id,
        valid: false,
        reason: templated
          ? 'url template has no matching public sitemap route'
          : 'url absent from public sitemap',
      };
    }
    const response = await cachedProbe(markdown, {
      accept: 'text/markdown, text/plain, */*',
    });
    if (!isReadableMarkdown(response)) {
      return {
        id,
        valid: false,
        reason: response.isHtml
          ? 'md target returned HTML'
          : `md target HTTP ${response.status || 'err'}`,
      };
    }
    return { id, valid: true };
  });
  const valid = results.filter((result) => result.valid).length;
  const integrityPercent = percentage(valid, configured);
  const truncated = configured > bounded.length;
  const failures = results
    .filter((result) => !result.valid)
    .slice(0, 20)
    .map(({ id, reason }) => ({ id, reason }));
  return {
    status: valid === configured && !truncated ? 'pass' : 'fail',
    detail:
      `${valid}/${configured} catalog surfaces valid (${integrityPercent}%)` +
      (truncated ? `; capped at ${MAX_CATALOG_SURFACES}` : ''),
    data: { valid, configured, integrityPercent, failures },
  };
}

function resolveCatalogSurfaceTargets(origin, surface, sitemapUrls) {
  const routeTemplate = parseSameOriginTemplate(origin, surface.url);
  const markdownTemplate = parseSameOriginTemplate(origin, surface.md);
  if (!routeTemplate || !markdownTemplate) return null;
  if (routeTemplate.names.length === 0 && markdownTemplate.names.length === 0) {
    return {
      route: routeTemplate.url.toString(),
      markdown: markdownTemplate.url.toString(),
      templated: false,
    };
  }
  if (
    routeTemplate.names.length === 0
    || routeTemplate.names.join('\0') !== markdownTemplate.names.join('\0')
  ) {
    return null;
  }
  for (const candidate of sitemapUrls) {
    const candidateUrl = new URL(candidate);
    const match = candidateUrl.pathname.match(routeTemplate.pattern);
    if (!match) continue;
    const values = new Map(
      routeTemplate.names.map((name, index) => [name, match[index + 1]]),
    );
    return {
      route: candidateUrl.toString(),
      markdown: materializeUrlTemplate(markdownTemplate, values),
      templated: true,
    };
  }
  return {
    route: routeTemplate.url.toString(),
    markdown: markdownTemplate.url.toString(),
    templated: true,
  };
}

function parseSameOriginTemplate(origin, value) {
  const names = [];
  const sentinels = [];
  const replaced = value.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (_match, name) => {
    const sentinel = `fleet-template-${names.length}`;
    names.push(name);
    sentinels.push(sentinel);
    return sentinel;
  });
  let url;
  try {
    url = new URL(replaced, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  let patternSource = escapeRegularExpression(url.pathname);
  for (const sentinel of sentinels) {
    patternSource = patternSource.replace(
      escapeRegularExpression(sentinel),
      '([^/]+)',
    );
  }
  return {
    url,
    names,
    sentinels,
    pattern: new RegExp(`^${patternSource}$`),
  };
}

function materializeUrlTemplate(template, values) {
  const url = new URL(template.url);
  for (let index = 0; index < template.names.length; index += 1) {
    const value = values.get(template.names[index]);
    url.pathname = url.pathname.replace(template.sentinels[index], value);
  }
  return url.toString();
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function probeReadableRoute(origin, routeUrl, catalog, cachedProbe) {
  const route = new URL(routeUrl);
  const path = route.pathname;
  const catalogTarget = catalog.get(canonicalUrl(route));
  if (catalogTarget) {
    const catalogResponse = await cachedProbe(catalogTarget, {
      accept: 'text/markdown, text/plain, */*',
    });
    if (isReadableMarkdown(catalogResponse)) {
      return {
        path,
        readable: true,
        method: new URL(catalogTarget).pathname,
      };
    }
  }

  const negotiated = await cachedProbe(route.toString(), {
    accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.1',
  });
  if (isReadableMarkdown(negotiated)) {
    return { path, readable: true, method: 'negotiation' };
  }

  const candidates = [
    ...markdownCandidates(origin, route),
  ].filter((candidate) => candidate && candidate !== catalogTarget);
  for (const candidate of [...new Set(candidates)]) {
    const response = await cachedProbe(candidate, {
      accept: 'text/markdown, text/plain, */*',
    });
    if (isReadableMarkdown(response)) {
      return { path, readable: true, method: new URL(candidate).pathname };
    }
  }
  return {
    path,
    readable: false,
    reason: negotiated.isHtml
      ? 'negotiation returned HTML and no Markdown alternate resolved'
      : `negotiation HTTP ${negotiated.status || 'err'} and no Markdown alternate resolved`,
  };
}

function markdownCandidates(origin, route) {
  const path = route.pathname;
  if (path.endsWith('.md')) return [route.toString()];
  if (path === '/') return [`${origin}/index.md`];
  if (path.endsWith('/')) {
    return [
      `${origin}${path}index.md`,
      `${origin}${path.slice(0, -1)}.md`,
    ];
  }
  if (path.endsWith('.html')) {
    return [`${origin}${path.slice(0, -5)}.md`];
  }
  return [`${origin}${path}.md`, `${origin}${path}/index.md`];
}

function apiSurfaceMarkdownMap(origin, apiAiProbe) {
  const data = parseApiAi(apiAiProbe);
  const map = new Map();
  for (const surface of Array.isArray(data?.surfaces) ? data.surfaces : []) {
    if (typeof surface?.url !== 'string' || typeof surface?.md !== 'string') continue;
    const route = sameOriginUrl(origin, surface.url);
    const markdown = sameOriginUrl(origin, surface.md);
    if (route && markdown) map.set(canonicalUrl(route), markdown);
  }
  return map;
}

function parseApiAi(probeValue) {
  try {
    return JSON.parse(probeValue.bodyFull || probeValue.bodyPreview || '{}');
  } catch {
    return null;
  }
}

function sameOriginUrl(origin, value) {
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  url.hash = '';
  url.search = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

function isReadableMarkdown(response) {
  if (!response.ok || response.isHtml) return false;
  return (
    isMarkdownType(response.contentType) ||
    response.bodyPreview?.trimStart().startsWith('#')
  );
}

function createProbeCache() {
  const cache = new Map();
  return (url, options = {}) => {
    const key = `${url}\n${options.accept ?? ''}`;
    if (!cache.has(key)) cache.set(key, probe(url, options));
    return cache.get(key);
  };
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function evenlySample(values, limit) {
  if (values.length <= limit) return [...values];
  if (limit <= 1) return [values[0]];
  return Array.from({ length: limit }, (_, index) => {
    const position = Math.floor((index * (values.length - 1)) / (limit - 1));
    return values[position];
  });
}

function percentage(numerator, denominator) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isMarkdownType(ct = '') {
  const c = ct.toLowerCase();
  return c.includes('markdown') || c.includes('text/plain');
}

async function probe(url, options = {}) {
  return withTransientRetries(() => probeOnce(url, options));
}

async function probeOnce(url, { accept, retainFullBody = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        ...(accept ? { Accept: accept } : {}),
      },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const bytes = buf.byteLength;
    const contentType = res.headers.get('content-type') || '';
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const bodyFull = decoder.decode(buf);
    const bodyPreview = bodyFull.slice(0, 400);
    const isHtml = detectHtml(bodyPreview, contentType);
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      bytes,
      bodyPreview,
      // Keep full body only for small responses (api/ai, robots, llms)
      bodyFull:
        bytes <= 2_000_000 || (retainFullBody && bytes <= MAX_SITEMAP_BYTES)
          ? bodyFull
          : bodyPreview,
      isHtml,
      finalUrl: res.url,
      retryAfter: res.headers.get('retry-after'),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytes: 0,
      bodyPreview: '',
      bodyFull: '',
      isHtml: false,
      error: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function detectHtml(preview, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  const head = (preview || '').slice(0, 200).toLowerCase();
  return (
    head.includes('<!doctype') ||
    head.includes('<html') ||
    head.includes('<div id="root"') ||
    head.includes('<div id="app"')
  );
}

function printScoreboard(results) {
  const sorted = [...results].sort((a, b) => {
    const order = { S: 0, A: 1, B: 2, C: 3, error: 4 };
    return (order[a.tier] ?? 9) - (order[b.tier] ?? 9) || b.score - a.score;
  });

  console.log('\n=== FLEET AGENT-INDEX SCOREBOARD (GEO) ===\n');
  console.log(
    pad('Tier', 4) +
      pad('Score', 6) +
      pad('Project', 28) +
      pad('llms', 6) +
      pad('api/ai', 7) +
      pad('home.md', 8) +
      pad('robots', 7) +
      pad('ai-ok', 6) +
      pad('sitemap', 8) +
      'jsonld'
  );
  console.log('-'.repeat(104));

  for (const r of sorted) {
    if (r.error) {
      console.log(`err  ${pad('0%', 6)}${pad(r.name, 28)}${r.error}`);
      continue;
    }
    const mark = (k) => {
      const s = r.checks[k]?.status;
      if (s === 'pass') return '✓';
      if (s === 'skip') return '·';
      return '✗';
    };
    console.log(
      pad(r.tier, 4) +
        pad(`${r.score}%`, 6) +
        pad(r.name, 28) +
        pad(mark('llms_txt'), 6) +
        pad(mark('api_ai'), 7) +
        pad(mark('homepage_md'), 8) +
        pad(mark('robots'), 7) +
        pad(mark('ai_access'), 6) +
        pad(mark('sitemap'), 8) +
        mark('jsonld')
    );
  }

  console.log('\n--- Failures (detail) ---\n');
  for (const r of sorted) {
    if (r.error || r.tier === 'S') continue;
    const fails = Object.entries(r.checks)
      .filter(([, c]) => c.status === 'fail')
      .map(([k, c]) => `    ${k}: ${c.detail}`);
    if (fails.length) {
      console.log(`${r.name} (${r.origin}) — ${r.tier}`);
      console.log(fails.join('\n'));
      console.log();
    }
  }
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function hostOf(url) {
  return new URL(url).host;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
