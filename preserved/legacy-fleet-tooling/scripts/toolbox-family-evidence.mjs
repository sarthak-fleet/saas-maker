#!/usr/bin/env node
/**
 * toolbox-family-evidence — emit a Significant Hobbies Toolbox family
 * evidence snapshot from the family registry.
 *
 * The CLI is intentionally declarative and offline by default. It does NOT
 * make network calls, does NOT touch production, does NOT deploy, and does
 * NOT read secrets. It validates the registry, builds a per-child envelope
 * for each product from the registry's declared evidence sources (status:
 * unknown until a live probe adapter is wired in), and emits a family
 * snapshot + Markdown report.
 *
 * Usage:
 *   node foundry/ops/scripts/toolbox-family-evidence.mjs                 # JSON to stdout
 *   node foundry/ops/scripts/toolbox-family-evidence.mjs --markdown       # Markdown report to stdout
 *   node foundry/ops/scripts/toolbox-family-evidence.mjs --out path.json  # write JSON snapshot
 *   node foundry/ops/scripts/toolbox-family-evidence.mjs --check          # exit non-zero on missing evidence
 *
 * Exit codes:
 *   0 — registry valid and snapshot emitted
 *   1 — registry invalid OR --check found unknown/missing evidence
 *   2 — usage error
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadToolboxRegistry, productForDomain } from '../lib/toolbox-automation/registry.mjs';
import { buildChildEvidence, buildFamilySnapshot, STATUS } from '../lib/toolbox-automation/evidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = resolve(__dirname, '../../..');
const DEFAULT_OUT = join(FLEET_ROOT, 'foundry/ops/data/toolbox-family-evidence-latest.json');
const DEFAULT_MD_OUT = join(FLEET_ROOT, 'foundry/ops/docs/toolbox-family-evidence-latest.md');

const args = process.argv.slice(2);
let markdown = false;
let check = false;
let outPath = null;
let mdOutPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--markdown') markdown = true;
  else if (a === '--check') check = true;
  else if (a === '--out') outPath = args[++i];
  else if (a === '--md-out') mdOutPath = args[++i];
  else if (a === '-h' || a === '--help') {
    printUsage();
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${a}`);
    printUsage();
    process.exit(2);
  }
}

function printUsage() {
  console.error(
    'Usage: toolbox-family-evidence.mjs [--markdown] [--check] [--out path.json] [--md-out path.md]'
  );
}

let registry;
try {
  registry = loadToolboxRegistry();
} catch (err) {
  console.error(`Registry invalid: ${err.message}`);
  process.exit(1);
}

// Build a declared-evidence envelope per child. Without a live probe adapter
// wired in, every status is `unknown` — this is the honest baseline. The
// --check flag surfaces this as a non-zero exit so a future adapter can flip
// it to pass.
const now = new Date();
const envelopes = registry.products.map((product) => {
  const raw = {
    revision: undefined,
    build: { status: STATUS.UNKNOWN, detail: product.evidenceSources.build },
    live: { status: STATUS.UNKNOWN, detail: product.evidenceSources.live },
    indexing: { status: STATUS.UNKNOWN, detail: product.evidenceSources.indexing },
    errors: { status: STATUS.UNKNOWN, detail: product.evidenceSources.errors },
    activation: product.activation.notApplicable
      ? { status: STATUS.NOT_APPLICABLE }
      : { status: STATUS.UNKNOWN, detail: product.activation.definition },
    backgroundJobs: product.backgroundJobs.map((job) => ({
      id: job.id,
      // Unknown until a job-receipts adapter is wired in.
    })),
  };
  return buildChildEvidence(registry, product.id, raw, now);
});

const snapshot = buildFamilySnapshot(registry, envelopes, { now });

const payload = {
  registry: {
    schema: registry.$schema,
    version: registry.version,
    family: registry.family.id,
    productCount: registry.products.length,
  },
  snapshot,
  envelopes,
  domainOwnership: Object.fromEntries(
    registry.products.map((p) => [p.domain, productForDomain(registry, p.domain)])
  ),
};

const json = JSON.stringify(payload, null, 2);
if (outPath) {
  writeFileSync(outPath, json, 'utf8');
  console.error(`JSON snapshot → ${outPath}`);
} else if (!markdown) {
  process.stdout.write(json + '\n');
}

if (markdown) {
  const md = renderMarkdown(payload);
  if (mdOutPath) {
    writeFileSync(mdOutPath, md, 'utf8');
    console.error(`Markdown report → ${mdOutPath}`);
  } else {
    process.stdout.write(md);
  }
}

if (check) {
  const incomplete = envelopes.filter((env) =>
    [env.build, env.live, env.indexing, env.errors, env.activation].some(
      (b) => b?.status === STATUS.UNKNOWN
    )
  );
  if (incomplete.length || snapshot.missing.length) {
    console.error(
      `Evidence incomplete: ${incomplete.length} child(ren) with unknown blocks, ${snapshot.missing.length} missing.`
    );
    process.exit(1);
  }
}

function renderMarkdown(payload) {
  const { snapshot, envelopes, registry: reg } = payload;
  const lines = [];
  lines.push(`# Significant Hobbies Toolbox — family evidence`);
  lines.push('');
  lines.push(`Generated ${snapshot.generatedAt} by \`toolbox-family-evidence.mjs\`. Do not edit by hand.`);
  lines.push('');
  lines.push(`**Family status:** \`${snapshot.familyStatus}\` (one child failure does not mark family failed: ${snapshot.oneChildFailureDoesNotMarkFamilyFailed}).`);
  lines.push('');
  lines.push(`| product | runtime | build | live | indexing | errors | activation | jobs |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const env of envelopes) {
    const jobs = env.backgroundJobs.map((j) => `${j.id}:${j.status}`).join('; ') || '—';
    lines.push(
      `| ${env.productId} | ${env.runtime} | ${env.build.status} | ${env.live.status} | ${env.indexing.status} | ${env.errors.status} | ${env.activation.status} | ${jobs} |`
    );
  }
  lines.push('');
  lines.push(`## Per-child status`);
  lines.push('');
  for (const [id, summary] of Object.entries(snapshot.perChild)) {
    lines.push(`- **${id}** — ${summary.status}${summary.reason ? ` (${summary.reason})` : ''}`);
  }
  lines.push('');
  lines.push(`## Digest`);
  lines.push('');
  lines.push(`- Policy: \`${snapshot.digest.policy}\``);
  lines.push(`- Failing: ${snapshot.digest.failing.join(', ') || '—'}`);
  lines.push(`- Stale: ${snapshot.digest.stale.join(', ') || '—'}`);
  lines.push(`- Unknown: ${snapshot.digest.unknown.join(', ') || '—'}`);
  lines.push(`- Page: ${snapshot.digest.page} (only on data/security risk or prolonged outage)`);
  lines.push('');
  lines.push(`## Activation definitions`);
  lines.push('');
  for (const env of envelopes) {
    lines.push(`- **${env.productId}** (\`${env.activation.type}\`): ${env.activation.definition ?? '—'}`);
  }
  lines.push('');
  lines.push(`## Privacy exclusions`);
  lines.push('');
  for (const p of registry.products) {
    lines.push(`- **${p.id}**: ${p.privacy.excludedCategories.join(', ')}`);
  }
  lines.push('');
  lines.push(`_Registry: ${reg.schema} v${reg.version}, ${reg.productCount} products. Live probes not wired — every status is \`unknown\` until an adapter is connected._`);
  return lines.join('\n') + '\n';
}
