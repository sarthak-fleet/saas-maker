#!/usr/bin/env node

// Audit of the Fleet Microsoft Clarity project registry.
//
// One Clarity project per product is a contract, not a preference: two
// products loading one project ID merge their recordings, heatmaps, and
// settings into a single bucket that cannot be separated afterwards. This
// script reads the committed receipt in config/clarity-projects.json and
// reports three ways that contract breaks — one ID claimed by two products,
// the retired fleet-wide shared project, and a receipt entry whose claim is
// not actually wired in the source it names.
//
// Read-only: it never writes outside this repository, and needs no
// credentials. Sibling checkouts are inspected, never modified.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF_ROOT = resolve(REPOSITORY_ROOT, '..');
const DEFAULT_REGISTRY_PATH = join(REPOSITORY_ROOT, 'config', 'clarity-projects.json');
const DEFAULT_FLEET_ROOT = resolve(REPOSITORY_ROOT, '..', '..');
const DEFAULT_PROJECTS_RELATIVE = join('site-health', 'apps', 'backend', 'config', 'projects.json');

export const CLARITY_ID_PATTERN = /^[a-z0-9]{10}$/;

// Codes an entry may acknowledge as recorded debt. STALE_ACKNOWLEDGEMENT is
// deliberately not acknowledgeable: it is the signal that an acknowledgement
// outlived the problem it described.
export const ACKNOWLEDGEABLE_CODES = Object.freeze([
  'SHARED_CLARITY_ID',
  'LEGACY_SHARED_ID',
  'UNWIRED_CLAIM',
]);
export const FINDING_CODES = Object.freeze([
  ...ACKNOWLEDGEABLE_CODES,
  'STALE_ACKNOWLEDGEMENT',
  'UNDECLARED_CLARITY_ID',
]);

const SKIPPED_DIRECTORIES = new Set([
  '.astro',
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.open-next',
  '.pnpm-store',
  '.svelte-kit',
  '.turbo',
  '.venv',
  '.vercel',
  '.wrangler',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'target',
  'test-results',
  'vendor',
  'venv',
]);

const SURFACE_EXTENSIONS = new Set([
  '.astro',
  '.cjs',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.php',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

// The registry, this script, and its fixtures name the retired ID on purpose;
// finding it there is not a violation.
const SELF_SCAN_EXEMPT = new Set([
  join('config', 'clarity-projects.json'),
  join('scripts', 'clarity-audit.mjs'),
]);
const SELF_SCAN_EXEMPT_PREFIXES = [join('tooling', 'test') + sep, 'test' + sep];
// Test fixtures stand in for live surfaces on purpose; they are never one.
const FIXTURE_SEGMENT = `${sep}test${sep}fixtures${sep}`;

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SOURCE_FILES = 20_000;

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isWrittenReason(value) {
  return typeof value === 'string' && value.trim().length >= 20;
}

export function validateRegistry(value) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, problems: ['registry must be an object'] };
  }
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (value.schema !== 'fleet.clarity-registry.v1') {
    fail('schema must be "fleet.clarity-registry.v1"');
  }
  if (!isIsoDate(value.updatedAt)) fail('updatedAt must be an ISO date');
  if (!CLARITY_ID_PATTERN.test(String(value.legacySharedId ?? ''))) {
    fail('legacySharedId must be a 10-character Clarity project ID');
  }

  if (!Array.isArray(value.projects) || value.projects.length === 0) {
    fail('projects must be a non-empty array');
    return { valid: problems.length === 0, problems };
  }

  const seen = new Set();
  for (const [index, entry] of value.projects.entries()) {
    const label = `projects[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${label} must be an object`);
      continue;
    }
    const name = entry.id ? `${label} (${entry.id})` : label;
    if (!entry.id || typeof entry.id !== 'string') fail(`${label}.id is required`);
    else if (seen.has(entry.id)) fail(`${label} duplicates project id ${entry.id}`);
    else seen.add(entry.id);

    if (!entry.repo || typeof entry.repo !== 'string') {
      fail(`${name}.repo is required so the audit knows where to verify the claim`);
    }

    const wired = entry.wiredFiles;
    if (!Array.isArray(wired) || wired.some((file) => typeof file !== 'string' || !file)) {
      fail(`${name}.wiredFiles must be an array of paths, relative to the Fleet root`);
    }

    if (entry.clarityId === null || entry.clarityId === undefined) {
      if (!isWrittenReason(entry.reason)) {
        fail(`${name} has no Clarity ID, so reason must be a written justification`);
      }
      if (Array.isArray(wired) && wired.length > 0) {
        fail(`${name} lists wired files but claims no Clarity ID`);
      }
    } else if (!CLARITY_ID_PATTERN.test(String(entry.clarityId))) {
      fail(`${name}.clarityId must be 10 lowercase alphanumerics, got ${entry.clarityId}`);
    } else if (Array.isArray(wired) && wired.length === 0 && !isWrittenReason(entry.reason)) {
      fail(`${name} claims a Clarity ID with no wired file and no written reason`);
    }

    if (entry.tag !== undefined && typeof entry.tag !== 'string') {
      fail(`${name}.tag must be a string when present`);
    }

    if (entry.violation !== undefined) {
      const violation = entry.violation;
      if (!violation || typeof violation !== 'object' || Array.isArray(violation)) {
        fail(`${name}.violation must be an object`);
        continue;
      }
      if (!ACKNOWLEDGEABLE_CODES.includes(violation.code)) {
        fail(`${name}.violation.code must be one of: ${ACKNOWLEDGEABLE_CODES.join(', ')}`);
      }
      if (!isIsoDate(violation.recordedAt)) fail(`${name}.violation.recordedAt must be an ISO date`);
      if (!isWrittenReason(violation.reason)) {
        fail(`${name}.violation.reason must be a written justification`);
      }
      if (!isWrittenReason(violation.fix)) {
        fail(`${name}.violation.fix must spell out the change that clears it`);
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

export function loadRegistry(path = DEFAULT_REGISTRY_PATH) {
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const { valid, problems } = validateRegistry(registry);
  if (!valid) {
    throw new Error(`Invalid Clarity registry at ${path}:\n- ${problems.join('\n- ')}`);
  }
  return registry;
}

function finding(code, project, message, extra = {}) {
  return { code, project, message, ...extra };
}

// Registry-only findings. These hold whether or not any checkout is present,
// because the receipt alone already states the contract breach.
export function findRegistryViolations(registry) {
  const findings = [];

  const byClarityId = new Map();
  for (const entry of registry.projects) {
    if (!entry.clarityId) continue;
    const owners = byClarityId.get(entry.clarityId) ?? [];
    owners.push(entry.id);
    byClarityId.set(entry.clarityId, owners);
  }

  for (const [clarityId, owners] of [...byClarityId].sort()) {
    if (owners.length < 2) continue;
    const group = [...owners].sort();
    for (const owner of group) {
      findings.push(
        finding(
          'SHARED_CLARITY_ID',
          owner,
          `Clarity project ${clarityId} is claimed by ${group.length} products (${group.join(', ')}); their sessions merge into one project.`,
          // A shared ID is one fact about a group. A dated record on any member
          // of that group — normally the product that borrowed the ID — covers
          // it, so the product that was borrowed from is not blamed twice.
          { group }
        )
      );
    }
  }

  for (const entry of registry.projects) {
    if (entry.clarityId !== registry.legacySharedId) continue;
    findings.push(
      finding(
        'LEGACY_SHARED_ID',
        entry.id,
        `Claims the retired fleet-wide shared Clarity project ${registry.legacySharedId} instead of a project of its own.`
      )
    );
  }

  return findings;
}

// Verifies each claim against the checkout the registry names. A missing
// checkout is reported as unverified, never as a pass.
export function verifyWiring(registry, fleetRoot) {
  const findings = [];
  const results = [];

  for (const entry of registry.projects) {
    const wiredFiles = entry.wiredFiles ?? [];
    const files = [];
    for (const file of wiredFiles) {
      const path = resolve(fleetRoot, file);
      if (!existsSync(path)) {
        files.push({ path: file, present: false, wired: false, legacy: false });
        findings.push(
          finding('UNWIRED_CLAIM', entry.id, `Declared surface ${file} does not exist in this checkout.`)
        );
        continue;
      }
      let source;
      try {
        source = readFileSync(path, 'utf8');
      } catch (error) {
        files.push({ path: file, present: true, wired: false, legacy: false });
        findings.push(finding('UNWIRED_CLAIM', entry.id, `Declared surface ${file} is unreadable: ${error.message}`));
        continue;
      }
      const wired = Boolean(entry.clarityId) && source.includes(entry.clarityId);
      const legacy = source.includes(registry.legacySharedId);
      files.push({ path: file, present: true, wired, legacy });
      if (!wired) {
        findings.push(
          finding(
            'UNWIRED_CLAIM',
            entry.id,
            `Registry claims Clarity project ${entry.clarityId} in ${file}, but that ID is not present there.`
          )
        );
      }
      if (legacy && entry.clarityId !== registry.legacySharedId) {
        findings.push(
          finding(
            'LEGACY_SHARED_ID',
            entry.id,
            `${file} still loads the retired fleet-wide shared Clarity project ${registry.legacySharedId}.`
          )
        );
      }
    }
    results.push({ id: entry.id, verified: true, files });
  }

  return { findings, results };
}

function walkSurfaces(root, onFile, state = { count: 0, truncated: false }, depth = 0) {
  if (depth > 12 || state.count >= MAX_SOURCE_FILES) {
    if (state.count >= MAX_SOURCE_FILES) state.truncated = true;
    return state;
  }
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return state;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      walkSurfaces(path, onFile, state, depth + 1);
      if (state.truncated) return state;
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SURFACE_EXTENSIONS.has(extension)) continue;
    let size;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size > MAX_SOURCE_BYTES) continue;
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    state.count += 1;
    onFile(path, source);
    if (state.count >= MAX_SOURCE_FILES) {
      state.truncated = true;
      return state;
    }
  }
  return state;
}

// The retired shared ID inside this repository is always fixable from here, so
// it is never acknowledgeable debt. The template that used to hardcode it is
// exactly why this check exists.
export function scanSelfForLegacyId(registry, selfRoot = SELF_ROOT) {
  const hits = [];
  if (!existsSync(selfRoot)) return hits;
  walkSurfaces(selfRoot, (path, source) => {
    if (!source.includes(registry.legacySharedId)) return;
    const relativePath = relative(selfRoot, path);
    const withinTooling = relative(REPOSITORY_ROOT, path);
    if (SELF_SCAN_EXEMPT.has(withinTooling)) return;
    if (SELF_SCAN_EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return;
    hits.push(relativePath);
  });
  return hits.sort();
}

// Optional fleet-wide sweep. It needs a full Fleet checkout, so it is opt-in
// and never part of the committed gate.
export function scanFleetForUndeclared(registry, fleetRoot) {
  const declared = new Set();
  for (const entry of registry.projects) {
    for (const file of entry.wiredFiles ?? []) declared.add(file.split('/').join(sep));
  }
  const byId = new Map(registry.projects.filter((entry) => entry.clarityId).map((entry) => [entry.clarityId, entry.id]));

  const hits = [];
  if (!existsSync(fleetRoot)) return hits;
  const pattern = /clarity\.ms\/tag\/([a-z0-9]{10})|["']clarity["']\s*,\s*["']script["']\s*,\s*["']([a-z0-9]{10})["']/g;
  walkSurfaces(fleetRoot, (path, source) => {
    if (!source.includes('clarity.ms/tag')) return;
    const relativePath = relative(fleetRoot, path);
    if (declared.has(relativePath)) return;
    if (relativePath.includes(FIXTURE_SEGMENT)) return;
    const ids = new Set();
    for (const match of source.matchAll(pattern)) ids.add(match[1] ?? match[2]);
    for (const id of [...ids].sort()) hits.push({ file: relativePath.split(sep).join('/'), clarityId: id, owner: byId.get(id) ?? null });
  });
  return hits;
}

function catalogVisibility(projectsPath) {
  const visibility = new Map();
  if (!projectsPath || !existsSync(projectsPath)) return visibility;
  try {
    const catalog = JSON.parse(readFileSync(projectsPath, 'utf8'));
    for (const entry of catalog.projects ?? []) {
      if (entry?.id) visibility.set(entry.id, entry.repositoryVisibility ?? 'unknown');
    }
  } catch {
    return visibility;
  }
  return visibility;
}

export function auditClarity({
  registry,
  fleetRoot,
  selfRoot = SELF_ROOT,
  visibility = new Map(),
  now = Date.now(),
  strict = false,
  omitPrivate = false,
  scanFleet = false,
}) {
  const warnings = [];
  const findings = [...findRegistryViolations(registry)];

  const fleetPresent = Boolean(fleetRoot) && existsSync(fleetRoot);
  let wiring = { findings: [], results: [] };
  if (fleetPresent) {
    wiring = verifyWiring(registry, fleetRoot);
    findings.push(...wiring.findings);
  } else {
    warnings.push(
      `No Fleet checkout at ${fleetRoot}; registry claims were validated but not verified against source.`
    );
  }

  const selfHits = scanSelfForLegacyId(registry, selfRoot);
  for (const path of selfHits) {
    findings.push(
      finding(
        'LEGACY_SHARED_ID',
        'saas-maker',
        `${path} in this repository still carries the retired fleet-wide shared Clarity project. Fixable here, so it is never recorded as debt.`,
        { inThisRepository: true }
      )
    );
  }

  const undeclared = scanFleet && fleetPresent ? scanFleetForUndeclared(registry, fleetRoot) : [];
  for (const hit of undeclared) {
    findings.push(
      finding(
        'UNDECLARED_CLARITY_ID',
        hit.owner ?? 'unknown',
        `${hit.file} loads Clarity project ${hit.clarityId}${hit.owner ? ` (registered to ${hit.owner})` : ''} but the registry does not record that file.`
      )
    );
    if (hit.clarityId === registry.legacySharedId) {
      findings.push(
        finding('LEGACY_SHARED_ID', hit.owner ?? 'unknown', `${hit.file} loads the retired fleet-wide shared Clarity project.`)
      );
    }
  }

  // An acknowledgement covers one project and one code. Anything else is
  // either new drift or an acknowledgement that outlived its problem.
  const acknowledgements = new Map();
  for (const entry of registry.projects) {
    if (entry.violation) acknowledgements.set(`${entry.id}::${entry.violation.code}`, entry.violation);
  }

  const annotated = findings.map((entry) => {
    const candidates = entry.group ?? [entry.project];
    const acknowledgement = entry.inThisRepository
      ? null
      : (candidates.map((project) => acknowledgements.get(`${project}::${entry.code}`)).find(Boolean) ?? null);
    return {
      ...entry,
      acknowledged: Boolean(acknowledgement),
      ...(acknowledgement ? { recordedAt: acknowledgement.recordedAt, fix: acknowledgement.fix } : {}),
    };
  });

  const observed = new Set(findings.map((entry) => `${entry.project}::${entry.code}`));
  for (const [key, acknowledgement] of acknowledgements) {
    if (observed.has(key)) continue;
    const [project, code] = key.split('::');
    if (!fleetPresent && code === 'UNWIRED_CLAIM') continue;
    annotated.push({
      code: 'STALE_ACKNOWLEDGEMENT',
      project,
      message:
        `Recorded ${code} debt for ${project} is no longer detected. The fix landed — remove the violation record so the receipt stops overstating the problem.`,
      acknowledged: false,
      recordedAt: acknowledgement.recordedAt,
    });
  }

  annotated.sort((a, b) => a.project.localeCompare(b.project) || a.code.localeCompare(b.code));

  const blocking = annotated.filter((entry) => strict || !entry.acknowledged);

  const wiredById = new Map(wiring.results.map((result) => [result.id, result]));
  const results = registry.projects
    .map((entry) => ({
      id: entry.id,
      repo: entry.repo,
      clarityId: entry.clarityId ?? null,
      tag: entry.tag ?? null,
      visibility: visibility.get(entry.id) ?? 'unknown',
      wiredFiles: entry.wiredFiles ?? [],
      verified: fleetPresent,
      files: wiredById.get(entry.id)?.files ?? [],
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.surfaceOwner ? { surfaceOwner: entry.surfaceOwner } : {}),
      ...(entry.violation ? { violation: entry.violation } : {}),
      findings: annotated.filter((item) => item.project === entry.id).map((item) => item.code),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const withheldResults = omitPrivate ? results.filter((result) => result.visibility !== 'public') : [];
  const published = omitPrivate ? results.filter((result) => result.visibility === 'public') : results;

  const distinctIds = new Set(registry.projects.filter((entry) => entry.clarityId).map((entry) => entry.clarityId));

  return {
    schemaVersion: 1,
    schema: 'fleet.clarity-audit.v1',
    generatedAt: new Date(now).toISOString(),
    strict,
    registry: {
      updatedAt: registry.updatedAt,
      legacySharedIdRetired: true,
      projects: registry.projects.length,
      wired: registry.projects.filter((entry) => (entry.wiredFiles ?? []).length > 0).length,
      noSurface: registry.projects.filter((entry) => !entry.clarityId).length,
      distinctClarityIds: distinctIds.size,
    },
    summary: {
      verifiedAgainstSource: fleetPresent,
      findings: annotated.length,
      acknowledged: annotated.filter((entry) => entry.acknowledged).length,
      blocking: blocking.length,
      byCode: Object.fromEntries(
        FINDING_CODES.map((code) => [code, annotated.filter((entry) => entry.code === code).length])
      ),
    },
    warnings,
    findings: annotated,
    blocking,
    ...(omitPrivate
      ? {
        withheld: {
          projects: withheldResults.length,
          note: 'Projects whose repository is not public are counted here but not identified, so a committed report never publishes the private project catalog.',
        },
      }
      : {}),
    results: published,
  };
}

const VALUE_FLAGS = new Set(['--registry', '--fleet-root', '--self-root', '--projects', '--output']);

export function parseArguments(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token] = value;
      index += 1;
    } else if (!token.startsWith('-')) {
      positionals.push(token);
    }
  }
  return { options, positionals };
}

const HELP = `Fleet Clarity project registry audit

Usage:
  clarity-audit.mjs [--registry <file>] [--fleet-root <dir>] [--projects <file>]
                    [--output <file>] [--json] [--check] [--strict]
                    [--scan-fleet] [--omit-private]

Reads config/clarity-projects.json — the receipt of which Microsoft Clarity
project belongs to which Fleet product — and reports:

  SHARED_CLARITY_ID      one Clarity project claimed by two products
  LEGACY_SHARED_ID       the retired fleet-wide shared project, still loaded
  UNWIRED_CLAIM          a receipt entry whose ID is not in the file it names
  STALE_ACKNOWLEDGEMENT  recorded debt whose fix has landed
  UNDECLARED_CLARITY_ID  a tagged surface the receipt does not know about
                         (--scan-fleet only)

A finding matched by a dated violation record on its own entry is recorded
debt: it is reported and does not fail, because the fix lives in another
repository and cannot be applied from here. Once that fix lands the record
goes stale and the audit fails until the receipt is updated. --strict fails on
every finding, acknowledged or not.

The retired shared ID inside this repository is always blocking: it is fixable
here, so it is never acceptable as debt.

--omit-private keeps projects whose repository is not public out of the named
results, so a report can be committed to a public repository without
publishing a private project catalog.

Exit codes:
  0  Report produced, nothing blocking.
  1  A blocking finding, or an invalid registry file.
  2  Usage error.`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return null;
  }

  let options;
  let registry;
  try {
    ({ options } = parseArguments(argv));
    registry = loadRegistry(resolve(options['--registry'] ?? DEFAULT_REGISTRY_PATH));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return null;
  }

  const fleetRoot = resolve(options['--fleet-root'] ?? DEFAULT_FLEET_ROOT);
  const projectsPath = resolve(options['--projects'] ?? join(fleetRoot, DEFAULT_PROJECTS_RELATIVE));

  const report = auditClarity({
    registry,
    fleetRoot,
    selfRoot: resolve(options['--self-root'] ?? SELF_ROOT),
    visibility: catalogVisibility(projectsPath),
    strict: argv.includes('--strict'),
    omitPrivate: argv.includes('--omit-private'),
    scanFleet: argv.includes('--scan-fleet'),
  });

  const output = options['--output'];
  if (output) {
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    const latest = join(dirname(outputPath), 'latest.json');
    if (basename(outputPath) !== 'latest.json') {
      writeFileSync(latest, `${JSON.stringify(report, null, 2)}\n`);
    }
  }

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderText(report, { compact: argv.includes('--check') })}\n`);
  }

  if (report.blocking.length > 0) process.exitCode = 1;
  return report;
}

function renderText(report, { compact = false } = {}) {
  const lines = [
    `Clarity registry audit — receipt updated ${report.registry.updatedAt}${report.strict ? ' (strict)' : ''}`,
    `${report.registry.projects} recorded product(s), ${report.registry.distinctClarityIds} distinct Clarity project(s), `
    + `${report.registry.noSurface} with no Clarity ID`,
    report.summary.verifiedAgainstSource
      ? 'Every claim was verified against the source it names.'
      : 'Claims were NOT verified against source: no Fleet checkout available.',
  ];

  if (!compact) {
    lines.push('', 'Per project:');
    for (const result of report.results) {
      const state = result.clarityId ?? 'no Clarity ID';
      const flag = result.findings.length > 0 ? `  <- ${[...new Set(result.findings)].join(', ')}` : '';
      lines.push(`  ${result.id.padEnd(22)} ${String(state).padEnd(12)} ${result.wiredFiles.join(', ')}${flag}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }

  const acknowledged = report.findings.filter((entry) => entry.acknowledged);
  if (acknowledged.length > 0) {
    lines.push('', `Recorded debt (reported, not failed${report.strict ? ' — but strict mode fails it' : ''}):`);
    for (const entry of acknowledged) {
      lines.push(`  - [${entry.code}] ${entry.project}: ${entry.message}`);
      if (entry.fix) lines.push(`      fix: ${entry.fix}`);
    }
  }

  if (report.blocking.length > 0) {
    lines.push('', 'Blocking:');
    for (const entry of report.blocking) lines.push(`  - [${entry.code}] ${entry.project}: ${entry.message}`);
  } else {
    lines.push(
      '',
      acknowledged.length > 0
        ? `No blocking findings. ${acknowledged.length} recorded violation(s) await a fix in another repository; `
          + 'the gate fails once that fix lands and the receipt is not updated.'
        : 'No blocking findings.'
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
