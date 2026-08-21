#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  collectCloudflareOutcomes,
  DEFAULT_CLOUDFLARE_ACCOUNT_ID,
} from '../lib/cloudflare-outcomes.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';
import {
  appendVisibilityOutcomeBundle,
  defaultVisibilityOutcomePath,
} from '../lib/visibility-outcome-store.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');

function usage() {
  process.stdout.write(`Collect read-only Cloudflare outcome evidence

Usage:
  cloudflare-outcomes-collect.mjs [--project <id>] [--ledger <ledger.jsonl>]

Uses CLOUDFLARE_API_TOKEN when present, otherwise the existing Wrangler OAuth
login. Only normalized aggregates are written to the private local ledger.\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--project') result.projectId = value;
    else if (flag === '--ledger') result.ledgerPath = value;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return result;
}

function readWranglerOAuthToken() {
  const candidates = [
    process.env.WRANGLER_CONFIG_PATH,
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    join(homedir(), '.config/.wrangler/config/default.toml'),
    join(homedir(), '.wrangler/config/default.toml'),
  ].filter(Boolean);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, 'utf8').match(/^oauth_token\s*=\s*["']([^"']+)["']/m);
    if (match) return match[1];
  }
  return null;
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
  if (projects.length === 0) throw new Error(`Unknown Cloudflare outcome project: ${args.projectId}`);
}

const token = process.env.CLOUDFLARE_API_TOKEN ?? readWranglerOAuthToken();
if (!token) throw new Error('Cloudflare credentials unavailable. Set CLOUDFLARE_API_TOKEN or run `wrangler login`.');

const result = await collectCloudflareOutcomes({
  projects,
  token,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_CLOUDFLARE_ACCOUNT_ID,
});
const receipt = appendVisibilityOutcomeBundle(result.bundle, {
  path: args.ledgerPath ? resolve(args.ledgerPath) : defaultVisibilityOutcomePath(),
  allowedProjectIds: new Set(projects.map((project) => project.id)),
});

process.stdout.write(`${JSON.stringify({
  schema: 'fleet.cloudflare-outcome-collection-receipt.v1',
  recorded: receipt.recorded,
  duplicates: receipt.duplicates,
  projectCount: result.projectCount,
  zoneCount: result.zoneCount,
  observationCount: result.bundle.observations.length,
  unavailable: result.unavailable,
  period: result.period,
}, null, 2)}\n`);
