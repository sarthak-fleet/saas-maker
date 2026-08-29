#!/usr/bin/env node

// Credential-free audit of how each Fleet project calls a hosted model.
// Reads a supplied project list, inspects package manifests and source, and
// reports a per-project verdict against the candidate canonical client.
// Read-only: it never writes outside this repository.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STANDARD_PATH = join(REPOSITORY_ROOT, 'config', 'ai-client-standard.json');
const DEFAULT_FLEET_ROOT = resolve(REPOSITORY_ROOT, '..', '..');
const DEFAULT_PROJECTS_RELATIVE = join(
  'site-health',
  'apps',
  'backend',
  'config',
  'projects.json'
);

export const VERDICTS = Object.freeze([
  'compliant',
  'drifted',
  'hand-rolled',
  'exception',
  'not-applicable',
]);

const SKIPPED_DIRECTORIES = new Set([
  '.astro',
  '.cache',
  '.git',
  '.gradle',
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

const SOURCE_EXTENSIONS = new Set([
  '.astro',
  '.cjs',
  '.cts',
  '.go',
  '.java',
  '.js',
  '.jsonc',
  '.jsx',
  '.kt',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
]);

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SOURCE_FILES = 6_000;

// Literal provider credentials committed to source are wrong under every
// candidate option, so they are the audit's only source-level hard failure.
const CREDENTIAL_LITERALS = [
  /\bsk-(?:proj|ant|or|live)-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
];
const CREDENTIAL_PLACEHOLDER = /(?:xxx|XXX|\.\.\.|example|placeholder|redacted|canary|dummy|your[-_]?key)/;
// Fake keys are the normal way to test redaction, so test and fixture paths are
// never treated as a leak.
const CREDENTIAL_EXEMPT_PATH =
  /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|specs|e2e|fixtures?|mocks?|examples?|benchmarks?)(?:\/|$)|\.(?:test|spec)\.[a-z]+$|(?:fixture|mock|sample|benchmark)/i;

export function validateStandard(value) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, problems: ['standard must be an object'] };
  }
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (value.status !== 'unratified' && value.status !== 'ratified') {
    fail('status must be "unratified" or "ratified"');
  }
  if (value.status === 'ratified' && !isIsoDate(value.ratifiedAt)) {
    fail('a ratified standard requires ratifiedAt as an ISO date');
  }
  if (value.status === 'unratified' && value.ratifiedAt !== null) {
    fail('an unratified standard must carry ratifiedAt: null');
  }

  const canonical = value.canonical;
  if (!canonical || typeof canonical !== 'object') {
    fail('canonical must be an object');
  } else {
    if (!canonical.option) fail('canonical.option is required');
    if (!canonical.packages || Object.keys(canonical.packages).length === 0) {
      fail('canonical.packages must name at least one package');
    } else {
      for (const [name, version] of Object.entries(canonical.packages)) {
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version))) {
          fail(`canonical.packages.${name} must be an exact version, got ${version}`);
        }
      }
    }
  }

  if (!value.gateway || typeof value.gateway !== 'object') fail('gateway must be an object');
  else if (!value.gateway.host) fail('gateway.host is required');
  else if (!Array.isArray(value.gateway.retiredHosts)) fail('gateway.retiredHosts must be an array');

  if (!value.detection || typeof value.detection !== 'object') {
    fail('detection must be an object');
  } else {
    for (const key of [
      'canonicalPackages',
      'providerSdkPackages',
      'providerApiHosts',
      'gatewayEnvNames',
    ]) {
      if (!Array.isArray(value.detection[key])) fail(`detection.${key} must be an array`);
    }
  }

  if (!Array.isArray(value.exceptions)) {
    fail('exceptions must be an array');
  } else {
    const seen = new Set();
    for (const [index, entry] of value.exceptions.entries()) {
      const label = `exceptions[${index}]`;
      if (!entry || typeof entry !== 'object') {
        fail(`${label} must be an object`);
        continue;
      }
      if (!entry.project) fail(`${label}.project is required`);
      if (seen.has(entry.project)) fail(`${label} duplicates project ${entry.project}`);
      seen.add(entry.project);
      if (!isIsoDate(entry.recordedAt)) fail(`${label}.recordedAt must be an ISO date`);
      if (!entry.reason || String(entry.reason).trim().length < 20) {
        fail(`${label}.reason must be a written justification`);
      }
      if (entry.reviewBy !== undefined && !isIsoDate(entry.reviewBy)) {
        fail(`${label}.reviewBy must be an ISO date when present`);
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function loadStandard(path = DEFAULT_STANDARD_PATH) {
  const standard = JSON.parse(readFileSync(path, 'utf8'));
  const { valid, problems } = validateStandard(standard);
  if (!valid) {
    throw new Error(`Invalid AI client standard at ${path}:\n- ${problems.join('\n- ')}`);
  }
  return standard;
}

// Accepts either the Site Health catalog shape or a plain list of ids/objects.
export function normaliseProjectList(value) {
  const entries = Array.isArray(value) ? value : Array.isArray(value?.projects) ? value.projects : null;
  if (!entries) throw new Error('project list must be an array or an object with a projects array');

  const seen = new Set();
  const projects = [];
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? { id: entry, repo: entry } : entry;
    if (!raw || typeof raw !== 'object' || !raw.id) continue;
    const repo = repoDirectoryFor(raw);
    const key = `${raw.id}::${repo ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    projects.push({
      id: raw.id,
      name: raw.name ?? raw.id,
      repo,
      visibility: raw.repositoryVisibility ?? raw.visibility ?? 'unknown',
      lifecycle: raw.lifecycle ?? null,
      tier: raw.tier ?? null,
    });
  }
  return projects;
}

function repoDirectoryFor(entry) {
  if (typeof entry.repo === 'string' && entry.repo) return entry.repo.split('/')[0];
  if (typeof entry.sourcePath === 'string' && entry.sourcePath) {
    return entry.sourcePath.split('/')[0];
  }
  return null;
}

export function readPackageManifests(projectRoot) {
  const manifests = [];
  const walk = (directory, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path, depth + 1);
      } else if (entry.isFile() && entry.name === 'package.json') {
        let parsed;
        try {
          parsed = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
          continue;
        }
        manifests.push({
          path: relative(projectRoot, path) || 'package.json',
          dependencies: {
            ...(parsed.dependencies ?? {}),
            ...(parsed.devDependencies ?? {}),
            ...(parsed.peerDependencies ?? {}),
          },
        });
      }
    }
  };
  walk(projectRoot, 0);
  return manifests.sort((a, b) => a.path.localeCompare(b.path));
}

export function collectDeclaredPackages(manifests, standard) {
  const canonical = new Set(standard.detection.canonicalPackages);
  const provider = new Set(standard.detection.providerSdkPackages);
  const declared = [];
  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      const kind = canonical.has(name) ? 'canonical' : provider.has(name) ? 'provider-sdk' : null;
      if (!kind) continue;
      declared.push({ package: name, version: String(version), kind, manifest: manifest.path });
    }
  }
  return declared.sort(
    (a, b) => a.package.localeCompare(b.package) || a.manifest.localeCompare(b.manifest)
  );
}

export function scanSource(projectRoot, standard) {
  const gatewayHosts = [standard.gateway.host, ...standard.gateway.retiredHosts].filter(Boolean);
  const retired = new Set(standard.gateway.retiredHosts);
  const envNames = standard.detection.gatewayEnvNames;
  const paths = standard.gateway.openAiCompatiblePaths ?? [];

  const providerHosts = (standard.detection.providerApiHosts ?? []).map(
    (host) => new RegExp(`${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:api/)?v\\d`)
  );
  const ignoredPaths = (standard.detection.scanIgnorePaths ?? []).map((value) =>
    value.split('/').join(sep)
  );
  const evidence = {
    gatewayHostFiles: 0,
    providerHostFiles: 0,
    gatewayEnvFiles: 0,
    completionsPathFiles: 0,
    canonicalImportFiles: 0,
    providerSdkImportFiles: 0,
    filesScanned: 0,
    truncated: false,
    retiredHosts: new Set(),
    credentialLiteral: false,
    credentialFiles: [],
  };

  const importPattern =
    /(?:from\s+['"]|require\(\s*['"]|import\(\s*['"]|import\s+['"])(ai|@ai-sdk\/[a-z0-9-]+)['"]/;
  const providerPattern =
    /(?:from\s+['"]|require\(\s*['"]|import\(\s*['"])((?:@openai\/|@anthropic-ai\/|@google\/|@mistralai\/)[a-z0-9-]+|openai|anthropic|cohere-ai|groq-sdk|replicate|together-ai)['"]|^\s*(?:import|from)\s+(?:openai|anthropic|google\.generativeai)\b/m;

  const walk = (directory, depth) => {
    if (evidence.filesScanned >= MAX_SOURCE_FILES) {
      evidence.truncated = true;
      return;
    }
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      if (entry.name.startsWith('.env')) continue;
      const relativePath = relative(projectRoot, path);
      if (ignoredPaths.some((prefix) => relativePath.startsWith(prefix))) continue;
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
      evidence.filesScanned += 1;

      for (const host of gatewayHosts) {
        if (!source.includes(host)) continue;
        evidence.gatewayHostFiles += 1;
        if (retired.has(host)) evidence.retiredHosts.add(host);
        break;
      }
      if (providerHosts.some((pattern) => pattern.test(source))) evidence.providerHostFiles += 1;
      if (envNames.some((name) => source.includes(name))) evidence.gatewayEnvFiles += 1;
      if (paths.some((value) => source.includes(value))) evidence.completionsPathFiles += 1;
      if (importPattern.test(source)) evidence.canonicalImportFiles += 1;
      if (providerPattern.test(source)) evidence.providerSdkImportFiles += 1;
      for (const pattern of CREDENTIAL_LITERALS) {
        const match = source.match(pattern);
        if (
          match
          && !CREDENTIAL_PLACEHOLDER.test(match[0])
          && !CREDENTIAL_EXEMPT_PATH.test(relativePath)
          && !isTestContext(source, match.index)
        ) {
          evidence.credentialLiteral = true;
          if (evidence.credentialFiles.length < 20) evidence.credentialFiles.push(relativePath);
          break;
        }
      }
      if (evidence.filesScanned >= MAX_SOURCE_FILES) {
        evidence.truncated = true;
        return;
      }
    }
  };

  walk(projectRoot, 0);
  return { ...evidence, retiredHosts: [...evidence.retiredHosts].sort() };
}

export function classifyProject({ project, declared, source, standard, exception }) {
  if (exception) {
    return {
      verdict: 'exception',
      pattern: patternFor(declared, source),
      reasons: [`Dated exception recorded ${exception.recordedAt}: ${exception.reason}`],
    };
  }

  const canonicalDeclarations = declared.filter((entry) => entry.kind === 'canonical');
  const providerDeclarations = declared.filter((entry) => entry.kind === 'provider-sdk');
  const callsModel =
    source.gatewayHostFiles > 0 ||
    source.providerHostFiles > 0 ||
    source.gatewayEnvFiles > 0 ||
    source.completionsPathFiles > 0 ||
    source.canonicalImportFiles > 0 ||
    source.providerSdkImportFiles > 0;

  if (canonicalDeclarations.length === 0 && providerDeclarations.length === 0 && !callsModel) {
    return {
      verdict: 'not-applicable',
      pattern: 'none',
      reasons: ['No hosted-model dependency and no model call site found in source.'],
    };
  }

  if (canonicalDeclarations.length > 0) {
    const reasons = [];
    let drifted = false;
    for (const entry of canonicalDeclarations) {
      const pinned = standard.canonical.packages[entry.package]
        ?? standard.canonical.companionPackages?.[entry.package];
      if (!pinned) continue;
      if (entry.version !== pinned) {
        drifted = true;
        reasons.push(`${entry.package} declares ${entry.version}, canonical pin is ${pinned}`);
      }
    }
    if (providerDeclarations.length > 0) {
      reasons.push(
        `Also declares provider SDKs directly: ${providerDeclarations.map((entry) => entry.package).join(', ')}`
      );
    }
    if (!drifted) reasons.unshift('Declares the canonical packages at the pinned versions.');
    return { verdict: drifted ? 'drifted' : 'compliant', pattern: 'vercel-ai-sdk', reasons };
  }

  const reasons = [];
  if (providerDeclarations.length > 0) {
    reasons.push(
      `Calls providers through their own SDKs: ${providerDeclarations.map((entry) => `${entry.package}@${entry.version}`).join(', ')}`
    );
  }
  if (source.gatewayHostFiles > 0) {
    reasons.push(`References the gateway host in ${source.gatewayHostFiles} source file(s).`);
  }
  if (source.providerHostFiles > 0) {
    reasons.push(
      `Calls a provider API host directly in ${source.providerHostFiles} source file(s), bypassing the gateway.`
    );
  }
  if (source.gatewayEnvFiles > 0) {
    reasons.push(`References a gateway environment name in ${source.gatewayEnvFiles} source file(s).`);
  }
  if (source.completionsPathFiles > 0) {
    reasons.push(
      `Builds an OpenAI-compatible request path in ${source.completionsPathFiles} source file(s).`
    );
  }
  if (reasons.length === 0) reasons.push('Model call evidence found without the canonical client.');

  return {
    verdict: 'hand-rolled',
    pattern: providerDeclarations.length > 0 ? 'provider-sdk' : 'raw-http',
    reasons,
  };
}

// A credential-shaped literal inside a test block, or on an assertion line, is
// a fixture for redaction tests rather than a leaked key.
function isTestContext(source, index) {
  const before = source.slice(0, index);
  if (/#\[cfg\(test\)\]|@Test\b|func test[A-Z]/.test(before)) return true;
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = source.indexOf('\n', index);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  return /\b(?:assert|expect|describe|it|test|should|XCTAssert)\s*[(!]|\bCANARY\b/i.test(line);
}

function patternFor(declared, source) {
  if (declared.some((entry) => entry.kind === 'canonical')) return 'vercel-ai-sdk';
  if (declared.some((entry) => entry.kind === 'provider-sdk')) return 'provider-sdk';
  if (
    source.gatewayHostFiles > 0
    || source.providerHostFiles > 0
    || source.completionsPathFiles > 0
    || source.gatewayEnvFiles > 0
  ) {
    return 'raw-http';
  }
  return 'none';
}

export function auditProject({ project, fleetRoot, standard, explain = false }) {
  const exception = standard.exceptions.find((entry) => entry.project === project.id) ?? null;
  const projectRoot = project.repo ? resolve(fleetRoot, project.repo) : null;

  if (!projectRoot || !existsSync(projectRoot)) {
    return {
      id: project.id,
      name: project.name,
      repo: project.repo,
      visibility: project.visibility,
      scanned: false,
      verdict: exception ? 'exception' : 'not-applicable',
      pattern: 'none',
      declared: [],
      evidence: null,
      reasons: [
        exception
          ? `Dated exception recorded ${exception.recordedAt}: ${exception.reason}`
          : 'No repository directory available in this checkout; nothing was inspected.',
      ],
      blocking: [],
    };
  }

  const manifests = readPackageManifests(projectRoot);
  const declared = collectDeclaredPackages(manifests, standard);
  const source = scanSource(projectRoot, standard);
  const { verdict, pattern, reasons } = classifyProject({
    project,
    declared,
    source,
    standard,
    exception,
  });

  const blocking = [];
  if (source.credentialLiteral) {
    blocking.push({
      code: 'CREDENTIAL_LITERAL',
      project: project.id,
      message:
        'A provider-credential-shaped literal appears in tracked source. Location withheld from this report; rerun locally with --explain to see it.',
      ...(explain ? { detail: source.credentialFiles } : {}),
    });
  }
  for (const host of source.retiredHosts) {
    blocking.push({
      code: 'RETIRED_GATEWAY_HOST',
      project: project.id,
      message: `References retired gateway host ${host}.`,
    });
  }

  return {
    id: project.id,
    name: project.name,
    repo: project.repo,
    visibility: project.visibility,
    scanned: true,
    verdict,
    pattern,
    declared,
    evidence: {
      manifests: manifests.length,
      filesScanned: source.filesScanned,
      truncated: source.truncated,
      gatewayHostFiles: source.gatewayHostFiles,
      providerHostFiles: source.providerHostFiles,
      gatewayEnvFiles: source.gatewayEnvFiles,
      completionsPathFiles: source.completionsPathFiles,
      canonicalImportFiles: source.canonicalImportFiles,
      providerSdkImportFiles: source.providerSdkImportFiles,
      credentialLiteralSuspected: source.credentialLiteral,
    },
    reasons,
    blocking,
  };
}

export function auditAiClients({
  projects,
  fleetRoot,
  standard,
  now = Date.now(),
  explain = false,
  omitPrivate = false,
}) {
  const results = normaliseProjectList(projects)
    .map((project) => auditProject({ project, fleetRoot, standard, explain }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const summary = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]));
  for (const result of results) summary[result.verdict] += 1;

  const patterns = {};
  for (const result of results) patterns[result.pattern] = (patterns[result.pattern] ?? 0) + 1;

  const warnings = [];
  const today = new Date(now).toISOString().slice(0, 10);
  for (const exception of standard.exceptions) {
    if (exception.reviewBy && exception.reviewBy < today) {
      warnings.push(`Exception for ${exception.project} passed its ${exception.reviewBy} review date.`);
    }
    if (!results.some((result) => result.id === exception.project)) {
      warnings.push(`Exception for ${exception.project} does not match any supplied project.`);
    }
  }
  const unscanned = results.filter((result) => !result.scanned).map((result) => result.id);
  if (unscanned.length > 0) {
    warnings.push(`${unscanned.length} project(s) had no local checkout to inspect: ${unscanned.join(', ')}.`);
  }

  // The project list is private input. A committed report names only projects
  // whose repository is already public; the rest are counted, never identified.
  const withheldResults = omitPrivate
    ? results.filter((result) => result.visibility !== 'public')
    : [];
  const published = omitPrivate
    ? results.filter((result) => result.visibility === 'public')
    : results;
  const withheld = omitPrivate
    ? {
      projects: withheldResults.length,
      byVerdict: Object.fromEntries(
        VERDICTS.map((verdict) => [
          verdict,
          withheldResults.filter((result) => result.verdict === verdict).length,
        ])
      ),
      note: 'Projects with a non-public repository are counted in the summary but not identified in this report.',
    }
    : null;

  return {
    schemaVersion: 1,
    schema: 'fleet.ai-client-audit.v1',
    generatedAt: new Date(now).toISOString(),
    standard: {
      status: standard.status,
      ratifiedAt: standard.ratifiedAt,
      option: standard.canonical.option,
      packages: standard.canonical.packages,
      issue: standard.issue,
    },
    advisory: standard.status !== 'ratified',
    summary: {
      projects: results.length,
      scanned: results.filter((result) => result.scanned).length,
      ...summary,
    },
    patterns,
    warnings,
    blocking: results.flatMap((result) => result.blocking),
    followUps: standard.followUps ?? [],
    ...(withheld ? { withheld } : {}),
    results: published,
  };
}

const VALUE_FLAGS = new Set(['--standard', '--fleet-root', '--projects', '--output']);

// Values that follow a value-taking flag are never treated as the positional
// project list.
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

const HELP = `Fleet AI client audit

Usage:
  ai-client-audit.mjs [<projects.json>] [--fleet-root <dir>] [--standard <file>]
                      [--output <file>] [--json] [--check] [--explain]
                      [--omit-private]

Reports, per project, the declared hosted-model dependency, the calling
pattern found in source, and the verdict against the candidate canonical
client: ${VERDICTS.join(' | ')}.

The audit is read-only with respect to every project it inspects, needs no
credentials, and skips node_modules, dist, .next, and other build output.

--omit-private keeps projects whose repository is not public out of the named
results while still counting them, so a report can be committed to a public
repository without publishing a private project catalog.

Exit codes:
  0  Report produced. Drift against an unratified standard is reported, not failed.
  1  Something unambiguously wrong: an invalid standard file, a credential
     literal in tracked source, or a retired gateway host still referenced.
  2  Usage error.`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return null;
  }

  let options;
  let positionals;
  let standard;
  try {
    ({ options, positionals } = parseArguments(argv));
    standard = loadStandard(resolve(options['--standard'] ?? DEFAULT_STANDARD_PATH));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return null;
  }

  const fleetRoot = resolve(options['--fleet-root'] ?? DEFAULT_FLEET_ROOT);
  const projectsPath = resolve(
    options['--projects'] ?? positionals[0] ?? join(fleetRoot, DEFAULT_PROJECTS_RELATIVE)
  );

  if (!existsSync(projectsPath)) {
    if (argv.includes('--check')) {
      process.stdout.write(
        `ai-client-audit: no project list at ${projectsPath}; standard validated, nothing to scan.\n`
      );
      return null;
    }
    process.stderr.write(`Project list not found: ${projectsPath}\n${HELP}\n`);
    process.exitCode = 2;
    return null;
  }

  const projects = JSON.parse(readFileSync(projectsPath, 'utf8'));
  const report = auditAiClients({
    projects,
    fleetRoot,
    standard,
    explain: argv.includes('--explain'),
    omitPrivate: argv.includes('--omit-private'),
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
    `AI client audit — standard ${report.standard.status} (option: ${report.standard.option})`,
    `${report.summary.scanned}/${report.summary.projects} projects inspected on disk`,
    '',
  ];
  for (const verdict of VERDICTS) {
    lines.push(`  ${verdict.padEnd(15)} ${report.summary[verdict]}`);
  }
  lines.push('', 'Pattern:');
  for (const [pattern, count] of Object.entries(report.patterns).sort()) {
    lines.push(`  ${pattern.padEnd(15)} ${count}`);
  }
  if (!compact) {
    lines.push('', 'Per project:');
    for (const result of report.results) {
      if (result.verdict === 'not-applicable') continue;
      const declared = result.declared.map((entry) => `${entry.package}@${entry.version}`).join(' ');
      lines.push(`  ${result.id.padEnd(24)} ${result.verdict.padEnd(15)} ${declared}`);
    }
  }
  if (!compact && report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  if (report.blocking.length > 0) {
    lines.push('', 'Blocking:');
    for (const entry of report.blocking) lines.push(`  - [${entry.code}] ${entry.message}`);
  } else {
    lines.push('', 'No blocking findings. Drift is advisory until the standard is ratified.');
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
