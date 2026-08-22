import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPage,
  collectLocalSiteAudit,
  isAuditableHtmlPage,
} from '../lib/local-site-audit.mjs';

test('skips agent surfaces and non-HTML endpoints', () => {
  assert.equal(isAuditableHtmlPage('https://rolepatch.com/index.md'), false);
  assert.equal(isAuditableHtmlPage('https://rolepatch.com/llms.txt'), false);
  assert.equal(isAuditableHtmlPage('https://rolepatch.com/api/ai'), false);
  assert.equal(isAuditableHtmlPage('https://rolepatch.com/about'), true);
});

test('classifies missing h1 as an error action and ignores JSON catalogs', () => {
  const html = classifyPage({
    url: 'https://sarthakagrawal.dev/about',
    status: 200,
    contentType: 'text/html',
    body: '<html><title>About</title><body><h2>About</h2></body></html>',
  });
  assert.deepEqual(html.map((issue) => issue.code), ['missing-h1', 'missing-canonical']);
  assert.equal(html[0].severity, 'error');

  const json = classifyPage({
    url: 'https://rolepatch.com/api/ai',
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"name":"RolePatch"}',
  });
  assert.deepEqual(json, []);
});

test('4xx sitemap URLs become restore-or-remove actions', async () => {
  const result = await collectLocalSiteAudit({
    brands: [{ rootDomain: 'example.test', canonicalName: 'Example' }],
    now: '2026-08-22T00:00:00.000Z',
    fetchImpl: async (url) => {
      if (String(url).includes('sitemap.xml')) {
        return {
          status: 200,
          headers: { get: () => 'application/xml' },
          text: async () => '<urlset><url><loc>https://example.test/gone</loc></url></urlset>',
        };
      }
      return {
        status: 404,
        headers: { get: () => 'text/html' },
        text: async () => '<html><title>Not found</title></html>',
      };
    },
  });
  assert.equal(result.summary.errorActions, 1);
  assert.equal(result.actions[0].code, 'http-404');
  assert.match(result.actions[0].action, /Restore the page or remove the URL from the sitemap/);
});
