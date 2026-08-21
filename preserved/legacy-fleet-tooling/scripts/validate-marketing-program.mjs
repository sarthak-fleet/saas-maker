#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMarketingProgram, validateMarketingProgram } from '../lib/marketing-program.mjs';

const programPath = resolve(import.meta.dirname, '../config/marketing-program.json');
const automation = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../config/automation-registry.json'), 'utf8'),
);
const registry = loadMarketingProgram(programPath);
const catalogSlugs = automation.entries
  .filter((project) => project.attention !== 'ignored')
  .map((project) => project.id);
validateMarketingProgram(registry, {
  catalogSlugs: [...catalogSlugs, 'fleet-ops', 'wifi-watch'],
});
console.log(`marketing program v${registry.version}: ${registry.projects.length} projects, ${registry.focusSet.length} focus`);
