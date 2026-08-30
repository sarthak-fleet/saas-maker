#!/usr/bin/env node

// Credential-free audit of how each Fleet project calls a hosted model.
// Reads a supplied project list, inspects package manifests and source, and
// reports a per-project verdict against the canonical direct-model client.
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

// ---------------------------------------------------------------------------
// Provider-host occurrence classification
//
// A provider host appearing in a file is not evidence that the project calls
// that provider. Placeholder text, preset pickers, documentation, comments and
// tests all mention hosts they never talk to. Every occurrence is therefore
// classified, and only `call-site` occurrences are reported as a direct model
// route. The raw mention count is kept alongside so nothing is hidden.
// ---------------------------------------------------------------------------

export const PROVIDER_HOST_CLASSES = Object.freeze([
  'call-site',
  'byo-key-config',
  'non-inference',
  'placeholder',
  'test',
  'documentation',
  'comment',
  'unclassified',
]);

// Occurrences within this many lines of each other are read as one lexical
// neighbourhood, which is how a provider picker is told from a single target.
const PROVIDER_MENU_WINDOW_LINES = 8;
const REQUEST_LOOKBEHIND_LINES = 3;
const PLACEHOLDER_LOOKBEHIND_LINES = 2;
const MAX_OCCURRENCES_PER_FILE = 200;
const MAX_CALL_SITE_DETAIL = 12;

// `Tests` needs the capital so `latest/` is not read as a test directory.
const TEST_PATH_PATTERN =
  /(?:^|[\\/])(?:tests?|[A-Za-z0-9._-]*Tests?|__tests__|__mocks__|specs?|e2e|fixtures?|mocks?|examples?|samples?|benchmarks?|testdata)(?:[\\/]|$)|\.(?:test|spec)\.[A-Za-z]+$|[A-Za-z0-9]Tests?\.[A-Za-z]+$/;

const DOC_PATH_PATTERN =
  /(?:^|[\\/])(?:docs?|documentation|website|guides?|handbook)(?:[\\/]|$)|(?:^|[\\/])(?:README|CHANGELOG|CONTRIBUTING|LICENSE)/i;

// A block that begins one of these is test code even in a file whose path says
// nothing, which is how a Rust `#[cfg(test)]` module at the end of a command
// file is kept out of the call-site count.
const TEST_BLOCK_PATTERN =
  /^\s*(?:#\[cfg\(test\)\]|@Test\b|func\s+test[A-Z]|(?:async\s+)?(?:describe|suite)\s*\(|class\s+Test[A-Z]|@pytest\.|def\s+test_)/;

const PLACEHOLDER_PATTERN =
  /placeholder|\bhint\b|helper[-_]?text|\bexample\b|\bsample\b|\be\.g\.|for instance/i;

// Billing, usage, key and catalogue endpoints are provider traffic that is not
// a model call, so they are not an inference route. `/models` only counts as a
// listing when it is the final segment: `/v1beta/models/<model>:generate` is
// inference.
const NON_INFERENCE_PATH_PATTERN =
  /\/(?:organizations?|usage|usage_report|costs?|billing|credits?|invoices?|limits?|quota|keys?|datasets?|rankings?|dashboard|health|status|me)(?:[/?]|$)|\/models$/;

const REQUEST_CALL_PATTERN =
  /\b(?:fetch|axios|got|ky|httpx|urlopen|urlretrieve|reqwest|URLSession|URLRequest|HttpClient|http)\s*[(.]|\.(?:post|get|put|patch|delete|head|request|send|fetch)\s*\(|\b[A-Za-z_$][\w$]*(?:Post|Get|Put|Delete|Request|Fetch|Call|Client)\s*\(|\brequests\.|\bcurl\b/;

const LINE_COMMENT_PREFIXES = ['//', '#', '*', '/*', '<!--'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A line-level comment test rather than a full lexer. A provider host that is
// the target of a request is effectively never parked behind code on the same
// line as a trailing comment, and a line-level test cannot be derailed by an
// apostrophe in JSX prose the way a character-level scanner can.
export function commentLineMap(lines, extension) {
  const map = new Array(lines.length).fill(false);
  const blocks =
    extension === '.py'
      ? [
        ['"""', '"""'],
        ["'''", "'''"],
      ]
      : [
        ['/*', '*/'],
        ['<!--', '-->'],
      ];
  let openBlock = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (openBlock) {
      map[index] = true;
      if (line.includes(openBlock)) openBlock = null;
      continue;
    }
    const trimmed = line.trimStart();
    if (LINE_COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) map[index] = true;
    for (const [open, close] of blocks) {
      // A comment opener stands alone or follows whitespace. Requiring that
      // keeps a glob such as `src/**` or `tmp/*/chats` from opening a block
      // comment that then swallows the rest of the file.
      const at = openerIndex(line, open);
      if (at < 0) continue;
      if (line.indexOf(close, at + open.length) < 0) {
        openBlock = close;
        map[index] = true;
      }
      break;
    }
  }
  return map;
}

function openerIndex(line, open) {
  for (let at = line.indexOf(open); at >= 0; at = line.indexOf(open, at + 1)) {
    if (at !== 0 && !/\s/.test(line[at - 1])) continue;
    if (insideQuotes(line, at)) continue;
    return at;
  }
  return -1;
}

// Cheap odd-quote test. A `/*` inside a quoted glob such as 'GET /**' is not a
// comment opener, and treating it as one used to swallow the rest of the file.
function insideQuotes(line, at) {
  for (const quote of ['"', "'", '`']) {
    let count = 0;
    for (let index = 0; index < at; index += 1) {
      if (line[index] === '\\') {
        index += 1;
        continue;
      }
      if (line[index] === quote) count += 1;
    }
    if (count % 2 === 1) return true;
  }
  return false;
}

function firstTestBlockLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (TEST_BLOCK_PATTERN.test(lines[index])) return index;
  }
  return -1;
}

function isActiveRuntimePath(relativePath) {
  if (TEST_PATH_PATTERN.test(relativePath) || DOC_PATH_PATTERN.test(relativePath)) return false;
  if (/^(?:AGENTS|README|PROJECT_STATUS|agents)\b/i.test(relativePath)) return false;
  if (/(?:^|[\/])(?:public|data)(?:[\/]|$)/i.test(relativePath)) return false;
  if (/(?:^|[\/])(?:catalog|reports)(?:[\/]|$)/i.test(relativePath)) return false;
  if (relativePath.startsWith('packages/portfolio-project-strip/')) return false;
  if (relativePath.startsWith('tooling/preserved/')) return false;
  if (relativePath === 'tooling/config/sites.json') return false;
  if (/(?:^|[\/])(?:cloudflare-env|worker-configuration)\.d\.ts$/i.test(relativePath)) {
    return false;
  }
  if (/(?:^|[\/])\.(?:env|dev\.vars)(?:\.example|\.sample|\.template)$/i.test(relativePath)) {
    return false;
  }
  if (
    relativePath === 'tooling/config/ai-client-standard.json'
    || relativePath === 'tooling/scripts/ai-client-audit.mjs'
  ) {
    return false;
  }
  return true;
}

// A URL assigned to a url-shaped name is a request target waiting to happen,
// which is the shape of the real bypasses: `const AI_BASE_URL = process.env.X
// ?? '<provider base url>'`. An object property is deliberately not a
// declaration — `endpointUrl: '…'` in a preset list is configuration, not a
// target.
export function declaredUrlIdentifier(line) {
  const match = line.match(
    /^\s*(?:export\s+)?(?:public\s+|private\s+|internal\s+|pub\s+)?(?:const|let|var|static|final|val|readonly)?\s*([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=(?!=)/
  );
  if (!match) return null;
  return /base|endpoint|url|uri|host|api/i.test(match[1]) ? match[1] : null;
}

function normaliseRequestPath(path) {
  return path.startsWith('/api/v') ? path.slice('/api'.length) : path;
}

function lineOffsets(source) {
  const offsets = [0];
  for (let index = source.indexOf('\n'); index >= 0; index = source.indexOf('\n', index + 1)) {
    offsets.push(index + 1);
  }
  return offsets;
}

function lineForOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Returns every provider-host occurrence in one file with its classification.
// The host must be followed by a version segment, which is the same shape the
// audit has always matched, so the raw count stays comparable.
export function scanProviderHostUsage({ source, relativePath, extension, standard }) {
  const hosts = standard.detection?.providerApiHosts ?? [];
  const modelPaths = standard.detection?.modelRequestPaths ?? [];
  if (hosts.length === 0) return [];

  const raw = [];
  for (const host of hosts) {
    const pattern = new RegExp(`${escapeRegExp(host)}(/(?:api/)?v\\d[A-Za-z0-9._~%:@\\-/]*)`, 'g');
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      raw.push({
        host,
        index: match.index,
        url: match[0],
        path: normaliseRequestPath(match[1]),
      });
      if (raw.length >= MAX_OCCURRENCES_PER_FILE) break;
    }
    if (raw.length >= MAX_OCCURRENCES_PER_FILE) break;
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.index - b.index);

  const lines = source.split('\n');
  const offsets = lineOffsets(source);
  const comments = commentLineMap(lines, extension);
  const testBlockLine = firstTestBlockLine(lines);
  const isTestPath = TEST_PATH_PATTERN.test(relativePath);
  const isDocPath = DOC_PATH_PATTERN.test(relativePath);

  const occurrences = raw.map((entry) => ({
    ...entry,
    line: lineForOffset(offsets, entry.index) + 1,
    // A bare base URL such as /v1 is supported because the declared paths hang
    // off it; /v1/moderations is not, because no declared path covers it.
        gatewayPathSupported: modelPaths.some(
      (value) =>
        entry.path === value
        || entry.path.startsWith(`${value}/`)
        || value.startsWith(`${entry.path}/`)
    ),
  }));

  for (const occurrence of occurrences) {
    const lineIndex = occurrence.line - 1;
    const line = lines[lineIndex] ?? '';
    const hasRequestTokenOnLine = REQUEST_CALL_PATTERN.test(line);
    const { classification, note } = classifyProviderHostOccurrence({
      occurrence,
      occurrences,
      line,
      lines,
      lineIndex,
      comments,
      testBlockLine,
      isTestPath,
      isDocPath,
      hasRequestTokenOnLine,
    });
    occurrence.classification = classification;
    occurrence.note = note;
  }
  return occurrences;
}

function classifyProviderHostOccurrence({
  occurrence,
  occurrences,
  line,
  lines,
  lineIndex,
  comments,
  testBlockLine,
  isTestPath,
  isDocPath,
  hasRequestTokenOnLine,
}) {
  if (comments[lineIndex]) {
    return { classification: 'comment', note: 'Appears in a comment, not in code.' };
  }
  if (isDocPath) {
    return { classification: 'documentation', note: 'Appears in a documentation path.' };
  }
  if (isTestPath || (testBlockLine >= 0 && lineIndex >= testBlockLine)) {
    return {
      classification: 'test',
      note: 'Appears in test code, which mentions hosts it may never call in production.',
    };
  }

  const placeholderWindow = lines
    .slice(Math.max(0, lineIndex - PLACEHOLDER_LOOKBEHIND_LINES), lineIndex + 1)
    .join('\n');
  if (PLACEHOLDER_PATTERN.test(placeholderWindow)) {
    return {
      classification: 'placeholder',
      note: 'Reads as placeholder, hint or example text rather than a request target.',
    };
  }

  if (NON_INFERENCE_PATH_PATTERN.test(occurrence.path)) {
    return {
      classification: 'non-inference',
      note: `Targets ${occurrence.path}, which is billing, usage, key or catalogue traffic rather than a model call.`,
    };
  }

  // Two or more distinct provider hosts in one neighbourhood is a picker of
  // bring-your-own-key endpoints, not a hardwired bypass, which always names a
  // single provider.
  if (!hasRequestTokenOnLine) {
    const neighbours = new Set(
      occurrences
        .filter((other) => Math.abs(other.line - occurrence.line) <= PROVIDER_MENU_WINDOW_LINES)
        .map((other) => other.host)
    );
    if (neighbours.size >= 2) {
      return {
        classification: 'byo-key-config',
        note: `One of ${neighbours.size} provider endpoints offered together, which reads as a bring-your-own-key picker.`,
      };
    }
  }

  if (hasRequestTokenOnLine) {
    return { classification: 'call-site', note: 'Passed to an HTTP client on the same line.' };
  }
  for (let offset = 1; offset <= REQUEST_LOOKBEHIND_LINES; offset += 1) {
    const previous = lines[lineIndex - offset];
    if (previous === undefined) break;
    if (REQUEST_CALL_PATTERN.test(previous)) {
      return {
        classification: 'call-site',
        note: 'Supplied as an argument to an HTTP client opened just above.',
      };
    }
  }
  const identifier = declaredUrlIdentifier(line);
  if (identifier) {
    return {
      classification: 'call-site',
      note: `Assigned to ${identifier}, a request-target name.`,
    };
  }

  return {
    classification: 'unclassified',
    note: 'Mentioned in code with no evidence either way; reported, not counted as a bypass.',
  };
}

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
  else if (!Array.isArray(value.gateway.retiredHosts)) fail('gateway.retiredHosts must be an array');

  if (!value.detection || typeof value.detection !== 'object') {
    fail('detection must be an object');
  } else {
    for (const key of [
      'canonicalPackages',
      'providerSdkPackages',
      'providerApiHosts',
      'modelRequestPaths',
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
      if (entry.allowsRetiredGatewayReferences !== undefined && typeof entry.allowsRetiredGatewayReferences !== 'boolean') {
        fail(`${label}.allowsRetiredGatewayReferences must be boolean when present`);
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
  const paths = standard.detection.modelRequestPaths ?? [];

  const ignoredPaths = (standard.detection.scanIgnorePaths ?? []).map((value) =>
    value.split('/').join(sep)
  );
  const evidence = {
    gatewayHostFiles: 0,
    providerHostFiles: 0,
    providerHostMentions: 0,
    providerCallSiteFiles: 0,
    providerCallSites: 0,
    providerModelPathFiles: 0,
    providerTestReferenceFiles: 0,
    providerHostBreakdown: Object.fromEntries(PROVIDER_HOST_CLASSES.map((name) => [name, 0])),
    providerCallSiteDetail: [],
    gatewayEnvFiles: 0,
    gatewayEnvPaths: [],
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

      const activeRuntimePath = isActiveRuntimePath(relativePath);
      if (activeRuntimePath) {
        for (const host of gatewayHosts) {
          if (!source.includes(host)) continue;
          evidence.gatewayHostFiles += 1;
          if (retired.has(host)) evidence.retiredHosts.add(host);
          break;
        }
      }
      const providerUsage = scanProviderHostUsage({
        source,
        relativePath,
        extension,
        standard,
      });
      if (providerUsage.length > 0) {
        evidence.providerHostFiles += 1;
        evidence.providerHostMentions += providerUsage.length;
        for (const occurrence of providerUsage) {
          evidence.providerHostBreakdown[occurrence.classification] += 1;
        }
        const callSites = providerUsage.filter(
          (occurrence) => occurrence.classification === 'call-site'
        );
        if (callSites.length > 0) {
          evidence.providerCallSiteFiles += 1;
          evidence.providerCallSites += callSites.length;
          for (const occurrence of callSites) {
            if (evidence.providerCallSiteDetail.length >= MAX_CALL_SITE_DETAIL) break;
            evidence.providerCallSiteDetail.push({
              file: relativePath,
              line: occurrence.line,
              host: occurrence.host,
              url: occurrence.url,
              path: occurrence.path,
              gatewayPathSupported: occurrence.gatewayPathSupported,
              why: occurrence.note,
            });
          }
        }
        if (
          providerUsage.some(
            (occurrence) =>
              occurrence.classification === 'call-site'
              || occurrence.classification === 'byo-key-config'
          )
        ) {
          evidence.providerModelPathFiles += 1;
        }
        if (providerUsage.some((occurrence) => occurrence.classification === 'test')) {
          evidence.providerTestReferenceFiles += 1;
        }
      }
      if (activeRuntimePath && envNames.some((name) => source.includes(name))) {
        evidence.gatewayEnvFiles += 1;
        if (evidence.gatewayEnvPaths.length < 20) evidence.gatewayEnvPaths.push(relativePath);
      }
      if (activeRuntimePath && paths.some((value) => source.includes(value))) {
        evidence.completionsPathFiles += 1;
      }
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
  // A provider host that is only mentioned — a placeholder, a doc example, a
  // test asserting the product refuses it — is not a model call path.
  const callsModel =
    source.gatewayHostFiles > 0 ||
    source.providerModelPathFiles > 0 ||
    source.gatewayEnvFiles > 0 ||
    source.completionsPathFiles > 0 ||
    source.canonicalImportFiles > 0 ||
    source.providerSdkImportFiles > 0;

  if (canonicalDeclarations.length === 0 && providerDeclarations.length === 0 && !callsModel) {
    return {
      verdict: 'not-applicable',
      pattern: 'none',
      // Even a pass says what was seen, so a mention the classifier declined to
      // act on is still on the page rather than buried in the counters.
      reasons: [
        'No hosted-model dependency and no model call site found in source.',
        ...providerHostReasons(source),
      ],
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
    reasons.push(...providerHostReasons(source));
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
  reasons.push(...providerHostReasons(source));
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

// Separates what the audit is willing to assert — a request aimed at a
// provider host — from what it merely saw. Both are stated, so a reader can
// still follow up on a mention the classifier declined to call a bypass.
function providerHostReasons(source) {
  const reasons = [];
  const breakdown = source.providerHostBreakdown ?? {};
  const callSites = source.providerCallSites ?? 0;
  const callSiteFiles = source.providerCallSiteFiles ?? 0;
  const mentions = source.providerHostMentions ?? 0;

  if (callSites > 0) {
    reasons.push(
      `Calls a project-owned provider API directly at ${callSites} call site(s) across ${callSiteFiles} file(s).`
    );
  }

  const soft = [
    ['byo-key-config', 'a bring-your-own-key endpoint picker'],
    ['non-inference', 'billing, usage or catalogue traffic'],
    ['placeholder', 'placeholder or example text'],
    ['test', 'test code'],
    ['documentation', 'documentation'],
    ['comment', 'a comment'],
    ['unclassified', 'code the classifier could not read either way'],
  ]
    .filter(([name]) => (breakdown[name] ?? 0) > 0)
    .map(([name, label]) => `${breakdown[name]} in ${label}`);

  if (soft.length > 0) {
    reasons.push(
      `Mentions a provider API host ${mentions} time(s) that are not counted as a call site: ${soft.join(', ')}. Worth reading, not a verdict.`
    );
  }
  return reasons;
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
    || source.providerModelPathFiles > 0
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
  // A dated, explicit exception may let the retiring gateway repository name
  // its own surface while it is being decommissioned. Caller repositories do
  // not inherit this exemption, and credential-shaped literals always block.
  if (exception?.allowsRetiredGatewayReferences !== true) {
    for (const host of source.retiredHosts) {
      blocking.push({
        code: 'RETIRED_GATEWAY_HOST',
        project: project.id,
        message: `References retired gateway host ${host}.`,
      });
    }
    if (source.gatewayEnvFiles > 0) {
      blocking.push({
        code: 'RETIRED_GATEWAY_ENV',
        project: project.id,
        message: `References a retired gateway-only environment name in ${source.gatewayEnvFiles} source file(s).`,
      });
    }
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
      // Raw signal, kept deliberately: files that contain a provider-host
      // string at all, whatever the classifier made of them.
      providerHostFiles: source.providerHostFiles,
      providerHostMentions: source.providerHostMentions,
      // High-confidence signal: a provider host used as a request target.
      providerCallSiteFiles: source.providerCallSiteFiles,
      providerCallSites: source.providerCallSites,
      providerHostBreakdown: source.providerHostBreakdown,
      providerCallSiteDetail: source.providerCallSiteDetail,
      gatewayEnvFiles: source.gatewayEnvFiles,
      ...(explain ? { gatewayEnvPaths: source.gatewayEnvPaths } : {}),
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

  // Named call sites are drawn from the published results only, so a private
  // project is never identified by its evidence.
  const providerCallSites = published.flatMap((result) =>
    (result.evidence?.providerCallSiteDetail ?? []).map((entry) => ({
      project: result.id,
      ...entry,
    }))
  );
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
    providerHosts: {
      note:
        'providerHostFiles counts files that contain a provider-host string. providerCallSites '
        + 'counts the subset the classifier is willing to call a request target. Direct call sites '
        + 'are routing evidence, not gateway bypasses; the raw mention count remains visible.',
      mentionFiles: results.reduce(
        (total, result) => total + (result.evidence?.providerHostFiles ?? 0),
        0
      ),
      callSiteProjects: [...new Set(providerCallSites.map((entry) => entry.project))].sort(),
      callSites: providerCallSites,
    },
    warnings,
    blocking: published.flatMap((result) => result.blocking),
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
pattern found in source, and the verdict against the canonical direct-model
client: ${VERDICTS.join(' | ')}.

The audit is read-only with respect to every project it inspects, needs no
credentials, and skips node_modules, dist, .next, and other build output.

--omit-private keeps projects whose repository is not public out of the named
results while still counting them, so a report can be committed to a public
repository without publishing a private project catalog.

Exit codes:
  0  Report produced. Drift against an unratified standard is reported, not failed.
  1  Something unambiguously wrong: an invalid standard file, a credential
     literal in tracked source, or a retired gateway host/variable still referenced.
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
  const hosts = report.providerHosts;
  if (hosts) {
    lines.push(
      '',
      `Provider hosts: ${hosts.mentionFiles} file(s) mention one; `
        + `${hosts.callSites.length} call site(s) in ${hosts.callSiteProjects.length} project(s) `
        + 'are read as a request target.'
    );
    if (!compact) {
      for (const entry of hosts.callSites) {
        lines.push(
          `  ${entry.project.padEnd(20)} ${entry.file}:${entry.line} ${entry.url}`
            + `${entry.gatewayPathSupported ? '' : '  [path not on the gateway]'}`
        );
      }
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
    lines.push(
      '',
      report.advisory
        ? 'No blocking findings. Drift is advisory until the standard is ratified.'
        : 'No blocking findings. The standard is ratified; drift is a real gap to close, '
          + 'but it is reported rather than failed so the gate does not redden on known debt.'
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
