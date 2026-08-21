#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { visibilityProjects } from '../lib/visibility-projects.mjs';
import {
  appendVisibilityOutcomeBundle,
  defaultVisibilityOutcomePath,
} from '../lib/visibility-outcome-store.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');

function usage() {
  process.stdout.write(`Ingest provider-authoritative visibility outcome aggregates

Usage:
  visibility-outcomes-ingest.mjs --input <bundle.json> [--ledger <ledger.jsonl>]

The command performs no network requests and reads no credentials. It validates
the complete bundle before writing normalized aggregate observations to the
private machine-local outcome ledger.\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--input') result.inputPath = value;
    else if (flag === '--ledger') result.ledgerPath = value;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return result;
}

const args = process.argv.slice(2);
if (args.some((argument) => ['-h', '--help'].includes(argument))) {
  usage();
  process.exit(0);
}

const options = parseArgs(args);
if (!options.inputPath) {
  usage();
  process.exit(1);
}

const catalog = JSON.parse(
  readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'),
);
const allowedProjectIds = new Set(visibilityProjects(catalog).map((project) => project.id));
const bundle = JSON.parse(readFileSync(resolve(options.inputPath), 'utf8'));
const receipt = appendVisibilityOutcomeBundle(bundle, {
  path: options.ledgerPath
    ? resolve(options.ledgerPath)
    : defaultVisibilityOutcomePath(),
  allowedProjectIds,
});

process.stdout.write(`${JSON.stringify({
  ...receipt,
  acceptedProjects: [...new Set(receipt.observations.map((observation) => observation.projectId))].sort(),
}, null, 2)}\n`);
