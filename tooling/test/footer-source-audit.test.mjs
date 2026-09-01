import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import {
  auditFooterSources,
  inspectFooterSource,
  validateManifest,
} from '../scripts/footer-source-audit.mjs';

const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'footer-source-audit-'));
  scratch.push(root);
  for (const [path, source] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, source);
  }
  return root;
}

function manifest(surfaces) {
  return { schemaVersion: 1, updatedAt: '2026-09-01', surfaces };
}

const paired = '<script src="https://sassmaker.com/project-strip.js"></script>\n'
  + '<script src="/ai-chat-footer.js"></script>\n';

test('inspectFooterSource recognizes hosted and same-origin loader names', () => {
  assert.deepEqual(inspectFooterSource(paired), {
    projectStripLoaders: 1,
    aiFooterLoaders: 1,
    ordered: true,
    composeOptOut: false,
  });
  assert.equal(
    inspectFooterSource('<script src="/portfolio-project-strip.js"></script>').projectStripLoaders,
    1,
  );
});

test('a required visual surface and shared factory pass when every named file is paired', () => {
  const root = fixture({ 'product/layout.astro': paired, 'factory/layout.astro': paired });
  const report = auditFooterSources({
    fleetRoot: root,
    now: Date.parse('2026-09-01T00:00:00.000Z'),
    manifest: manifest([
      { id: 'product', kind: 'visual', state: 'required', files: ['product/layout.astro'] },
      { id: 'factory', kind: 'factory', state: 'required', files: ['factory/layout.astro'] },
    ]),
  });
  assert.deepEqual(report.summary, {
    visual: 1,
    factories: 1,
    required: 2,
    compliant: 2,
    compliantVisual: 1,
    compliantFactories: 1,
    acknowledgedExceptions: 0,
    findings: 0,
    blocking: 0,
  });
});

test('missing loaders, reversed order, opt-outs, and missing files block required source', () => {
  const root = fixture({
    'product/reversed.html': '<script src="/ai-chat-footer.js"></script><script src="/project-strip.js"></script>',
    'product/opt-out.html': '<script src="/project-strip.js"></script><script src="/ai-chat-footer.js" data-compose="false"></script>',
  });
  const report = auditFooterSources({
    fleetRoot: root,
    manifest: manifest([
      {
        id: 'product',
        kind: 'visual',
        state: 'required',
        files: ['product/reversed.html', 'product/opt-out.html', 'product/missing.html'],
      },
    ]),
  });
  assert.deepEqual(
    report.blocking.map((entry) => entry.code).sort(),
    ['COMPOSE_OPT_OUT', 'LOADER_ORDER', 'MISSING_SOURCE'],
  );
});

test('a dated retirement exception reports matching debt and fails when it becomes stale', () => {
  const debt = '<script src="/project-strip.js"></script><script src="/ai-chat-footer.js" data-compose={false}></script>';
  const exception = {
    id: 'retired-product',
    kind: 'visual',
    state: 'retired-exception',
    files: ['retired/index.html'],
    allows: ['COMPOSE_OPT_OUT'],
    recordedAt: '2026-09-01',
    reason: 'The retired repository requires owner approval before source reactivation.',
  };
  const root = fixture({ 'retired/index.html': debt });
  const report = auditFooterSources({ fleetRoot: root, manifest: manifest([exception]) });
  assert.equal(report.summary.acknowledgedExceptions, 1);
  assert.equal(report.summary.blocking, 0);
  assert.equal(report.findings[0].code, 'COMPOSE_OPT_OUT');

  rmSync(join(root, 'retired/index.html'));
  const missing = auditFooterSources({ fleetRoot: root, manifest: manifest([exception]) });
  assert.equal(missing.blocking.some((entry) => entry.code === 'MISSING_SOURCE'), true);

  writeFileSync(join(root, 'retired/index.html'), paired);
  const stale = auditFooterSources({ fleetRoot: root, manifest: manifest([exception]) });
  assert.equal(stale.blocking[0].code, 'STALE_EXCEPTION');
});

test('manifest validation rejects unknown fields, duplicate ids, and unsafe paths', () => {
  const result = validateManifest(manifest([
    { id: 'same', kind: 'visual', state: 'required', files: ['safe.html'], surprise: true },
    { id: 'same', kind: 'visual', state: 'required', files: ['../unsafe.html'] },
  ]));
  assert.equal(result.valid, false);
  assert.match(result.problems.join('\n'), /unsupported field surprise/u);
  assert.match(result.problems.join('\n'), /duplicate id/u);
  assert.match(result.problems.join('\n'), /safe relative paths/u);
});
