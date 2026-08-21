#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NormalizedAiVisibilityCache } from '../lib/founder-control/ai-visibility-cache.mjs';
import {
  createFixtureVisibilityProviders,
  loadAiVisibilityEngine,
  runAiVisibilityCanary,
} from '../lib/founder-control/ai-visibility.mjs';
import {
  findAiVisibilityProject,
  loadAiVisibilityPortfolio,
} from '../lib/founder-control/ai-visibility-registry.mjs';
import { loadFounderProjects } from '../lib/founder-control/registry.mjs';
import { FounderControlStore, defaultDatabasePath } from '../lib/founder-control/store.mjs';

function usage() {
  console.log(`Manual local Foundry AI visibility canary

Usage:
  ai-visibility-canary.mjs --project <id> --fixture <fixture.json> [options]

Options:
  --db <path>          Override the private Founder ledger path
  --cache <path>       Override the normalized local cache path
  --prompt-set <id>    Select a configured prompt set
  --reactivate <id>    Explicitly reactivate one ignored project for this run

Only fixture providers are accepted. This command cannot load credentials,
enable a schedule, or call a live provider.`);
}

function parseArgs(args) {
  const result = { reactivatedProjectIds: [] };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--project') result.projectId = value;
    else if (flag === '--fixture') result.fixturePath = value;
    else if (flag === '--db') result.databasePath = value;
    else if (flag === '--cache') result.cachePath = value;
    else if (flag === '--prompt-set') result.promptSetId = value;
    else if (flag === '--reactivate') result.reactivatedProjectIds.push(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return result;
}

if (process.argv.slice(2).some((argument) => ['-h', '--help'].includes(argument))) {
  usage();
  process.exit(0);
}

const options = parseArgs(process.argv.slice(2));
if (!options.projectId || !options.fixturePath) {
  usage();
  process.exit(1);
}

const engine = await loadAiVisibilityEngine();
const portfolio = loadAiVisibilityPortfolio({
  reactivatedProjectIds: options.reactivatedProjectIds,
});
const project = findAiVisibilityProject(portfolio, options.projectId);
const fixture = JSON.parse(readFileSync(resolve(options.fixturePath), 'utf8'));
const providers = createFixtureVisibilityProviders(fixture, engine);
const store = new FounderControlStore({
  databasePath: options.databasePath ? resolve(options.databasePath) : defaultDatabasePath(),
  projects: loadFounderProjects(),
});

try {
  const receipt = await runAiVisibilityCanary({
    project,
    providers,
    store,
    engine,
    cache: new NormalizedAiVisibilityCache({
      ...(options.cachePath ? { path: resolve(options.cachePath) } : {}),
    }),
    ...(options.promptSetId ? { promptSetId: options.promptSetId } : {}),
  });
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  store.close();
}
