import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  AhrefsSiteAuditError,
  collectAhrefsSiteAuditHealth,
  normalizeBrands,
  renderAhrefsSiteAuditErrorMarkdown,
  renderAhrefsSiteAuditMarkdown,
} from '../lib/ahrefs-site-audit.mjs';
import {
  DEFAULT_BRANDS_PATH,
  DEFAULT_OUTPUT_PATH,
  loadCanonicalBrands,
  runAhrefsSiteAuditHealth,
} from '../scripts/ahrefs-site-audit-health.mjs';

const BRANDS = [
  { rootDomain: 'karte.cc', canonicalName: 'Karte' },
  { rootDomain: 'sassmaker.com', canonicalName: 'SaaS Maker' },
];
const NOW = '2026-08-20T12:00:00.000Z';

function jsonResponse(status, body, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  };
}

function healthscore(overrides = {}) {
  return {
    project_id: '1',
    project_name: 'Karte',
    target_url: 'https://karte.cc/',
    status: 'Completed',
    date: '2026-08-18',
    health_score: 92,
    total: 40,
    urls_with_errors: 1,
    urls_with_warnings: 2,
    urls_with_notices: 3,
    ...overrides,
  };
}

test('standalone paths leave the retired Fleet root behind', () => {
  assert.equal(
    DEFAULT_BRANDS_PATH,
    resolve(import.meta.dirname, '../../site-health/apps/backend/config/root-brands.json'),
  );
  assert.equal(
    DEFAULT_OUTPUT_PATH,
    resolve(import.meta.dirname, '../docs/ahrefs-site-audit-latest.md'),
  );
  assert.doesNotMatch(DEFAULT_BRANDS_PATH, /foundry\//);
  assert.doesNotMatch(DEFAULT_OUTPUT_PATH, /foundry\//);
});

test('missing API key fails closed before any provider call', async () => {
  let called = false;
  await assert.rejects(
    () => collectAhrefsSiteAuditHealth({
      brands: BRANDS,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, { healthscores: [] });
      },
    }),
    (error) => error instanceof AhrefsSiteAuditError && error.code === 'missing-api-key',
  );
  assert.equal(called, false);
});

test('401 and 403 are entitlement failures', async () => {
  await assert.rejects(
    () => collectAhrefsSiteAuditHealth({
      apiKey: 'k',
      brands: BRANDS,
      fetchImpl: async () => jsonResponse(401, {}, 'Unauthorized'),
    }),
    (error) => error.code === 'auth-entitlement-error' && error.httpStatus === 401,
  );
  await assert.rejects(
    () => collectAhrefsSiteAuditHealth({
      apiKey: 'k',
      brands: BRANDS,
      fetchImpl: async () => jsonResponse(403, {}, 'Forbidden'),
    }),
    (error) => error.code === 'auth-entitlement-error' && error.httpStatus === 403,
  );
});

test('network and invalid payloads fail closed', async () => {
  await assert.rejects(
    () => collectAhrefsSiteAuditHealth({
      apiKey: 'k',
      brands: BRANDS,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    (error) => error.code === 'request-failed',
  );
  await assert.rejects(
    () => collectAhrefsSiteAuditHealth({
      apiKey: 'k',
      brands: BRANDS,
      fetchImpl: async () => jsonResponse(200, { projects: [] }),
    }),
    (error) => error.code === 'invalid-response',
  );
});

test('maps a fresh crawl and keeps null metrics as null', async () => {
  const result = await collectAhrefsSiteAuditHealth({
    apiKey: 'k',
    brands: BRANDS,
    now: NOW,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.ahrefs.com/v3/site-audit/projects');
      assert.equal(init.headers.Authorization, 'Bearer k');
      return jsonResponse(200, {
        healthscores: [
          healthscore(),
          healthscore({
            project_id: '2',
            project_name: 'SaaS Maker',
            target_url: 'https://www.sassmaker.com',
            health_score: null,
            total: null,
            urls_with_errors: null,
            urls_with_warnings: null,
            urls_with_notices: null,
          }),
        ],
      });
    },
  });

  assert.equal(result.schema, 'fleet.ahrefs-site-audit-health.v1');
  assert.equal(result.status, 'complete');
  assert.equal(result.summary.fresh, 2);
  assert.equal(result.observations[0].status, 'fresh');
  assert.equal(result.observations[1].rootDomain, 'sassmaker.com');
  assert.equal(result.observations[1].siteAudit.healthScore, null);
  assert.equal(result.observations[1].siteAudit.urlsWithErrors, null);
  const markdown = renderAhrefsSiteAuditMarkdown(result);
  assert.match(markdown, /Karte/);
  assert.match(markdown, /\| – \| 2026-08-18 \| – \| – \| – \| – \| SaaS Maker \|/);
  assert.doesNotMatch(markdown, /Bearer|AHREFS_API_KEY|healthscores/);
});

test('grades missing, stale, incomplete, future, and ambiguous projects', async () => {
  const result = await collectAhrefsSiteAuditHealth({
    apiKey: 'k',
    brands: [
      { rootDomain: 'missing.example', canonicalName: 'Missing' },
      { rootDomain: 'stale.example', canonicalName: 'Stale' },
      { rootDomain: 'running.example', canonicalName: 'Running' },
      { rootDomain: 'future.example', canonicalName: 'Future' },
      { rootDomain: 'karte.cc', canonicalName: 'Karte' },
    ],
    now: NOW,
    maxAgeDays: 14,
    fetchImpl: async () => jsonResponse(200, {
      healthscores: [
        healthscore({
          project_id: 's',
          project_name: 'Stale',
          target_url: 'https://stale.example',
          date: '2026-07-01',
        }),
        healthscore({
          project_id: 'r',
          project_name: 'Running',
          target_url: 'https://running.example',
          status: 'Running',
        }),
        healthscore({
          project_id: 'f',
          project_name: 'Future',
          target_url: 'https://future.example',
          date: '2026-08-22',
        }),
        healthscore({ project_id: 'k1', project_name: 'Karte A' }),
        healthscore({ project_id: 'k2', project_name: 'Karte B' }),
      ],
    }),
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(
    Object.fromEntries(result.observations.map((entry) => [entry.rootDomain, entry.status])),
    {
      'missing.example': 'missing-project',
      'stale.example': 'stale-crawl',
      'running.example': 'crawl-not-completed',
      'future.example': 'future-crawl',
      'karte.cc': 'ambiguous-project',
    },
  );
  assert.equal(result.observations[0].siteAudit.healthScore, null);
});

test('error markdown never invents zero scores', () => {
  const markdown = renderAhrefsSiteAuditErrorMarkdown(
    new AhrefsSiteAuditError('auth-entitlement-error', 'denied', { httpStatus: 403 }),
    { now: NOW },
  );
  assert.match(markdown, /blocked — auth-entitlement-error \(HTTP 403\)/);
  assert.match(markdown, /never written as zero|never reported as zero|No Site Audit metric is reported as zero/);
  assert.doesNotMatch(markdown, /Health Score \| 0/);
});

test('missing Site Health catalog fails closed without contacting Ahrefs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahrefs-site-audit-'));
  const outputPath = join(directory, 'report.md');
  let called = false;
  const outcome = await runAhrefsSiteAuditHealth({
    apiKey: 'k',
    act: false,
    brandsPath: join(directory, 'missing.json'),
    outputPath,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, { healthscores: [] });
    },
  });
  assert.equal(called, false);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'missing-brand-catalog');
  assert.match(readFileSync(outputPath, 'utf8'), /blocked — missing-brand-catalog/);
  assert.match(outcome.error.message, /does not own the brand catalog/);
});

test('CLI writes a sanitized report from the Site Health catalog shape', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahrefs-site-audit-'));
  const brandsPath = join(directory, 'root-brands.json');
  const outputPath = join(directory, 'docs', 'ahrefs-site-audit-latest.md');
  writeFileSync(brandsPath, JSON.stringify({
    version: 1,
    brands: [{ rootDomain: 'karte.cc', canonicalName: 'Karte', alternateNames: ['Karte.cc'] }],
  }));

  const outcome = await runAhrefsSiteAuditHealth({
    apiKey: 'k',
    act: false,
    brandsPath,
    outputPath,
    now: NOW,
    fetchImpl: async () => jsonResponse(200, { healthscores: [healthscore()] }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.observations[0].status, 'fresh');
  const markdown = readFileSync(outputPath, 'utf8');
  assert.match(markdown, /fresh coverage: 1\/1/i);
  assert.doesNotMatch(markdown, /foundry\/ops|Bearer k|project_id/);
});

test('missing key through the operator entrypoint writes a blocked report', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahrefs-site-audit-'));
  const outputPath = join(directory, 'blocked.md');
  const previous = process.env.AHREFS_API_KEY;
  delete process.env.AHREFS_API_KEY;
  try {
    const outcome = await runAhrefsSiteAuditHealth({
      brands: BRANDS,
      act: false,
      outputPath,
      now: NOW,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, 'missing-api-key');
    assert.match(readFileSync(outputPath, 'utf8'), /blocked — missing-api-key/);
  } finally {
    if (previous == null) delete process.env.AHREFS_API_KEY;
    else process.env.AHREFS_API_KEY = previous;
  }
});

test('normalizeBrands reads the Site Health catalog contract', () => {
  assert.deepEqual(
    normalizeBrands({
      version: 1,
      brands: [{ rootDomain: 'https://www.karte.cc', canonicalName: 'Karte' }],
    }),
    [{ rootDomain: 'karte.cc', canonicalName: 'Karte' }],
  );
  assert.throws(
    () => loadCanonicalBrands(join(tmpdir(), 'does-not-exist-root-brands.json')),
    (error) => error.code === 'missing-brand-catalog',
  );
});

test('blocked Ahrefs still emits local source actions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahrefs-site-audit-'));
  const outputPath = join(directory, 'report.md');
  const pages = {
    'https://karte.cc/sitemap.xml': {
      status: 200,
      headers: { get: () => 'application/xml' },
      text: async () => '<urlset><url><loc>https://karte.cc/about</loc></url></urlset>',
    },
    'https://karte.cc/sitemap-index.xml': {
      status: 404,
      headers: { get: () => 'text/plain' },
      text: async () => 'missing',
    },
    'https://karte.cc/about': {
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><head><title>About</title><link rel="canonical" href="https://karte.cc/about"></head><body><h2>About</h2></body></html>',
    },
    'https://sassmaker.com/sitemap.xml': {
      status: 200,
      headers: { get: () => 'application/xml' },
      text: async () => '<urlset><url><loc>https://sassmaker.com/</loc></url></urlset>',
    },
    'https://sassmaker.com/sitemap-index.xml': {
      status: 404,
      headers: { get: () => 'text/plain' },
      text: async () => 'missing',
    },
    'https://sassmaker.com/': {
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><head><title>SaaS Maker</title><link rel="canonical" href="https://sassmaker.com/"></head><body><h1>Studio</h1></body></html>',
    },
  };
  const outcome = await runAhrefsSiteAuditHealth({
    apiKey: 'k',
    brands: BRANDS,
    outputPath,
    now: NOW,
    fetchImpl: async () => { throw new Error('ahrefs down'); },
    localFetchImpl: async (url) => pages[url] ?? {
      status: 404,
      headers: { get: () => 'text/plain' },
      text: async () => 'missing',
    },
  });
  assert.equal(outcome.error.code, 'request-failed');
  assert.equal(outcome.actions.length, 1);
  assert.equal(outcome.actions[0].code, 'missing-h1');
  assert.equal(outcome.actions[0].url, 'https://karte.cc/about');
  assert.match(readFileSync(outputPath, 'utf8'), /Add one visible page-level h1/);
});
