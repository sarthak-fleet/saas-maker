#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appendSearchChangeReceipt, SEARCH_CHANGE_RECEIPT_SCHEMA } from '../lib/search-change-receipt-store.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!flag?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
  values.set(flag.slice(2), value);
}
for (const field of ['project', 'action', 'query', 'url', 'revision']) {
  if (!values.has(field)) throw new Error(`--${field} is required`);
}

const catalog = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'));
const project = visibilityProjects(catalog).find((candidate) => candidate.id === values.get('project'));
if (!project) throw new Error(`Unknown Search Console project: ${values.get('project')}`);
const landingPage = new URL(values.get('url'));
if (!(project.domains ?? []).includes(landingPage.hostname)) {
  throw new Error(`URL host is not registered for ${project.id}: ${landingPage.hostname}`);
}

const receipt = appendSearchChangeReceipt({
  schemaVersion: SEARCH_CHANGE_RECEIPT_SCHEMA,
  projectId: project.id,
  actionId: values.get('action'),
  query: values.get('query'),
  landingPage: landingPage.href,
  revision: values.get('revision'),
  changedAt: values.get('changed-at') ?? new Date().toISOString(),
});
process.stdout.write(`${JSON.stringify({ ok: true, receipt })}\n`);
