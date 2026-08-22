#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { checkGeoIdentityLinks } from '../lib/geo-identity-links.mjs';
import { validateGeoIdentityContract } from '../lib/project-catalog.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const catalog = JSON.parse(
  await readFile(path.join(root, 'foundry/ops/config/projects.json'), 'utf8'),
);
const agentRegistry = JSON.parse(
  await readFile(
    path.join(root, 'foundry/ops/config/agent-surfaces-registry.json'),
    'utf8',
  ),
);

const json = process.argv.includes('--json');
const timeoutMs = numberOption('--timeout-ms', 10_000);
const concurrency = numberOption('--concurrency', 6);
validateGeoIdentityContract(catalog, agentRegistry);
const audit = await checkGeoIdentityLinks(catalog, { timeoutMs, concurrency });

if (json) {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
} else {
  for (const result of audit.results) {
    const detail = result.status === 'pass'
      ? `${result.httpStatus} ${result.resolvedUrl}`
      : result.reason;
    process.stdout.write(
      `${result.status.toUpperCase()}\t${result.projectId}\t${result.kind}\t${result.url}\t${detail}\n`,
    );
  }
  process.stdout.write(
    `\n${audit.passed}/${audit.linkCount} declared public links passed across ${audit.projectCount} products.\n`,
  );
}

if (audit.failed > 0) process.exitCode = 1;

function numberOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value)) throw new Error(`${name} requires an integer`);
  return value;
}
