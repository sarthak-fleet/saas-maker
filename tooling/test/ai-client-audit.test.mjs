import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

import {
  VERDICTS,
  auditAiClients,
  classifyProject,
  collectDeclaredPackages,
  normaliseProjectList,
  readPackageManifests,
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

test('the shipped standard validates and is still unratified', () => {
  const { valid, problems } = validateStandard(standard);
  assert.deepEqual(problems, []);
  assert.equal(valid, true);
  assert.equal(standard.status, 'unratified');
  assert.equal(standard.ratifiedAt, null);
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
  assert.match(validateStandard(claimed).problems.join('\n'), /requires ratifiedAt/u);
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

test('raw HTTP against the gateway is hand-rolled, not compliant and not skipped', () => {
  const result = auditFixtures(['raw-http-project']).results[0];
  assert.equal(result.verdict, 'hand-rolled');
  assert.equal(result.pattern, 'raw-http');
  assert.deepEqual(result.declared, []);
  assert.equal(result.evidence.gatewayHostFiles, 1);
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

test('the report summarises every verdict bucket and stays advisory while unratified', () => {
  const report = auditFixtures([
    'compliant-project',
    'drifted-project',
    'raw-http-project',
    'provider-sdk-project',
    'plain-project',
  ]);
  assert.equal(report.schema, 'fleet.ai-client-audit.v1');
  assert.equal(report.advisory, true);
  assert.equal(report.standard.status, 'unratified');
  assert.deepEqual(report.summary, {
    projects: 5,
    scanned: 5,
    compliant: 1,
    drifted: 1,
    'hand-rolled': 2,
    exception: 0,
    'not-applicable': 1,
  });
  assert.deepEqual(report.blocking, []);
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
