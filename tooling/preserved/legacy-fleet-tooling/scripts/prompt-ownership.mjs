#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPromptOwnershipReport } from '../lib/prompt-ownership.mjs';

const fleetRoot = resolve(import.meta.dirname, '../../..');
const load = (path) => JSON.parse(readFileSync(resolve(fleetRoot, path), 'utf8'));
const catalog = load('foundry/ops/config/projects.json');
const marketingProgram = load('foundry/ops/config/marketing-program.json');
const agentRegistry = load('foundry/ops/config/agent-surfaces-registry.json');
const report = buildPromptOwnershipReport({
  marketingProgram,
  identities: catalog.geoIdentities,
  agentRegistry,
});

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(renderMarkdown(report));
}

function renderMarkdown(value) {
  const header = [
    '# Fleet prompt ownership',
    '',
    `${value.projectCount} projects · ${value.promptCount} prompts · ` +
      `${value.counts.published} published · ${value.counts['approval-pending']} approval-pending · ` +
      `${value.counts.missing} missing`,
    '',
    '| Project | Prompt | State | Owned page | Action |',
    '| --- | --- | --- | --- | --- |',
  ];
  const rows = value.rows.map((row) => [
    row.productName,
    row.promptKey,
    row.state,
    row.url ?? '—',
    row.implementationAction,
  ].map(escapeCell).join(' | ')).map((row) => `| ${row} |`);
  return `${[...header, ...rows].join('\n')}\n`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
