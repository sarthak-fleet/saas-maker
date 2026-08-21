#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fleetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const componentId = process.argv[2];

const components = {
  drank: {
    root: 'foundry/helpers/drank',
    workflow: 'drank-ci.yml',
    paths: [
      'foundry/helpers/drank',
      'foundry/ops/scripts/manual-component-deploy.mjs',
      '.github/workflows/drank-ci.yml',
    ],
    commands: [
      ['pnpm', ['run', 'build']],
      [
        'pnpm',
        [
          '--allow-build=esbuild',
          '--allow-build=workerd',
          'dlx',
          'wrangler@4.120.0',
          'pages',
          'deploy',
          'out',
          '--project-name=drank',
          '--branch=main',
        ],
      ],
    ],
  },
  'chatgpt-connections': {
    root: 'foundry/helpers/chatgpt-connections',
    workflow: 'chatgpt-connections-ci.yml',
    tagWorker: true,
    paths: [
      'foundry/helpers/chatgpt-connections',
      'foundry/ops/scripts/manual-component-deploy.mjs',
      '.github/workflows/chatgpt-connections-ci.yml',
    ],
    commands: [['pnpm', ['exec', 'wrangler', 'deploy']]],
  },
  'psi-swarm': {
    root: 'foundry/helpers/psi-swarm',
    workflow: 'psi-swarm-ci.yml',
    paths: [
      'foundry/helpers/psi-swarm',
      'foundry/ops/scripts/manual-component-deploy.mjs',
      '.github/workflows/psi-swarm-ci.yml',
    ],
    commands: [
      ['pnpm', ['run', 'build:web']],
      [
        'pnpm',
        [
          '--dir',
          'web',
          'exec',
          'wrangler',
          'pages',
          'deploy',
          'dist',
          '--project-name=psi-swarm-web',
          '--branch=main',
        ],
      ],
    ],
  },
  'reel-pipeline': {
    root: 'foundry/marketing/reel-pipeline',
    workflow: 'reel-pipeline-ci.yml',
    tagWorker: true,
    paths: [
      'foundry/marketing/reel-pipeline',
      'foundry/marketing/content-factory',
      'foundry/ops/scripts/manual-component-deploy.mjs',
      '.github/workflows/reel-pipeline-ci.yml',
    ],
    commands: [['npx', ['wrangler', 'deploy', '--config', 'wrangler.jsonc']]],
  },
};

if (!components[componentId]) {
  fail(`usage: manual-component-deploy.mjs <${Object.keys(components).join('|')}>`);
}

const component = components[componentId];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? fleetRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  console.error(`deploy blocked: ${message}`);
  process.exit(1);
}

function githubSlug() {
  const url = run('git', ['remote', 'get-url', 'origin']);
  if (url.startsWith('git@github.com:')) {
    return url.slice('git@github.com:'.length).replace(/\.git$/, '');
  }
  if (url.startsWith('https://github.com/')) {
    return url.slice('https://github.com/'.length).replace(/\.git$/, '');
  }
  fail(`origin remote is not a GitHub URL: ${url}`);
}

function verifyGitState() {
  const branch = run('git', ['branch', '--show-current']);
  if (branch !== 'main') fail(`current branch is ${branch || 'DETACHED'}, expected main`);

  if (run('git', ['status', '--porcelain'])) fail('Fleet working tree is dirty');

  run('git', ['fetch', '--quiet', 'origin']);
  const upstream = run('git', [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ]);
  const [behind, ahead] = run('git', [
    'rev-list',
    '--left-right',
    '--count',
    `${upstream}...HEAD`,
  ])
    .split(/\s+/)
    .map(Number);
  if (behind !== 0 || ahead !== 0) {
    fail(`branch is not synced with ${upstream}: ahead ${ahead}, behind ${behind}`);
  }
}

function verifyComponentCi(slug) {
  let runs;
  try {
    runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        '-R',
        slug,
        '--workflow',
        component.workflow,
        '--branch',
        'main',
        '--limit',
        '20',
        '--json',
        'status,conclusion,headSha,url',
      ])
    );
  } catch {
    fail(`could not read ${component.workflow} runs from GitHub`);
  }

  const successful = runs.find(
    (candidate) =>
      candidate.status === 'completed' &&
      candidate.conclusion === 'success' &&
      candidate.headSha
  );
  if (!successful) fail(`no successful ${component.workflow} run found on main`);

  try {
    run('git', ['cat-file', '-e', `${successful.headSha}^{commit}`]);
    run('git', ['merge-base', '--is-ancestor', successful.headSha, 'HEAD']);
  } catch {
    fail(`latest successful ${component.workflow} run is not an ancestor of current main`);
  }

  const changed = spawnSync(
    'git',
    ['diff', '--quiet', successful.headSha, 'HEAD', '--', ...component.paths],
    { cwd: fleetRoot }
  );
  if (changed.status !== 0) {
    fail(
      `${componentId} changed after the latest successful ${component.workflow} run: ${successful.url}`
    );
  }
}

verifyGitState();

try {
  run('gh', ['auth', 'status']);
} catch {
  fail('gh is not authenticated');
}

const slug = githubSlug();
verifyComponentCi(slug);

const componentRoot = join(fleetRoot, component.root);
for (const [command, args] of component.commands) {
  const commandArgs = component.tagWorker
    ? [...args, '--tag', run('git', ['rev-parse', 'HEAD'])]
    : args;
  console.log(`Running ${command} ${commandArgs.join(' ')} in ${component.root}`);
  const result = spawnSync(command, commandArgs, {
    cwd: componentRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`);
}
