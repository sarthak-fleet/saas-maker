#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FLEET_ROOT = resolve(SCRIPT_DIR, '../../../../..');
const CONFIG_PATTERN = /(^|\/)wrangler\.(toml|json|jsonc)$/;
const PACKAGE_PATTERN = /(^|\/)package\.json$/;
const SAFE_ENV_EXAMPLE_PATTERN = /(^|\/)(?:\.env(?:\.[^/]+)?\.example|\.dev\.vars\.example)$/;
const TURSO_PACKAGE_PATTERN = /^(?:@libsql\/|@tursodatabase\/|libsql$)/;
const DATABASE_PROVIDERS = new Set(['cloudflare-d1', 'turso']);
const DATABASE_STATES = new Set(['prepared', 'authoritative', 'rollback-held']);

const SURFACE_DEFINITIONS = [
  { product: 'd1', keys: ['d1_databases'], identifiers: ['database_name', 'binding'] },
  { product: 'r2', keys: ['r2_buckets'], identifiers: ['bucket_name', 'binding'] },
  { product: 'kv', keys: ['kv_namespaces'], identifiers: ['binding'] },
  { product: 'durable-objects', keys: ['durable_objects'], identifiers: ['class_name', 'name', 'binding'] },
  { product: 'queues', keys: ['queues'], identifiers: ['queue', 'queue_name', 'binding'] },
  { product: 'workflows', keys: ['workflows'], identifiers: ['workflow_name', 'class_name', 'binding'] },
  { product: 'vectorize', keys: ['vectorize'], identifiers: ['index_name', 'binding'] },
  { product: 'workers-ai', keys: ['ai'], identifiers: ['binding'] },
  { product: 'hyperdrive', keys: ['hyperdrive'], identifiers: ['binding'] },
  { product: 'analytics-engine', keys: ['analytics_engine_datasets'], identifiers: ['dataset', 'binding'] },
  { product: 'browser-rendering', keys: ['browser'], identifiers: ['binding'] },
  { product: 'images', keys: ['images'], identifiers: ['binding'] },
  { product: 'services', keys: ['services'], identifiers: ['service', 'binding'] },
  { product: 'containers', keys: ['containers'], identifiers: ['class_name', 'name'] },
  { product: 'observability', keys: ['observability', 'logpush'], identifiers: [] },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function argument(argv, name) {
  return argv.find((value, index) => argv[index - 1] === name);
}

function hasConfigKey(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\[\\[?\\s*${escaped}\\s*\\]?|["']?${escaped}["']?\\s*[:=])`, 'i').test(text);
}

function extractValues(text, keys) {
  const values = new Set();
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`["']?${escaped}["']?\\s*[:=]\\s*["']([^"'\\n\\r]+)["']`, 'gi');
    for (const match of text.matchAll(pattern)) values.add(match[1].trim());
  }
  return [...values].sort();
}

function extractTopLevelName(text) {
  return text.match(/^\s*(?:"name"|name)\s*[:=]\s*["']([^"'\n\r]+)["']/m)?.[1]?.trim() ?? null;
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        output += character;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
    } else {
      output += character;
    }
  }
  return output;
}

function stripTrailingCommas(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] ?? '')) lookahead += 1;
      if (text[lookahead] === '}' || text[lookahead] === ']') continue;
    }
    output += character;
  }
  return output;
}

function parseConfigObject(text, configFile) {
  if (!/\.jsonc?$/.test(configFile)) return null;
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
  } catch {
    return null;
  }
}

function valuesFromObject(value, keys, values = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) valuesFromObject(item, keys, values);
    return values;
  }
  if (!value || typeof value !== 'object') return values;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === 'string' && nested.trim()) values.add(nested.trim());
    valuesFromObject(nested, keys, values);
  }
  return values;
}

function tomlSections(text, keys) {
  const headers = [...text.matchAll(/^\s*\[\[?([^\]]+)\]\]?\s*$/gm)]
    .map((match) => ({ name: match[1].trim(), start: match.index, end: match.index + match[0].length }));
  const blocks = [];
  for (const [index, header] of headers.entries()) {
    const leaf = header.name.split('.').at(-1);
    if (!keys.includes(leaf)) continue;
    blocks.push(text.slice(header.end, headers[index + 1]?.start ?? text.length));
  }
  if (blocks.length > 0) return blocks.join('\n');
  return text
    .split('\n')
    .filter((line) => keys.some((key) => new RegExp(`^\\s*${key}\\s*=`).test(line)))
    .join('\n');
}

function trackedFiles(fleetRoot, repoPath) {
  const ownsGit = existsSync(join(repoPath, '.git'));
  const gitRoot = ownsGit ? repoPath : fleetRoot;
  const scope = ownsGit ? null : relative(fleetRoot, repoPath);
  const command = ['-C', gitRoot, 'ls-files', '-z'];
  if (scope && scope !== '.') command.push('--', scope);
  const output = execFileSync('git', command, { encoding: 'utf8' });
  return output
    .split('\0')
    .filter(Boolean)
    .map((file) => scope && scope !== '.' && file.startsWith(`${scope}/`) ? file.slice(scope.length + 1) : file)
    .sort();
}

function declaredProducts(deployKind, files = []) {
  const products = [];
  if (deployKind?.includes('worker')) products.push('workers');
  if (deployKind?.includes('pages')) {
    products.push('pages');
    if (files.some((file) => /(^|\/)(functions\/|_worker\.(?:js|ts)$)/.test(file))) {
      products.push('pages-functions');
    }
  }
  return products;
}

function declaredDatabaseResources(project) {
  const resources = project.databaseResources ?? [];
  if (!Array.isArray(resources)) {
    throw new Error(`Project ${project.id} databaseResources must be an array`);
  }
  const seen = new Set();
  return resources.map((resource) => {
    if (!resource || !DATABASE_PROVIDERS.has(resource.provider)) {
      throw new Error(`Project ${project.id} has an invalid database provider`);
    }
    if (typeof resource.name !== 'string' || resource.name.trim() === '') {
      throw new Error(`Project ${project.id} has a database resource without a name`);
    }
    if (!DATABASE_STATES.has(resource.state)) {
      throw new Error(`Project ${project.id} database ${resource.name} has an invalid state`);
    }
    const key = `${resource.provider}:${resource.name}`;
    if (seen.has(key)) throw new Error(`Project ${project.id} declares duplicate database ${key}`);
    seen.add(key);
    return { provider: resource.provider, name: resource.name, state: resource.state };
  }).sort((left, right) =>
    left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name));
}

function scanTursoSurface(project, repoPath, files) {
  const packageFiles = files.filter((file) => PACKAGE_PATTERN.test(file));
  const dependencyFiles = [];
  for (const file of packageFiles) {
    try {
      const manifest = readJson(join(repoPath, file));
      const dependencyNames = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ];
      if (dependencyNames.some((name) => TURSO_PACKAGE_PATTERN.test(name))) {
        dependencyFiles.push(file);
      }
    } catch {
      // Invalid package manifests are reported by their owning project checks.
    }
  }
  if (dependencyFiles.length === 0) return null;

  const envKeys = new Set();
  const envFiles = [];
  for (const file of files.filter((candidate) => SAFE_ENV_EXAMPLE_PATTERN.test(candidate))) {
    const text = readFileSync(join(repoPath, file), 'utf8');
    let matched = false;
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
      if (!match) continue;
      const name = match[1];
      if (/TURSO|LIBSQL/.test(name) || name === 'DATABASE_URL') {
        envKeys.add(name);
        matched = true;
      }
    }
    if (matched) envFiles.push(file);
  }

  const sourceFiles = [...new Set([...dependencyFiles, ...envFiles])]
    .map((file) => project.repo && project.repo !== '.'
      ? `${project.repo.replace(/\/$/, '')}/${file}`
      : file)
    .sort();
  return {
    product: 'turso',
    sourceFiles,
    identifiers: [...envKeys].sort(),
  };
}

function scanConfig(project, repoPath, configFile) {
  const text = readFileSync(join(repoPath, configFile), 'utf8');
  const configObject = parseConfigObject(text, configFile);
  const sourceFile = project.repo && project.repo !== '.'
    ? `${project.repo.replace(/\/$/, '')}/${configFile}`
    : configFile;
  const surfaces = [];
  for (const definition of SURFACE_DEFINITIONS) {
    const configuredKeys = definition.keys.filter((key) =>
      configObject ? Object.hasOwn(configObject, key) : hasConfigKey(text, key));
    if (configuredKeys.length === 0) continue;
    const identifiers = configObject
      ? [...configuredKeys.reduce(
        (values, key) => valuesFromObject(configObject[key], definition.identifiers, values),
        new Set(),
      )].sort()
      : extractValues(tomlSections(text, configuredKeys), definition.identifiers);
    surfaces.push({
      product: definition.product,
      sourceFile,
      identifiers,
    });
  }
  return {
    path: sourceFile,
    workerName: typeof configObject?.name === 'string' ? configObject.name : extractTopLevelName(text),
    surfaces,
    signals: {
      scheduled: configObject
        ? Array.isArray(configObject.triggers?.crons) && configObject.triggers.crons.length > 0
        : hasConfigKey(text, 'crons'),
      queueConsumer: configObject
        ? Array.isArray(configObject.queues?.consumers) && configObject.queues.consumers.length > 0
        : /\bconsumers\b["']?\s*[:=]/i.test(text),
      workflow: configObject ? Object.hasOwn(configObject, 'workflows') : hasConfigKey(text, 'workflows'),
      cpuLimitConfigured: configObject
        ? Number.isFinite(configObject.limits?.cpu_ms)
        : /\bcpu_ms\b["']?\s*[:=]/i.test(text),
      observabilityConfigured: configObject
        ? Object.hasOwn(configObject, 'observability') || Object.hasOwn(configObject, 'logpush')
        : hasConfigKey(text, 'observability') || hasConfigKey(text, 'logpush'),
    },
  };
}

function mergeSurfaces(configs, declared, additional = []) {
  const merged = new Map();
  for (const product of declared) {
    merged.set(product, { product, sourceFiles: ['projects.json'], identifiers: [] });
  }
  for (const config of configs) {
    for (const surface of config.surfaces) {
      const current = merged.get(surface.product) ?? {
        product: surface.product,
        sourceFiles: [],
        identifiers: [],
      };
      current.sourceFiles = [...new Set([...current.sourceFiles, surface.sourceFile])].sort();
      current.identifiers = [...new Set([...current.identifiers, ...surface.identifiers])].sort();
      merged.set(surface.product, current);
    }
  }
  for (const surface of additional.filter(Boolean)) {
    const current = merged.get(surface.product) ?? {
      product: surface.product,
      sourceFiles: [],
      identifiers: [],
    };
    current.sourceFiles = [...new Set([...current.sourceFiles, ...surface.sourceFiles])].sort();
    current.identifiers = [...new Set([...current.identifiers, ...surface.identifiers])].sort();
    merged.set(surface.product, current);
  }
  return [...merged.values()].sort((left, right) => left.product.localeCompare(right.product));
}

export function scanFleetCostSurfaces({ fleetRoot = DEFAULT_FLEET_ROOT, projectId = null } = {}) {
  const root = resolve(fleetRoot);
  const manifestPath = join(root, 'foundry/ops/config/projects.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Fleet project registry not found: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const selected = (manifest.projects ?? [])
    .filter((project) => !projectId || project.id === projectId)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (projectId && selected.length === 0) throw new Error(`Unknown Fleet project: ${projectId}`);

  const projects = selected.map((project) => {
    const infrastructure = manifest.infrastructure?.projects?.[project.id] ?? {
      deployments: [],
      resources: [],
    };
    const repoPath = project.repo ? resolve(root, project.repo) : null;
    const warnings = [];
    let configs = [];
    let files = [];
    if (repoPath && existsSync(repoPath)) {
      try {
        files = trackedFiles(root, repoPath);
        const configFiles = files.filter((file) => CONFIG_PATTERN.test(file));
        configs = configFiles.map((file) => scanConfig(project, repoPath, file));
      } catch (error) {
        warnings.push(`Tracked-file scan failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (project.repo) {
      warnings.push(`Repository not found: ${project.repo}`);
    }
    const tursoSurface = repoPath && existsSync(repoPath)
      ? scanTursoSurface(project, repoPath, files)
      : null;
    const databaseResources = declaredDatabaseResources(project);
    const declaredDatabaseSurfaces = databaseResources.map((resource) => ({
      product: resource.provider === 'cloudflare-d1' ? 'd1' : 'turso',
      sourceFiles: ['projects.json'],
      identifiers: [resource.name],
    }));
    const declaredInfrastructureSurfaces = infrastructure.resources.map((resource) => ({
      product: resource.provider === 'turso' ? 'turso' : resource.kind,
      sourceFiles: ['projects.json'],
      identifiers: [resource.name],
    }));

    return {
      id: project.id,
      family: project.family ?? project.id,
      tier: project.tier ?? 'unknown',
      priority: project.portfolio?.priority ?? null,
      status: project.status ?? 'unknown',
      repo: project.repo ?? null,
      deployKind: project.deployKind ?? 'unknown',
      declared: {
        cloudflareProject: project.cfProject ?? null,
        pagesProjects: [...(project.cfPages ?? [])].sort(),
        d1Databases: [...(project.d1Databases ?? [])].sort(),
        tursoDatabases: [...(project.tursoDatabases ?? [])].sort(),
        databaseResources,
        deployments: infrastructure.deployments,
        cloudResources: infrastructure.resources,
        domains: [...(project.domains ?? [])].sort(),
      },
      costSurfaces: mergeSurfaces(
        configs,
        declaredProducts(project.deployKind, files),
        [tursoSurface, ...declaredDatabaseSurfaces, ...declaredInfrastructureSurfaces],
      ),
      configs: configs.map((config) => ({
        path: config.path,
        workerName: config.workerName,
        signals: config.signals,
      })),
      evidence: 'configuration-only',
      warnings,
    };
  });

  return {
    schemaVersion: 1,
    evidence: 'configuration-only',
    scope: { projectId, projectCount: projects.length },
    projects,
  };
}

function renderHuman(report) {
  const rows = report.projects.map((project) => {
    const products = project.costSurfaces.map((surface) => surface.product).join(', ') || 'none detected';
    return `${project.id}\t${project.status}\t${project.deployKind}\t${products}`;
  });
  return [
    'Cloudflare + Turso cost-surface inventory (configuration only; not usage or billing)',
    'PROJECT\tSTATUS\tDEPLOY\tCONFIGURED SURFACES',
    ...rows,
  ].join('\n');
}

function usage() {
  return 'Usage: scan-cost-surfaces.mjs [--root PATH] [--project ID] [--json]';
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const allowed = new Set(['--root', '--project', '--json']);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    if (!allowed.has(value)) throw new Error(`Unknown option: ${value}`);
    if (value !== '--json') index += 1;
  }
  const report = scanFleetCostSurfaces({
    fleetRoot: argument(argv, '--root') ?? DEFAULT_FLEET_ROOT,
    projectId: argument(argv, '--project') ?? null,
  });
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : renderHuman(report));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
  });
}
