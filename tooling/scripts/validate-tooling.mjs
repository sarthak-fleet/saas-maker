#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateStandard } from './ai-client-audit.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = join(repositoryRoot, 'skills');
const scriptsRoot = join(repositoryRoot, 'scripts');
const preservedScriptsRoot = join(
  repositoryRoot,
  'preserved',
  'legacy-fleet-tooling',
  'scripts',
);
const allowedFrontmatterKeys = new Set([
  'allowed-tools',
  'description',
  'license',
  'metadata',
  'name',
]);
const failures = [];

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function frontmatterFor(file) {
  const source = readFileSync(file, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { source, values: null, keys: [] };

  const values = {};
  const keys = [];
  for (const line of match[1].split('\n')) {
    if (/^\s/.test(line)) continue;
    const field = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    keys.push(field[1]);
    values[field[1]] = field[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { source, values, keys };
}

function validateSkills() {
  let count = 0;
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      failures.push(`skills/${entry.name}: missing SKILL.md`);
      continue;
    }

    count += 1;
    const { source, values, keys } = frontmatterFor(skillFile);
    if (!values) {
      failures.push(`skills/${entry.name}: missing YAML frontmatter`);
      continue;
    }
    if (values.name !== entry.name) {
      failures.push(`skills/${entry.name}: frontmatter name is ${values.name || 'missing'}`);
    }
    if (!values.description) {
      failures.push(`skills/${entry.name}: missing description`);
    }
    for (const key of keys) {
      if (!allowedFrontmatterKeys.has(key)) {
        failures.push(`skills/${entry.name}: unsupported frontmatter key ${key}`);
      }
    }

    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
      const resolved = resolve(dirname(skillFile), target);
      if (!existsSync(resolved)) {
        failures.push(`skills/${entry.name}: broken relative link ${target}`);
      }
    }
  }
  return count;
}

function validateScripts() {
  const files = [
    ...walk(scriptsRoot),
    ...(existsSync(preservedScriptsRoot) ? walk(preservedScriptsRoot) : []),
  ];
  const shellScripts = files.filter((file) => file.endsWith('.sh') || readFileSync(file, 'utf8').startsWith('#!/usr/bin/env bash'));
  const nodeScripts = files.filter((file) => file.endsWith('.mjs'));

  for (const file of shellScripts) {
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`${relative(repositoryRoot, file)}: ${result.stderr.trim() || 'bash syntax check failed'}`);
    }
  }
  for (const file of nodeScripts) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`${relative(repositoryRoot, file)}: ${result.stderr.trim() || 'Node syntax check failed'}`);
    }
  }

  return { node: nodeScripts.length, shell: shellScripts.length };
}

function validateAiClientStandard() {
  const path = join(repositoryRoot, 'config', 'ai-client-standard.json');
  if (!existsSync(path)) {
    failures.push('config/ai-client-standard.json: missing');
    return 0;
  }
  let standard;
  try {
    standard = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push(`config/ai-client-standard.json: ${error.message}`);
    return 0;
  }
  for (const problem of validateStandard(standard).problems) {
    failures.push(`config/ai-client-standard.json: ${problem}`);
  }
  return standard.exceptions?.length ?? 0;
}

if (!statSync(skillsRoot).isDirectory() || !statSync(scriptsRoot).isDirectory()) {
  throw new Error('skills/ and scripts/ must both exist');
}

const skillCount = validateSkills();
const scriptCounts = validateScripts();
const aiClientExceptions = validateAiClientStandard();

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${skillCount} skills, ${scriptCounts.node} Node scripts, ${scriptCounts.shell} shell scripts, `
  + `and the AI client standard with ${aiClientExceptions} dated exception(s).`,
);
