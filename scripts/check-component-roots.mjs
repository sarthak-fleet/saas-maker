#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { access, lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const retiredRoots = [
  ['foundry/apps/internal', 'drank'].join('/'),
  ['foundry/apps/internal', 'psi-swarm'].join('/'),
  ['foundry/helpers', 'drank'].join('/'),
  ['foundry/helpers', 'psi-swarm'].join('/'),
  ['foundry/packages', 'feedback'].join('/'),
  ['foundry/packages', 'ai-chat-footer'].join('/'),
  ['foundry/packages', 'portfolio-project-strip'].join('/'),
  ['foundry/apps/public', 'public-directory'].join('/'),
  ['foundry/packages', 'ai-visibility'].join('/'),
  ['foundry/helpers', 'chatgpt-connections'].join('/'),
  ['foundry/apps/public', 'mobile-cockpit'].join('/'),
  ['foundry/apps/dashboard', 'mobile-cockpit'].join('/'),
  ['foundry/helpers', 'mashup'].join('/'),
  ['foundry/marketing', 'reel-pipeline'].join('/'),
  ['foundry/marketing', 'content-factory'].join('/'),
];
const historicalReferencePrefixes = [
  'foundry/openspec/',
  'foundry/ops/docs/fleet-perf-scoreboard-',
];
const historicalReferenceFiles = new Set([
  'foundry/ops/docs/public-product-smoke-latest.json',
]);
const components = [
  {
    id: 'ai-visibility',
    root: 'foundry/helpers/ai-visibility',
    required: ['package.json', 'README.md', 'pnpm-lock.yaml'],
    nativeCheck: 'pnpm check',
  },
  {
    id: 'fleet-console',
    root: 'foundry/apps/dashboard/fleet-console',
    required: ['package.json', 'PRODUCT.md', 'DESIGN.md', 'pnpm-lock.yaml'],
    nativeCheck: 'pnpm run build',
  },
];

for (const retiredRoot of retiredRoots) {
  try {
    await access(path.join(root, retiredRoot));
    throw new Error(`Retired component root still exists: ${retiredRoot}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);
const staleReferences = [];

for (const relativePath of trackedFiles) {
  if (
    historicalReferenceFiles.has(relativePath) ||
    historicalReferencePrefixes.some((prefix) => relativePath.startsWith(prefix))
  ) {
    continue;
  }

  const absolutePath = path.join(root, relativePath);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  if (!stats.isFile() && !stats.isSymbolicLink()) continue;
  const content = stats.isSymbolicLink()
    ? await readlink(absolutePath)
    : await readFile(absolutePath, 'utf8');

  for (const retiredRoot of retiredRoots) {
    if (content.includes(retiredRoot)) {
      staleReferences.push(`${relativePath}: ${retiredRoot}`);
    }
  }
}

if (staleReferences.length > 0) {
  throw new Error(`Stale active component paths:\n- ${staleReferences.join('\n- ')}`);
}

const psiSkillPointer = path.join(root, 'foundry/ops/skills/psi-swarm/SKILL.md');
const psiSkillContract = await readFile(psiSkillPointer, 'utf8');
if (
  !psiSkillContract.includes('../../../../psi-swarm/SKILL.md') ||
  !psiSkillContract.includes('https://github.com/sass-maker/psi-swarm/blob/main/SKILL.md')
) {
  throw new Error(
    'PSI Swarm skill pointer must name the standalone checkout and canonical public contract'
  );
}

for (const component of components) {
  for (const requiredPath of component.required) {
    await access(path.join(root, component.root, requiredPath));
  }

  const packageJson = JSON.parse(
    await readFile(path.join(root, component.root, 'package.json'), 'utf8')
  );
  if (!packageJson.name) {
    throw new Error(`${component.id}: package.json must define a name`);
  }
}

console.log(`Component roots valid (${components.length})`);
for (const component of components) {
  console.log(`- ${component.id}: ${component.root} [${component.nativeCheck}]`);
}
