#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildMissingPromptCoverageManifests } from '../lib/prompt-coverage-manifests.mjs';

const fleetRoot = resolve(import.meta.dirname, '../../..');
const load = (path) => JSON.parse(readFileSync(resolve(fleetRoot, path), 'utf8'));
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const output = option('--output');
const createdAt = option('--created-at') ?? new Date().toISOString();
const manifests = buildMissingPromptCoverageManifests({
  marketingProgram: load('foundry/ops/config/marketing-program.json'),
  catalog: load('foundry/ops/config/projects.json'),
  agentRegistry: load('foundry/ops/config/agent-surfaces-registry.json'),
  createdAt,
});

if (output) {
  const directory = resolve(output);
  mkdirSync(directory, { recursive: true });
  for (const entry of manifests) {
    writeFileSync(
      resolve(directory, `${entry.projectId}.json`),
      `${JSON.stringify(entry.manifest, null, 2)}\n`,
    );
  }
}
process.stdout.write(`${JSON.stringify(manifests.map(({ projectId, promptKey, manifestHash }) => ({ projectId, promptKey, manifestHash })), null, 2)}\n`);
