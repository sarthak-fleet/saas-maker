#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  attachSitemapSubmissionState,
  collectSearchConsoleOutcomes,
  ensureSearchConsoleSitemaps,
} from '../lib/search-console.mjs';
import {
  appendVisibilityOutcomeBundle,
  defaultVisibilityOutcomePath,
} from '../lib/visibility-outcome-store.mjs';
import { validateRootBrandContract } from '../lib/root-brand-contract.mjs';
import { validateRootSearchQueryContract } from '../lib/root-search-query-contract.mjs';
import { searchConsoleProjects } from '../lib/visibility-projects.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const catalog = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'));
const config = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/search-console.json'), 'utf8'));
const rootBrands = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/root-brands.json'), 'utf8'));
const rootQueries = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/root-search-queries.json'), 'utf8'));

function parseArgs(args) {
  const options = { projectId: null, ledgerPath: null, discoveryCycle: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--discovery-cycle') {
      options.discoveryCycle = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--project') options.projectId = value;
    else if (flag === '--ledger') options.ledgerPath = resolve(value);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return options;
}

function accessToken() {
  const result = spawnSync(
    'gcloud',
    ['auth', 'application-default', 'print-access-token'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Google Application Default Credentials are unavailable');
  }
  return result.stdout.trim();
}

const options = parseArgs(process.argv.slice(2));
const brandMap = validateRootBrandContract(rootBrands, catalog.projects ?? []);
const rootsByDomain = validateRootSearchQueryContract(rootQueries, brandMap, catalog.projects ?? []);
const eligible = searchConsoleProjects(catalog, rootsByDomain);
const projects = options.projectId
  ? eligible.filter((project) => project.id === options.projectId)
  : eligible;
if (projects.length === 0) throw new Error(`Unknown Search Console project: ${options.projectId}`);

let discovery = null;
let googleSitemaps = [];
if (options.discoveryCycle) {
  const indexNow = spawnSync(
    process.execPath,
    [resolve(FLEET_ROOT, 'foundry/ops/scripts/indexnow-submit.mjs')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (indexNow.status !== 0) {
    throw new Error(`IndexNow discovery update failed: ${indexNow.stderr.trim() || indexNow.stdout.trim() || 'unknown error'}`);
  }
  const indexNowSummary = indexNow.stdout.match(
    /Done\. urls=(\d+) skipped_already=(\d+) batches_ok=(\d+) batches_fail=(\d+)/,
  );
  if (!indexNowSummary || Number(indexNowSummary[4]) > 0) {
    throw new Error(`IndexNow discovery update was incomplete: ${indexNow.stdout.trim() || 'missing receipt'}`);
  }
  googleSitemaps = await ensureSearchConsoleSitemaps({
    projects,
    accessToken: accessToken(),
    quotaProject: config.quotaProject,
  });
  discovery = {
    indexNow: {
      submittedUrls: Number(indexNowSummary[1]),
      skippedUrls: Number(indexNowSummary[2]),
      successfulBatches: Number(indexNowSummary[3]),
    },
    googleSitemaps: googleSitemaps.reduce((counts, result) => {
      counts[result.state] = (counts[result.state] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

const collected = await collectSearchConsoleOutcomes({
  projects,
  accessToken: accessToken(),
  quotaProject: config.quotaProject,
  reportingWindowDays: config.reportingWindowDays,
  reportingLagDays: config.reportingLagDays,
  searchTermLimit: config.searchTermLimit,
});
const outcomeBundle = options.discoveryCycle
  ? attachSitemapSubmissionState(collected.bundle, googleSitemaps)
  : collected.bundle;
if (outcomeBundle.observations.length === 0) {
  throw new Error('No accessible Search Console properties matched Fleet projects');
}
const ledgerPath = options.ledgerPath ?? defaultVisibilityOutcomePath();
const receipt = appendVisibilityOutcomeBundle(outcomeBundle, {
  path: ledgerPath,
  allowedProjectIds: new Set(eligible.map((project) => project.id)),
});

process.stdout.write(`${JSON.stringify({
  schema: 'fleet.search-console-collection-receipt.v1',
  period: collected.period,
  accessibleProperties: collected.propertyCount,
  measuredProjects: collected.bundle.observations.length,
  unavailable: collected.unavailable,
  recorded: receipt.recorded,
  duplicates: receipt.duplicates,
  ...(discovery ? { discovery } : {}),
}, null, 2)}\n`);
