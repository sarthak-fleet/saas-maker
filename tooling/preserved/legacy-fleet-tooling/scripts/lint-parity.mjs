#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), '../../..');
const activeTiers = new Set(['focus', 'active', 'secondary']);
const configNames = [
  'biome.json',
  'biome.jsonc',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'oxlint.config.ts',
  '.oxlintrc.json',
];

const pathExists = async (candidate) =>
  access(candidate).then(
    () => true,
    () => false
  );

const readJson = async (candidate) => JSON.parse(await readFile(candidate, 'utf8'));

const detectLinter = (configPath, packageJson) => {
  if (configPath?.includes('biome')) return 'biome';
  if (configPath?.includes('eslint')) return 'eslint';
  if (configPath?.includes('oxlint')) return 'oxlint';

  const scripts = Object.values(packageJson?.scripts ?? {}).join(' ');
  if (/\bultracite\b/u.test(scripts)) return 'ultracite';
  if (/\bbiome\b/u.test(scripts)) return 'biome';
  if (/\beslint\b/u.test(scripts)) return 'eslint';
  if (/\boxlint\b/u.test(scripts)) return 'oxlint';
  return 'none';
};

const projectCheckout = (workspaceRoot, project) => {
  const relativePath = project.sourcePath ?? project.repo;
  return relativePath ? path.resolve(workspaceRoot, relativePath) : null;
};

export const classifyProject = async ({
  deliberateDivergences = {},
  project,
  workspaceRoot,
}) => {
  const checkout = projectCheckout(workspaceRoot, project);
  const relativeCheckout = project.sourcePath ?? project.repo ?? null;

  if (!activeTiers.has(project.tier) || project.lifecycle === 'past') {
    const reason =
      project.lifecycle === 'past'
        ? 'lifecycle past is outside active adoption'
        : `tier ${project.tier} is outside active adoption`;
    return {
      configPath: null,
      id: project.id,
      linter: 'not-inspected',
      reason,
      repositoryPath: relativeCheckout,
      status: 'excluded',
      tier: project.tier,
    };
  }

  if (!checkout || !(await pathExists(checkout))) {
    return {
      configPath: null,
      id: project.id,
      linter: 'unknown',
      reason: 'registered checkout is unavailable',
      repositoryPath: relativeCheckout,
      status: 'unavailable',
      tier: project.tier,
    };
  }

  let configPath = null;
  for (const name of configNames) {
    if (await pathExists(path.join(checkout, name))) {
      configPath = name;
      break;
    }
  }

  const packagePath = path.join(checkout, 'package.json');
  const packageJson = (await pathExists(packagePath)) ? await readJson(packagePath) : null;
  const linter = detectLinter(configPath, packageJson);
  const config = configPath ? await readFile(path.join(checkout, configPath), 'utf8') : '';
  const aligned =
    config.includes('ops/templates/biome.base.json') ||
    config.includes('ultracite/biome/') ||
    config.includes('ultracite/eslint/') ||
    config.includes('ultracite/oxlint/');

  if (aligned) {
    return {
      configPath,
      id: project.id,
      linter,
      reason: 'configuration resolves the shared or upstream preset',
      repositoryPath: relativeCheckout,
      status: 'aligned',
      tier: project.tier,
    };
  }

  if (deliberateDivergences[project.id]) {
    return {
      configPath,
      id: project.id,
      linter,
      reason: deliberateDivergences[project.id],
      repositoryPath: relativeCheckout,
      status: 'deliberate-divergence',
      tier: project.tier,
    };
  }

  if (!configPath && linter === 'none') {
    return {
      configPath: null,
      id: project.id,
      linter,
      reason: 'no recognized lint configuration or package script',
      repositoryPath: relativeCheckout,
      status: 'missing-configuration',
      tier: project.tier,
    };
  }

  return {
    configPath,
    id: project.id,
    linter,
    reason: 'recognized lint setup does not resolve the shared preset',
    repositoryPath: relativeCheckout,
    status: 'unmanaged',
    tier: project.tier,
  };
};

export const buildParityReport = async ({
  deliberateDivergences = {},
  projects,
  workspaceRoot,
}) => {
  const results = [];
  for (const project of [...projects].sort((left, right) => left.id.localeCompare(right.id))) {
    results.push(await classifyProject({ deliberateDivergences, project, workspaceRoot }));
  }

  const counts = Object.fromEntries(
    [
      'aligned',
      'deliberate-divergence',
      'unmanaged',
      'missing-configuration',
      'unavailable',
      'excluded',
    ].map((status) => [status, results.filter((result) => result.status === status).length])
  );

  return {
    projects: results,
    schemaVersion: 'fleet.lint-parity.v1',
    summary: {
      activeTotal: results.filter((result) => result.status !== 'excluded').length,
      counts,
      excludedTotal: counts.excluded,
    },
  };
};

const printHuman = (report) => {
  const { counts } = report.summary;
  console.log(
    `Fleet lint parity: ${counts.aligned} aligned, ${counts['deliberate-divergence']} deliberate, ${counts.unmanaged} unmanaged, ${counts['missing-configuration']} missing, ${counts.unavailable} unavailable (${report.summary.activeTotal} active)`
  );
  for (const project of report.projects.filter((entry) => entry.status !== 'excluded')) {
    console.log(
      `  ${project.status.padEnd(21)} ${project.id} (${project.linter}${project.configPath ? `, ${project.configPath}` : ''})`
    );
  }
  console.log(`  excluded              ${report.summary.excludedTotal} inactive project(s)`);
};

const main = async () => {
  const registry = await readJson(path.join(defaultWorkspaceRoot, 'foundry/ops/config/projects.json'));
  const parityConfig = await readJson(
    path.join(defaultWorkspaceRoot, 'foundry/ops/config/lint-parity.json')
  );
  const report = await buildParityReport({
    deliberateDivergences: parityConfig.deliberateDivergences,
    projects: registry.projects,
    workspaceRoot: defaultWorkspaceRoot,
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printHuman(report);
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
