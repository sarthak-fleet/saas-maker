#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fleetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflowRoot = join(fleetRoot, '.github/workflows');
const workflowFiles = readdirSync(workflowRoot)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();

// Credential-free availability checks may run daily when explicitly reviewed.
// Keep this filename allowlist narrow so product/build automation stays weekly.
const frequentScheduleAllowlist = new Set();

const errors = [];

function nestedBlock(lines, header, indent) {
  const prefix = `${' '.repeat(indent)}${header}:`;
  const start = lines.findIndex((line) => line === prefix);
  if (start === -1) return [];

  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.length - line.trimStart().length <= indent) break;
    block.push(line);
  }
  return block;
}

function jobBlockForLine(lines, lineIndex) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(lines[index])) {
      return nestedBlock(lines, lines[index].trim().slice(0, -1), 2);
    }
  }
  return [];
}

for (const file of workflowFiles) {
  const source = readFileSync(join(workflowRoot, file), 'utf8');
  const lines = source.split(/\r?\n/);

  if (!lines.includes('  workflow_dispatch:')) {
    errors.push(`${file}: workflow_dispatch is required for intentional reruns`);
  }

  const concurrency = nestedBlock(lines, 'concurrency', 0);
  if (concurrency.length === 0) {
    errors.push(`${file}: top-level concurrency is required`);
  } else {
    // Reusable workflow callers cannot use ${{ github.workflow }} in concurrency
    // groups — it causes "workflow file issue" parse failures. Allow a static
    // string for any workflow that contains a `uses:` job reference.
    const isReusableCaller = lines.some((line) => /^\s+uses:\s+.*@/.test(line));
    if (!isReusableCaller && !concurrency.some((line) => line.includes('github.workflow'))) {
      errors.push(`${file}: concurrency group must include github.workflow`);
    }
    if (!concurrency.some((line) => line.trimStart().startsWith('cancel-in-progress:'))) {
      errors.push(`${file}: concurrency must declare cancel-in-progress`);
    }
  }

  for (const trigger of ['push', 'pull_request']) {
    const block = nestedBlock(lines, trigger, 2);
    if (block.length > 0 && !block.some((line) => line.trim() === 'paths:')) {
      errors.push(`${file}: ${trigger} must be path-scoped`);
    }
  }

  const schedule = nestedBlock(lines, 'schedule', 2);
  for (const line of schedule.filter((candidate) => candidate.includes('cron:'))) {
    const cron = line.match(/cron:\s*['"]([^'"]+)['"]/)?.[1];
    const fields = cron?.trim().split(/\s+/);
    if (!fields || fields.length !== 5) {
      errors.push(`${file}: invalid cron expression`);
      continue;
    }
    if (fields[2] === '*' && fields[4] === '*' && !frequentScheduleAllowlist.has(file)) {
      errors.push(`${file}: scheduled workflows must run weekly or less often`);
    }
  }

  const runnerLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s{4}runs-on:/.test(line));
  const timeoutCount = lines.filter((line) => /^\s{4}timeout-minutes:/.test(line)).length;
  if (timeoutCount !== runnerLines.length) {
    errors.push(`${file}: every job must declare timeout-minutes`);
  }

  for (const { line, index } of runnerLines) {
    if (!line.includes('macos-')) continue;
    const jobBlock = jobBlockForLine(lines, index);
    if (!jobBlock.some((candidate) => candidate.trim() === "if: github.event_name == 'workflow_dispatch'")) {
      errors.push(`${file}: macOS jobs must be manual-only`);
    }
  }

  const hasAutomaticTrigger =
    nestedBlock(lines, 'push', 2).length > 0 ||
    nestedBlock(lines, 'pull_request', 2).length > 0;
  const deployCommand =
    /\bwrangler\s+(?:pages\s+)?deploy\b/.test(source) ||
    /\bopennextjs-cloudflare\s+deploy\b/.test(source);
  if (hasAutomaticTrigger && deployCommand) {
    errors.push(`${file}: production deploy commands cannot use automatic triggers`);
  }
}

if (errors.length > 0) {
  console.error('GitHub Actions policy violations:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`GitHub Actions policy valid (${workflowFiles.length} workflows)`);
