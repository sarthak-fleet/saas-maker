#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const opsDir = resolve(scriptDir, '..');
const hookScript = resolve(opsDir, 'scripts/agent-bin/record-codex-skill-run.mjs');
const managedMarker = 'record-codex-skill-run.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function mergeSkillRunHook(input, { commandPath = hookScript } = {}) {
  const config = input && typeof input === 'object' && !Array.isArray(input) ? structuredClone(input) : {};
  config.hooks ??= {};
  const existing = Array.isArray(config.hooks.Stop) ? config.hooks.Stop : [];
  const retained = existing.filter(
    (group) =>
      !Array.isArray(group?.hooks) ||
      !group.hooks.some(
        (hook) => typeof hook?.command === 'string' && hook.command.includes(managedMarker),
      ),
  );
  retained.push({
    hooks: [
      {
        type: 'command',
        command: `/usr/bin/env node ${shellQuote(commandPath)}`,
        timeout: 3,
        statusMessage: 'Recording Fleet skill run',
      },
    ],
  });
  config.hooks.Stop = retained;
  return config;
}

async function main() {
  const hooksPath = resolve(option('--hooks', resolve(homedir(), '.codex/hooks.json')));
  const dryRun = process.argv.includes('--dry-run');
  let current = {};
  try {
    current = JSON.parse(await readFile(hooksPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const merged = mergeSkillRunHook(current);
  const rendered = `${JSON.stringify(merged, null, 2)}\n`;
  let previous = '';
  try {
    previous = await readFile(hooksPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (previous === rendered) {
    process.stdout.write(`Codex Fleet skill-run hook is current: ${hooksPath}\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`Would update Codex Fleet skill-run hook: ${hooksPath}\n`);
    return;
  }

  await mkdir(dirname(hooksPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${hooksPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, rendered, { mode: 0o600 });
  await rename(temporaryPath, hooksPath);
  await chmod(hooksPath, 0o600);
  process.stdout.write(`Updated Codex Fleet skill-run hook: ${hooksPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`skill-run hook install failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
