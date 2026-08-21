#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = resolve(SCRIPT_DIR, '../../../../..');
const DEFAULT_REGISTRY = resolve(FLEET_ROOT, 'foundry/ops/config/projects.json');
const DEFAULT_POLICY = resolve(FLEET_ROOT, 'AGENTS.md');
const RETIRED_PATTERN = /\b(retired|dropped|reactivation is required)\b/i;
export const AUTH_MODELS = new Set([
  'required-user',
  'required-service',
  'public-personalized',
  'public-persistent',
]);

function csv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePolicyExclusions(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Out Of Fleet');
  if (start === -1) return [];

  const exclusions = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const match = line.match(/^-\s+`([^`]+)`/);
    if (match) exclusions.push(match[1]);
  }
  return exclusions;
}

export function buildManifest({
  projects,
  policyExclusions = [],
  excludeIds = [],
  onlyIds = [],
  includeRetired = false,
}) {
  const explicitExclusions = new Set(excludeIds);
  const policy = new Set(policyExclusions);
  const only = new Set(onlyIds);
  const included = [];
  const excluded = [];

  for (const project of projects) {
    const reasons = [];
    const domains = Array.isArray(project.domains)
      ? project.domains.filter(Boolean)
      : [];

    if (only.size > 0 && !only.has(project.id)) reasons.push('not selected');
    if (explicitExclusions.has(project.id)) reasons.push('explicit exclusion');
    if (policy.has(project.id)) reasons.push('Fleet policy exclusion');
    if (project.tier === 'out-of-fleet' || project.tier === 'non-product') {
      reasons.push(`tier ${project.tier}`);
    }
    if (project.status !== 'live') reasons.push(`status ${project.status}`);
    if (domains.length === 0) reasons.push('no public domain');
    if (!includeRetired && RETIRED_PATTERN.test(String(project.notes ?? ''))) {
      reasons.push('retired or reactivation-only');
    }

    if (reasons.length > 0) {
      excluded.push({ id: project.id, reasons: [...new Set(reasons)] });
      continue;
    }

    if (!AUTH_MODELS.has(project.authModel)) {
      throw new Error(
        `Project "${project.id}" must declare a valid authModel; received ${JSON.stringify(project.authModel)}`,
      );
    }

    included.push({
      id: project.id,
      family: project.family ?? project.id,
      authModel: project.authModel,
      tier: project.tier ?? null,
      repo: project.repo ?? null,
      status: project.status,
      domains,
      urls: domains.map((domain) => `https://${domain}`),
      app: project.app ?? null,
      notes: project.notes ?? '',
      maxSurfaces: 6,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'foundry/ops/config/projects.json',
    filters: {
      only: [...only],
      excluded: [...explicitExclusions],
      includeRetired,
      policyExclusions: [...policy],
    },
    summary: {
      included: included.length,
      excluded: excluded.length,
    },
    products: included,
    excluded,
  };
}

function parseArgs(argv) {
  const options = {
    excludeIds: [],
    onlyIds: [],
    includeRetired: false,
    format: 'json',
    registryPath: DEFAULT_REGISTRY,
    policyPath: DEFAULT_POLICY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--exclude') options.excludeIds = csv(argv[++index]);
    else if (arg === '--only') options.onlyIds = csv(argv[++index]);
    else if (arg === '--include-retired') options.includeRetired = true;
    else if (arg === '--format') options.format = argv[++index];
    else if (arg === '--registry') options.registryPath = resolve(argv[++index]);
    else if (arg === '--policy') options.policyPath = resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['json', 'table'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  return options;
}

function table(manifest) {
  const rows = [
    ['PROJECT', 'AUTH MODEL', 'REPO', 'DOMAINS', 'MAX'],
    ...manifest.products.map((project) => [
      project.id,
      project.authModel,
      project.repo ?? '—',
      project.domains.join(','),
      String(project.maxSurfaces),
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row) =>
      row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd(),
    )
    .join('\n');
}

function usage() {
  return `usage: build-audit-manifest.mjs [options]

Options:
  --exclude id,id       Omit explicit projects
  --only id,id          Include only selected project IDs
  --include-retired     Include retired/reactivation-only live surfaces
  --format json|table   Output format (default: json)
  --registry path       Override projects.json
  --policy path         Override root AGENTS.md
`;
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const registry = JSON.parse(readFileSync(options.registryPath, 'utf8'));
  const policyMarkdown = readFileSync(options.policyPath, 'utf8');
  const manifest = buildManifest({
    projects: registry.projects ?? [],
    policyExclusions: parsePolicyExclusions(policyMarkdown),
    excludeIds: options.excludeIds,
    onlyIds: options.onlyIds,
    includeRetired: options.includeRetired,
  });

  process.stdout.write(
    options.format === 'table'
      ? `${table(manifest)}\n`
      : `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
