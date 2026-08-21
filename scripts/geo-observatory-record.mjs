#!/usr/bin/env node
/**
 * GEO Observatory — ledger recorder + report generator.
 *
 * Usage:
 *   node foundry/ops/scripts/geo-observatory-record.mjs <observations.json>
 *   node foundry/ops/scripts/geo-observatory-record.mjs --root-search <observations.json>
 *   node foundry/ops/scripts/geo-observatory-record.mjs --report-only
 *
 * observations.json: array of entries:
 *   { "date": "YYYY-MM-DD", "product": "<registry id>", "qid": "<config qid>",
 *     "query": "<exact configured query>", "source": "web-search",
 *     "class": "A"|"B"|"C", "top": ["url", ...], "notes": "..." }
 *
 * Validates against foundry/ops/config/geo-observatory.json, appends to the
 * JSONL ledger (all-or-nothing), regenerates the latest-report doc.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateRootBrandContract } from '../lib/root-brand-contract.mjs';
import {
  activeObservatoryQueries,
  mergeRootSearchQueriesIntoObservatory,
  validateRootSearchQueryContract,
} from '../lib/root-search-query-contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = resolve(__dirname, '../../..');
const CONFIG_PATH = join(FLEET_ROOT, 'foundry/ops/config/geo-observatory.json');
const ROOT_BRANDS_PATH = join(FLEET_ROOT, 'foundry/ops/config/root-brands.json');
const ROOT_QUERIES_PATH = join(FLEET_ROOT, 'foundry/ops/config/root-search-queries.json');
const PROJECTS_PATH = join(FLEET_ROOT, 'foundry/ops/config/projects.json');
const LEDGER_PATH = join(FLEET_ROOT, 'foundry/ops/data/geo-observatory/ledger.jsonl');
const REPORT_PATH = join(FLEET_ROOT, 'foundry/ops/docs/geo-observatory-latest.md');

const CLASSES = new Set(['A', 'B', 'C']);

function loadContracts() {
  const observatory = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const projects = JSON.parse(readFileSync(PROJECTS_PATH, 'utf8')).projects ?? [];
  const brands = validateRootBrandContract(
    JSON.parse(readFileSync(ROOT_BRANDS_PATH, 'utf8')),
    projects,
  );
  const rootQueries = validateRootSearchQueryContract(
    JSON.parse(readFileSync(ROOT_QUERIES_PATH, 'utf8')),
    brands,
    projects,
  );
  return {
    config: mergeRootSearchQueriesIntoObservatory(observatory, rootQueries),
    rootQueries,
  };
}

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function validate(entries, cfg) {
  const products = new Map(cfg.products.map((p) => [p.id, p]));
  const errors = [];
  const seen = new Set();
  entries.forEach((e, i) => {
    const where = `entry ${i} (${e?.product ?? '?'} / ${e?.qid ?? '?'})`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push(`${where}: observation must be an object`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errors.push(`${where}: bad date`);
    const p = products.get(e.product);
    if (!p) errors.push(`${where}: unknown product`);
    const query = p?.queries.find((q) => q.qid === e.qid);
    if (p && !query) {
      errors.push(`${where}: unknown qid for product`);
    } else if (query && e.query !== query.q) {
      errors.push(`${where}: query must exactly match configured text`);
    } else if (query?.status === 'historical') {
      errors.push(`${where}: historical query cannot receive a new observation`);
    }
    const key = `${e.product}|${e.qid}`;
    if (seen.has(key)) errors.push(`${where}: duplicate product/qid in input`);
    seen.add(key);
    if (e.source !== 'web-search') {
      errors.push(`${where}: source must be web-search`);
    }
    if (!CLASSES.has(e.class)) errors.push(`${where}: class must be A|B|C`);
    if (!Array.isArray(e.top)) {
      errors.push(`${where}: top must be an array of URLs`);
    } else {
      const noResults =
        e.class === 'C' &&
        e.top.length === 0 &&
        /no organic results/i.test(e.notes || '');
      if (!noResults && (e.top.length < 2 || e.top.length > 3)) {
        errors.push(`${where}: top must contain 2-3 URLs, or be empty for an explicit no-results C`);
      }
      const uniqueUrls = new Set();
      e.top.forEach((url, urlIndex) => {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
          if (uniqueUrls.has(parsed.href)) {
            errors.push(`${where}: duplicate top URL at index ${urlIndex}`);
          }
          uniqueUrls.add(parsed.href);
        } catch {
          errors.push(`${where}: top URL at index ${urlIndex} must be absolute HTTP(S)`);
        }
      });
      if (query && p?.origin) {
        const originHost = normalizedHostname(p.origin);
        const ownsTopResult = e.top
          .slice(0, 3)
          .some((url) => {
            try {
              return normalizedHostname(url) === originHost;
            } catch {
              return false;
            }
          });
        if (e.class === 'A' && !ownsTopResult) {
          errors.push(`${where}: class A requires the configured origin in the captured top 3`);
        }
        if (e.class === 'C' && ownsTopResult) {
          errors.push(`${where}: class C cannot include the configured origin in the captured top 3`);
        }
      }
    }
    if (typeof e.notes !== 'string' || e.notes.trim().length < 20) {
      errors.push(`${where}: notes must provide a factual explanation`);
    }
  });
  return errors;
}

export function validateRootSearchRun(entries, cfg, rootsByDomain) {
  const errors = validate(entries, cfg);
  const expected = new Map();
  for (const root of rootsByDomain.values()) {
    for (const query of root.activeQueries) {
      expected.set(`${root.projectId}|${query.id}`, {
        product: root.projectId,
        qid: query.id,
        query: query.text,
      });
    }
  }

  if (entries.length !== expected.size) {
    errors.push(`root search run must contain exactly ${expected.size} observations; received ${entries.length}`);
  }

  const submitted = new Map();
  const dates = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const key = `${entry.product}|${entry.qid}`;
    if (!expected.has(key)) {
      errors.push(`unexpected root search observation: ${key}`);
      continue;
    }
    submitted.set(key, (submitted.get(key) ?? 0) + 1);
    if (typeof entry.date === 'string') dates.add(entry.date);
  }

  for (const [key, observation] of expected) {
    const count = submitted.get(key) ?? 0;
    if (count === 0) errors.push(`missing root search observation: ${key}`);
    if (count > 1) errors.push(`duplicate root search observation: ${key}`);
    const entry = entries.find((candidate) =>
      candidate?.product === observation.product && candidate?.qid === observation.qid);
    if (entry && entry.query !== observation.query) {
      errors.push(`root search query text mismatch: ${key}`);
    }
  }

  if (dates.size !== 1) {
    errors.push(`root search run must use one observation date; received ${dates.size}`);
  }
  return errors;
}

function normalizedHostname(value) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

export function generateReport(ledger, cfg) {
  const dates = [...new Set(ledger.map((e) => e.date))].sort();
  const recent = dates.slice(-5);
  const byKey = new Map(); // product|qid -> {date -> entry}
  for (const e of ledger) {
    const k = `${e.product}|${e.qid}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(e.date, e); // later entries for same date win
  }

  const lines = [];
  lines.push('# GEO Observatory — latest report');
  lines.push('');
  lines.push(`Generated from \`foundry/ops/data/geo-observatory/ledger.jsonl\` ` +
    `(${ledger.length} observations, ${dates.length} run(s): ${dates.join(', ')}).`);
  lines.push('Rubric: A = own domain top-3 · B = partial page-one visibility · C = absent.');
  lines.push('Do not edit — regenerate via `geo-observatory-record.mjs`.');
  lines.push('');

  // Movers: class change between last two dates
  if (dates.length >= 2) {
    const [prev, last] = dates.slice(-2);
    const movers = [];
    for (const [k, m] of byKey) {
      const a = m.get(prev)?.class;
      const b = m.get(last)?.class;
      if (a && b && a !== b) {
        const dir = b < a ? '📈' : '📉';
        movers.push(`- ${dir} **${k.replace('|', ' / ')}**: ${a} → ${b}`);
      }
    }
    lines.push('## Movers (vs previous run)');
    lines.push('');
    lines.push(movers.length ? movers.join('\n') : '_No class changes._');
    lines.push('');
  }

  lines.push('## Trend');
  lines.push('');
  lines.push(`| product | query (kind) | ${recent.join(' | ')} |`);
  lines.push(`|---|---|${recent.map(() => '---').join('|')}|`);
  for (const p of cfg.products) {
    for (const q of activeObservatoryQueries(p)) {
      const m = byKey.get(`${p.id}|${q.qid}`);
      const cells = recent.map((d) => m?.get(d)?.class ?? '·');
      lines.push(`| ${p.id} | ${q.q.slice(0, 48)} (${q.kind}) | ${cells.join(' | ')} |`);
    }
  }
  lines.push('');

  // Retired: has ledger history but no config entry. Without this the trend
  // table (which iterates cfg.products) drops the query silently, and the
  // report reads as though the surface was never tracked.
  const tracked = new Set(cfg.products.flatMap((p) => p.queries.map((q) => `${p.id}|${q.qid}`)));
  const retired = [...byKey.keys()].filter((k) => !tracked.has(k));
  if (retired.length) {
    lines.push('## Retired (in ledger, no longer in config)');
    lines.push('');
    for (const k of retired.sort()) {
      const seen = [...byKey.get(k).keys()].sort();
      const lastClass = byKey.get(k).get(seen[seen.length - 1])?.class ?? '?';
      lines.push(
        `- **${k.replace('|', ' / ')}** — last observed ${seen[seen.length - 1]} at ${lastClass} ` +
          `(${seen.length} observation(s)). History kept; not probed on new runs.`
      );
    }
    lines.push('');
  }

  // Latest notes with evidence
  const last = dates[dates.length - 1];
  if (last) {
    lines.push(`## Latest run notes (${last})`);
    lines.push('');
    const latestEntries = cfg.products.flatMap((product) =>
      activeObservatoryQueries(product)
        .map((query) => byKey.get(`${product.id}|${query.qid}`)?.get(last))
        .filter(Boolean),
    );
    for (const e of latestEntries) {
      const top = (e.top || []).slice(0, 2).join(', ') || 'no results captured';
      lines.push(`- **${e.product} / ${e.qid}** → ${e.class}. Top: ${top}${e.notes ? ` — ${e.notes}` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const { config: cfg, rootQueries } = loadContracts();
  const args = process.argv.slice(2);
  const rootSearchMode = args[0] === '--root-search';
  const arg = rootSearchMode ? args[1] : args[0];
  if (!arg) {
    console.error(
      'Usage: geo-observatory-record.mjs <observations.json> | ' +
      '--root-search <observations.json> | --report-only',
    );
    process.exit(2);
  }

  if (arg !== '--report-only') {
    const entries = JSON.parse(readFileSync(arg, 'utf8'));
    if (!Array.isArray(entries) || entries.length === 0) {
      console.error('observations file must be a non-empty JSON array');
      process.exit(2);
    }
    const errors = rootSearchMode
      ? validateRootSearchRun(entries, cfg, rootQueries)
      : validate(entries, cfg);
    if (errors.length) {
      console.error(`Rejected — ${errors.length} invalid entr${errors.length === 1 ? 'y' : 'ies'}:`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    appendFileSync(LEDGER_PATH, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
    console.log(`Appended ${entries.length} observation(s) to ledger.`);
  }

  const ledger = loadLedger();
  writeFileSync(REPORT_PATH, generateReport(ledger, cfg), 'utf8');
  console.log(`Report regenerated → ${REPORT_PATH}`);
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) main();
