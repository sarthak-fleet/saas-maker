#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildTokenWorldProjection } from '../lib/token-world.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const args = parseArgs(process.argv.slice(2));
if (!args.seed) {
  console.error('usage: node foundry/ops/scripts/generate-token-world.mjs --seed <private-seed.json> [--output <public.json>] [--correction-note <reason>]');
  process.exit(1);
}

const outputPath = path.resolve(root, args.output ?? 'saas-maker/apps/showcase/src/data/tokenWorld.json');
const seed = JSON.parse(await readFile(path.resolve(args.seed), 'utf8'));
const previous = JSON.parse(await readFile(outputPath, 'utf8').catch(() => 'null'));
const projection = buildTokenWorldProjection(seed, previous, { correctionNote: args.correctionNote });
const rendered = `${JSON.stringify(projection, null, 2)}\n`;

if (args.check) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('Token-world projection is stale or differs from the supplied seed');
    process.exitCode = 1;
  } else {
    console.log(`Token-world projection is current at ${projection.lifetimeTokens.toLocaleString('en-US')} tokens`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${path.relative(root, outputPath)} at ${projection.lifetimeTokens.toLocaleString('en-US')} tokens`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--check') parsed.check = true;
    else if (value.startsWith('--')) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
      parsed[key] = next;
      index += 1;
    } else throw new Error(`unexpected argument: ${value}`);
  }
  return parsed;
}
