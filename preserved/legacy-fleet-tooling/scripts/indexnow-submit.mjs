#!/usr/bin/env node
/**
 * Fleet IndexNow submitter — notify Bing/Yandex/Naver/Seznam/Yep of URLs.
 *
 * Google is NOT covered (use Search Console). See foundry/ops/docs/indexnow.md.
 *
 * Usage:
 *   node foundry/ops/scripts/indexnow-submit.mjs --init-key
 *   node foundry/ops/scripts/indexnow-submit.mjs --apply-keys
 *   node foundry/ops/scripts/indexnow-submit.mjs --dry-run
 *   node foundry/ops/scripts/indexnow-submit.mjs
 *   node foundry/ops/scripts/indexnow-submit.mjs --id rolepatch
 *   node foundry/ops/scripts/indexnow-submit.mjs --url https://rolepatch.com/
 *   node foundry/ops/scripts/indexnow-submit.mjs --host rolepatch.com --max 50
 *   node foundry/ops/scripts/indexnow-submit.mjs --check-keys
 *   node foundry/ops/scripts/indexnow-submit.mjs --force   # ignore state; resubmit all
 *   node foundry/ops/scripts/indexnow-submit.mjs --reset-state
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistry,
  productOriginRequired as productOrigin,
} from './lib/registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = resolve(__dirname, '../../..');
const CONFIG_PATH = join(FLEET_ROOT, 'foundry/ops/config/indexnow.json');
const STATE_PATH = process.env.FLEET_INDEXNOW_STATE_PATH
  ? resolve(process.env.FLEET_INDEXNOW_STATE_PATH)
  : join(FLEET_ROOT, 'foundry/ops/config/indexnow-state.json');

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  // next token missing or another flag → treat as absent
  if (v == null || v.startsWith('-')) return null;
  return v;
};

const dryRun = flag('--dry-run');
const onlyId = opt('--id');
const onlyHost = opt('--host');
const singleUrl = opt('--url');
const forceAll = flag('--force');
const resetState = flag('--reset-state');
const initKey = flag('--init-key');
const applyKeys = flag('--apply-keys');
const checkKeys = flag('--check-keys');
const verbose = flag('--verbose') || flag('-v');

/** @returns {number} */
function parseMax() {
  if (!args.includes('--max')) return Infinity;
  const raw = opt('--max');
  if (raw == null) {
    throw new Error(
      '--max requires a positive integer (e.g. --max 50). Got missing value.'
    );
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `--max requires a positive integer (e.g. --max 50). Got: ${JSON.stringify(raw)}`
    );
  }
  return n;
}

const maxUrls = parseMax();

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Missing ${CONFIG_PATH}`);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

/** @returns {{ version: number, submitted: Record<string, { etag?: string, lastOkAt?: string, urls: Record<string, string> }> }} */
function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { version: 1, submitted: {} };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { version: 1, submitted: {} };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function hostOf(origin) {
  return new URL(origin).host;
}

function keyLocation(origin, key) {
  return `${origin.replace(/\/$/, '')}/${key}.txt`;
}

/** Generate key if empty. */
function ensureKey(cfg) {
  if (cfg.key && String(cfg.key).trim()) return cfg;
  cfg.key = randomBytes(16).toString('hex');
  saveConfig(cfg);
  console.log(`Generated IndexNow key → ${CONFIG_PATH}`);
  console.log(`  key=${cfg.key}`);
  console.log(`  Host as /${cfg.key}.txt on each origin (use --apply-keys).`);
  return cfg;
}

/** Write {key}.txt into each product publicDir. */
function applyKeyFiles(cfg, products) {
  if (!cfg.key) throw new Error('No key — run --init-key first');
  let n = 0;
  for (const p of products) {
    if (!p.publicDir) {
      console.log(`· ${p.id}: no publicDir (skip key file)`);
      continue;
    }
    const dir = join(FLEET_ROOT, p.publicDir);
    if (!existsSync(dir)) {
      console.log(`· ${p.id}: publicDir missing ${p.publicDir}`);
      continue;
    }
    const path = join(dir, `${cfg.key}.txt`);
    if (!dryRun) writeFileSync(path, `${cfg.key}\n`, 'utf8');
    n++;
    console.log(`✓ ${p.id}: ${path}${dryRun ? ' (dry-run)' : ''}`);
  }
  console.log(
    `\nWrote key file for ${n} products. Deploy so https://{host}/${cfg.key}.txt is live, then submit.`
  );
}

/**
 * Fetch with timeout + retry/backoff.
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, retries?: number }} [opts]
 */
async function fetchWithRetry(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const { timeoutMs: _t, retries: _r, backoffMs: _b, ...init } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      // Retry transient 5xx / 429
      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < retries
      ) {
        const wait = backoffMs * 2 ** attempt;
        if (verbose)
          console.warn(
            `  retry ${attempt + 1}/${retries} ${url} status=${res.status} wait=${wait}ms`
          );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        const wait = backoffMs * 2 ** attempt;
        if (verbose)
          console.warn(
            `  retry ${attempt + 1}/${retries} ${url}: ${e.message} wait=${wait}ms`
          );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}

async function fetchText(url, userAgent, opts = {}) {
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': userAgent, Accept: '*/*' },
    redirect: 'follow',
    ...opts,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, finalUrl: res.url };
}

function looksLikeHtml(text) {
  const head = text.slice(0, 200).toLowerCase();
  return (
    head.includes('<!doctype') ||
    head.includes('<html') ||
    head.includes('<head')
  );
}

function extractLocs(xml) {
  const locs = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    locs.push(m[1].trim());
  }
  return locs;
}

async function collectSitemapUrls(origin, userAgent, max) {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  // robots Sitemap:
  try {
    const rob = await fetchText(`${origin}/robots.txt`, userAgent);
    if (rob.ok && !looksLikeHtml(rob.text)) {
      for (const line of rob.text.split(/\r?\n/)) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) candidates.unshift(m[1].replace(/\/$/, ''));
      }
    }
  } catch {
    /* ignore */
  }

  const seen = new Set();
  const urls = [];
  const queue = [];

  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      queue.push(c);
    }
  }

  while (queue.length && urls.length < max) {
    const smUrl = queue.shift();
    let res;
    try {
      res = await fetchText(smUrl, userAgent);
    } catch (e) {
      if (verbose) console.warn(`  sitemap fail ${smUrl}: ${e.message}`);
      continue;
    }
    if (!res.ok || looksLikeHtml(res.text)) {
      if (verbose)
        console.warn(
          `  skip sitemap ${smUrl} status=${res.status} html=${looksLikeHtml(res.text)}`
        );
      continue;
    }
    const locs = extractLocs(res.text);
    const isIndex =
      /<sitemapindex/i.test(res.text) || smUrl.includes('sitemap-index');
    for (const loc of locs) {
      if (isIndex && /sitemap/i.test(loc)) {
        if (!seen.has(loc)) {
          seen.add(loc);
          queue.push(loc);
        }
        continue;
      }
      // only same host
      try {
        if (new URL(loc).host !== new URL(origin).host) continue;
      } catch {
        continue;
      }
      if (!urls.includes(loc)) urls.push(loc);
      if (urls.length >= max) break;
    }
  }

  // Homepage + high-value agent surfaces (skip known optional 404s later at submit filter)
  const always = [
    `${origin}/`,
    `${origin}/llms.txt`,
    `${origin}/index.md`,
    `${origin}/api/ai`,
  ];
  // llms-full is optional — only include if we already saw it in sitemap
  for (const u of always) {
    if (!urls.includes(u)) urls.unshift(u);
  }
  return max === Infinity ? urls : urls.slice(0, max);
}

async function checkKeyLive(origin, key, userAgent) {
  const loc = keyLocation(origin, key);
  try {
    const res = await fetchText(loc, userAgent, { retries: 1 });
    const body = res.text.trim();
    const ok = res.ok && body === key;
    return { loc, ok, status: res.status, body: body.slice(0, 40) };
  } catch (e) {
    return { loc, ok: false, status: 'ERR', body: e.message };
  }
}

/**
 * Filter to URLs not yet successfully submitted (or force all).
 * State stores host → { urls: { [url]: isoTimestamp } }.
 */
function filterNewUrls(state, host, urlList, force) {
  if (force) return urlList;
  const prev = state.submitted[host]?.urls || {};
  return urlList.filter((u) => !prev[u]);
}

function recordSubmitted(state, host, urlList) {
  if (!state.submitted[host]) {
    state.submitted[host] = { urls: {} };
  }
  const now = new Date().toISOString();
  state.submitted[host].lastOkAt = now;
  for (const u of urlList) {
    state.submitted[host].urls[u] = now;
  }
}

async function submitBatch(cfg, host, urlList) {
  const key = cfg.key;
  const keyLocationUrl = `https://${host}/${key}.txt`;
  const payload = {
    host,
    key,
    keyLocation: keyLocationUrl,
    urlList,
  };

  if (dryRun) {
    console.log(
      `  [dry-run] POST ${cfg.endpoint} host=${host} urls=${urlList.length}`
    );
    if (verbose) console.log(JSON.stringify(payload, null, 2));
    return { ok: true, status: 0, dryRun: true };
  }

  try {
    const res = await fetchWithRetry(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': cfg.userAgent || 'fleet-indexnow/1.0',
      },
      body: JSON.stringify(payload),
      timeoutMs: cfg.timeoutMs || DEFAULT_TIMEOUT_MS,
      retries: cfg.retries ?? DEFAULT_RETRIES,
    });
    // IndexNow: 200/202 success; 4xx failure (already retried 5xx/429)
    const text = await res.text().catch(() => '');
    return {
      ok: res.status === 200 || res.status === 202,
      status: res.status,
      body: text.slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false,
      status: 'ERR',
      body: e.message || String(e),
    };
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function main() {
  let cfg = loadConfig();
  const registry = loadRegistry();
  let products = registry.products || [];

  if (resetState) {
    if (!dryRun) {
      saveState({ version: 1, submitted: {} });
      console.log(`Reset state → ${STATE_PATH}`);
    } else {
      console.log(`[dry-run] would reset ${STATE_PATH}`);
    }
    if (!flag('--dry-run') && args.filter((a) => a !== '--reset-state').length === 0) {
      return;
    }
  }

  if (initKey) {
    cfg = ensureKey(cfg);
    return;
  }

  cfg = ensureKey(cfg);
  if (!cfg.key) throw new Error('No IndexNow key configured');

  if (onlyId) products = products.filter((p) => p.id === onlyId);

  if (applyKeys) {
    applyKeyFiles(cfg, products);
    return;
  }

  if (checkKeys) {
    console.log(`Checking live key files for key=${cfg.key.slice(0, 8)}…\n`);
    let okN = 0;
    for (const p of products) {
      const origin = productOrigin(p);
      if (onlyHost && hostOf(origin) !== onlyHost) continue;
      const r = await checkKeyLive(origin, cfg.key, cfg.userAgent);
      const mark = r.ok ? '✓' : '✗';
      if (r.ok) okN++;
      console.log(
        `${mark} ${p.id}: ${r.loc} → ${r.status}${r.ok ? '' : ` body=${r.body}`}`
      );
    }
    console.log(
      `\n${okN} live key(s). Deploy --apply-keys output before submit if any ✗.`
    );
    return;
  }

  // Collect work: host → urls
  /** @type {Map<string, { origin: string, id: string, urls: string[] }>} */
  const byHost = new Map();

  if (singleUrl) {
    const u = new URL(singleUrl);
    const host = u.host;
    byHost.set(host, {
      origin: `${u.protocol}//${u.host}`,
      id: onlyId || host,
      urls: [singleUrl],
    });
  } else {
    const eligibleProducts = products.filter((p) => {
      const origin = productOrigin(p);
      const host = hostOf(origin);
      return !onlyHost || host === onlyHost;
    });
    const collections = await mapWithConcurrency(eligibleProducts, 4, async (p) => {
      const origin = productOrigin(p);
      try {
        const urls = await collectSitemapUrls(
          origin,
          cfg.userAgent || 'fleet-indexnow/1.0',
          maxUrls
        );
        return { p, origin, urls };
      } catch (error) {
        return { p, origin, error };
      }
    });
    for (const result of collections) {
      const { p, origin } = result;
      const host = hostOf(origin);
      if (result.error) {
        console.log(`Collect ${p.id} (${origin})… FAIL: ${result.error.message}`);
        continue;
      }
      const { urls } = result;
      console.log(`Collect ${p.id} (${origin})… ${urls.length} urls`);
      try {
        const prev = byHost.get(host);
        if (prev) {
          const set = new Set([...prev.urls, ...urls]);
          prev.urls = [...set];
        } else {
          byHost.set(host, { origin, id: p.id, urls });
        }
      } catch (e) {
        console.log(`FAIL: ${e.message}`);
      }
    }
  }

  if (byHost.size === 0) {
    console.log('Nothing to submit.');
    return;
  }

  const state = loadState();
  const batchSize = Number(cfg.batchSize) || 100;
  let submitted = 0;
  let skipped = 0;
  let batchesOk = 0;
  let batchesFail = 0;

  for (const [host, work] of byHost) {
    const fresh = filterNewUrls(state, host, work.urls, forceAll);
    skipped += work.urls.length - fresh.length;
    console.log(
      `\n▸ ${host} (${work.id}) — ${work.urls.length} URLs, ${fresh.length} new${forceAll ? ' (--force)' : ''}`
    );
    if (fresh.length === 0) {
      console.log('  (nothing new — use --force to resubmit)');
      continue;
    }
    if (!dryRun) {
      const keyCheck = await checkKeyLive(
        work.origin,
        cfg.key,
        cfg.userAgent
      );
      if (!keyCheck.ok) {
        console.warn(
          `  ⚠ key not live at ${keyCheck.loc} (${keyCheck.status}). IndexNow may reject. Run --apply-keys + deploy, or --check-keys.`
        );
      }
    }
    const batches = chunk(fresh, batchSize);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const result = await submitBatch(cfg, host, batch);
      if (result.ok) {
        batchesOk++;
        submitted += batch.length;
        if (!dryRun) recordSubmitted(state, host, batch);
        console.log(
          `  batch ${i + 1}/${batches.length}: OK status=${result.status} n=${batch.length}`
        );
      } else {
        batchesFail++;
        console.error(
          `  batch ${i + 1}/${batches.length}: FAIL status=${result.status} ${result.body || ''}`
        );
        // continue remaining batches/hosts
      }
      // be polite
      if (!dryRun) await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!dryRun && (batchesOk > 0 || forceAll)) {
    saveState(state);
  }

  console.log(
    `\nDone. urls=${submitted} skipped_already=${skipped} batches_ok=${batchesOk} batches_fail=${batchesFail}${dryRun ? ' (dry-run)' : ''}`
  );
  console.log(
    'Note: IndexNow ≠ Google. Submit sitemaps in Google Search Console separately.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
