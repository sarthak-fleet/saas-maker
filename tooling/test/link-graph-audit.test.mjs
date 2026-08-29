import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditLinkGraph,
  extractAnchorHrefs,
} from '../scripts/link-graph-audit.mjs';

function response(status, body = '', headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
    body: { cancel: async () => {} },
  };
}

test('extractAnchorHrefs keeps HTTP anchors and removes fragments', () => {
  const urls = extractAnchorHrefs(
    '<a href="/about#team">About</a><a href="mailto:a@example.com">Mail</a><a href="https://else.test/x?y=1&amp;z=2">Else</a>',
    'https://example.test/',
  );
  assert.deepEqual(urls.map((url) => url.href), [
    'https://example.test/about',
    'https://else.test/x?y=1&z=2',
  ]);
});

test('auditLinkGraph reports internal errors, redirects, orphans, and external errors', async () => {
  const pages = new Map([
    ['http://127.0.0.1:4000/sitemap.xml', response(200, '<urlset><url><loc>https://example.test/</loc></url></urlset>')],
    ['http://127.0.0.1:4000/', response(200, '<a href="/?view=all">View</a><a href="/data.csv">Data</a><a href="/missing">Missing</a><a href="/old">Old</a><a href="/orphan">Orphan</a><a href="https://external.test/dead">External</a>')],
    ['http://127.0.0.1:4000/?view=all', response(200)],
    ['http://127.0.0.1:4000/data.csv', response(200)],
    ['http://127.0.0.1:4000/missing', response(404)],
    ['http://127.0.0.1:4000/old', response(301, '', { location: '/new' })],
    ['http://127.0.0.1:4000/orphan', response(200)],
    ['https://external.test/dead', response(500)],
  ]);
  const result = await auditLinkGraph({
    sitemap: 'https://example.test/sitemap.xml',
    localOrigin: 'http://127.0.0.1:4000',
    canonicalOrigin: 'https://example.test',
    external: true,
    now: '2026-08-28T00:00:00.000Z',
    fetchImpl: async (url) => pages.get(String(url)) ?? response(404),
  });
  assert.deepEqual(result.summary, {
    sitemapPages: 1,
    sitemapFiles: 1,
    crawledPages: 1,
    discoveredInternal: 6,
    internalErrors: 1,
    internalRedirects: 1,
    orphanCandidates: 3,
    discoveredExternal: 1,
    checkedExternal: 1,
    externalErrors: 1,
    externalRedirects: 0,
    externalUnverified: 0,
  });
  assert.equal(result.issues.internalErrors[0].url, 'https://example.test/missing');
  assert.deepEqual(result.issues.internalErrors[0].sources, ['https://example.test/']);
  assert.equal(result.issues.internalRedirects[0].location, '/new');
});
