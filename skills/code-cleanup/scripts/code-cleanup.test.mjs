import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildUpgradeCommands,
  checkAudit,
  checkFleet,
  checkOutdated,
  checkRepository,
  classifyVersionChange,
  comparePackageJson,
  dependencyFileInfo,
  discoverCleanupPlan,
  lookupBundlephobia,
  normalizeBundlephobia,
  normalizeOutdatedData,
  parseExactNpmSpecifier,
  parseCliArgs,
  runCleanup,
  selectUpgradePackages,
  upgradePackages,
} from './code-cleanup.mjs';

const cli = path.resolve(import.meta.dirname, 'code-cleanup.mjs');

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function runGit(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function initializeRepository(t, files = {}) {
  const repository = mkdtempSync(path.join(tmpdir(), 'dependency-guard-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));

  for (const [relativePath, content] of Object.entries(files)) {
    write(path.join(repository, relativePath), content);
  }
  runGit(repository, ['init', '-q']);
  runGit(repository, ['config', 'user.email', 'guard@example.test']);
  runGit(repository, ['config', 'user.name', 'Dependency Guard']);
  runGit(repository, ['add', '.']);
  runGit(repository, ['commit', '-qm', 'fixture']);
  return repository;
}

test('recognizes supported dependency manifests and lockfiles', () => {
  assert.deepEqual(dependencyFileInfo('apps/web/package.json'), {
    ecosystem: 'node',
    fileType: 'manifest',
    parser: 'npm',
  });
  assert.deepEqual(dependencyFileInfo('requirements-dev.txt'), {
    ecosystem: 'python',
    fileType: 'manifest',
  });
  assert.deepEqual(dependencyFileInfo('ios/Package.resolved'), {
    ecosystem: 'swift',
    fileType: 'lockfile',
  });
  assert.equal(dependencyFileInfo('src/index.ts'), null);
});

test('compares npm dependency groups deterministically', () => {
  const changes = comparePackageJson(
    {
      dependencies: { alpha: '1.0.0', remove: '2.0.0' },
      devDependencies: { tool: '1.0.0' },
    },
    {
      dependencies: { alpha: '1.1.0', added: '3.0.0' },
      devDependencies: { tool: '1.0.0' },
    },
  );

  assert.deepEqual(changes, [
    {
      change: 'added',
      group: 'dependencies',
      name: 'added',
      before: null,
      after: '3.0.0',
    },
    {
      change: 'changed',
      group: 'dependencies',
      name: 'alpha',
      before: '1.0.0',
      after: '1.1.0',
    },
    {
      change: 'removed',
      group: 'dependencies',
      name: 'remove',
      before: '2.0.0',
      after: null,
    },
  ]);
});

test('reports clean repositories and precise npm plus lockfile changes', (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      dependencies: { alpha: '1.0.0', remove: '2.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  assert.equal(checkRepository({ repository }).clean, true);

  write(path.join(repository, 'package.json'), JSON.stringify({
    dependencies: { alpha: '1.1.0', added: '3.0.0' },
  }));
  write(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages: {}\n');

  const report = checkRepository({ repository });
  assert.equal(report.clean, false);
  assert.deepEqual(report.findings.map((finding) => finding.path), [
    'package.json',
    'pnpm-lock.yaml',
  ]);
  assert.deepEqual(
    report.findings[0].changes.map(({ change, name }) => `${change}:${name}`),
    ['added:added', 'changed:alpha', 'removed:remove'],
  );
  assert.equal(report.findings[1].manualReview, true);
});

test('ignores package metadata changes with no direct dependency delta', (t) => {
  const repository = initializeRepository(t, {
    'package.json': '{"name":"fixture","scripts":{"test":"node --test"}}\n',
  });
  write(
    path.join(repository, 'package.json'),
    '{"name":"fixture","scripts":{"test":"node --test","lint":"node lint.mjs"}}\n',
  );

  const report = checkRepository({ repository });
  assert.equal(report.clean, true);
  assert.deepEqual(report.findings, []);
});

test('includes untracked opaque manifests and flags invalid package JSON', (t) => {
  const repository = initializeRepository(t, {
    'package.json': '{"name":"fixture"}\n',
  });
  write(path.join(repository, 'Cargo.toml'), '[dependencies]\nserde = "1"\n');
  write(path.join(repository, 'package.json'), '{"dependencies":');

  const report = checkRepository({ repository });
  assert.deepEqual(report.findings.map((finding) => finding.path), [
    'Cargo.toml',
    'package.json',
  ]);
  assert.equal(report.findings[0].manualReview, true);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /invalid JSON/);
});

test('strict CLI exits non-zero after emitting a complete JSON report', (t) => {
  const repository = initializeRepository(t, {
    'package.json': '{"name":"fixture","dependencies":{}}\n',
  });
  write(
    path.join(repository, 'package.json'),
    '{"name":"fixture","dependencies":{"tiny":"1.0.0"}}\n',
  );

  const result = spawnSync(process.execPath, [
    cli,
    'check',
    '--repo',
    repository,
    '--strict',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.requiresReview, true);
  assert.equal(report.summary.directChanges, 1);
});

test('Fleet scan uses active registry tiers and deduplicates git roots', (t) => {
  const fleetRoot = mkdtempSync(path.join(tmpdir(), 'dependency-fleet-'));
  t.after(() => rmSync(fleetRoot, { recursive: true, force: true }));
  const foundry = path.join(fleetRoot, 'foundry');

  write(
    path.join(foundry, 'ops/config/projects.json'),
    JSON.stringify({
      projects: [
        {
          id: 'fleet-workspace',
          lifecycle: 'maintained',
          tier: 'active',
          repo: 'foundry/ops',
        },
        {
          id: 'drank',
          lifecycle: 'maintained',
          tier: 'active',
          repo: 'drank',
        },
        {
          id: 'missing-active',
          lifecycle: 'maintained',
          tier: 'secondary',
          repo: 'missing-active',
        },
        {
          id: 'missing-parked',
          lifecycle: 'past',
          tier: 'parked',
          repo: 'missing-parked',
        },
        {
          id: 'past-active',
          lifecycle: 'past',
          tier: 'active',
          repo: 'past-active',
        },
      ],
    }),
  );
  write(path.join(foundry, 'package.json'), '{"name":"foundry"}\n');
  mkdirSync(path.join(foundry, 'helpers/drank'), { recursive: true });
  runGit(foundry, ['init', '-q']);
  runGit(foundry, ['config', 'user.email', 'guard@example.test']);
  runGit(foundry, ['config', 'user.name', 'Dependency Guard']);
  runGit(foundry, ['add', '.']);
  runGit(foundry, ['commit', '-qm', 'fixture']);

  const report = checkFleet({ fleetRoot });
  assert.equal(report.summary.repositories, 1);
  assert.deepEqual(report.repositories[0].projectIds, [
    'drank',
    'fleet-workspace',
  ]);
  assert.deepEqual(report.skipped.map((item) => item.projectId), [
    'missing-active',
  ]);
  assert.deepEqual(report.excluded.map((item) => item.projectId), [
    'missing-parked',
    'past-active',
  ]);
  assert.equal(report.summary.excluded, 2);
});

test('validates exact npm versions and normalizes Bundlephobia evidence', async () => {
  assert.deepEqual(parseExactNpmSpecifier('@scope/pkg@1.2.3-beta.1'), {
    name: '@scope/pkg',
    version: '1.2.3-beta.1',
  });
  assert.equal(parseExactNpmSpecifier('react@latest'), null);
  assert.equal(parseExactNpmSpecifier('react@^19.0.0'), null);

  const fixture = {
    name: 'react',
    version: '19.1.1',
    size: 7633,
    gzip: 2916,
    dependencyCount: 0,
    hasJSModule: false,
    hasJSNext: false,
    hasSideEffects: true,
    isModuleType: false,
    description: 'React',
    repository: 'https://github.com/facebook/react.git',
  };
  assert.deepEqual(
    normalizeBundlephobia(fixture, 'react@19.1.1'),
    {
      requested: 'react@19.1.1',
      ...fixture,
    },
  );

  const result = await lookupBundlephobia('react@19.1.1', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => fixture,
    }),
  });
  assert.equal(result.gzip, 2916);

  await assert.rejects(
    lookupBundlephobia('react@latest', {
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    }),
    /exact npm version/,
  );
});

test('discovers all distinct safe checks and skips redundant or write-mode scripts', (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'cleanup-fixture',
      packageManager: 'npm@10.0.0',
      scripts: {
        'knip:strict': 'knip',
        check: 'eslint .',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        format: 'prettier --write .',
      },
      devDependencies: {
        knip: '5.0.0',
      },
    }),
  });

  const plan = discoverCleanupPlan({ repository });
  assert.equal(plan.packageManager.name, 'npm');
  assert.deepEqual(
    plan.stages.map(({ id, status }) => `${id}:${status}`),
    [
      'knip:planned',
      'quality:check:planned',
      'quality:lint:skipped',
      'quality:typecheck:planned',
      'quality:format:skipped',
      'git-diff-check:planned',
    ],
  );
});

test('reports missing cleanup coverage without installing tools', (t) => {
  const repository = initializeRepository(t, {
    'README.md': '# no package manifest\n',
  });

  const plan = discoverCleanupPlan({ repository });
  assert.equal(plan.packageManager, null);
  assert.deepEqual(
    plan.stages.map(({ id, status }) => `${id}:${status}`),
    [
      'knip:unavailable',
      'quality:unavailable',
      'git-diff-check:planned',
    ],
  );
});

test('combined cleanup continues after failures and includes explicit lookups', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'cleanup-fixture',
      packageManager: 'npm@10.0.0',
      scripts: {
        'knip:strict': 'knip',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
      },
    }),
  });
  const invoked = [];

  const report = await runCleanup({
    repository,
    bundlephobia: ['react@19.1.1'],
    skipOutdated: true,
    skipAudit: true,
    commandRunner: async (stage) => {
      if (stage.status !== 'planned') return stage;
      invoked.push(stage.id);
      return {
        ...stage,
        status: stage.id === 'knip' ? 'failed' : 'passed',
        exitCode: stage.id === 'knip' ? 1 : 0,
        durationMs: 1,
        output: '',
      };
    },
    bundleLookup: async (specifier) => ({
      requested: specifier,
      name: 'react',
      version: '19.1.1',
      size: 7633,
      gzip: 2916,
      dependencyCount: 0,
      hasJSModule: false,
      hasJSNext: false,
      hasSideEffects: true,
      isModuleType: false,
      description: 'React',
      repository: 'https://github.com/facebook/react.git',
    }),
  });

  assert.deepEqual(invoked, [
    'knip',
    'quality:lint',
    'quality:typecheck',
    'git-diff-check',
  ]);
  assert.equal(report.ok, false);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.passed, 3);
  assert.equal(report.bundlephobia[0].status, 'passed');
});

test('combined cleanup includes freshness and audit health signals', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'health-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const report = await runCleanup({
    repository,
    dependencyRunner: async (stage) => ({
      ...stage,
      exitCode: stage.id === 'outdated' ? 1 : 0,
      durationMs: 1,
      stdout: stage.id === 'outdated'
        ? '{"alpha":{"current":"1.0.0","wanted":"1.0.0","latest":"1.1.0","dependencyType":"dependencies"}}'
        : '{"metadata":{"vulnerabilities":{"low":0,"moderate":0,"high":0,"critical":0,"total":0}}}',
      stderr: '',
      error: null,
    }),
    commandRunner: async (stage) => (
      stage.status === 'planned'
        ? {
            ...stage,
            status: 'passed',
            exitCode: 0,
            durationMs: 1,
            output: '',
          }
        : stage
    ),
  });

  assert.equal(report.outdated.summary.total, 1);
  assert.equal(report.audit.status, 'passed');
  assert.equal(report.summary.actionRequired, true);
  assert.equal(report.summary.safeUpgrades, 1);
});

test('normalizes outdated packages and conservatively gates zero and major versions', () => {
  const packages = normalizeOutdatedData(
    {
      alpha: {
        current: '1.2.0',
        wanted: '1.2.1',
        latest: '1.4.0',
        dependencyType: 'dependencies',
      },
      beta: {
        current: '0.2.1',
        wanted: '0.2.4',
        latest: '0.3.0',
        dependencyType: 'devDependencies',
      },
      gamma: {
        current: '2.0.0',
        wanted: '2.0.0',
        latest: '3.0.0',
        dependencyType: 'dependencies',
      },
    },
    {
      dependencies: { alpha: '1.2.0', gamma: '^2.0.0' },
      devDependencies: { beta: '~0.2.1' },
    },
  );

  assert.deepEqual(
    packages.map(({ name, safeTarget, latestChange, declared }) => ({
      name,
      safeTarget,
      latestChange,
      declared,
    })),
    [
      {
        name: 'alpha',
        safeTarget: '1.4.0',
        latestChange: 'minor',
        declared: '1.2.0',
      },
      {
        name: 'beta',
        safeTarget: '0.2.4',
        latestChange: 'minor',
        declared: '~0.2.1',
      },
      {
        name: 'gamma',
        safeTarget: null,
        latestChange: 'major',
        declared: '^2.0.0',
      },
    ],
  );
  assert.equal(classifyVersionChange('1.2.3', '2.0.0'), 'major');
});

test('uses pnpm wanted as the baseline when node_modules is absent', () => {
  const packages = normalizeOutdatedData(
    {
      alpha: {
        wanted: '1.2.0',
        latest: '1.4.0',
        dependencyType: 'dependencies',
      },
      beta: {
        wanted: '0.2.1',
        latest: '0.3.0',
        dependencyType: 'devDependencies',
      },
    },
    {
      dependencies: { alpha: '1.2.0' },
      devDependencies: { beta: '~0.2.1' },
    },
  );

  assert.deepEqual(
    packages.map(({ name, current, safeTarget, latestChange }) => ({
      name,
      current,
      safeTarget,
      latestChange,
    })),
    [
      {
        name: 'alpha',
        current: '1.2.0',
        safeTarget: '1.4.0',
        latestChange: 'minor',
      },
      {
        name: 'beta',
        current: '0.2.1',
        safeTarget: null,
        latestChange: 'minor',
      },
    ],
  );
});

test('parses pnpm outdated JSON after registry warnings', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'outdated-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const report = await checkOutdated({
    repository,
    commandRunner: async (stage) => ({
      ...stage,
      exitCode: 1,
      durationMs: 1,
      stdout: 'WARN registry retry\n{"alpha":{"current":"1.0.0","wanted":"1.0.0","latest":"1.1.0","dependencyType":"dependencies"}}\n',
      stderr: '',
      error: null,
    }),
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.safe, 1);
  assert.deepEqual(report.warnings, ['WARN registry retry']);
});

test('normalizes package-manager audit failures and severity counts', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'audit-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const report = await checkAudit({
    repository,
    commandRunner: async (stage) => ({
      ...stage,
      exitCode: 1,
      durationMs: 1,
      stdout: JSON.stringify({
        metadata: {
          vulnerabilities: {
            low: 0,
            moderate: 1,
            high: 2,
            critical: 0,
            total: 3,
          },
        },
      }),
      stderr: '',
      error: null,
    }),
  });

  assert.equal(report.status, 'failed');
  assert.deepEqual(report.vulnerabilities, {
    low: 0,
    moderate: 1,
    high: 2,
    critical: 0,
  });
});

test('selects bulk conservative upgrades and gates majors explicitly', () => {
  const outdated = {
    packages: normalizeOutdatedData({
      alpha: {
        current: '1.0.0',
        wanted: '1.0.0',
        latest: '1.2.0',
        dependencyType: 'dependencies',
      },
      major: {
        current: '1.0.0',
        wanted: '1.0.0',
        latest: '2.0.0',
        dependencyType: 'devDependencies',
      },
    }, {
      dependencies: { alpha: '1.0.0' },
      devDependencies: { major: '^1.0.0' },
    }),
  };

  assert.deepEqual(
    selectUpgradePackages(outdated, { all: true, safe: true })
      .map(({ name, target }) => `${name}@${target}`),
    ['alpha@1.2.0'],
  );
  assert.throws(
    () => selectUpgradePackages(outdated, { packages: ['major'] }),
    /no conservative update/,
  );
  assert.throws(
    () => selectUpgradePackages(outdated, {
      all: true,
      safe: true,
      packages: ['alpha'],
    }),
    /either repeatable --package values or --all --safe/,
  );
  assert.deepEqual(
    selectUpgradePackages(outdated, {
      packages: ['major'],
      allowMajor: true,
    }).map(({ name, target, change }) => ({ name, target, change })),
    [{ name: 'major', target: '2.0.0', change: 'major' }],
  );
});

test('builds native package-manager upgrade commands without lifecycle scripts', () => {
  const selections = [{
    name: 'alpha',
    target: '1.2.0',
    dependencyType: 'devDependencies',
    declared: '1.0.0',
  }];
  assert.deepEqual(
    buildUpgradeCommands('pnpm', selections, '/repo')[0].args,
    ['update', 'alpha@1.2.0', '--ignore-scripts'],
  );
  assert.deepEqual(
    buildUpgradeCommands('npm', selections, '/repo')[0].args,
    ['install', 'alpha@1.2.0', '--save-dev', '--save-exact', '--ignore-scripts'],
  );
});

test('upgrade previews by default and validates after explicit apply', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'upgrade-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const outdated = {
    status: 'passed',
    packages: normalizeOutdatedData({
      alpha: {
        current: '1.0.0',
        wanted: '1.0.0',
        latest: '1.1.0',
        dependencyType: 'dependencies',
      },
    }, {
      dependencies: { alpha: '1.0.0' },
    }),
    summary: { total: 1, safe: 1, major: 0, deprecated: 0 },
  };

  const preview = await upgradePackages({
    repository,
    outdated,
    all: true,
    safe: true,
  });
  assert.equal(preview.applied, false);
  assert.equal(preview.selections[0].target, '1.1.0');

  const applied = await upgradePackages({
    repository,
    outdated,
    all: true,
    safe: true,
    apply: true,
    commandRunner: async (command) => ({
      ...command,
      exitCode: 0,
      durationMs: 1,
      stdout: '',
      stderr: '',
      error: null,
    }),
    cleanupRunner: async () => ({
      ok: true,
      summary: { passed: 4, failed: 0 },
    }),
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.ok, true);
  assert.equal(applied.cleanup.ok, true);
});

test('upgrade refuses to overlap existing manifest changes', async (t) => {
  const repository = initializeRepository(t, {
    'package.json': JSON.stringify({
      name: 'dirty-upgrade-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const outdated = {
    status: 'passed',
    packages: normalizeOutdatedData({
      alpha: {
        current: '1.0.0',
        wanted: '1.0.0',
        latest: '1.1.0',
        dependencyType: 'dependencies',
      },
    }, {
      dependencies: { alpha: '1.0.0' },
    }),
    summary: { total: 1, safe: 1, major: 0, deprecated: 0 },
  };
  write(
    path.join(repository, 'package.json'),
    JSON.stringify({
      name: 'dirty-upgrade-fixture',
      packageManager: 'pnpm@10.0.0',
      dependencies: { alpha: '1.0.1' },
    }),
  );

  await assert.rejects(
    upgradePackages({
      repository,
      outdated,
      packages: ['alpha'],
      apply: true,
    }),
    /Refusing to upgrade with existing manifest or lockfile changes/,
  );
});

test('run CLI succeeds with explicit unavailable coverage and stable JSON', (t) => {
  const repository = initializeRepository(t, {
    'README.md': '# cleanup fixture\n',
  });
  const result = spawnSync(process.execPath, [
    cli,
    'run',
    '--repo',
    repository,
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, 'run');
  assert.equal(report.ok, true);
  assert.equal(report.summary.unavailable, 4);
  assert.equal(report.checks.at(-1).id, 'git-diff-check');
  assert.equal(report.checks.at(-1).status, 'passed');
});

test('parses repeatable Bundlephobia candidates', () => {
  assert.deepEqual(
    parseCliArgs([
      'run',
      '--bundlephobia',
      'react@19.1.1',
      '--bundlephobia',
      'zod@4.0.5',
    ]).bundlephobia,
    ['react@19.1.1', 'zod@4.0.5'],
  );
  const upgrade = parseCliArgs([
    'upgrade',
    '--package',
    'react',
    '--package',
    'zod@4.4.3',
    '--apply',
    '--allow-major',
  ]);
  assert.deepEqual(upgrade.packages, ['react', 'zod@4.4.3']);
  assert.equal(upgrade.apply, true);
  assert.equal(upgrade.allowMajor, true);
});

test('Fleet exposes the code cleanup skill and requires it before dependency edits', () => {
  const fleetRoot = path.resolve(import.meta.dirname, '../../../../..');
  const agentStack = readFileSync(
    path.join(fleetRoot, 'foundry/ops/scripts/agent-stack.sh'),
    'utf8',
  );
  const rootAgents = readFileSync(path.join(fleetRoot, 'AGENTS.md'), 'utf8');
  const standards = readFileSync(
    path.join(fleetRoot, 'foundry/ops/docs/fleet-agent-standards.md'),
    'utf8',
  );

  assert.match(
    agentStack,
    /EXPOSED_FLEET_SKILLS=\([\s\S]*code-cleanup/,
  );
  assert.match(rootAgents, /Use `\$code-cleanup` before dependency manifest/);
  assert.match(
    standards,
    /Bundlephobia only as\s+advisory browser-package evidence/,
  );
  assert.match(standards, /Upgrade mode must\s+preview by default/);
});
