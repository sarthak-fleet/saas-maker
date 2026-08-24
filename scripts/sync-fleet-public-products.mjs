#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPublicProducts } from './public-products.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fleetCatalog = path.resolve(
  process.env.FLEET_PUBLIC_PRODUCTS_PATH ??
    path.join(repoRoot, '../site-health/apps/backend/config/projects.json')
);
const destination = path.join(repoRoot, 'catalog/generated/public.json');

const PUBLIC_FIELDS = new Set([
  'id',
  'name',
  'description',
  'url',
  'tier',
  'category',
  'priority',
  'spotlight',
  'maturity',
  'repositoryUrl',
  'changelogUrl',
  'roadmapUrl',
  'pillarId',
]);
const REQUIRED_FIELDS = ['id', 'name', 'description', 'url'];
const DIRECTORY_FIELDS = new Set([
  'id',
  'name',
  'description',
  'makerNote',
  'kind',
  'form',
  'platforms',
  'technologies',
  'group',
  'lifecycle',
  'deployed',
  'deploymentProviders',
  'domains',
  'url',
  'repositoryUrl',
  'changelogUrl',
  'roadmapUrl',
  'firstCommitAt',
  'latestCommitAt',
]);
const FORBIDDEN_KEYS =
  /(?:secret|token|password|credential|private|owner|cfProject|notes|dependencies|evidenceSources|contracts)/i;
const CREDENTIAL_VALUE =
  /(?:bearer\s+[a-z0-9._-]+|(?:api|access|secret)[_-]?key\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

function assertNoPrivateData(value, trail = 'projection') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateData(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`${trail}.${key}: forbidden private field`);
      assertNoPrivateData(entry, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && CREDENTIAL_VALUE.test(value)) {
    throw new Error(`${trail}: credential-shaped value`);
  }
}

function validateProjection(parsed, sourcePath) {
  if (![1, 2, 3, 4].includes(parsed.schemaVersion) || !Array.isArray(parsed.products)) {
    throw new Error(`Unsupported Fleet public projection: ${sourcePath}`);
  }

  const ids = new Set();
  for (const product of parsed.products) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
      throw new Error(`${sourcePath}: every product must be an object`);
    }
    for (const key of Object.keys(product)) {
      if (!PUBLIC_FIELDS.has(key))
        throw new Error(`${product.id ?? 'unknown'}: unsupported public field ${key}`);
    }
    for (const key of REQUIRED_FIELDS) {
      if (!product[key]) throw new Error(`${product.id ?? 'unknown'}: missing ${key}`);
    }
    if (ids.has(product.id)) throw new Error(`public product ids must be unique: ${product.id}`);
    ids.add(product.id);
  }
  if (parsed.schemaVersion >= 3) {
    if (!Array.isArray(parsed.directory) || parsed.directory.length === 0) {
      throw new Error(`${sourcePath}: complete public directory is required`);
    }
    const directoryIds = new Set();
    for (const project of parsed.directory) {
      for (const key of Object.keys(project)) {
        if (!DIRECTORY_FIELDS.has(key)) {
          throw new Error(`${project.id ?? 'unknown'}: unsupported directory field ${key}`);
        }
      }
      for (const key of ['id', 'name', 'description', 'makerNote', 'form', 'group', 'lifecycle']) {
        if (!project[key]) throw new Error(`${project.id ?? 'unknown'}: missing directory ${key}`);
      }
      if (directoryIds.has(project.id)) {
        throw new Error(`public directory ids must be unique: ${project.id}`);
      }
      directoryIds.add(project.id);
    }
  }
  assertNoPrivateData(parsed);
}

if (process.argv.includes('--validate')) {
  const checkedIn = await readFile(destination, 'utf8');
  const parsed = JSON.parse(checkedIn);
  validateProjection(parsed, destination);
  console.log(
    `SaaS Maker checked-in public catalog is valid (${parsed.directory?.length ?? parsed.products.length} identities)`
  );
  process.exit(0);
}

const catalog = JSON.parse(await readFile(fleetCatalog, 'utf8'));
const projection = buildPublicProducts(catalog);
validateProjection(projection, fleetCatalog);
const rendered = `${JSON.stringify(projection, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(destination, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('SaaS Maker public catalog is stale; run pnpm catalog:sync-public');
    process.exitCode = 1;
  } else {
    console.log(
      `SaaS Maker public catalog matches Site Health (${projection.directory?.length ?? projection.products.length} identities)`
    );
  }
} else {
  await writeFile(destination, rendered);
  console.log(
    `Synced ${projection.directory?.length ?? projection.products.length} public identities from Site Health`
  );
}
