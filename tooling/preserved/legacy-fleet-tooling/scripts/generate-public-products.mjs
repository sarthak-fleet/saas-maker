#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPublicProducts } from '../lib/public-products.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const paths = {
  projects: path.join(root, 'foundry/ops/config/projects.json'),
  output: path.join(root, 'foundry/ops/public/products.json'),
};

const projects = await readJson(paths.projects);
const projection = buildPublicProducts(projects);
const rendered = `${JSON.stringify(projection, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(paths.output, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('Fleet public product projection is stale; run npm run generate:public');
    process.exitCode = 1;
  } else {
    console.log(`Fleet public product projection is current (${projection.products.length} maintained, ${projection.pastProjects.length} past)`);
  }
} else {
  await writeFile(paths.output, rendered);
  console.log(`Wrote ${path.relative(root, paths.output)} (${projection.products.length} maintained, ${projection.pastProjects.length} past)`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
