#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPublicWorkflowsManifest } from '../lib/public-workflows-manifest.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const sourcePath = path.join(root, 'foundry/ops/public/products.json');
const targetPath = path.join(root, 'foundry/ops/workflows/config/sites.json');

const projection = JSON.parse(await readFile(sourcePath, 'utf8'));
const manifest = buildPublicWorkflowsManifest(projection);
const rendered = `${JSON.stringify(manifest, null, 2)}\n`;
const current = await readFile(targetPath, 'utf8').catch(() => '');

if (process.argv.includes('--check')) {
  if (current !== rendered) {
    console.error('Public workflows manifest is stale or the submodule is not initialized.');
    console.error('Run: git submodule update --init --depth 1 foundry/ops/workflows');
    console.error('Then: npm run generate:public-workflows');
    process.exitCode = 1;
  } else {
    console.log(`Public workflows manifest is current (${manifest.sites.length} sites)`);
  }
} else {
  await writeFile(targetPath, rendered);
  console.log(`Wrote ${path.relative(root, targetPath)} (${manifest.sites.length} sites)`);
}
