#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PSI_ROOT = resolve(import.meta.dirname, '../../helpers/psi-swarm');
const PSI_CLI = resolve(PSI_ROOT, 'cli/dist/cli.js');
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseTargets(args) {
  const targets = args.flatMap((value, index) => {
    if (value !== '--target' || !args[index + 1]) return [];
    const separator = args[index + 1].indexOf('=');
    if (separator <= 0) throw new Error('--target must use project-id=https://domain');
    const projectId = args[index + 1].slice(0, separator);
    const url = new URL(args[index + 1].slice(separator + 1));
    if (!PROJECT_ID_PATTERN.test(projectId) || url.protocol !== 'https:') {
      throw new Error('--target must use a canonical project id and HTTPS URL');
    }
    return [{ projectId, url: url.toString() }];
  });
  if (targets.length === 0) throw new Error('at least one --target is required');
  if (new Set(targets.map((target) => target.projectId)).size !== targets.length) {
    throw new Error('portfolio targets must use unique project ids');
  }
  return targets;
}

export function runPerformancePortfolio(
  targets,
  { cliPath = PSI_CLI, cwd = PSI_ROOT, run = spawnSync, log = console.log } = {},
) {
  if (!existsSync(cliPath) && run === spawnSync) {
    throw new Error('PSI Swarm CLI is not built');
  }
  const failed = [];
  targets.forEach((target, index) => {
    log(`[${index + 1}/${targets.length}] ${target.projectId}`);
    const result = run(process.execPath, [
      cliPath,
      'run',
      target.url,
      '--runs',
      '2',
      '--presets',
      'desktop',
      '--tag',
      'console-portfolio',
      '--no-suggest',
      '--no-crux',
      '--no-ahrefs',
      '--no-diagnose',
      '--no-insight',
    ], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    });
    if (result.status !== 0) {
      failed.push(target.projectId);
      const detail = String(result.stderr || result.stdout || 'PSI run failed').trim().split(/\r?\n/).at(-1);
      log(`${target.projectId}: ${detail}`);
    }
  });
  return { completed: targets.length - failed.length, failed };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const targets = parseTargets(process.argv.slice(2));
    const result = runPerformancePortfolio(targets);
    console.log(`Completed ${result.completed}/${targets.length} performance targets.`);
    if (result.failed.length > 0) {
      console.error(`Failed: ${result.failed.join(', ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
