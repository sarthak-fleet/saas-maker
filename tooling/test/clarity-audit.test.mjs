import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  ACKNOWLEDGEABLE_CODES,
  auditClarity,
  findRegistryViolations,
  validateRegistry,
} from '../scripts/clarity-audit.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtures = join(import.meta.dirname, 'fixtures', 'clarity-audit');
const fleetRoot = join(fixtures, 'fleet');
const cleanSelfRoot = join(fixtures, 'self-clean');
const dirtySelfRoot = join(fixtures, 'self-dirty');
const now = Date.parse('2026-08-30T00:00:00.000Z');

const base = JSON.parse(readFileSync(join(fixtures, 'registry.json'), 'utf8'));
const shipped = JSON.parse(
  readFileSync(join(repositoryRoot, 'config', 'clarity-projects.json'), 'utf8')
);

function audit(registry, overrides = {}) {
  return auditClarity({
    registry,
    fleetRoot,
    selfRoot: cleanSelfRoot,
    now,
    ...overrides,
  });
}

function codesFor(report, project) {
  return report.findings
    .filter((entry) => entry.project === project)
    .map((entry) => entry.code)
    .sort();
}

test('the shipped registry validates', () => {
  const { valid, problems } = validateRegistry(shipped);
  assert.deepEqual(problems, []);
  assert.equal(valid, true);
  assert.equal(shipped.legacySharedId, 'y39u4kk9oq');
});

test('validateRegistry rejects malformed ids, undated debt, and unexplained gaps', () => {
  const badId = structuredClone(base);
  badId.projects[0].clarityId = 'Y6AAAAAAAA';
  assert.match(validateRegistry(badId).problems.join('\n'), /10 lowercase alphanumerics/u);

  const duplicateKey = structuredClone(base);
  duplicateKey.projects.push(structuredClone(base.projects[0]));
  assert.match(validateRegistry(duplicateKey).problems.join('\n'), /duplicates project id alpha/u);

  const unexplained = structuredClone(base);
  delete unexplained.projects[2].reason;
  assert.match(validateRegistry(unexplained).problems.join('\n'), /written justification/u);

  const claimWithoutFile = structuredClone(base);
  claimWithoutFile.projects[0].wiredFiles = [];
  assert.match(validateRegistry(claimWithoutFile).problems.join('\n'), /no wired file/u);

  const undated = structuredClone(base);
  undated.projects[0].violation = {
    code: 'SHARED_CLARITY_ID',
    reason: 'shares an id with another product and merges its sessions',
    fix: 'give it a project of its own and update this entry',
  };
  assert.match(validateRegistry(undated).problems.join('\n'), /recordedAt must be an ISO date/u);

  const unknownCode = structuredClone(base);
  unknownCode.projects[0].violation = {
    code: 'STALE_ACKNOWLEDGEMENT',
    recordedAt: '2026-08-30',
    reason: 'a stale acknowledgement can never itself be acknowledged away',
    fix: 'remove the record instead of recording it again',
  };
  assert.match(
    validateRegistry(unknownCode).problems.join('\n'),
    new RegExp(`must be one of: ${ACKNOWLEDGEABLE_CODES.join(', ')}`, 'u')
  );

  const noFix = structuredClone(base);
  noFix.projects[0].violation = {
    code: 'SHARED_CLARITY_ID',
    recordedAt: '2026-08-30',
    reason: 'shares an id with another product and merges its sessions',
    fix: 'tbd',
  };
  assert.match(validateRegistry(noFix).problems.join('\n'), /spell out the change/u);
});

test('a clean registry over a matching checkout has nothing to report', () => {
  const report = audit(base);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.blocking, []);
  assert.equal(report.summary.verifiedAgainstSource, true);
  assert.equal(report.registry.distinctClarityIds, 2);
  assert.equal(report.registry.noSurface, 1);
});

test('one Clarity ID claimed by two products is a finding against both', () => {
  const shared = structuredClone(base);
  shared.projects[1].clarityId = 'y6aaaaaaaa';
  shared.projects[1].wiredFiles = [];
  shared.projects[1].reason = 'Deliberately left unwired for this fixture so only the sharing is measured.';

  const registryOnly = findRegistryViolations(shared);
  assert.deepEqual(
    registryOnly.map((entry) => [entry.code, entry.project]),
    [
      ['SHARED_CLARITY_ID', 'alpha'],
      ['SHARED_CLARITY_ID', 'beta'],
    ]
  );
  assert.match(registryOnly[0].message, /claimed by 2 products \(alpha, beta\)/u);

  const report = audit(shared);
  assert.equal(report.blocking.length, 2);
  assert.equal(report.summary.byCode.SHARED_CLARITY_ID, 2);
});

test('a dated record on the borrower covers the product it borrowed from', () => {
  const shared = structuredClone(base);
  shared.projects[1].clarityId = 'y6aaaaaaaa';
  shared.projects[1].wiredFiles = [];
  shared.projects[1].reason = 'Deliberately left unwired for this fixture so only the sharing is measured.';
  shared.projects[1].violation = {
    code: 'SHARED_CLARITY_ID',
    recordedAt: '2026-08-30',
    reason: 'Beta copied alpha snippet wholesale, so both products record into one Clarity project.',
    fix: 'Create a Clarity project for beta and replace y6aaaaaaaa in its layout.',
  };

  const report = audit(shared);
  assert.equal(report.summary.byCode.SHARED_CLARITY_ID, 2);
  assert.equal(report.summary.acknowledged, 2);
  assert.deepEqual(report.blocking, []);

  const strict = audit(shared, { strict: true });
  assert.equal(strict.blocking.length, 2);
});

test('the retired fleet-wide shared project is a finding wherever it is claimed', () => {
  const legacy = structuredClone(base);
  legacy.projects.push({
    id: 'gamma',
    repo: 'gamma',
    clarityId: 'y39u4kk9oq',
    tag: 'gamma',
    wiredFiles: ['gamma/app.html'],
  });

  const report = audit(legacy);
  assert.deepEqual(codesFor(report, 'gamma'), ['LEGACY_SHARED_ID']);
  assert.equal(report.blocking.length, 1);
  assert.match(report.blocking[0].message, /retired fleet-wide shared Clarity project/u);
});

test('the retired ID inside a product that claims a different one is caught from source', () => {
  const drifted = structuredClone(base);
  drifted.projects.push({
    id: 'gamma',
    repo: 'gamma',
    clarityId: 'y6cccccccc',
    tag: 'gamma',
    wiredFiles: ['gamma/app.html'],
  });

  const report = audit(drifted);
  assert.deepEqual(codesFor(report, 'gamma'), ['LEGACY_SHARED_ID', 'UNWIRED_CLAIM']);
});

test('a claimed ID that is not in the file it names fails, and a missing file is not a pass', () => {
  const wrong = structuredClone(base);
  wrong.projects[0].clarityId = 'y6zzzzzzzz';
  wrong.projects[1].wiredFiles = ['beta/src/does-not-exist.tsx'];

  const report = audit(wrong);
  assert.deepEqual(codesFor(report, 'alpha'), ['UNWIRED_CLAIM']);
  assert.match(
    report.findings.find((entry) => entry.project === 'alpha').message,
    /claims Clarity project y6zzzzzzzz in alpha\/index\.html, but that ID is not present/u
  );
  assert.match(
    report.findings.find((entry) => entry.project === 'beta').message,
    /does not exist in this checkout/u
  );
  assert.equal(report.blocking.length, 2);
});

test('a record whose fix has landed goes stale and fails until the receipt is updated', () => {
  const fixed = structuredClone(base);
  fixed.projects[1].violation = {
    code: 'SHARED_CLARITY_ID',
    recordedAt: '2026-08-30',
    reason: 'Recorded while beta still borrowed the alpha Clarity project instead of owning one.',
    fix: 'Create a Clarity project for beta and replace the borrowed ID in its layout.',
  };

  const report = audit(fixed);
  assert.deepEqual(codesFor(report, 'beta'), ['STALE_ACKNOWLEDGEMENT']);
  assert.equal(report.blocking.length, 1);
  assert.equal(report.blocking[0].acknowledged, false);
  assert.match(report.blocking[0].message, /remove the violation record/u);
});

test('the retired ID inside this repository is blocking and cannot be recorded as debt', () => {
  const withRecord = structuredClone(base);
  withRecord.projects[0].violation = {
    code: 'LEGACY_SHARED_ID',
    recordedAt: '2026-08-30',
    reason: 'An attempt to record an in-repository leak as debt someone else has to fix.',
    fix: 'This must not silence the finding, because the file is editable from here.',
  };

  const report = auditClarity({
    registry: withRecord,
    fleetRoot,
    selfRoot: dirtySelfRoot,
    now,
  });
  const self = report.findings.filter((entry) => entry.inThisRepository);
  assert.equal(self.length, 1);
  assert.equal(self[0].acknowledged, false);
  assert.match(self[0].message, /templates\/snippet\.html/u);
  assert.equal(report.blocking.some((entry) => entry.inThisRepository), true);
});

test('a missing Fleet checkout is reported as unverified rather than passed', () => {
  const report = audit(base, { fleetRoot: join(fixtures, 'no-such-fleet') });
  assert.equal(report.summary.verifiedAgainstSource, false);
  assert.match(report.warnings.join('\n'), /validated but not verified against source/u);
  assert.deepEqual(report.blocking, []);
});

test('an unrecorded tagged surface is only found with the opt-in fleet sweep', () => {
  const quiet = audit(base);
  assert.equal(quiet.summary.byCode.UNDECLARED_CLARITY_ID, 0);

  const swept = audit(base, { scanFleet: true });
  const undeclared = swept.findings.filter((entry) => entry.code === 'UNDECLARED_CLARITY_ID');
  assert.deepEqual(
    undeclared.map((entry) => entry.message.split(' ')[0]).sort(),
    ['delta/index.html', 'gamma/app.html']
  );
  assert.equal(
    swept.findings.some(
      (entry) => entry.code === 'LEGACY_SHARED_ID' && entry.message.startsWith('gamma/app.html')
    ),
    true
  );
});

test('omitPrivate counts private repositories without naming them', () => {
  const report = audit(base, {
    omitPrivate: true,
    visibility: new Map([
      ['alpha', 'public'],
      ['beta', 'private'],
      ['epsilon', 'private'],
    ]),
  });
  assert.deepEqual(
    report.results.map((result) => result.id),
    ['alpha']
  );
  assert.equal(report.withheld.projects, 2);
  assert.equal(JSON.stringify(report.results).includes('beta'), false);
});

test('the shipped registry records both live contract violations with an exact fix', () => {
  const violations = shipped.projects.filter((entry) => entry.violation);
  assert.deepEqual(
    violations.map((entry) => [entry.id, entry.violation.code]),
    [
      ['high-signal', 'LEGACY_SHARED_ID'],
      ['live', 'SHARED_CLARITY_ID'],
    ]
  );
  assert.match(
    violations.find((entry) => entry.id === 'live').violation.fix,
    /live\/src\/app\/layout\.tsx/u
  );
  assert.match(
    violations.find((entry) => entry.id === 'high-signal').violation.fix,
    /high-signal\/apps\/web\/src\/app\/layout\.tsx/u
  );

  const findings = findRegistryViolations(shipped);
  assert.deepEqual(
    findings.map((entry) => `${entry.code}:${entry.project}`).sort(),
    ['LEGACY_SHARED_ID:high-signal', 'SHARED_CLARITY_ID:live', 'SHARED_CLARITY_ID:significanthobbies']
  );
});

test('the snippet template ships no Clarity ID and demands both substitutions', () => {
  const template = readFileSync(join(repositoryRoot, 'templates', 'clarity-snippet.html'), 'utf8');
  assert.equal(template.includes(shipped.legacySharedId), false);
  assert.doesNotMatch(template, /"y[a-z0-9]{9}"/u);
  assert.match(template, /"CLARITY_PROJECT_ID"/u);
  assert.match(template, /"PROJECT_SLUG"/u);
  assert.doesNotMatch(template, /shared Clarity project for the whole fleet/u);

  const bulk = readFileSync(join(repositoryRoot, 'scripts', 'apply-clarity-id.sh'), 'utf8');
  assert.equal(bulk.includes('templates/clarity-snippet.html'), false);
});
