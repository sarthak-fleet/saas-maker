#!/usr/bin/env node
//
// scripts/verify-local.mjs
//
// CLI entrypoint for the reusable local-verification qualification.
// Loads a qualification config, runs the qualification, and writes the
// result envelope. Backs the local-verification skill and the reusable
// verify-local workflow.
//
// Usage:
//   node scripts/verify-local.mjs --config qualification.json
//   node scripts/verify-local.mjs --config qualification.json --output result.json
//   node scripts/verify-local.mjs --config qualification.json --skip-failure-injection
//   node scripts/verify-local.mjs --validate-only --config qualification.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { qualify, validateQualification } from '../lib/local-verification.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const configPath = argument('--config');
  if (!configPath) {
    console.error('Usage: verify-local.mjs --config <path> [--output <path>] [--skip-failure-injection] [--validate-only]');
    process.exit(1);
  }

  const absolutePath = resolve(configPath);
  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    console.error(`Could not read qualification config ${absolutePath}: ${error.message}`);
    process.exit(1);
  }

  let config;
  try {
    config = validateQualification(rawConfig);
  } catch (error) {
    console.error(`Invalid qualification config: ${error.message}`);
    process.exit(1);
  }

  if (process.argv.includes('--validate-only')) {
    console.log(`Valid qualification config for ${config.project}: ${config.readinessProbes.length} probe(s), timeout ${config.timeoutSeconds}s`);
    return;
  }

  const skipFI = process.argv.includes('--skip-failure-injection');
  if (skipFI) {
    config = { ...config, failureInjection: undefined };
  }

  const result = await qualify(config);

  const outputPath = argument('--output');
  if (outputPath) {
    const absoluteOutput = resolve(outputPath);
    mkdirSync(dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Result written to ${absoluteOutput}`);
  }

  console.log(`\n== Local Verification Qualification ==`);
  console.log(`Project:     ${result.project}`);
  console.log(`State:       ${result.state}`);
  console.log(`Duration:    ${result.durationMs}ms`);
  console.log(`Readiness:   ${result.readiness.state} (${result.readiness.attempts} attempts, ${result.readiness.durationMs}ms)`);
  console.log(`Patch:       ${result.patchSelection.state}${result.patchSelection.observed ? ' (' + result.patchSelection.observed.slice(0, 7) + ')' : ''}`);
  console.log(`Failure inj: ${result.failureInjection.state}${result.failureInjection.durationMs ? ' (' + result.failureInjection.durationMs + 'ms)' : ''}`);
  if (result.error) {
    console.log(`Error:       ${result.error.code} — ${result.error.message}`);
  }

  if (result.state !== 'qualified') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
