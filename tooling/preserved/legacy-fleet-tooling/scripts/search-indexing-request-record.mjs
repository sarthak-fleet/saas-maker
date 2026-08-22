#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  appendSearchIndexingRequest,
  SEARCH_INDEXING_REQUEST_SCHEMA,
} from '../lib/search-indexing-request-store.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');

function parseArgs(args) {
  const options = { projectId: null, inspectedUrl: null, requestedAt: new Date().toISOString() };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--project') options.projectId = value;
    else if (flag === '--url') options.inspectedUrl = value;
    else if (flag === '--requested-at') options.requestedAt = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!options.projectId) throw new Error('--project is required');
  if (!options.inspectedUrl) throw new Error('--url is required');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const catalog = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'));
const project = visibilityProjects(catalog).find((candidate) => candidate.id === options.projectId);
if (!project) throw new Error(`Unknown Search Console project: ${options.projectId}`);

const inspectedUrl = new URL(options.inspectedUrl);
const allowedHosts = new Set(project.domains ?? []);
if (!allowedHosts.has(inspectedUrl.hostname)) {
  throw new Error(`URL host is not registered for ${project.id}: ${inspectedUrl.hostname}`);
}

const receipt = appendSearchIndexingRequest({
  schemaVersion: SEARCH_INDEXING_REQUEST_SCHEMA,
  projectId: project.id,
  inspectedUrl: inspectedUrl.href,
  requestedAt: options.requestedAt,
});
process.stdout.write(`${JSON.stringify({ ok: true, receipt })}\n`);
