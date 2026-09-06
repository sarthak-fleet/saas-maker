import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { gradeHeadParity, statusClass } from '../lib/head-parity.mjs';

test('a host that answers HEAD as it answers GET passes', async () => {
  const check = await gradeHeadParity({
    probes: [
      { url: 'https://example.com/', label: '/', status: 200 },
      { url: 'https://example.com/llms.txt', label: '/llms.txt', status: 200 },
    ],
    head: async () => ({ status: 200 }),
  });
  assert.equal(check.status, 'pass');
  assert.equal(check.data.checked, 2);
  assert.deepEqual(check.data.mismatches, []);
});

test('HEAD 404 against GET 200 fails the route and names it', async () => {
  // The #93 blind spot: sassmaker.com interior routes returned 404 to HEAD and
  // 200 to GET, and a GET-only audit scored the site fully healthy.
  const check = await gradeHeadParity({
    probes: [
      { url: 'https://sassmaker.com/', label: '/', status: 200 },
      { url: 'https://sassmaker.com/learnings', label: '/learnings', status: 200 },
      { url: 'https://sassmaker.com/projects', label: '/projects', status: 200 },
    ],
    head: async (url) => ({ status: url.endsWith('/') ? 200 : 404 }),
  });
  assert.equal(check.status, 'fail');
  assert.equal(check.data.checked, 3);
  assert.deepEqual(check.data.mismatches, [
    { route: '/learnings', get: 200, head: 404 },
    { route: '/projects', get: 200, head: 404 },
  ]);
  assert.match(check.detail, /\/learnings HEAD 404 vs GET 200/);
});

test('a route that 404s to both verbs is consistent, not a parity failure', async () => {
  assert.equal(statusClass(404), 4);
  assert.equal(statusClass(0), 0);
  const check = await gradeHeadParity({
    probes: [{ url: 'https://example.com/gone', label: '/gone', status: 404 }],
    head: async () => ({ status: 404 }),
  });
  assert.equal(check.status, 'pass');
});

test('status classes are compared, not exact codes', async () => {
  // A 200 that becomes a 204 to HEAD is the same class and not a defect; a 200
  // that becomes a 500 is.
  const same = await gradeHeadParity({
    probes: [{ url: 'https://example.com/x', label: '/x', status: 200 }],
    head: async () => ({ status: 204 }),
  });
  assert.equal(same.status, 'pass');
  const different = await gradeHeadParity({
    probes: [{ url: 'https://example.com/x', label: '/x', status: 200 }],
    head: async () => ({ status: 500 }),
  });
  assert.equal(different.status, 'fail');
});

test('the HEAD carries the same Accept as the GET it is compared with', async () => {
  // Comparing a Markdown-negotiated GET against a bare HEAD reports negotiation
  // as a routing defect: anime.significanthobbies.com answers 404 to
  // `Accept: text/markdown` on routes that exist, and 200 to a bare HEAD.
  const sent = [];
  const check = await gradeHeadParity({
    probes: [
      { url: 'https://example.com/api/ai', label: '/api/ai', status: 200, accept: 'application/json' },
      { url: 'https://example.com/robots.txt', label: '/robots.txt', status: 200 },
    ],
    head: async (url, accept) => {
      sent.push([new URL(url).pathname, accept]);
      return { status: 200 };
    },
  });
  assert.equal(check.status, 'pass');
  assert.deepEqual(sent.sort(), [
    ['/api/ai', 'application/json'],
    ['/robots.txt', undefined],
  ]);
});

test('a route GET could not reach at all is not compared', async () => {
  const check = await gradeHeadParity({
    probes: [{ url: 'https://example.com/x', label: '/x', status: 0 }],
    head: async () => {
      throw new Error('HEAD must not be issued for an unreachable GET');
    },
  });
  assert.equal(check.status, 'skip');
});

test('a HEAD that cannot connect fails against a reachable GET', async () => {
  const check = await gradeHeadParity({
    probes: [{ url: 'https://example.com/x', label: '/x', status: 200 }],
    head: async () => ({ status: 0, error: 'ECONNRESET' }),
  });
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /HEAD err vs GET 200/);
});

test('end to end against a server that resolves a path for GET but not HEAD', async () => {
  const server = createServer((req, res) => {
    // The shape of the Cloudflare Pages defect: the extensionless path is
    // resolved to an emitted .html asset for GET, and missed for HEAD.
    if (req.url === '/learnings' && req.method === 'HEAD') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>ok</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const probes = [];
    for (const path of ['/', '/learnings']) {
      const response = await fetch(`${base}${path}`);
      probes.push({ url: `${base}${path}`, label: path, status: response.status });
    }
    const check = await gradeHeadParity({
      probes,
      head: async (url) => ({ status: (await fetch(url, { method: 'HEAD' })).status }),
    });
    assert.equal(check.status, 'fail');
    assert.deepEqual(check.data.mismatches, [{ route: '/learnings', get: 200, head: 404 }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
