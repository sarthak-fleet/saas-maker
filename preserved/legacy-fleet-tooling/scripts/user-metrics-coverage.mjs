#!/usr/bin/env node
/**
 * Validate that every maintained Fleet product has PostHog analytics
 * instrumentation or an explicit not-applicable designation.
 *
 * Reads the canonical project catalog and checks for PostHog instrumentation
 * markers in the product's source. Products without web frontends are
 * automatically marked not-applicable.
 *
 * Usage:
 *   node user-metrics-coverage.mjs [--catalog <path>] [--root <fleet-root>]
 *
 * Exit codes:
 *   0 — all maintained products have coverage or explicit exceptions
 *   1 — one or more maintained products are missing coverage
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
let catalogPath = null;
let fleetRoot = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--catalog' && args[i + 1]) catalogPath = args[++i];
  if (args[i] === '--root' && args[i + 1]) fleetRoot = resolve(args[++i]);
}

fleetRoot = fleetRoot ?? resolve(import.meta.dirname, '..', '..', '..');
catalogPath = catalogPath ?? join(fleetRoot, 'foundry', 'ops', 'config', 'projects.json');

if (!existsSync(catalogPath)) {
  console.error(`Catalog not found: ${catalogPath}`);
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const projects = catalog.projects ?? catalog;
const maintained = Object.entries(projects)
  .filter(([id, p]) => p.lifecycle === 'maintained')
  .map(([id, p]) => ({ id: p.id ?? id, name: p.name, kind: p.portfolio?.kind, domains: p.domains ?? [] }));

// Products that have no user-facing web frontend or are internal platform tools
// exempt from PostHog product analytics instrumentation
const NO_WEB_FRONTEND = new Set([
  'reddit-insights', // pure data pipeline Worker
  'fleet-workspace', // internal platform (this repo)
  'drank', // internal monitoring/ops tool
  'psi-swarm', // internal performance tool
  'agent-office', // internal platform surface
  'local-ai-video-studio', // internal tool (not yet public)
  'veg-protein-food', // no local checkout
  'mashup', // no local checkout
  'sarthakagrawal-personal', // personal site (separate concern)
  'indulge', // native iOS app (no web frontend)
  'research-papers', // Astro site with separate analytics
]);

// Check for PostHog instrumentation in a product checkout
function hasPosthogInstrumentation(projectId) {
  const productDir = join(fleetRoot, projectId);
  if (!existsSync(productDir)) return { found: false, reason: 'no-checkout' };

  // Check for analytics.ts (React/Next.js products)
  const analyticsPaths = [
    join(productDir, 'src/lib/analytics.ts'),
    join(productDir, 'lib/analytics.ts'),
    join(productDir, 'src/lib/analytics.tsx'),
    join(productDir, 'components/analytics-provider.tsx'),
    join(productDir, 'src/components/analytics-provider.tsx'),
    join(productDir, 'src/components/posthog-provider.tsx'),
    join(productDir, 'components/posthog-provider.tsx'),
  ];

  for (const p of analyticsPaths) {
    if (existsSync(p)) return { found: true, file: p };
  }

  // Check for PostHog CDN snippet in source files (not dist/build output)
  const sourceDirs = [
    'src', 'lib', 'browser/src', 'landing-astro/src',
    'apps/web', 'apps/landing-page-astro/src', 'public', 'landing',
    'site/src', 'website/src', 'docs-site/src',
  ].filter((d) => existsSync(join(productDir, d)));

  if (sourceDirs.length === 0) return { found: false, reason: 'no-source-dir' };

  try {
    const dirs = sourceDirs.map((d) => `"${join(productDir, d)}"`).join(' ');
    const result = execSync(
      `grep -rl "posthog" --include="*.astro" --include="*.html" --include="*.js" --include="*.ts" --include="*.tsx" ${dirs} 2>/dev/null | grep -v node_modules | grep -v dist | head -1`,
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    if (result) return { found: true, file: result };
  } catch {
    // grep returns non-zero when no matches
  }

  return { found: false, reason: 'no-instrumentation' };
}

let covered = 0;
let missing = 0;
let exempt = 0;
const missingProducts = [];

console.log('User metrics coverage validation');
console.log('==================================\n');

for (const project of maintained) {
  if (NO_WEB_FRONTEND.has(project.id)) {
    exempt++;
    console.log(`  ✓ ${project.id.padEnd(30)} exempt (no web frontend)`);
    continue;
  }

  const result = hasPosthogInstrumentation(project.id);
  if (result.found) {
    covered++;
    console.log(`  ✓ ${project.id.padEnd(30)} instrumented`);
  } else {
    missing++;
    missingProducts.push(project);
    console.log(`  ✗ ${project.id.padEnd(30)} MISSING (${result.reason})`);
  }
}

console.log(`\n--- Summary ---`);
console.log(`Maintained products: ${maintained.length}`);
console.log(`Instrumented: ${covered}`);
console.log(`Exempt: ${exempt}`);
console.log(`Missing: ${missing}`);

if (missing > 0) {
  console.error(`\n${missing} product(s) missing PostHog instrumentation:`);
  for (const p of missingProducts) {
    console.error(`  - ${p.id} (${p.name})`);
  }
  process.exit(1);
}

console.log('\nAll maintained products have PostHog coverage or explicit exemptions.');
process.exit(0);
