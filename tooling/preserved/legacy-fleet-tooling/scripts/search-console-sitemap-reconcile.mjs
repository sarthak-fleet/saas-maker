#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { domainStrengthRoots } from '../lib/founder-control/domain-scope.mjs';
import { loadFounderProjects } from '../lib/founder-control/registry.mjs';
import {
  reconcileSearchConsoleSitemaps,
  searchConsoleSitemapTargets,
} from '../lib/search-console.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const catalog = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'));
const config = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/search-console.json'), 'utf8'));

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

const unknown = process.argv.slice(2).filter((argument) => argument !== '--apply');
if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
const apply = process.argv.includes('--apply');
const projects = visibilityProjects(catalog);
const rootDomains = domainStrengthRoots(loadFounderProjects());
const targets = searchConsoleSitemapTargets(projects, rootDomains, config.sitemapOverrides);
const result = await reconcileSearchConsoleSitemaps({
  targets,
  accessToken: accessToken(),
  quotaProject: config.quotaProject,
  apply,
});
const counts = result.actions.reduce((summary, action) => {
  const key = `${action.action}:${action.state}`;
  summary[key] = (summary[key] ?? 0) + 1;
  return summary;
}, {});

process.stdout.write(`${JSON.stringify({
  schema: 'fleet.search-console-sitemap-reconciliation.v1',
  mode: apply ? 'apply' : 'preview',
  targetCount: result.targetCount,
  propertyCount: result.propertyCount,
  counts,
  actions: result.actions,
}, null, 2)}\n`);
