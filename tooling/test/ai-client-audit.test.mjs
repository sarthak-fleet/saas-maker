import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

import {
  PROVIDER_HOST_CLASSES,
  VERDICTS,
  auditAiClients,
  classifyProject,
  collectDeclaredPackages,
  commentLineMap,
  declaredUrlIdentifier,
  normaliseProjectList,
  readPackageManifests,
  scanProviderHostUsage,
  scanSource,
  validateStandard,
} from '../scripts/ai-client-audit.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const committedFixtures = join(import.meta.dirname, 'fixtures', 'ai-client-audit');
const standard = JSON.parse(
  readFileSync(join(repositoryRoot, 'config', 'ai-client-standard.json'), 'utf8')
);

// Build output cannot be committed as a fixture because .next, dist, and
// node_modules are ignored, so the committed fixtures are copied to a scratch
// tree and the ignored directories are recreated there.
let fixtureRoot = committedFixtures;

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ai-client-audit-'));
  cpSync(committedFixtures, fixtureRoot, { recursive: true });

  const drifted = join(fixtureRoot, 'drifted-project');
  for (const [directory, manifest, source] of [
    ['.next/standalone', '{"name":"stale","dependencies":{"ai":"6.0.42"}}', 'export const base = "https://ai-gateway.sassmaker.com/v1/chat/completions";\n'],
    ['node_modules/ai', '{"name":"ai","version":"6.0.97"}', 'export const url = "https://ai-gateway.sassmaker.com/v1/chat/completions";\n'],
    ['dist', '{"name":"bundle","dependencies":{"openai":"6.49.0"}}', 'export const url = "https://ai-gateway.sassmaker.com/v1/chat/completions";\n'],
  ]) {
    const target = join(drifted, ...directory.split('/'));
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), manifest);
    writeFileSync(join(target, 'index.js'), source);
  }
});

after(() => {
  if (fixtureRoot !== committedFixtures) rmSync(fixtureRoot, { recursive: true, force: true });
});

function auditFixtures(ids) {
  return auditAiClients({
    projects: ids.map((id) => ({ id, repo: id })),
    fleetRoot: fixtureRoot,
    standard,
    now: Date.parse('2026-08-29T00:00:00.000Z'),
  });
}

test('the shipped standard validates and is ratified with a date', () => {
  const { valid, problems } = validateStandard(standard);
  assert.deepEqual(problems, []);
  assert.equal(valid, true);
  assert.equal(standard.status, 'ratified');
  assert.match(standard.ratifiedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(standard.canonical.option, 'direct-free-model-vercel-ai-sdk');
  assert.equal(standard.gateway.host, null);
  assert.deepEqual(standard.gateway.retiredHosts, ['ai-gateway.sassmaker.com']);
});

test('validateStandard rejects loose pins, undated exceptions, and claimed ratification', () => {
  const loosePin = structuredClone(standard);
  loosePin.canonical.packages.ai = '^6.0.97';
  assert.match(validateStandard(loosePin).problems.join('\n'), /must be an exact version/u);

  const undated = structuredClone(standard);
  undated.exceptions = [{ project: 'free-ai', reason: 'because the gateway is special enough' }];
  assert.match(validateStandard(undated).problems.join('\n'), /recordedAt must be an ISO date/u);

  const thinReason = structuredClone(standard);
  thinReason.exceptions = [{ project: 'free-ai', recordedAt: '2026-08-29', reason: 'gateway' }];
  assert.match(validateStandard(thinReason).problems.join('\n'), /written justification/u);

  const claimed = structuredClone(standard);
  claimed.status = 'ratified';
  claimed.ratifiedAt = null;
  assert.match(validateStandard(claimed).problems.join('\n'), /requires ratifiedAt/u);

  const staleUnratified = structuredClone(standard);
  staleUnratified.status = 'unratified';
  assert.match(
    validateStandard(staleUnratified).problems.join('\n'),
    /must carry ratifiedAt: null/u
  );
});

test('package manifests are read across the workspace and skip build output', () => {
  const manifests = readPackageManifests(join(fixtureRoot, 'drifted-project'));
  assert.deepEqual(
    manifests.map((manifest) => manifest.path),
    ['package.json', join('packages', 'worker', 'package.json')]
  );

  const declared = collectDeclaredPackages(manifests, standard);
  assert.deepEqual(
    declared.map((entry) => `${entry.package}@${entry.version}`),
    ['@ai-sdk/openai-compatible@^2.0.41', 'ai@^6.0.97']
  );
  assert.equal(
    declared.every((entry) => entry.kind === 'canonical'),
    true
  );
});

test('a pinned canonical declaration is compliant', () => {
  const report = auditFixtures(['compliant-project']);
  const result = report.results[0];
  assert.equal(result.verdict, 'compliant');
  assert.equal(result.pattern, 'vercel-ai-sdk');
  assert.deepEqual(
    result.declared.map((entry) => entry.package),
    ['@ai-sdk/openai-compatible', 'ai']
  );
});

test('a ranged or off-pin canonical declaration is drifted and names the pin', () => {
  const result = auditFixtures(['drifted-project']).results[0];
  assert.equal(result.verdict, 'drifted');
  assert.equal(result.pattern, 'vercel-ai-sdk');
  assert.match(result.reasons.join('\n'), /ai declares \^6\.0\.97, canonical pin is 6\.0\.168/u);
});

test('raw HTTP against the retired gateway is hand-rolled and blocking', () => {
  const result = auditFixtures(['raw-http-project']).results[0];
  assert.equal(result.verdict, 'hand-rolled');
  assert.equal(result.pattern, 'raw-http');
  assert.deepEqual(result.declared, []);
  assert.equal(result.evidence.gatewayHostFiles, 1);
  assert.deepEqual(
    result.blocking.map((entry) => entry.code).sort(),
    ['RETIRED_GATEWAY_ENV', 'RETIRED_GATEWAY_HOST']
  );
});

test('a provider SDK without the canonical client is hand-rolled and labelled provider-sdk', () => {
  const result = auditFixtures(['provider-sdk-project']).results[0];
  assert.equal(result.verdict, 'hand-rolled');
  assert.equal(result.pattern, 'provider-sdk');
  assert.match(result.reasons.join('\n'), /openai@6\.49\.0/u);
});

test('a project with no model call path lands on not-applicable', () => {
  const result = auditFixtures(['plain-project']).results[0];
  assert.equal(result.verdict, 'not-applicable');
  assert.equal(result.pattern, 'none');
  assert.equal(result.evidence.gatewayHostFiles, 0);
});

test('build output is never inspected, so a vendored copy cannot change a verdict', () => {
  const source = scanSource(join(fixtureRoot, 'drifted-project'), standard);
  assert.equal(source.gatewayHostFiles, 0);
  assert.equal(source.canonicalImportFiles, 1);
  assert.equal(source.providerSdkImportFiles, 0);

  const manifests = readPackageManifests(join(fixtureRoot, 'drifted-project'));
  assert.deepEqual(
    manifests.map((manifest) => manifest.path),
    ['package.json', join('packages', 'worker', 'package.json')]
  );

  const result = auditFixtures(['drifted-project']).results[0];
  assert.equal(result.verdict, 'drifted');
  assert.equal(result.pattern, 'vercel-ai-sdk');
});

test('a dated exception wins over the measured pattern and records its reason', () => {
  const withException = structuredClone(standard);
  withException.exceptions = [
    {
      project: 'raw-http-project',
      recordedAt: '2026-08-29',
      reason: 'The fixture stands in for the gateway itself and cannot depend on a client.',
    },
  ];
  const report = auditAiClients({
    projects: [{ id: 'raw-http-project', repo: 'raw-http-project' }],
    fleetRoot: fixtureRoot,
    standard: withException,
    now: Date.parse('2026-08-29T00:00:00.000Z'),
  });
  const result = report.results[0];
  assert.equal(result.verdict, 'exception');
  assert.equal(result.pattern, 'raw-http');
  assert.match(result.reasons.join('\n'), /Dated exception recorded 2026-08-29/u);
});

test('a missing checkout is reported honestly rather than passed', () => {
  const report = auditFixtures(['not-checked-out']);
  const result = report.results[0];
  assert.equal(result.scanned, false);
  assert.equal(result.verdict, 'not-applicable');
  assert.match(result.reasons.join('\n'), /No repository directory available/u);
  assert.match(report.warnings.join('\n'), /had no local checkout/u);
});

test('classifyProject needs no filesystem and covers every verdict name', () => {
  const empty = {
    gatewayHostFiles: 0,
    gatewayEnvFiles: 0,
    completionsPathFiles: 0,
    canonicalImportFiles: 0,
    providerSdkImportFiles: 0,
  };
  const seen = new Set([
    classifyProject({ project: { id: 'a' }, declared: [], source: empty, standard }).verdict,
    classifyProject({
      project: { id: 'b' },
      declared: [{ package: 'ai', version: '6.0.168', kind: 'canonical', manifest: 'package.json' }],
      source: empty,
      standard,
    }).verdict,
    classifyProject({
      project: { id: 'c' },
      declared: [{ package: 'ai', version: '6.0.1', kind: 'canonical', manifest: 'package.json' }],
      source: empty,
      standard,
    }).verdict,
    classifyProject({
      project: { id: 'd' },
      declared: [],
      source: { ...empty, gatewayHostFiles: 2 },
      standard,
    }).verdict,
    classifyProject({
      project: { id: 'e' },
      declared: [],
      source: empty,
      standard,
      exception: { recordedAt: '2026-08-29', reason: 'a recorded and dated justification here' },
    }).verdict,
  ]);
  assert.deepEqual([...seen].sort(), [...VERDICTS].sort());
});

test('the report summarises every verdict bucket and is binding once ratified', () => {
  const report = auditFixtures([
    'compliant-project',
    'drifted-project',
    'raw-http-project',
    'provider-sdk-project',
    'plain-project',
  ]);
  assert.equal(report.schema, 'fleet.ai-client-audit.v1');
  assert.equal(report.advisory, false);
  assert.equal(report.standard.status, 'ratified');
  assert.deepEqual(report.summary, {
    projects: 5,
    scanned: 5,
    compliant: 1,
    drifted: 1,
    'hand-rolled': 2,
    exception: 0,
    'not-applicable': 1,
  });
  assert.deepEqual(
    report.blocking.map((entry) => entry.code).sort(),
    ['RETIRED_GATEWAY_ENV', 'RETIRED_GATEWAY_HOST']
  );
});

test('omitPrivate counts private repositories without naming them', () => {
  const report = auditAiClients({
    projects: [
      { id: 'compliant-project', repo: 'compliant-project', repositoryVisibility: 'public' },
      { id: 'raw-http-project', repo: 'raw-http-project', repositoryVisibility: 'private' },
    ],
    fleetRoot: fixtureRoot,
    standard,
    omitPrivate: true,
    now: Date.parse('2026-08-29T00:00:00.000Z'),
  });
  assert.deepEqual(
    report.results.map((result) => result.id),
    ['compliant-project']
  );
  assert.equal(report.summary.projects, 2);
  assert.equal(report.summary['hand-rolled'], 1);
  assert.equal(report.withheld.projects, 1);
  assert.equal(report.withheld.byVerdict['hand-rolled'], 1);
  assert.equal(JSON.stringify(report).includes('raw-http-project'), false);
});

test('normaliseProjectList accepts the catalog shape, plain ids, and drops duplicates', () => {
  assert.deepEqual(
    normaliseProjectList({
      projects: [
        { id: 'alpha', repo: 'alpha', name: 'Alpha' },
        { id: 'alpha', repo: 'alpha' },
        { id: 'beta', sourcePath: 'beta/apps/web' },
        { id: 'gamma' },
      ],
    }).map((project) => [project.id, project.repo]),
    [
      ['alpha', 'alpha'],
      ['beta', 'beta'],
      ['gamma', null],
    ]
  );
  assert.equal(normaliseProjectList([{ id: 'a', repo: 'a' }])[0].visibility, 'unknown');
  assert.deepEqual(normaliseProjectList(['solo']).map((project) => project.repo), ['solo']);
  assert.throws(() => normaliseProjectList({ nope: true }), /must be an array/u);
});

// ---------------------------------------------------------------------------
// Provider-host precision.
//
// `providerHostFiles` counts files that contain a provider-host string. Reading
// it as "this project calls a provider directly" produced false non-compliance
// across the fleet: placeholder text, preset pickers, documentation, comments,
// billing endpoints, and a test whose whole purpose was proving the product
// refuses those hosts. Each class below is a committed fixture of a verified
// real-world false positive, plus the two genuine bypasses that must survive.
// ---------------------------------------------------------------------------

function evidenceFor(id) {
  return auditFixtures([id]).results[0];
}

function classesIn(result) {
  return Object.fromEntries(
    Object.entries(result.evidence.providerHostBreakdown).filter(([, count]) => count > 0)
  );
}

test('every classification name is one the report declares', () => {
  for (const id of [
    'placeholder-project',
    'preset-menu-project',
    'docs-mention-project',
    'guard-test-project',
    'billing-endpoint-project',
    'test-helper-call-project',
    'env-default-bypass-project',
    'moderation-bypass-project',
  ]) {
    for (const name of Object.keys(evidenceFor(id).evidence.providerHostBreakdown)) {
      assert.ok(PROVIDER_HOST_CLASSES.includes(name), `${name} is not a declared class`);
    }
  }
});

test('bring-your-own-key placeholder text is a mention, never a call site', () => {
  const result = evidenceFor('placeholder-project');
  assert.equal(result.evidence.providerHostFiles, 2, 'the raw mention count is kept');
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { placeholder: 2 });
  // Two provider-host files used to be enough to call this non-compliant.
  assert.equal(result.verdict, 'not-applicable');
});

test('a provider picker is configuration, not a direct call site', () => {
  const result = evidenceFor('preset-menu-project');
  assert.equal(result.evidence.providerHostFiles, 2);
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { 'byo-key-config': 8 });
  // It is still a model call path, so it is not silently dropped to
  // not-applicable; it is just not reported as bypassing the gateway.
  assert.equal(result.verdict, 'hand-rolled');
  assert.doesNotMatch(result.reasons.join('\n'), /project-owned provider API directly/u);
  assert.match(result.reasons.join('\n'), /bring-your-own-key/u);
});

test('documentation and comments never count as call sites', () => {
  const result = evidenceFor('docs-mention-project');
  assert.equal(result.evidence.providerHostFiles, 2);
  assert.equal(result.evidence.providerHostMentions, 4);
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { documentation: 2, comment: 2 });
  assert.equal(result.verdict, 'not-applicable');
});

test('a test proving the product refuses provider hosts is not evidence it calls them', () => {
  const result = evidenceFor('guard-test-project');
  assert.equal(result.evidence.providerHostFiles, 2);
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { test: 5 });
  assert.doesNotMatch(result.reasons.join('\n'), /project-owned provider API directly/u);
});

test('billing and usage endpoints are provider traffic but not model calls', () => {
  const result = evidenceFor('billing-endpoint-project');
  assert.equal(result.evidence.providerHostFiles, 1);
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { 'non-inference': 2 });
  assert.equal(result.verdict, 'not-applicable');
  assert.match(result.reasons.join('\n'), /billing, usage or catalogue traffic/u);
});

test('a real provider call in a test helper is still reported, not silently dropped', () => {
  // The classifier declines to call this a violation because it cannot tell a
  // live call in a helper from fixture data. It must still be visible.
  const result = evidenceFor('test-helper-call-project');
  assert.equal(result.evidence.providerHostFiles, 1);
  assert.equal(result.evidence.providerHostMentions, 1);
  assert.equal(result.evidence.providerCallSites, 0);
  assert.deepEqual(classesIn(result), { test: 1 });
  assert.match(result.reasons.join('\n'), /1 in test code/u);
  assert.match(result.reasons.join('\n'), /Worth reading, not a verdict/u);
});

test('an environment default pointed at a provider is a genuine direct route', () => {
  const result = evidenceFor('env-default-bypass-project');
  assert.equal(result.evidence.providerCallSites, 2);
  assert.equal(result.evidence.providerCallSiteFiles, 2);
  assert.equal(result.verdict, 'hand-rolled');
  assert.match(result.reasons.join('\n'), /project-owned provider API directly at 2 call site\(s\) across 2 file\(s\)/u);
  assert.deepEqual(
    result.evidence.providerCallSiteDetail.map((entry) => `${entry.file}:${entry.line}`).sort(),
    [join('cli', 'src', 'reason.ts') + ':1', join('scripts', 'auto-publish.ts') + ':5']
  );
  // The doc comment naming the same host on line 3 is not a second call site.
  assert.equal(result.evidence.providerHostBreakdown.comment, 1);
});

test('a provider-specific path is surfaced without gateway-era warnings', () => {
  const report = auditFixtures(['moderation-bypass-project']);
  const result = report.results[0];
  assert.equal(result.evidence.providerCallSites, 1);
  assert.equal(result.evidence.providerCallSiteDetail[0].path, '/v1/moderations');
  assert.equal(result.evidence.providerCallSiteDetail[0].gatewayPathSupported, false);
  assert.equal(
    report.warnings.some((warning) => warning.includes('gateway') || warning.includes('/v1/moderations')),
    false
  );
  assert.deepEqual(report.blocking, []);
});

test('a standard model path raises no gateway-era warning', () => {
  const report = auditFixtures(['env-default-bypass-project']);
  assert.equal(
    report.warnings.some((warning) => warning.includes('not among the gateway')),
    false
  );
});

test('the report reports both numbers: raw mentions and high-confidence call sites', () => {
  const report = auditFixtures([
    'placeholder-project',
    'preset-menu-project',
    'guard-test-project',
    'env-default-bypass-project',
    'moderation-bypass-project',
  ]);
  // Nine files mention a provider host; three call sites in two projects are
  // read as a request target. Losing the first number would be its own kind of
  // blindness, so both are published.
  assert.equal(report.providerHosts.mentionFiles, 9);
  assert.equal(report.providerHosts.callSites.length, 3);
  assert.deepEqual(report.providerHosts.callSiteProjects, [
    'env-default-bypass-project',
    'moderation-bypass-project',
  ]);
});

test('a mention-only project is never dragged into a model-calling verdict', () => {
  const mentionsOnly = {
    gatewayHostFiles: 0,
    gatewayEnvFiles: 0,
    completionsPathFiles: 0,
    canonicalImportFiles: 0,
    providerSdkImportFiles: 0,
    providerHostFiles: 4,
    providerHostMentions: 9,
    providerCallSiteFiles: 0,
    providerCallSites: 0,
    providerModelPathFiles: 0,
  };
  const result = classifyProject({
    project: { id: 'mentions' },
    declared: [],
    source: mentionsOnly,
    standard,
  });
  assert.equal(result.verdict, 'not-applicable');
  assert.equal(result.pattern, 'none');
});

test('scanProviderHostUsage classifies each occurrence with a line and a path', () => {
  const occurrences = scanProviderHostUsage({
    // Padded so the three occurrences are separate neighbourhoods rather than
    // one provider picker.
    source: [
      'const DEFAULT_BASE = "https://api.openai.com/v1";',
      ...Array(10).fill('const filler = 1;'),
      '// see https://api.anthropic.com/v1/messages for the shape',
      ...Array(10).fill('const filler = 2;'),
      'const shown = { placeholder: "https://api.mistral.ai/v1" };',
    ].join('\n'),
    relativePath: join('src', 'client.ts'),
    extension: '.ts',
    standard,
  });
  assert.deepEqual(
    occurrences.map((entry) => [entry.line, entry.classification, entry.path]),
    [
      [1, 'call-site', '/v1'],
      [12, 'comment', '/v1/messages'],
      [23, 'placeholder', '/v1'],
    ]
  );
});

test('declaredUrlIdentifier separates a request target from an object property', () => {
  assert.equal(declaredUrlIdentifier("const AI_BASE_URL = process.env.X ?? 'https://x';"), 'AI_BASE_URL');
  assert.equal(declaredUrlIdentifier('let url = "https://x";'), 'url');
  assert.equal(declaredUrlIdentifier("  endpointUrl: 'https://x',"), null);
  assert.equal(declaredUrlIdentifier("  baseUrl: 'https://x',"), null);
  assert.equal(declaredUrlIdentifier('const label = "OpenAI";'), null);
  assert.equal(declaredUrlIdentifier('case .openai: return "https://x"'), null);
});

test('a quoted glob does not open a block comment that swallows the file', () => {
  // A real regression: `'GET /**'` and `tmp/*/chats` opened a comment that hid
  // every later call site in the file.
  const map = commentLineMap(
    [
      "const routes = ['GET /**', 'POST /api/create'];",
      "const chats = '~/.gemini/tmp/*/chats/session-*.json';",
      "await fetch('https://api.openai.com/v1/chat/completions');",
      '/* a real block comment',
      '   still inside it */',
      'const after = 1;',
    ],
    '.ts'
  );
  assert.deepEqual(map, [false, false, false, true, true, false]);
});
