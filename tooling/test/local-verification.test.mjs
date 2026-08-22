import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  validateQualification,
  runProbe,
  waitForReadiness,
  verifyPatchSelection,
  runFailureInjection,
  qualify,
  startProcess,
  stopProcess,
} from '../lib/local-verification.mjs';

const SHA_A = '0123456789abcdef0123456789abcdef01234567';
const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';

// ---------------------------------------------------------------------------
// Helpers: create a temporary HTTP server that serves health + SHA endpoints.
// ---------------------------------------------------------------------------

function startMockServer({ port = 0, sha = SHA_A, breakHealth = false } = {}) {
  const server = createServer((request, response) => {
    if (request.url === '/health' && !breakHealth) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }
    if (request.url === '/health' && breakHealth) {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('not ok');
      return;
    }
    if (request.url === '/__sha') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(sha);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

test('qualification config validates the allowlisted schema', () => {
  const valid = {
    schema: 'fleet.local-verification-qualification.v1',
    project: 'test-project',
    startCommand: ['node', 'server.mjs'],
    readinessProbes: [
      { type: 'http', name: 'health', url: 'http://127.0.0.1:8787/health', status: 200 },
    ],
    patchSelection: { type: 'http', url: 'http://127.0.0.1:8787/__sha', pattern: '([0-9a-f]{40})' },
  };
  const config = validateQualification(valid);
  assert.equal(config.project, 'test-project');
  assert.equal(config.timeoutSeconds, 300);
  assert.equal(config.pollIntervalSeconds, 2);
});

test('qualification config rejects unknown keys and invalid probes', () => {
  assert.throws(
    () => validateQualification({
      schema: 'fleet.local-verification-qualification.v1',
      project: 'bad',
      startCommand: ['node', 's.mjs'],
      readinessProbes: [{ type: 'http', url: 'http://127.0.0.1:1/' }],
      patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
      extra: true,
    }),
    /unknown keys/,
  );

  assert.throws(
    () => validateQualification({
      schema: 'fleet.local-verification-qualification.v1',
      project: 'bad',
      startCommand: ['node', 's.mjs'],
      readinessProbes: [{ type: 'invalid' }],
      patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
    }),
    /type must be one of/,
  );

  assert.throws(
    () => validateQualification({
      schema: 'wrong',
      project: 'bad',
      startCommand: ['node', 's.mjs'],
      readinessProbes: [{ type: 'http', url: 'http://127.0.0.1:1/' }],
      patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
    }),
    /schema must be/,
  );

  assert.throws(
    () => validateQualification({
      schema: 'fleet.local-verification-qualification.v1',
      project: 'bad',
      startCommand: ['node', 's.mjs'],
      readinessProbes: [{ type: 'http', url: 'http://example.com/' }],
      patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
    }),
    /localhost/,
  );

  assert.throws(
    () => validateQualification({
      schema: 'fleet.local-verification-qualification.v1',
      project: 'bad',
      startCommand: ['node', 's.mjs'],
      readinessProbes: [{ type: 'http', url: 'http://127.0.0.1:1/' }],
      patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
      failureInjection: { startCommand: [] },
    }),
    /non-empty array/,
  );
});

// ---------------------------------------------------------------------------
// Individual probes
// ---------------------------------------------------------------------------

test('HTTP probe detects a ready server', async () => {
  const { server, port } = await startMockServer();
  try {
    const result = await runProbe({
      type: 'http',
      url: `http://127.0.0.1:${port}/health`,
      status: 200,
      bodyPattern: 'ok',
    });
    assert.equal(result.ok, true);
    assert.equal(result.detail, '200');
  } finally {
    server.close();
  }
});

test('HTTP probe detects a broken server', async () => {
  const { server, port } = await startMockServer({ breakHealth: true });
  try {
    const result = await runProbe({
      type: 'http',
      url: `http://127.0.0.1:${port}/health`,
      status: 200,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /503/);
  } finally {
    server.close();
  }
});

test('TCP probe detects an open port', async () => {
  const { server, port } = await startMockServer();
  try {
    const result = await runProbe({ type: 'tcp', port });
    assert.equal(result.ok, true);
  } finally {
    server.close();
  }
});

test('TCP probe detects a closed port', async () => {
  const result = await runProbe({ type: 'tcp', port: 1, timeoutSeconds: 1 });
  assert.equal(result.ok, false);
});

test('log probe matches a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-test-'));
  const logPath = join(dir, 'app.log');
  writeFileSync(logPath, 'Server ready on port 8787\n');
  try {
    const result = await runProbe({
      type: 'log',
      path: logPath,
      pattern: 'ready',
    });
    assert.equal(result.ok, true);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('log probe fails on missing file', async () => {
  const result = await runProbe({
    type: 'log',
    path: '/nonexistent/path/app.log',
    pattern: 'ready',
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /not found/);
});

test('command probe checks exit code', async () => {
  const result = await runProbe({
    type: 'command',
    command: ['node', '-e', 'process.exit(0)'],
    timeoutSeconds: 5,
  });
  assert.equal(result.ok, true);

  const failed = await runProbe({
    type: 'command',
    command: ['node', '-e', 'process.exit(1)'],
    timeoutSeconds: 5,
  });
  assert.equal(failed.ok, false);
});

// ---------------------------------------------------------------------------
// Observable readiness polling (no fixed waits)
// ---------------------------------------------------------------------------

test('waitForReadiness polls until ready', async () => {
  const { server, port } = await startMockServer();
  try {
    const result = await waitForReadiness(
      [{ type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200 }],
      { timeoutSeconds: 5, pollIntervalSeconds: 0.5 },
    );
    assert.equal(result.state, 'ready');
    assert.equal(result.attempts, 1);
    assert.equal(result.probes[0].ok, true);
  } finally {
    server.close();
  }
});

test('waitForReadiness times out when the server stays broken', async () => {
  const { server, port } = await startMockServer({ breakHealth: true });
  try {
    const result = await waitForReadiness(
      [{ type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200 }],
      { timeoutSeconds: 2, pollIntervalSeconds: 0.5 },
    );
    assert.equal(result.state, 'timeout');
    assert.ok(result.attempts >= 2);
    assert.equal(result.probes[0].ok, false);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Exact-patch selection
// ---------------------------------------------------------------------------

test('patch selection matches when the running SHA equals the expected SHA', async () => {
  const { server, port } = await startMockServer({ sha: SHA_A });
  try {
    const result = await verifyPatchSelection(
      { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
      SHA_A,
    );
    assert.equal(result.state, 'match');
    assert.equal(result.expected, SHA_A);
    assert.equal(result.observed, SHA_A);
  } finally {
    server.close();
  }
});

test('patch selection fails on a stale SHA', async () => {
  const { server, port } = await startMockServer({ sha: SHA_B });
  try {
    const result = await verifyPatchSelection(
      { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
      SHA_A,
    );
    assert.equal(result.state, 'mismatch');
    assert.equal(result.expected, SHA_A);
    assert.equal(result.observed, SHA_B);
  } finally {
    server.close();
  }
});

test('patch selection errors when the SHA endpoint is unreachable', async () => {
  const result = await verifyPatchSelection(
    { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
    SHA_A,
  );
  assert.equal(result.state, 'error');
  assert.equal(result.observed, null);
});

// ---------------------------------------------------------------------------
// Failure injection
// ---------------------------------------------------------------------------

test('failure injection detects a broken service', async () => {
  const { server, port } = await startMockServer({ breakHealth: true });
  try {
    const config = {
      schema: 'fleet.local-verification-qualification.v1',
      project: 'test',
      startCommand: ['node', '-e', 'process.exit(0)'],
      readinessProbes: [
        { type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200 },
      ],
      patchSelection: { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
      failureInjection: {
        startCommand: ['node', '-e', 'setTimeout(() => process.exit(0), 5000)'],
        expectNotReadyWithinSeconds: 3,
      },
    };
    const result = await runFailureInjection(config, { pollIntervalSeconds: 0.5 });
    assert.equal(result.state, 'detected');
  } finally {
    server.close();
  }
});

test('failure injection is skipped when not configured', async () => {
  const config = {
    schema: 'fleet.local-verification-qualification.v1',
    project: 'test',
    startCommand: ['node', '-e', 'process.exit(0)'],
    readinessProbes: [
      { type: 'http', name: 'health', url: 'http://127.0.0.1:1/health', status: 200 },
    ],
    patchSelection: { type: 'http', url: 'http://127.0.0.1:1/__sha', pattern: '([0-9a-f]{40})' },
  };
  const result = await runFailureInjection(config);
  assert.equal(result.state, 'skipped');
});

// ---------------------------------------------------------------------------
// Full qualification on two materially different project types
// ---------------------------------------------------------------------------

// Project type 1: HTTP server with HTTP health + SHA endpoints.
test('qualification passes for an HTTP server project', async () => {
  // Use a fixed high port — the startCommand spawns its own server.
  const port = 19876;
  const config = {
    schema: 'fleet.local-verification-qualification.v1',
    project: 'http-server',
    startCommand: ['node', '-e', `
      const http = require('http');
      const server = http.createServer((req, res) => {
        if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
        if (req.url === '/__sha') { res.writeHead(200); res.end('${SHA_A}'); return; }
        res.writeHead(404); res.end();
      });
      server.listen(${port}, '127.0.0.1');
    `],
    readinessProbes: [
      { type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200, bodyPattern: 'ok' },
    ],
    timeoutSeconds: 10,
    pollIntervalSeconds: 0.5,
    patchSelection: { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
    failureInjection: {
      startCommand: ['node', '-e', 'setTimeout(() => process.exit(0), 5000)'],
      expectNotReadyWithinSeconds: 3,
    },
  };

  const result = await qualify(config, {
    expectedSha: SHA_A,
    getExpectedSha: async () => SHA_A,
  });

  assert.equal(result.state, 'qualified');
  assert.equal(result.project, 'http-server');
  assert.equal(result.readiness.state, 'ready');
  assert.equal(result.patchSelection.state, 'match');
  assert.equal(result.failureInjection.state, 'detected');
  assert.equal(result.error, null);
});

// Project type 2: log-based readiness + command-based patch selection.
test('qualification passes for a log-probe project type', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-log-'));
  const logPath = join(dir, 'app.log');
  const shaPath = join(dir, 'sha.txt');

  // Simulate a service that writes a readiness log and a SHA marker file.
  const config = {
    schema: 'fleet.local-verification-qualification.v1',
    project: 'log-probe-worker',
    startCommand: ['node', '-e', `
      const fs = require('fs');
      setTimeout(() => {
        fs.writeFileSync('${logPath}', 'Ready on port 9999\\n');
        fs.writeFileSync('${shaPath}', '${SHA_B}\\n');
      }, 200);
    `],
    readinessProbes: [
      { type: 'log', name: 'ready-log', path: logPath, pattern: 'Ready on port' },
    ],
    timeoutSeconds: 10,
    pollIntervalSeconds: 0.5,
    patchSelection: {
      type: 'command',
      command: ['node', '-e', `process.stdout.write(require('fs').readFileSync('${shaPath}', 'utf8'))`],
      pattern: '([0-9a-f]{40})',
    },
    failureInjection: {
      startCommand: ['node', '-e', 'setTimeout(() => process.exit(0), 5000)'],
      expectNotReadyWithinSeconds: 3,
    },
  };

  try {
    const result = await qualify(config, {
      expectedSha: SHA_B,
      getExpectedSha: async () => SHA_B,
    });

    assert.equal(result.state, 'qualified');
    assert.equal(result.project, 'log-probe-worker');
    assert.equal(result.readiness.state, 'ready');
    assert.equal(result.readiness.probes[0].type, 'log');
    assert.equal(result.patchSelection.state, 'match');
    assert.equal(result.patchSelection.observed, SHA_B);
    assert.equal(result.failureInjection.state, 'detected');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// Qualification fails when the running SHA is stale.
test('qualification fails on a stale patch', async () => {
  const { server, port } = await startMockServer({ sha: SHA_B });
  try {
    const config = {
      schema: 'fleet.local-verification-qualification.v1',
      project: 'stale',
      startCommand: ['node', '-e', 'process.exit(0)'],
      readinessProbes: [
        { type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200 },
      ],
      timeoutSeconds: 5,
      pollIntervalSeconds: 0.5,
      patchSelection: { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
    };

    const result = await qualify(config, {
      expectedSha: SHA_A,
      getExpectedSha: async () => SHA_A,
    });

    assert.equal(result.state, 'failed');
    assert.equal(result.readiness.state, 'ready');
    assert.equal(result.patchSelection.state, 'mismatch');
    assert.equal(result.error.code, 'PATCH_MISMATCH');
  } finally {
    server.close();
  }
});

// Qualification fails when readiness times out.
test('qualification fails on readiness timeout', async () => {
  const { server, port } = await startMockServer({ breakHealth: true });
  try {
    const config = {
      schema: 'fleet.local-verification-qualification.v1',
      project: 'timeout',
      startCommand: ['node', '-e', 'process.exit(0)'],
      readinessProbes: [
        { type: 'http', name: 'health', url: `http://127.0.0.1:${port}/health`, status: 200 },
      ],
      timeoutSeconds: 2,
      pollIntervalSeconds: 0.5,
      patchSelection: { type: 'http', url: `http://127.0.0.1:${port}/__sha`, pattern: '([0-9a-f]{40})' },
    };

    const result = await qualify(config, { expectedSha: SHA_A });

    assert.equal(result.state, 'failed');
    assert.equal(result.readiness.state, 'timeout');
    assert.equal(result.patchSelection.state, 'skipped');
    assert.equal(result.error.code, 'READINESS_FAILED');
  } finally {
    server.close();
  }
});
