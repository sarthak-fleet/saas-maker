#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;

const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 12_000;
const SAFE_FOCUSED_SCRIPTS = [
  'format:check',
  'lint',
  'typecheck',
  'test',
];
const KNIP_CONFIG_FILES = [
  'knip.json',
  'knip.jsonc',
  'knip.js',
  'knip.cjs',
  'knip.mjs',
  'knip.ts',
  'knip.config.js',
  'knip.config.cjs',
  'knip.config.mjs',
  'knip.config.ts',
];
const NODE_LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];

const DEPENDENCY_GROUPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const INCLUDED_FLEET_TIERS = new Set(['focus', 'active', 'secondary']);

const EXACT_FILES = new Map([
  ['package.json', { ecosystem: 'node', fileType: 'manifest', parser: 'npm' }],
  ['package-lock.json', { ecosystem: 'node', fileType: 'lockfile' }],
  ['npm-shrinkwrap.json', { ecosystem: 'node', fileType: 'lockfile' }],
  ['pnpm-lock.yaml', { ecosystem: 'node', fileType: 'lockfile' }],
  ['yarn.lock', { ecosystem: 'node', fileType: 'lockfile' }],
  ['bun.lock', { ecosystem: 'node', fileType: 'lockfile' }],
  ['bun.lockb', { ecosystem: 'node', fileType: 'lockfile' }],
  ['pyproject.toml', { ecosystem: 'python', fileType: 'manifest' }],
  ['uv.lock', { ecosystem: 'python', fileType: 'lockfile' }],
  ['poetry.lock', { ecosystem: 'python', fileType: 'lockfile' }],
  ['Pipfile', { ecosystem: 'python', fileType: 'manifest' }],
  ['Pipfile.lock', { ecosystem: 'python', fileType: 'lockfile' }],
  ['Cargo.toml', { ecosystem: 'rust', fileType: 'manifest' }],
  ['Cargo.lock', { ecosystem: 'rust', fileType: 'lockfile' }],
  ['go.mod', { ecosystem: 'go', fileType: 'manifest' }],
  ['go.sum', { ecosystem: 'go', fileType: 'lockfile' }],
  ['Gemfile', { ecosystem: 'ruby', fileType: 'manifest' }],
  ['Gemfile.lock', { ecosystem: 'ruby', fileType: 'lockfile' }],
  ['Podfile', { ecosystem: 'cocoapods', fileType: 'manifest' }],
  ['Podfile.lock', { ecosystem: 'cocoapods', fileType: 'lockfile' }],
  ['Package.swift', { ecosystem: 'swift', fileType: 'manifest' }],
  ['Package.resolved', { ecosystem: 'swift', fileType: 'lockfile' }],
]);

function git(repository, args, options = {}) {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function splitNulls(value) {
  return value.split('\0').filter(Boolean);
}

function stableSort(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function errorRecord(error, fallbackCode = 'ERR_GUARD') {
  return {
    code: error?.code || fallbackCode,
    message: String(error?.stderr || error?.message || error).trim(),
  };
}

export function dependencyFileInfo(relativePath) {
  const basename = path.basename(relativePath);
  if (EXACT_FILES.has(basename)) return { ...EXACT_FILES.get(basename) };
  if (/^requirements(?:-[^.]+)?\.txt$/i.test(basename)) {
    return { ecosystem: 'python', fileType: 'manifest' };
  }
  return null;
}

export function parsePackageJson(content, relativePath, snapshot) {
  if (content === null) return {};

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${relativePath} is invalid JSON in ${snapshot}: ${error.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${relativePath} must contain a JSON object in ${snapshot}`);
  }
  return parsed;
}

function dependencyMap(packageJson, group) {
  const value = packageJson[group];
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}

export function comparePackageJson(basePackage, headPackage) {
  const changes = [];

  for (const group of DEPENDENCY_GROUPS) {
    const before = dependencyMap(basePackage, group);
    const after = dependencyMap(headPackage, group);
    const names = stableSort(new Set([...Object.keys(before), ...Object.keys(after)]));

    for (const name of names) {
      if (!(name in before)) {
        changes.push({
          change: 'added',
          group,
          name,
          before: null,
          after: String(after[name]),
        });
      } else if (!(name in after)) {
        changes.push({
          change: 'removed',
          group,
          name,
          before: String(before[name]),
          after: null,
        });
      } else if (String(before[name]) !== String(after[name])) {
        changes.push({
          change: 'changed',
          group,
          name,
          before: String(before[name]),
          after: String(after[name]),
        });
      }
    }
  }

  return changes;
}

export function resolveGitRoot(repository) {
  const root = git(repository, ['rev-parse', '--show-toplevel']).trim();
  return realpathSync(root);
}

function readRevisionFile(repository, revision, relativePath) {
  try {
    return git(repository, ['show', `${revision}:${relativePath}`]);
  } catch {
    return null;
  }
}

function readWorktreeFile(repository, relativePath) {
  const absolutePath = path.join(repository, relativePath);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, 'utf8');
}

function changedFiles(repository, base, head) {
  if (head !== 'WORKTREE') {
    return stableSort(splitNulls(git(repository, [
      'diff',
      '--name-only',
      '-z',
      base,
      head,
      '--',
    ])));
  }

  const changed = splitNulls(git(repository, [
    'diff',
    '--name-only',
    '-z',
    base,
    '--',
  ]));
  const untracked = splitNulls(git(repository, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]));
  return stableSort(new Set([...changed, ...untracked]));
}

function summarizeReports(repositories, skipped = [], excluded = []) {
  const findings = repositories.flatMap((repository) => repository.findings);
  const errors = repositories.flatMap((repository) => repository.errors);
  const directChanges = findings.reduce(
    (count, finding) => count + (finding.changes?.length || 0),
    0,
  );

  return {
    repositories: repositories.length,
    cleanRepositories: repositories.filter((repository) => repository.clean).length,
    changedFiles: findings.length,
    directChanges,
    skipped: skipped.length,
    excluded: excluded.length,
    errors: errors.length,
    requiresReview: findings.length > 0 || errors.length > 0,
  };
}

export function checkRepository(options = {}) {
  const requestedRepository = path.resolve(options.repository || process.cwd());
  const repository = resolveGitRoot(requestedRepository);
  const base = options.base || 'HEAD';
  const head = options.head || 'WORKTREE';
  const findings = [];
  const errors = [];

  let files;
  try {
    files = changedFiles(repository, base, head).filter(dependencyFileInfo);
  } catch (error) {
    errors.push({
      repository,
      path: null,
      ...errorRecord(error, 'ERR_GIT_COMPARE'),
    });
    files = [];
  }

  for (const relativePath of files) {
    const info = dependencyFileInfo(relativePath);
    const finding = {
      path: relativePath,
      ecosystem: info.ecosystem,
      fileType: info.fileType,
      parser: info.parser || null,
      manualReview: info.parser !== 'npm',
      changes: [],
    };

    if (info.parser === 'npm') {
      let parseFailed = false;
      try {
        const baseContent = readRevisionFile(repository, base, relativePath);
        const headContent = head === 'WORKTREE'
          ? readWorktreeFile(repository, relativePath)
          : readRevisionFile(repository, head, relativePath);
        const basePackage = parsePackageJson(baseContent, relativePath, base);
        const headPackage = parsePackageJson(headContent, relativePath, head);
        finding.changes = comparePackageJson(basePackage, headPackage);
        finding.manualReview = false;
      } catch (error) {
        parseFailed = true;
        finding.manualReview = true;
        errors.push({
          repository,
          path: relativePath,
          ...errorRecord(error, 'ERR_PACKAGE_JSON'),
        });
      }
      if (!parseFailed && finding.changes.length === 0) continue;
    }

    findings.push(finding);
  }

  return {
    repository,
    projectIds: stableSort(new Set(options.projectIds || [])),
    base,
    head,
    clean: findings.length === 0 && errors.length === 0,
    findings,
    errors,
  };
}

function defaultFleetRoot() {
  return path.resolve(import.meta.dirname, '../../../../..');
}

function addRepositoryCandidate(candidates, candidatePath, projectId, skipped) {
  const resolvedPath = path.resolve(candidatePath);
  if (!existsSync(resolvedPath)) {
    skipped.push({
      projectId,
      path: resolvedPath,
      reason: 'missing',
    });
    return;
  }

  let root;
  try {
    root = resolveGitRoot(resolvedPath);
  } catch {
    skipped.push({
      projectId,
      path: resolvedPath,
      reason: 'not-a-git-repository',
    });
    return;
  }

  if (!candidates.has(root)) candidates.set(root, new Set());
  if (projectId) candidates.get(root).add(projectId);
}

export function discoverFleetRepositories(fleetRoot = defaultFleetRoot()) {
  const resolvedFleetRoot = path.resolve(fleetRoot);
  const registryPath = path.join(
    resolvedFleetRoot,
    'foundry/ops/config/projects.json',
  );
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (!Array.isArray(registry.projects)) {
    throw new Error(`${registryPath} must contain a projects array`);
  }

  const candidates = new Map();
  const skipped = [];
  const excluded = [];
  addRepositoryCandidate(
    candidates,
    path.join(resolvedFleetRoot, 'foundry'),
    'fleet-workspace',
    skipped,
  );

  for (const project of registry.projects) {
    if (
      project.lifecycle !== 'maintained'
      || !INCLUDED_FLEET_TIERS.has(project.tier)
    ) {
      excluded.push({
        projectId: project.id,
        lifecycle: project.lifecycle || null,
        tier: project.tier || null,
        reason: project.lifecycle !== 'maintained'
          ? `lifecycle ${project.lifecycle || 'unspecified'} is outside maintained enforcement`
          : `tier ${project.tier || 'unspecified'} is outside maintained enforcement`,
      });
      continue;
    }
    const source = project.sourcePath || project.repo;
    if (!source) continue;
    addRepositoryCandidate(
      candidates,
      path.join(resolvedFleetRoot, source),
      project.id,
      skipped,
    );
  }

  return {
    fleetRoot: resolvedFleetRoot,
    repositories: stableSort(candidates.keys()).map((repository) => ({
      repository,
      projectIds: stableSort(candidates.get(repository)),
    })),
    skipped: skipped.sort((left, right) => (
      `${left.projectId}:${left.path}`.localeCompare(`${right.projectId}:${right.path}`)
    )),
    excluded: excluded.sort((left, right) => left.projectId.localeCompare(right.projectId)),
  };
}

export function checkFleet(options = {}) {
  const discovery = discoverFleetRepositories(options.fleetRoot);
  const repositories = discovery.repositories.map(({ repository, projectIds }) => (
    checkRepository({
      repository,
      projectIds,
      base: options.base,
      head: options.head,
    })
  ));
  const summary = summarizeReports(
    repositories,
    discovery.skipped,
    discovery.excluded,
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'fleet',
    ok: summary.errors === 0,
    fleetRoot: discovery.fleetRoot,
    base: options.base || 'HEAD',
    head: options.head || 'WORKTREE',
    requiresReview: summary.requiresReview,
    summary,
    repositories,
    skipped: discovery.skipped,
    excluded: discovery.excluded,
  };
}

function checkReport(options = {}) {
  const repository = checkRepository(options);
  const summary = summarizeReports([repository]);
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'check',
    ok: summary.errors === 0,
    base: repository.base,
    head: repository.head,
    requiresReview: summary.requiresReview,
    summary,
    repositories: [repository],
    skipped: [],
    excluded: [],
  };
}

export function parseExactNpmSpecifier(specifier) {
  const separator = specifier.lastIndexOf('@');
  if (separator <= 0) return null;
  const name = specifier.slice(0, separator);
  const version = specifier.slice(separator + 1);
  if (!name || !version) return null;
  if (name.startsWith('@') && !name.includes('/')) return null;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    return null;
  }
  return { name, version };
}

export function normalizeBundlephobia(data, requested) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Bundlephobia returned an invalid response');
  }
  for (const field of ['name', 'version', 'size', 'gzip', 'dependencyCount']) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(`Bundlephobia response is missing ${field}`);
    }
  }
  return {
    requested,
    name: String(data.name),
    version: String(data.version),
    size: Number(data.size),
    gzip: Number(data.gzip),
    dependencyCount: Number(data.dependencyCount),
    hasJSModule: Boolean(data.hasJSModule),
    hasJSNext: Boolean(data.hasJSNext),
    hasSideEffects: data.hasSideEffects === null
      ? null
      : Boolean(data.hasSideEffects),
    isModuleType: Boolean(data.isModuleType),
    description: data.description ? String(data.description) : null,
    repository: data.repository ? String(data.repository) : null,
  };
}

export async function lookupBundlephobia(specifier, options = {}) {
  if (!parseExactNpmSpecifier(specifier)) {
    throw new Error(
      `Use an exact npm version such as react@19.1.1; received ${specifier}`,
    );
  }

  const timeoutMs = options.timeoutMs || 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchImpl = options.fetchImpl || fetch;
    const url = new URL('https://bundlephobia.com/api/size');
    url.searchParams.set('package', specifier);
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'fleet-code-cleanup/1' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Bundlephobia returned HTTP ${response.status}`);
    }
    return normalizeBundlephobia(await response.json(), specifier);
  } finally {
    clearTimeout(timer);
  }
}

function readPackageManifest(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) return null;
  return parsePackageJson(
    readFileSync(manifestPath, 'utf8'),
    manifestPath,
    'WORKTREE',
  );
}

function findPackageManager(startDirectory, gitRoot, packageManifest) {
  const declared = packageManifest?.packageManager;
  if (typeof declared === 'string') {
    const match = /^(pnpm|npm|yarn|bun)@/.exec(declared);
    if (match) {
      return {
        name: match[1],
        source: 'packageManager',
        root: startDirectory,
      };
    }
  }

  const lockfiles = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ];
  let current = startDirectory;

  while (true) {
    const currentManifestPath = path.join(current, 'package.json');
    if (existsSync(currentManifestPath)) {
      try {
        const currentManifest = readPackageManifest(currentManifestPath);
        const currentDeclared = currentManifest?.packageManager;
        if (typeof currentDeclared === 'string') {
          const match = /^(pnpm|npm|yarn|bun)@/.exec(currentDeclared);
          if (match) {
            return {
              name: match[1],
              source: 'packageManager',
              root: current,
            };
          }
        }
      } catch {
        // The dependency comparison reports invalid package manifests.
      }
    }

    for (const [filename, name] of lockfiles) {
      if (existsSync(path.join(current, filename))) {
        return {
          name,
          source: filename,
          root: current,
        };
      }
    }

    if (current === gitRoot) break;
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(`${gitRoot}${path.sep}`)) break;
    current = parent;
  }

  if (packageManifest) {
    return {
      name: 'npm',
      source: 'package.json fallback',
      root: startDirectory,
    };
  }
  return null;
}

function findLocalExecutable(startDirectory, gitRoot, executable) {
  let current = startDirectory;
  while (true) {
    const candidate = path.join(current, 'node_modules', '.bin', executable);
    if (existsSync(candidate)) return candidate;
    if (current === gitRoot) break;
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(`${gitRoot}${path.sep}`)) break;
    current = parent;
  }
  return null;
}

function packageScriptStage(id, label, packageManager, script, cwd, kind) {
  return {
    id,
    label,
    kind,
    status: 'planned',
    command: packageManager.name,
    args: ['run', script],
    cwd,
    source: `package.json#scripts.${script}`,
  };
}

function fixedStage(id, label, status, reason, kind) {
  return {
    id,
    label,
    kind,
    status,
    reason,
    command: null,
    args: [],
  };
}

function scriptInvokes(aggregateCommand, script) {
  const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`(?:npm\\s+run|pnpm\\s+run|pnpm|yarn\\s+run|yarn|bun\\s+run)\\s+${escaped}(?:\\s|$)`),
  ];
  return patterns.some((pattern) => pattern.test(aggregateCommand));
}

export function discoverCleanupPlan(options = {}) {
  const requestedDirectory = realpathSync(
    path.resolve(options.repository || process.cwd()),
  );
  const gitRoot = resolveGitRoot(requestedDirectory);
  const requestedManifestPath = path.join(requestedDirectory, 'package.json');
  const rootManifestPath = path.join(gitRoot, 'package.json');
  const manifestPath = existsSync(requestedManifestPath)
    ? requestedManifestPath
    : existsSync(rootManifestPath)
      ? rootManifestPath
      : null;
  const executionRoot = manifestPath ? path.dirname(manifestPath) : requestedDirectory;
  const packageManifest = readPackageManifest(manifestPath);
  const packageManager = findPackageManager(
    executionRoot,
    gitRoot,
    packageManifest,
  );
  const scripts = packageManifest?.scripts
    && !Array.isArray(packageManifest.scripts)
    && typeof packageManifest.scripts === 'object'
    ? packageManifest.scripts
    : {};
  const allDependencies = {
    ...dependencyMap(packageManifest || {}, 'dependencies'),
    ...dependencyMap(packageManifest || {}, 'devDependencies'),
    ...dependencyMap(packageManifest || {}, 'peerDependencies'),
    ...dependencyMap(packageManifest || {}, 'optionalDependencies'),
  };
  const hasKnipConfig = Boolean(
    packageManifest?.knip
      || KNIP_CONFIG_FILES.some((filename) => existsSync(path.join(executionRoot, filename))),
  );
  const hasKnipDependency = Object.hasOwn(allDependencies, 'knip');
  const localKnip = findLocalExecutable(executionRoot, gitRoot, 'knip');
  const stages = [];

  if (packageManager && typeof scripts['knip:strict'] === 'string') {
    stages.push(packageScriptStage(
      'knip',
      'Knip unused code and dependencies',
      packageManager,
      'knip:strict',
      executionRoot,
      'unused',
    ));
  } else if (packageManager && typeof scripts.knip === 'string') {
    stages.push(packageScriptStage(
      'knip',
      'Knip unused code and dependencies',
      packageManager,
      'knip',
      executionRoot,
      'unused',
    ));
  } else if (localKnip && (hasKnipDependency || hasKnipConfig)) {
    stages.push({
      id: 'knip',
      label: 'Knip unused code and dependencies',
      kind: 'unused',
      status: 'planned',
      command: localKnip,
      args: [],
      cwd: executionRoot,
      source: path.relative(gitRoot, localKnip),
    });
  } else {
    const reason = hasKnipDependency || hasKnipConfig
      ? 'Knip is configured but no installed native command is available'
      : 'No repository-native Knip path was discovered';
    stages.push(fixedStage(
      'knip',
      'Knip unused code and dependencies',
      'unavailable',
      reason,
      'unused',
    ));
  }

  const selectedQualityCommands = [];
  if (packageManager && typeof scripts.check === 'string') {
    stages.push(packageScriptStage(
      'quality:check',
      'Project check',
      packageManager,
      'check',
      executionRoot,
      'quality',
    ));
    selectedQualityCommands.push({
      script: 'check',
      command: scripts.check.trim(),
    });
  }

  if (packageManager) {
    for (const script of SAFE_FOCUSED_SCRIPTS) {
      if (typeof scripts[script] !== 'string') continue;
      const command = scripts[script].trim();
      const duplicate = selectedQualityCommands.find((selected) => (
        selected.command === command
          || scriptInvokes(selected.command, script)
      ));
      if (duplicate) {
        stages.push(fixedStage(
          `quality:${script}`,
          `Project ${script}`,
          'skipped',
          `Duplicated or explicitly covered by the ${duplicate.script} script`,
          'quality',
        ));
      } else {
        stages.push(packageScriptStage(
          `quality:${script}`,
          `Project ${script}`,
          packageManager,
          script,
          executionRoot,
          'quality',
        ));
        selectedQualityCommands.push({ script, command });
      }
    }
  }

  if (selectedQualityCommands.length === 0) {
    stages.push(fixedStage(
      'quality',
      'Project-native quality checks',
      'unavailable',
      packageManager
        ? 'No safe aggregate or focused quality scripts were discovered'
        : 'No package manager and safe project-native quality scripts were discovered',
      'quality',
    ));
  }

  if (
    typeof scripts.format === 'string'
    && typeof scripts['format:check'] !== 'string'
  ) {
    stages.push(fixedStage(
      'quality:format',
      'Project format',
      'skipped',
      'Write-mode format scripts are never run by code cleanup',
      'quality',
    ));
  }

  stages.push({
    id: 'git-diff-check',
    label: 'Git whitespace and conflict-marker check',
    kind: 'git',
    status: 'planned',
    command: 'git',
    args: ['diff', '--check', 'HEAD', '--', '.'],
    cwd: requestedDirectory,
    source: 'git diff --check',
  });

  return {
    repository: gitRoot,
    executionRoot,
    packageManifest: manifestPath
      ? path.relative(gitRoot, manifestPath) || 'package.json'
      : null,
    packageManager,
    stages,
  };
}

function truncateOutput(value) {
  const normalized = String(value || '').trim();
  if (normalized.length <= MAX_CAPTURED_OUTPUT) return normalized;
  return `[output truncated to final ${MAX_CAPTURED_OUTPUT} characters]\n${
    normalized.slice(-MAX_CAPTURED_OUTPUT)
  }`;
}

export function executeRawCommand(stage, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
  const result = spawnSync(stage.command, stage.args, {
    cwd: stage.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  return {
    ...stage,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? errorRecord(result.error, 'ERR_CLEANUP_COMMAND') : null,
  };
}

export function executeCleanupStage(stage, options = {}) {
  if (stage.status !== 'planned') return { ...stage };

  const result = executeRawCommand(stage, options);
  const output = truncateOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
  const passed = !result.error && result.exitCode === 0;

  return {
    ...result,
    status: passed ? 'passed' : 'failed',
    output,
    stdout: undefined,
    stderr: undefined,
  };
}

function extractJsonObject(value) {
  const text = String(value || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Package manager did not return a JSON object');
  }
  return {
    data: JSON.parse(text.slice(start, end + 1)),
    prefix: text.slice(0, start).trim(),
    suffix: text.slice(end + 1).trim(),
  };
}

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function classifyVersionChange(current, target) {
  const before = versionParts(current);
  const after = versionParts(target);
  if (!before || !after) return 'unknown';
  if (before.major !== after.major) return 'major';
  if (before.minor !== after.minor) return 'minor';
  if (before.patch !== after.patch) return 'patch';
  return 'none';
}

function isConservativeUpgrade(current, target) {
  const before = versionParts(current);
  const after = versionParts(target);
  if (!before || !after || before.major !== after.major) return false;
  if (before.major === 0 && before.minor !== after.minor) return false;
  return (
    after.minor > before.minor
      || (after.minor === before.minor && after.patch > before.patch)
  );
}

function compareVersions(left, right) {
  const before = versionParts(left);
  const after = versionParts(right);
  if (!before || !after) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (before[key] !== after[key]) return Math.sign(after[key] - before[key]);
  }
  return 0;
}

function dependencyGroupFor(packageManifest, name) {
  for (const group of DEPENDENCY_GROUPS) {
    const dependencies = dependencyMap(packageManifest || {}, group);
    if (Object.hasOwn(dependencies, name)) {
      return {
        group,
        declared: String(dependencies[name]),
      };
    }
  }
  return {
    group: null,
    declared: null,
  };
}

export function normalizeOutdatedData(data, packageManifest = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Outdated response must be a JSON object');
  }

  return Object.entries(data).map(([name, value]) => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
    const wanted = record.wanted == null
      ? record.update == null ? null : String(record.update)
      : String(record.wanted);
    // pnpm omits `current` when node_modules is absent. `wanted` is still the
    // lockfile/manifest-compatible baseline and is safe to use for semver
    // classification without installing the repository first.
    const current = record.current == null ? wanted : String(record.current);
    const latest = record.latest == null ? null : String(record.latest);
    const manifest = dependencyGroupFor(packageManifest, name);
    let safeTarget = null;
    if (current && latest && isConservativeUpgrade(current, latest)) {
      safeTarget = latest;
    } else if (current && wanted && isConservativeUpgrade(current, wanted)) {
      safeTarget = wanted;
    }

    return {
      name,
      current,
      wanted,
      latest,
      safeTarget,
      latestChange: classifyVersionChange(current, latest),
      dependencyType: record.dependencyType || record.type || manifest.group,
      declared: manifest.declared,
      deprecated: Boolean(record.isDeprecated || record.deprecated),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function outdatedCommand(packageManager, cwd) {
  if (packageManager === 'pnpm') {
    return {
      id: 'outdated',
      label: 'Outdated direct packages',
      command: 'pnpm',
      args: ['outdated', '--format', 'json'],
      cwd,
    };
  }
  if (packageManager === 'npm') {
    return {
      id: 'outdated',
      label: 'Outdated direct packages',
      command: 'npm',
      args: ['outdated', '--json'],
      cwd,
    };
  }
  return null;
}

export async function checkOutdated(options = {}) {
  const plan = options.plan || discoverCleanupPlan(options);
  const manager = plan.packageManager?.name || null;
  const manifestPath = plan.packageManifest
    ? path.join(plan.repository, plan.packageManifest)
    : null;
  const packageManifest = readPackageManifest(manifestPath);
  const stage = manager ? outdatedCommand(manager, plan.executionRoot) : null;

  if (!packageManifest || !manager) {
    return {
      status: 'unavailable',
      packageManager: manager,
      packages: [],
      summary: { total: 0, safe: 0, major: 0, deprecated: 0 },
      reason: 'No package manifest and package manager were discovered',
    };
  }
  if (!stage) {
    return {
      status: 'unavailable',
      packageManager: manager,
      packages: [],
      summary: { total: 0, safe: 0, major: 0, deprecated: 0 },
      reason: `${manager} does not expose a stable non-interactive JSON outdated report`,
    };
  }

  const runner = options.commandRunner || executeRawCommand;
  const result = await runner(stage, { timeoutMs: options.timeoutMs });
  if (result.error) {
    return {
      ...stage,
      status: 'failed',
      packageManager: manager,
      packages: [],
      summary: { total: 0, safe: 0, major: 0, deprecated: 0 },
      error: result.error,
      timedOut: result.timedOut,
    };
  }

  try {
    const parsed = extractJsonObject(result.stdout || result.output);
    const packages = normalizeOutdatedData(parsed.data, packageManifest);
    return {
      ...stage,
      status: 'passed',
      packageManager: manager,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      packages,
      summary: {
        total: packages.length,
        safe: packages.filter((item) => item.safeTarget).length,
        major: packages.filter((item) => item.latestChange === 'major').length,
        deprecated: packages.filter((item) => item.deprecated).length,
      },
      warnings: [parsed.prefix, parsed.suffix].filter(Boolean),
    };
  } catch (error) {
    return {
      ...stage,
      status: 'failed',
      packageManager: manager,
      exitCode: result.exitCode,
      packages: [],
      summary: { total: 0, safe: 0, major: 0, deprecated: 0 },
      error: errorRecord(error, 'ERR_OUTDATED_JSON'),
      output: truncateOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
    };
  }
}

function auditCommand(packageManager, cwd) {
  const commands = {
    pnpm: ['audit', '--json'],
    npm: ['audit', '--json'],
    yarn: ['npm', 'audit', '--json'],
    bun: ['audit', '--json'],
  };
  const args = commands[packageManager];
  if (!args) return null;
  return {
    id: 'audit',
    label: 'Dependency vulnerability audit',
    command: packageManager,
    args,
    cwd,
  };
}

function auditVulnerabilityCounts(data) {
  const counts = data?.metadata?.vulnerabilities;
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    const normalized = {};
    for (const [severity, count] of Object.entries(counts)) {
      if (severity === 'total' || !Number.isFinite(Number(count))) continue;
      normalized[severity] = Number(count);
    }
    return normalized;
  }
  if (data?.advisories && typeof data.advisories === 'object') {
    return { total: Object.keys(data.advisories).length };
  }
  if (data?.vulnerabilities && typeof data.vulnerabilities === 'object') {
    return { total: Object.keys(data.vulnerabilities).length };
  }
  return {};
}

export async function checkAudit(options = {}) {
  const plan = options.plan || discoverCleanupPlan(options);
  const manager = plan.packageManager?.name || null;
  const stage = manager ? auditCommand(manager, plan.executionRoot) : null;
  if (!stage) {
    return {
      status: 'unavailable',
      packageManager: manager,
      vulnerabilities: {},
      reason: 'No supported package-manager audit command was discovered',
    };
  }

  const runner = options.commandRunner || executeRawCommand;
  const result = await runner(stage, { timeoutMs: options.timeoutMs });
  let parsed = null;
  try {
    parsed = extractJsonObject(result.stdout || result.output).data;
  } catch {
    // Some package-manager versions return human output; preserve it below.
  }
  const failed = Boolean(result.error) || result.exitCode !== 0;
  return {
    ...stage,
    status: failed ? 'failed' : 'passed',
    packageManager: manager,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    vulnerabilities: auditVulnerabilityCounts(parsed),
    error: result.error || (
      failed
        ? {
            code: 'ERR_DEPENDENCY_AUDIT',
            message: 'The package-manager audit reported vulnerabilities or failed',
          }
        : null
    ),
    output: failed
      ? truncateOutput([result.stdout, result.stderr].filter(Boolean).join('\n'))
      : '',
  };
}

function requestedPackage(value) {
  const exact = parseExactNpmSpecifier(value);
  return exact
    ? { name: exact.name, target: exact.version }
    : { name: value, target: null };
}

export function selectUpgradePackages(outdated, options = {}) {
  const packages = new Map(outdated.packages.map((item) => [item.name, item]));
  if (options.all) {
    if (options.packages?.length > 0) {
      throw new Error('Choose either repeatable --package values or --all --safe');
    }
    if (!options.safe) {
      throw new Error('--all requires --safe');
    }
    if (options.allowMajor) {
      throw new Error('Major upgrades must name packages explicitly; do not combine --all and --allow-major');
    }
    return outdated.packages
      .filter((item) => item.safeTarget)
      .map((item) => ({
        ...item,
        target: item.safeTarget,
        change: classifyVersionChange(item.current, item.safeTarget),
      }));
  }

  if (!options.packages || options.packages.length === 0) {
    throw new Error('upgrade requires repeatable --package values or --all --safe');
  }

  const selected = [];
  for (const raw of options.packages) {
    const request = requestedPackage(raw);
    const item = packages.get(request.name);
    if (!item) {
      throw new Error(`${request.name} is not an outdated direct dependency`);
    }
    const target = request.target || (
      options.allowMajor ? item.latest : item.safeTarget
    );
    if (!target) {
      throw new Error(
        `${request.name} has no conservative update; name an exact version and use --allow-major if intended`,
      );
    }
    const change = classifyVersionChange(item.current, target);
    if (change === 'major' && !options.allowMajor) {
      throw new Error(`${request.name}@${target} is a major upgrade; add --allow-major`);
    }
    if (change === 'unknown') {
      throw new Error(`${request.name} has non-semver versions and cannot be upgraded automatically`);
    }
    if ((compareVersions(item.current, target) ?? 0) <= 0) {
      throw new Error(`${request.name}@${target} is not newer than ${item.current}`);
    }
    selected.push({
      ...item,
      target,
      change,
    });
  }
  return selected.sort((left, right) => left.name.localeCompare(right.name));
}

function npmSaveFlags(item) {
  const flags = {
    devDependencies: '--save-dev',
    optionalDependencies: '--save-optional',
    peerDependencies: '--save-peer',
    dependencies: '--save-prod',
  };
  const result = [flags[item.dependencyType] || '--save-prod'];
  if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(item.declared || '')) {
    result.push('--save-exact');
  } else if (String(item.declared || '').startsWith('~')) {
    result.push('--save-prefix=~');
  } else if (String(item.declared || '').startsWith('^')) {
    result.push('--save-prefix=^');
  }
  return result;
}

export function buildUpgradeCommands(packageManager, selections, cwd) {
  const specs = selections.map((item) => `${item.name}@${item.target}`);
  if (specs.length === 0) return [];
  if (packageManager === 'pnpm') {
    return [{
      id: 'upgrade:pnpm',
      label: 'Apply pnpm dependency upgrades',
      command: 'pnpm',
      args: ['update', ...specs, '--ignore-scripts'],
      cwd,
    }];
  }
  if (packageManager === 'yarn') {
    return [{
      id: 'upgrade:yarn',
      label: 'Apply Yarn dependency upgrades',
      command: 'yarn',
      args: ['up', ...specs, '--mode=skip-build'],
      cwd,
    }];
  }
  if (packageManager === 'bun') {
    return [{
      id: 'upgrade:bun',
      label: 'Apply Bun dependency upgrades',
      command: 'bun',
      args: ['update', ...specs, '--ignore-scripts'],
      cwd,
    }];
  }
  if (packageManager === 'npm') {
    return selections.map((item) => ({
      id: `upgrade:npm:${item.name}`,
      label: `Apply npm dependency upgrade for ${item.name}`,
      command: 'npm',
      args: [
        'install',
        `${item.name}@${item.target}`,
        ...npmSaveFlags(item),
        '--ignore-scripts',
      ],
      cwd,
    }));
  }
  throw new Error(`Unsupported package manager for upgrades: ${packageManager}`);
}

function dirtyDependencyFiles(plan) {
  const absolutePaths = [];
  if (plan.packageManifest) {
    absolutePaths.push(path.join(plan.repository, plan.packageManifest));
  }
  const managerRoot = plan.packageManager?.root || plan.executionRoot;
  for (const filename of NODE_LOCKFILES) {
    const candidate = path.join(managerRoot, filename);
    if (existsSync(candidate)) absolutePaths.push(candidate);
  }
  const relativePaths = absolutePaths.map((absolutePath) => (
    path.relative(plan.repository, absolutePath)
  ));
  if (relativePaths.length === 0) return [];
  return git(plan.repository, [
    'status',
    '--porcelain',
    '--',
    ...relativePaths,
  ]).trim().split('\n').filter(Boolean);
}

export async function upgradePackages(options = {}) {
  const plan = discoverCleanupPlan(options);
  if (!plan.packageManifest || !plan.packageManager) {
    throw new Error('No package manifest and package manager were discovered');
  }
  const outdated = options.outdated || await checkOutdated({
    plan,
    timeoutMs: options.timeoutMs,
    commandRunner: options.outdatedRunner,
  });
  if (outdated.status !== 'passed') {
    throw new Error(outdated.error?.message || outdated.reason || 'Outdated check failed');
  }
  const selections = selectUpgradePackages(outdated, {
    all: options.all,
    safe: options.safe,
    allowMajor: options.allowMajor,
    packages: options.packages,
  });
  const commands = buildUpgradeCommands(
    plan.packageManager.name,
    selections,
    plan.executionRoot,
  );
  const report = {
    schemaVersion: SCHEMA_VERSION,
    command: 'upgrade',
    ok: true,
    applied: false,
    repository: plan.repository,
    executionRoot: plan.executionRoot,
    packageManager: plan.packageManager,
    selections,
    commands,
    applyResults: [],
    cleanup: null,
  };
  if (!options.apply || selections.length === 0) return report;

  const dirty = dirtyDependencyFiles(plan);
  if (dirty.length > 0) {
    throw new Error(
      `Refusing to upgrade with existing manifest or lockfile changes:\n${dirty.join('\n')}`,
    );
  }

  const runner = options.commandRunner || executeRawCommand;
  for (const command of commands) {
    const result = await runner(command, { timeoutMs: options.timeoutMs });
    const passed = !result.error && result.exitCode === 0;
    report.applyResults.push({
      ...command,
      status: passed ? 'passed' : 'failed',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      error: result.error,
      output: truncateOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
    });
    if (!passed) {
      report.ok = false;
      return report;
    }
  }
  report.applied = true;
  const cleanupRunner = options.cleanupRunner || runCleanup;
  report.cleanup = await cleanupRunner({
    repository: plan.executionRoot,
    timeoutMs: options.timeoutMs,
    bundlephobia: options.bundlephobia,
    skipOutdated: true,
    ignoreDependencyReview: true,
  });
  report.ok = report.cleanup.ok;
  return report;
}

function cleanupSummary(
  dependency,
  checks,
  bundlephobia,
  outdated,
  audit,
  options = {},
) {
  const count = (status) => checks.filter((check) => check.status === status).length;
  const health = [outdated, audit];
  const healthCount = (status) => (
    health.filter((item) => item.status === status).length
  );
  const bundleFailures = bundlephobia.filter((lookup) => lookup.status === 'failed').length;
  const localFailures = count('failed');
  const outdatedAction = outdated.status === 'passed' && outdated.summary.total > 0;
  const dependencyAction = !options.ignoreDependencyReview && dependency.requiresReview;
  const actionRequired = dependencyAction
    || !dependency.ok
    || localFailures > 0
    || bundleFailures > 0
    || outdatedAction
    || audit.status === 'failed';

  return {
    actionRequired,
    dependencyReviewRequired: dependency.requiresReview,
    passed: count('passed') + healthCount('passed'),
    failed: localFailures + healthCount('failed'),
    unavailable: count('unavailable') + healthCount('unavailable'),
    skipped: count('skipped') + healthCount('skipped'),
    bundlephobiaRequested: bundlephobia.length,
    bundlephobiaFailed: bundleFailures,
    outdated: outdated.summary.total,
    safeUpgrades: outdated.summary.safe,
    majorUpgrades: outdated.summary.major,
    auditStatus: audit.status,
  };
}

export async function runCleanup(options = {}) {
  const plan = discoverCleanupPlan(options);
  const dependency = checkReport({
    repository: plan.repository,
    base: options.base,
    head: options.head,
  });
  const outdated = options.skipOutdated
    ? {
        status: 'skipped',
        packageManager: plan.packageManager?.name || null,
        packages: [],
        summary: { total: 0, safe: 0, major: 0, deprecated: 0 },
        reason: 'Skipped by operator',
      }
    : await checkOutdated({
        plan,
        timeoutMs: options.timeoutMs,
        commandRunner: options.dependencyRunner,
      });
  const audit = options.skipAudit
    ? {
        status: 'skipped',
        packageManager: plan.packageManager?.name || null,
        vulnerabilities: {},
        reason: 'Skipped by operator',
      }
    : await checkAudit({
        plan,
        timeoutMs: options.timeoutMs,
        commandRunner: options.dependencyRunner,
      });
  const commandRunner = options.commandRunner || executeCleanupStage;
  const checks = [];

  for (const stage of plan.stages) {
    checks.push(await commandRunner(stage, {
      timeoutMs: options.timeoutMs,
    }));
  }

  const bundlephobia = [];
  const lookup = options.bundleLookup || lookupBundlephobia;
  for (const specifier of options.bundlephobia || []) {
    try {
      bundlephobia.push({
        specifier,
        status: 'passed',
        result: await lookup(specifier, {
          timeoutMs: options.timeoutMs,
        }),
      });
    } catch (error) {
      bundlephobia.push({
        specifier,
        status: 'failed',
        error: errorRecord(error, 'ERR_BUNDLEPHOBIA'),
      });
    }
  }

  const summary = cleanupSummary(
    dependency,
    checks,
    bundlephobia,
    outdated,
    audit,
    { ignoreDependencyReview: options.ignoreDependencyReview },
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'run',
    ok: !summary.actionRequired,
    repository: plan.repository,
    executionRoot: plan.executionRoot,
    base: dependency.base,
    head: dependency.head,
    summary,
    coverage: {
      packageManifest: plan.packageManifest,
      packageManager: plan.packageManager,
    },
    dependency,
    outdated,
    audit,
    checks,
    bundlephobia,
  };
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatFinding(finding) {
  const lines = [
    `    ${finding.path} (${finding.ecosystem} ${finding.fileType})`,
  ];
  for (const change of finding.changes) {
    if (change.change === 'added') {
      lines.push(`      + ${change.group} ${change.name}: ${change.after}`);
    } else if (change.change === 'removed') {
      lines.push(`      - ${change.group} ${change.name}: ${change.before}`);
    } else {
      lines.push(
        `      ~ ${change.group} ${change.name}: ${change.before} -> ${change.after}`,
      );
    }
  }
  if (finding.manualReview && finding.changes.length === 0) {
    lines.push('      ! manual dependency review required');
  }
  return lines;
}

function printGuardReport(report) {
  const state = report.requiresReview ? 'REVIEW REQUIRED' : 'CLEAN';
  console.log(
    `Dependency guard: ${state} — ${report.summary.changedFiles} changed dependency file(s), `
      + `${report.summary.directChanges} direct npm change(s), ${report.summary.errors} error(s)`,
  );

  for (const repository of report.repositories) {
    if (repository.findings.length === 0 && repository.errors.length === 0) continue;
    const ids = repository.projectIds.length > 0
      ? ` [${repository.projectIds.join(', ')}]`
      : '';
    console.log(`  ${repository.repository}${ids}`);
    for (const finding of repository.findings) {
      for (const line of formatFinding(finding)) console.log(line);
    }
    for (const error of repository.errors) {
      console.log(`    ! ${error.path || 'repository'}: ${error.message}`);
    }
  }

  if (report.skipped.length > 0) {
    console.log(`  Skipped registered checkouts: ${report.skipped.length}`);
    for (const skipped of report.skipped) {
      console.log(`    - ${skipped.projectId}: ${skipped.reason} (${skipped.path})`);
    }
  }
  if (report.excluded?.length > 0) {
    console.log(`  Excluded catalog identities: ${report.excluded.length}`);
    for (const excluded of report.excluded) {
      console.log(`    - ${excluded.projectId}: ${excluded.reason}`);
    }
  }
}

function printLookup(result) {
  console.log(`${result.name}@${result.version}`);
  console.log(`  minified: ${formatBytes(result.size)}`);
  console.log(`  gzip: ${formatBytes(result.gzip)}`);
  console.log(`  dependencies: ${result.dependencyCount}`);
  console.log(`  JS module: ${result.hasJSModule ? 'yes' : 'no'}`);
  console.log(`  package type module: ${result.isModuleType ? 'yes' : 'no'}`);
  console.log(
    `  side effects: ${result.hasSideEffects === null ? 'unknown' : result.hasSideEffects ? 'yes' : 'no'}`,
  );
  if (result.repository) console.log(`  repository: ${result.repository}`);
}

function commandDisplay(check) {
  if (!check.command) return null;
  return [check.command, ...(check.args || [])].join(' ');
}

function formatOutdatedPackage(item) {
  const target = item.safeTarget || item.latest || item.wanted || '?';
  const gate = item.safeTarget ? 'conservative' : item.latestChange;
  return `${item.name}: ${item.current || '?'} -> ${target} (${gate})`;
}

function printOutdatedReport(report) {
  const state = report.status === 'passed'
    ? report.summary.total > 0 ? 'UPDATES AVAILABLE' : 'CURRENT'
    : report.status.toUpperCase();
  console.log(
    `Package freshness: ${state} — ${report.summary.total} outdated, `
      + `${report.summary.safe} conservative, ${report.summary.major} major`,
  );
  if (report.reason) console.log(`  ${report.reason}`);
  for (const item of report.packages) {
    console.log(`  - ${formatOutdatedPackage(item)}`);
  }
  for (const warning of report.warnings || []) {
    console.log(`  ! ${warning}`);
  }
  if (report.error?.message) console.log(`  ! ${report.error.message}`);
}

function printAuditReport(report, indent = '') {
  const counts = Object.entries(report.vulnerabilities || {})
    .map(([severity, count]) => `${severity}=${count}`)
    .join(', ');
  console.log(
    `${indent}Dependency audit: ${report.status}`
      + (counts ? ` (${counts})` : ''),
  );
  if (report.reason) console.log(`${indent}  ${report.reason}`);
  if (report.error?.message) console.log(`${indent}  ${report.error.message}`);
}

function printUpgradeReport(report) {
  const state = report.applied
    ? report.ok ? 'APPLIED' : 'APPLIED WITH FAILURES'
    : 'PREVIEW';
  console.log(`Package upgrade: ${state} — ${report.selections.length} package(s)`);
  console.log(`  Repository: ${report.executionRoot}`);
  for (const item of report.selections) {
    console.log(
      `  - ${item.name}: ${item.current} -> ${item.target} (${item.change}, ${item.dependencyType})`,
    );
  }
  if (!report.applied && report.selections.length > 0) {
    console.log('  Re-run with --apply to modify the manifest and lockfile.');
  }
  for (const result of report.applyResults) {
    console.log(`  ${result.status === 'passed' ? '✓' : '×'} ${result.label}: ${result.status}`);
    if (result.status === 'failed' && result.output) {
      for (const line of result.output.split('\n')) console.log(`    ${line}`);
    }
  }
  if (report.cleanup) {
    console.log(
      `  Post-upgrade cleanup: ${report.cleanup.ok ? 'passed' : 'failed'} — `
        + `${report.cleanup.summary.passed} passed, ${report.cleanup.summary.failed} failed`,
    );
  }
}

function printCleanupReport(report) {
  const state = report.summary.actionRequired ? 'ACTION REQUIRED' : 'NO ACTION';
  console.log(
    `Code cleanup: ${state} — ${report.summary.passed} passed, `
      + `${report.summary.failed} failed, ${report.summary.unavailable} unavailable, `
      + `${report.summary.skipped} skipped`,
  );
  console.log(`  Repository: ${report.executionRoot}`);
  const dependencyState = report.dependency.requiresReview
    ? 'REVIEW REQUIRED'
    : 'CLEAN';
  console.log(
    `  Dependencies: ${dependencyState} — `
      + `${report.dependency.summary.changedFiles} changed dependency file(s), `
      + `${report.dependency.summary.directChanges} direct npm change(s)`,
  );

  for (const repository of report.dependency.repositories) {
    for (const finding of repository.findings) {
      for (const line of formatFinding(finding)) console.log(line);
    }
    for (const error of repository.errors) {
      console.log(`    ! ${error.path || 'repository'}: ${error.message}`);
    }
  }

  console.log(
    `  Outdated packages: ${report.outdated.status} — `
      + `${report.outdated.summary.total} total, `
      + `${report.outdated.summary.safe} conservative, `
      + `${report.outdated.summary.major} major`,
  );
  for (const item of report.outdated.packages) {
    console.log(`    - ${formatOutdatedPackage(item)}`);
  }
  if (report.outdated.reason) console.log(`    ${report.outdated.reason}`);
  if (report.outdated.error?.message) {
    console.log(`    ! ${report.outdated.error.message}`);
  }
  printAuditReport(report.audit, '  ');

  console.log('  Checks:');
  for (const check of report.checks) {
    const icon = {
      passed: '✓',
      failed: '×',
      unavailable: '○',
      skipped: '↷',
    }[check.status] || '?';
    const command = commandDisplay(check);
    console.log(
      `    ${icon} ${check.label}: ${check.status}`
        + (command ? ` (${command})` : ''),
    );
    if (check.reason) console.log(`      ${check.reason}`);
    if (check.timedOut) console.log('      Command timed out');
    if (check.error?.message) console.log(`      ${check.error.message}`);
    if (check.status === 'failed' && check.output) {
      for (const line of check.output.split('\n')) console.log(`      ${line}`);
    }
  }

  if (report.bundlephobia.length > 0) {
    console.log('  Bundlephobia:');
    for (const lookup of report.bundlephobia) {
      if (lookup.status === 'passed') {
        console.log(
          `    ✓ ${lookup.specifier}: ${formatBytes(lookup.result.gzip)} gzip, `
            + `${lookup.result.dependencyCount} dependencies`,
        );
      } else {
        console.log(`    × ${lookup.specifier}: ${lookup.error.message}`);
      }
    }
  } else {
    console.log('  Bundlephobia: skipped (no explicit public browser package supplied)');
  }
}

function usage() {
  return `Usage:
  code-cleanup.mjs run [--repo PATH] [--base REF] [--head REF]
    [--bundlephobia package@exact-version ...] [--skip-outdated] [--skip-audit]
    [--timeout-ms N] [--json]
  code-cleanup.mjs outdated [--repo PATH] [--timeout-ms N] [--json]
  code-cleanup.mjs upgrade --repo PATH
    (--package NAME[@VERSION] ... | --all --safe)
    [--allow-major] [--apply] [--bundlephobia package@exact-version ...]
    [--timeout-ms N] [--json]
  code-cleanup.mjs check [--repo PATH] [--base REF] [--head REF] [--strict] [--json]
  code-cleanup.mjs fleet [--fleet-root PATH] [--base REF] [--head REF] [--strict] [--json]
  code-cleanup.mjs lookup <package@exact-version> [--timeout-ms N] [--json]

Defaults compare HEAD with the current worktree. --strict exits non-zero when
direct npm dependencies, opaque manifests, or lockfiles changed, or parsing
failed. Run checks package freshness and vulnerabilities, then executes
configured Knip, native quality scripts, and git diff --check. Upgrade is a
preview unless --apply is supplied; bulk upgrades require --all --safe and
never include majors. Bundlephobia only receives exact public browser package
specifiers supplied explicitly by the operator.`;
}

export function parseCliArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {
    command: command === '--help' || command === '-h' ? 'help' : command,
    positionals: [],
    bundlephobia: [],
    packages: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--all') options.all = true;
    else if (argument === '--safe') options.safe = true;
    else if (argument === '--allow-major') options.allowMajor = true;
    else if (argument === '--skip-outdated') options.skipOutdated = true;
    else if (argument === '--skip-audit') options.skipAudit = true;
    else if (argument === '--bundlephobia') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--bundlephobia requires an exact public npm package specifier');
      }
      options.bundlephobia.push(value);
      index += 1;
    }
    else if (argument === '--package') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--package requires a direct package name or exact version');
      }
      options.packages.push(value);
      index += 1;
    }
    else if (['--repo', '--base', '--head', '--fleet-root', '--timeout-ms'].includes(argument)) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      options.positionals.push(argument);
    }
  }

  return options;
}

function parseTimeout(value) {
  if (value === undefined) return undefined;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  return timeoutMs;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help || options.command === 'help') {
    console.log(usage());
    return 0;
  }

  try {
    const timeoutMs = parseTimeout(options.timeoutMs);

    if (options.command === 'lookup') {
      const [specifier] = options.positionals;
      if (!specifier || options.positionals.length !== 1) {
        throw new Error('lookup requires one exact npm package specifier');
      }
      const result = await lookupBundlephobia(specifier, {
        timeoutMs,
      });
      const report = {
        schemaVersion: SCHEMA_VERSION,
        command: 'lookup',
        ok: true,
        result,
      };
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printLookup(result);
      return 0;
    }

    if (options.command === 'run') {
      if (options.positionals.length > 0) {
        throw new Error('run does not accept positional arguments');
      }
      const report = await runCleanup({
        repository: options.repo,
        base: options.base,
        head: options.head,
        timeoutMs,
        bundlephobia: options.bundlephobia,
        skipOutdated: options.skipOutdated,
        skipAudit: options.skipAudit,
      });
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printCleanupReport(report);
      return report.ok ? 0 : 1;
    }

    if (options.command === 'outdated') {
      if (options.positionals.length > 0) {
        throw new Error('outdated does not accept positional arguments; use --package with upgrade');
      }
      const report = await checkOutdated({
        repository: options.repo,
        timeoutMs,
      });
      const output = {
        schemaVersion: SCHEMA_VERSION,
        command: 'outdated',
        ok: report.status === 'passed' && report.summary.total === 0,
        repository: options.repo ? path.resolve(options.repo) : process.cwd(),
        ...report,
      };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else printOutdatedReport(report);
      if (report.status !== 'passed') return 2;
      return report.summary.total > 0 ? 1 : 0;
    }

    if (options.command === 'upgrade') {
      if (options.positionals.length > 0) {
        throw new Error('upgrade does not accept positional arguments; use repeatable --package');
      }
      const report = await upgradePackages({
        repository: options.repo,
        packages: options.packages,
        all: options.all,
        safe: options.safe,
        allowMajor: options.allowMajor,
        apply: options.apply,
        timeoutMs,
        bundlephobia: options.bundlephobia,
      });
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printUpgradeReport(report);
      return report.ok ? 0 : 1;
    }

    let report;
    if (options.command === 'check') {
      report = checkReport({
        repository: options.repo,
        base: options.base,
        head: options.head,
      });
    } else if (options.command === 'fleet') {
      report = checkFleet({
        fleetRoot: options.fleetRoot,
        base: options.base,
        head: options.head,
      });
    } else {
      throw new Error(`Unknown command: ${options.command}`);
    }

    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printGuardReport(report);
    if (!report.ok) return 2;
    if (options.strict && report.requiresReview) return 1;
    return 0;
  } catch (error) {
    const failure = {
      schemaVersion: SCHEMA_VERSION,
      command: options.command,
      ok: false,
      error: errorRecord(error),
    };
    if (options.json) console.error(JSON.stringify(failure, null, 2));
    else console.error(`Code cleanup failed: ${failure.error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
