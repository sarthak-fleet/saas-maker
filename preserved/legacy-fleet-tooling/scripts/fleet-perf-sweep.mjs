#!/usr/bin/env node
/**
 * Quick fleet desktop-LCP scoreboard via psi-swarm.
 * Usage: node scripts/fleet-perf-sweep.mjs [--runs 2] [--concurrency 1] [--only slug,slug] [--merge path]
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PSI_CLI = process.env.PSI_SWARM_CLI ?? `${__dirname}/../../helpers/psi-swarm/cli/dist/cli.js`;

const arg = (flag) => process.argv.find((a, i) => process.argv[i - 1] === flag);

const runs = Number(arg('--runs') ?? 2);
const concurrency = Number(arg('--concurrency') ?? 1);
const onlySlugs = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const mergePath = arg('--merge') ?? null;

const SKIP = new Set(['free-ai', 'reel-pipeline']);
const manifest = JSON.parse(readFileSync(join(__dirname, '../config/projects.json'), 'utf8'));
let entries = manifest.projects
  .filter((project) => project.status === 'live' && project.domains?.length && !SKIP.has(project.id))
  .map((project) => ({
    slug: project.id,
    name: project.id.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
    url: `https://${project.domains[0]}`,
  }));

if (onlySlugs?.length) {
  const wanted = new Set(onlySlugs);
  entries = entries.filter((e) => wanted.has(e.slug));
  const missing = onlySlugs.filter((s) => !entries.some((e) => e.slug === s));
  if (missing.length) {
    console.error(`Unknown slugs in --only: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function parseLcpMs(value) {
  if (!value) return null;
  const v = value.trim();
  if (v.endsWith('ms')) return parseFloat(v);
  if (v.endsWith('s')) return parseFloat(v) * 1000;
  return parseFloat(v);
}

function parseDesktopLcp(output) {
  const desktopIdx = output.indexOf('desktop  ·');
  if (desktopIdx === -1) return null;
  const slice = output.slice(desktopIdx, desktopIdx + 1200);
  const lcpLine = slice.match(/│ LCP\s+│([^│]+)│([^│]+)│([^│]+)│/);
  if (!lcpLine) return null;
  const p50 = lcpLine[1].trim();
  const p75 = lcpLine[2].trim();
  const p90 = lcpLine[3].trim();
  const score = slice.match(/│ Perf Score\s+│\s*(\d+)/)?.[1];
  return { p50, p75, p90, score };
}

function runPsi(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [
        PSI_CLI,
        'run',
        url,
        '--runs',
        String(runs),
        '--presets',
        'desktop',
        '--no-suggest',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`exit ${code} for ${url}\n${out.slice(-800)}`));
      else resolve(out);
    });
  });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

console.log(`Fleet perf sweep: ${entries.length} sites, desktop × ${runs} runs, concurrency ${concurrency}\n`);

const results = await pool(entries, concurrency, async (entry, idx) => {
  const label = `[${idx + 1}/${entries.length}] ${entry.slug}`;
  process.stdout.write(`${label} … `);
  try {
    const output = await runPsi(entry.url);
    const lcp = parseDesktopLcp(output);
    const p90ms = lcp?.p90 ? parseLcpMs(lcp.p90) : null;
    console.log(lcp ? `p90 ${lcp.p90} score ${lcp.score}` : 'parse failed');
    return { ...entry, ok: true, ...lcp, p90ms: Number.isFinite(p90ms) ? p90ms : null };
  } catch (err) {
    console.log(`FAILED`);
    return { ...entry, ok: false, error: err.message };
  }
});

let finalResults = results;
if (mergePath && existsSync(mergePath)) {
  const prior = JSON.parse(readFileSync(mergePath, 'utf8'));
  const bySlug = new Map((prior.results ?? []).map((r) => [r.slug, r]));
  for (const r of results) bySlug.set(r.slug, r);
  finalResults = [...bySlug.values()];
}
finalResults.sort((a, b) => (b.p90ms ?? -1) - (a.p90ms ?? -1));

const outDir = join(__dirname, '../docs');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outPath = mergePath ?? join(outDir, `fleet-perf-scoreboard-${stamp}.json`);
const payload = {
  generatedAt: new Date().toISOString(),
  runs,
  ...(onlySlugs ? { partial: onlySlugs } : {}),
  results: finalResults,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log('\n── Desktop LCP p90 ranking (slowest first) ──\n');
for (const r of finalResults) {
  if (!r.ok) {
    console.log(`  FAIL  ${r.slug.padEnd(22)} ${r.url}`);
    continue;
  }
  const flag = (r.p90ms ?? 0) > 2500 ? 'POOR' : (r.p90ms ?? 0) > 500 ? 'WARN' : 'GOOD';
  console.log(
    `  ${flag}  ${String(Math.round(r.p90ms ?? 0)).padStart(5)}ms  ${r.slug.padEnd(22)} ${r.name}`
  );
}

const good = finalResults.filter((r) => r.ok && (r.p90ms ?? 9999) <= 500).length;
const warn = finalResults.filter((r) => r.ok && (r.p90ms ?? 0) > 500 && (r.p90ms ?? 0) <= 2500).length;
const poor = finalResults.filter((r) => r.ok && (r.p90ms ?? 0) > 2500).length;
const fail = finalResults.filter((r) => !r.ok).length;
console.log(`\nSummary: ${good} ≤500ms · ${warn} 500ms–2.5s · ${poor} >2.5s · ${fail} failed`);
console.log(`Wrote ${outPath}`);
