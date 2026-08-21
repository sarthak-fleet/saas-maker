#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectPosthogOutcomes,
  DEFAULT_POSTHOG_PROJECT_ID,
} from '../lib/posthog-outcomes.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';
import {
  appendVisibilityOutcomeBundle,
  defaultVisibilityOutcomePath,
} from '../lib/visibility-outcome-store.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');

function usage() {
  process.stdout.write(`Collect read-only PostHog user-metrics evidence

Usage:
  posthog-outcomes-collect.mjs [--project <id>] [--ledger <ledger.jsonl>] [--window <days>]

Uses POSTHOG_PERSONAL_API_KEY for read-only Query API access.
Only normalized aggregates are written to the private local ledger.
No PII, raw events, or credentials are stored.\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--project') result.projectId = value;
    else if (flag === '--ledger') result.ledgerPath = value;
    else if (flag === '--window') result.windowDays = Number(value);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return result;
}

const rawArgs = process.argv.slice(2);
if (rawArgs.some((argument) => ['-h', '--help'].includes(argument))) {
  usage();
  process.exit(0);
}

const args = parseArgs(rawArgs);
const catalog = JSON.parse(readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'));
let projects = visibilityProjects(catalog);
if (args.projectId) {
  projects = projects.filter((project) => project.id === args.projectId);
  if (projects.length === 0) throw new Error(`Unknown PostHog outcome project: ${args.projectId}`);
}

const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
if (!personalApiKey) {
  throw new Error('PostHog personal API key unavailable. Set POSTHOG_PERSONAL_API_KEY.');
}

const result = await collectPosthogOutcomes({
  projects,
  personalApiKey,
  projectId: Number(process.env.POSTHOG_PROJECT_ID) || DEFAULT_POSTHOG_PROJECT_ID,
  reportingWindowDays: args.windowDays ?? 7,
});
const receipt = appendVisibilityOutcomeBundle(result.bundle, {
  path: args.ledgerPath ? resolve(args.ledgerPath) : defaultVisibilityOutcomePath(),
  allowedProjectIds: new Set(projects.map((project) => project.id)),
});

process.stdout.write(`${JSON.stringify({
  schema: 'fleet.posthog-outcome-collection-receipt.v1',
  recorded: receipt.recorded,
  duplicates: receipt.duplicates,
  projectCount: result.projectCount,
  observationCount: result.observationCount,
  unavailable: result.unavailable,
  period: result.period,
}, null, 2)}\n`);
