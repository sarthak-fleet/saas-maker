#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  loadAiVisibilityEngine,
  prepareProviderObservationRuns,
  runAiVisibilityCanary,
} from '../lib/founder-control/ai-visibility.mjs';
import {
  loadAiVisibilityPortfolio,
} from '../lib/founder-control/ai-visibility-registry.mjs';
import { loadFounderProjects } from '../lib/founder-control/registry.mjs';
import { FounderControlStore, defaultDatabasePath } from '../lib/founder-control/store.mjs';

function usage() {
  console.log(`Ingest externally captured AI Visibility provider observations

Usage:
  ai-visibility-provider-observations.mjs --input <bundle.json> [options]

Options:
  --db <path>       Override the private Founder ledger path
  --require-all     Require exact coverage of all currently eligible projects

The command reads no credentials and makes no provider or network request.
Raw answer text is analyzed in memory and is not retained in the ledger.`);
}

function parseArgs(args) {
  const result = { requireAll: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--require-all') {
      result.requireAll = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag ?? 'argument'}`);
    if (flag === '--input') result.inputPath = value;
    else if (flag === '--db') result.databasePath = value;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return result;
}

if (process.argv.slice(2).some((argument) => ['-h', '--help'].includes(argument))) {
  usage();
  process.exit(0);
}

const options = parseArgs(process.argv.slice(2));
if (!options.inputPath) {
  usage();
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(resolve(options.inputPath), 'utf8'));
const engine = await loadAiVisibilityEngine();
const portfolio = loadAiVisibilityPortfolio();
const runs = prepareProviderObservationRuns({
  bundle,
  portfolio,
  engine,
  requireAll: options.requireAll,
});
const store = new FounderControlStore({
  databasePath: options.databasePath ? resolve(options.databasePath) : defaultDatabasePath(),
  projects: loadFounderProjects(),
});

try {
  const receipts = [];
  for (const run of runs) {
    receipts.push(await runAiVisibilityCanary({
      project: run.project,
      providers: run.providers,
      store,
      engine,
      providerKind: 'provider-observation',
      promptSetId: run.promptSetId,
      provenance: run.provenance,
      runId: run.runId,
      now: () => run.observedAt,
    }));
  }
  console.log(JSON.stringify({
    schema: 'fleet.ai-visibility-provider-ingest-receipt.v1',
    projectCoverage: {
      recorded: runs.length,
      canonical: portfolio.eligible.length,
      complete: runs.length === portfolio.eligible.length,
    },
    receipts,
  }, null, 2));
} finally {
  store.close();
}
