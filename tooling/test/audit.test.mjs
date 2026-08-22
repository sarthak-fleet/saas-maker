import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  probeOnce,
  runAudit,
  validateManifest,
} from '../scripts/audit.mjs';

const VALID_MANIFEST = {
  schemaVersion: 1,
  sites: [{ id: 'example', url: 'https://example.com', probePath: '/' }],
};

test('manifest accepts only the public allowlist', () => {
  assert.deepEqual(validateManifest(VALID_MANIFEST), VALID_MANIFEST);
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, repository: 'private/path' }),
    /keys invalid/,
  );
  assert.throws(
    () => validateManifest({
      schemaVersion: 1,
      sites: [{ ...VALID_MANIFEST.sites[0], token: 'not-allowed' }],
    }),
    /keys invalid/,
  );
});

test('manifest rejects credentials and unsafe paths', () => {
  assert.throws(
    () => validateManifest({
      schemaVersion: 1,
      sites: [{ id: 'bad', url: 'https://user:pass@example.com', probePath: '/' }],
    }),
    /credential-free/,
  );
  assert.throws(
    () => validateManifest({
      schemaVersion: 1,
      sites: [{ id: 'bad', url: 'https://example.com', probePath: '/../private' }],
    }),
    /safe path/,
  );
});

test('probe records redirects without response bodies', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, { location: '/final' });
      response.end('ignored redirect body');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('body must not appear in the report');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await probeOnce(
      { id: 'local', url: `http://127.0.0.1:${address.port}`, probePath: '/start' },
      { timeoutMs: 2_000 },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'insecure-redirect');
    assert.equal(JSON.stringify(result).includes('ignored redirect body'), false);
  } finally {
    server.close();
  }
});

test('audit produces bounded aggregate metrics', async () => {
  const probe = async () => ({
    ok: true,
    status: 200,
    finalUrl: 'https://example.com/',
    headersMs: 10,
    totalMs: 12,
    redirects: [],
  });
  const report = await runAudit(VALID_MANIFEST, { mode: 'availability', runs: 1, probe });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, 'availability');
  assert.equal(report.runs, 1);
  assert.equal(report.results.length, 1);
  assert.equal('body' in report.results[0], false);
  await assert.rejects(
    () => runAudit(VALID_MANIFEST, { mode: 'performance', runs: 6, probe }),
    /runs must be an integer from 1 to 5/,
  );
});
