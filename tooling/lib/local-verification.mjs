// lib/local-verification.mjs
//
// Reusable local-verification qualification engine. Products supply a
// qualification config (see contracts/local-verification/qualification.schema.json);
// this library implements observable readiness probing, failure injection,
// exact-patch selection checks, and the qualification result envelope.
//
// No npm dependencies. Node 20+ built-in fetch, http, net, fs, child_process.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createConnection } from 'node:net';

const SCHEMA = 'fleet.local-verification-qualification.v1';
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_SECONDS = 2;
const DEFAULT_PROBE_TIMEOUT_SECONDS = 10;
const SHA_PATTERN = /([0-9a-f]{40})/;

const PROBE_TYPES = new Set(['http', 'tcp', 'log', 'command']);
const PATCH_TYPES = new Set(['http', 'log', 'command']);

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

function fail(message) {
  const error = new Error(message);
  error.code = 'ERR_QUALIFICATION_CONFIG';
  throw error;
}

function requireKeys(value, allowed, label) {
  const keys = Object.keys(value);
  const extras = keys.filter((k) => !allowed.has(k));
  if (extras.length) fail(`${label} has unknown keys: ${extras.join(', ')}`);
}

export function validateQualification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Qualification config must be an object.');
  }
  requireKeys(value, new Set([
    'schema', 'project', 'startCommand', 'startEnv',
    'readinessProbes', 'timeoutSeconds', 'pollIntervalSeconds',
    'patchSelection', 'failureInjection',
  ]), 'qualification');

  if (value.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (typeof value.project !== 'string' || !value.project.trim()) {
    fail('project must be a non-empty string.');
  }
  if (!Array.isArray(value.startCommand) || value.startCommand.length === 0) {
    fail('startCommand must be a non-empty array.');
  }
  if (value.startCommand.some((a) => typeof a !== 'string')) {
    fail('startCommand entries must be strings.');
  }
  if (value.startEnv !== undefined) {
    if (!value.startEnv || typeof value.startEnv !== 'object' || Array.isArray(value.startEnv)) {
      fail('startEnv must be an object.');
    }
    for (const [k, v] of Object.entries(value.startEnv)) {
      if (typeof v !== 'string') fail(`startEnv.${k} must be a string.`);
    }
  }
  if (!Array.isArray(value.readinessProbes) || value.readinessProbes.length === 0) {
    fail('readinessProbes must be a non-empty array.');
  }
  value.readinessProbes.forEach((probe, i) => validateProbe(probe, i));

  const timeout = value.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
    fail('timeoutSeconds must be an integer from 1 to 300.');
  }
  const interval = value.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
  if (typeof interval !== 'number' || interval < 0.5 || interval > 30) {
    fail('pollIntervalSeconds must be a number from 0.5 to 30.');
  }

  validatePatchSelection(value.patchSelection);
  if (value.failureInjection !== undefined) {
    validateFailureInjection(value.failureInjection);
  }

  return {
    schema: SCHEMA,
    project: value.project,
    startCommand: value.startCommand,
    startEnv: value.startEnv ?? {},
    readinessProbes: value.readinessProbes,
    timeoutSeconds: timeout,
    pollIntervalSeconds: interval,
    patchSelection: value.patchSelection,
    failureInjection: value.failureInjection,
  };
}

function validateProbe(probe, index) {
  const label = `readinessProbes[${index}]`;
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
    fail(`${label} must be an object.`);
  }
  requireKeys(probe, new Set([
    'type', 'name', 'url', 'status', 'bodyPattern',
    'port', 'host', 'path', 'pattern', 'command', 'expectExitCode', 'timeoutSeconds',
  ]), label);
  if (!PROBE_TYPES.has(probe.type)) {
    fail(`${label}.type must be one of: ${[...PROBE_TYPES].join(', ')}.`);
  }
  if (probe.name !== undefined && (typeof probe.name !== 'string' || !probe.name.trim())) {
    fail(`${label}.name must be a non-empty string.`);
  }
  switch (probe.type) {
    case 'http':
      if (typeof probe.url !== 'string' || !/^https?:\/\/127\.0\.0\.1(:[0-9]+)?\//.test(probe.url)) {
        fail(`${label}.url must be a localhost HTTP URL.`);
      }
      if (probe.status !== undefined && (typeof probe.status !== 'number' || probe.status < 100 || probe.status > 599)) {
        fail(`${label}.status must be a valid HTTP status.`);
      }
      break;
    case 'tcp':
      if (typeof probe.port !== 'number' || probe.port < 1 || probe.port > 65535) {
        fail(`${label}.port must be a valid port number.`);
      }
      if (probe.host !== undefined && probe.host !== '127.0.0.1' && probe.host !== 'localhost') {
        fail(`${label}.host must be 127.0.0.1 or localhost.`);
      }
      break;
    case 'log':
      if (typeof probe.path !== 'string' || !probe.path.trim()) {
        fail(`${label}.path must be a non-empty string.`);
      }
      if (typeof probe.pattern !== 'string' || !probe.pattern.trim()) {
        fail(`${label}.pattern must be a non-empty regex string.`);
      }
      break;
    case 'command':
      if (!Array.isArray(probe.command) || probe.command.length === 0) {
        fail(`${label}.command must be a non-empty array.`);
      }
      break;
  }
  if (probe.timeoutSeconds !== undefined) {
    if (typeof probe.timeoutSeconds !== 'number' || probe.timeoutSeconds < 1 || probe.timeoutSeconds > 60) {
      fail(`${label}.timeoutSeconds must be a number from 1 to 60.`);
    }
  }
}

function validatePatchSelection(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('patchSelection must be an object.');
  }
  requireKeys(patch, new Set(['type', 'url', 'path', 'pattern', 'command', 'expectSha']), 'patchSelection');
  if (!PATCH_TYPES.has(patch.type)) {
    fail(`patchSelection.type must be one of: ${[...PATCH_TYPES].join(', ')}.`);
  }
  switch (patch.type) {
    case 'http':
      if (typeof patch.url !== 'string' || !/^https?:\/\/127\.0\.0\.1(:[0-9]+)?\//.test(patch.url)) {
        fail('patchSelection.url must be a localhost HTTP URL.');
      }
      if (typeof patch.pattern !== 'string' || !patch.pattern.trim()) {
        fail('patchSelection.pattern must be a non-empty regex string.');
      }
      break;
    case 'log':
      if (typeof patch.path !== 'string' || !patch.path.trim()) {
        fail('patchSelection.path must be a non-empty string.');
      }
      if (typeof patch.pattern !== 'string' || !patch.pattern.trim()) {
        fail('patchSelection.pattern must be a non-empty regex string.');
      }
      break;
    case 'command':
      if (!Array.isArray(patch.command) || patch.command.length === 0) {
        fail('patchSelection.command must be a non-empty array.');
      }
      break;
  }
}

function validateFailureInjection(fi) {
  if (!fi || typeof fi !== 'object' || Array.isArray(fi)) {
    fail('failureInjection must be an object.');
  }
  requireKeys(fi, new Set(['startCommand', 'startEnv', 'expectNotReadyWithinSeconds']), 'failureInjection');
  if (!Array.isArray(fi.startCommand) || fi.startCommand.length === 0) {
    fail('failureInjection.startCommand must be a non-empty array.');
  }
  if (fi.startEnv !== undefined) {
    if (!fi.startEnv || typeof fi.startEnv !== 'object' || Array.isArray(fi.startEnv)) {
      fail('failureInjection.startEnv must be an object.');
    }
    for (const [k, v] of Object.entries(fi.startEnv)) {
      if (typeof v !== 'string') fail(`failureInjection.startEnv.${k} must be a string.`);
    }
  }
  const window = fi.expectNotReadyWithinSeconds ?? 30;
  if (!Number.isInteger(window) || window < 1 || window > 120) {
    fail('failureInjection.expectNotReadyWithinSeconds must be an integer from 1 to 120.');
  }
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

export function startProcess(command, env = {}, options = {}) {
  const [cmd, ...args] = command;
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: options.cwd ?? process.cwd(),
    shell: false,
  });
  return child;
}

export function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, 5_000);
    child.once('exit', () => clearTimeout(timer));
  } catch { /* already dead */ }
}

// ---------------------------------------------------------------------------
// Individual probe execution
// ---------------------------------------------------------------------------

export async function runProbe(probe) {
  const timeoutMs = (probe.timeoutSeconds ?? DEFAULT_PROBE_TIMEOUT_SECONDS) * 1_000;
  switch (probe.type) {
    case 'http': return probeHttp(probe, timeoutMs);
    case 'tcp': return probeTcp(probe, timeoutMs);
    case 'log': return probeLog(probe);
    case 'command': return probeCommand(probe, timeoutMs);
    default: return { ok: false, detail: `unknown probe type: ${probe.type}` };
  }
}

async function probeHttp(probe, timeoutMs) {
  const expectedStatus = probe.status ?? 200;
  try {
    const response = await fetch(probe.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'fleet-local-verification/1.0' },
    });
    if (response.status !== expectedStatus) {
      return { ok: false, detail: `status ${response.status} (expected ${expectedStatus})` };
    }
    if (probe.bodyPattern) {
      const body = await response.text();
      const regex = new RegExp(probe.bodyPattern);
      if (!regex.test(body)) {
        return { ok: false, detail: `body did not match /${probe.bodyPattern}/` };
      }
    } else {
      await response.body?.cancel();
    }
    return { ok: true, detail: `${response.status}` };
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { ok: false, detail: 'timeout' };
    }
    return { ok: false, detail: `connection refused` };
  }
}

function probeTcp(probe, timeoutMs) {
  return new Promise((resolve) => {
    const host = probe.host ?? '127.0.0.1';
    const socket = createConnection({ host, port: probe.port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, detail: 'timeout' });
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true, detail: `connected ${host}:${probe.port}` });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: error.code || 'connection refused' });
    });
  });
}

function probeLog(probe) {
  if (!existsSync(probe.path)) {
    return { ok: false, detail: `log file not found: ${probe.path}` };
  }
  try {
    const content = readFileSync(probe.path, 'utf8');
    const regex = new RegExp(probe.pattern);
    if (regex.test(content)) {
      return { ok: true, detail: `matched /${probe.pattern}/` };
    }
    return { ok: false, detail: `no match for /${probe.pattern}/` };
  } catch (error) {
    return { ok: false, detail: `read error: ${error.message}` };
  }
}

function probeCommand(probe, timeoutMs) {
  return new Promise((resolve) => {
    const [cmd, ...args] = probe.command;
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      cwd: probe.path || process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* dead */ }
      resolve({ ok: false, detail: 'timeout' });
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const expected = probe.expectExitCode ?? 0;
      if (code === expected) {
        resolve({ ok: true, detail: `exit ${code}` });
      } else {
        resolve({ ok: false, detail: `exit ${code} (expected ${expected})${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}` });
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, detail: 'spawn error' });
    });
  });
}

// ---------------------------------------------------------------------------
// Readiness polling
// ---------------------------------------------------------------------------

export async function waitForReadiness(probes, options = {}) {
  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
  const intervalMs = (options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1_000;
  const start = performance.now();
  let attempts = 0;
  let lastResults = probes.map((p) => ({
    name: p.name || p.type,
    type: p.type,
    ok: false,
    detail: 'not started',
  }));

  while (performance.now() - start < timeoutMs) {
    attempts += 1;
    const results = [];
    for (const probe of probes) {
      const result = await runProbe(probe);
      results.push({
        name: probe.name || probe.type,
        type: probe.type,
        ok: result.ok,
        detail: result.detail,
      });
    }
    lastResults = results;
    if (results.every((r) => r.ok)) {
      return {
        state: 'ready',
        durationMs: Math.round(performance.now() - start),
        attempts,
        probes: results,
      };
    }
    await sleep(intervalMs);
  }

  return {
    state: 'timeout',
    durationMs: Math.round(performance.now() - start),
    attempts,
    probes: lastResults,
  };
}

// ---------------------------------------------------------------------------
// Patch selection verification
// ---------------------------------------------------------------------------

export async function captureRunningSha(patchSelection) {
  switch (patchSelection.type) {
    case 'http': return captureShaFromHttp(patchSelection);
    case 'log': return captureShaFromLog(patchSelection);
    case 'command': return captureShaFromCommand(patchSelection);
    default: return { sha: null, detail: `unknown type: ${patchSelection.type}` };
  }
}

async function captureShaFromHttp(patch) {
  try {
    const response = await fetch(patch.url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'fleet-local-verification/1.0' },
    });
    const body = await response.text();
    const match = body.match(new RegExp(patch.pattern));
    return { sha: match?.[1] || null, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { sha: null, detail: error?.name === 'TimeoutError' ? 'timeout' : 'connection refused' };
  }
}

function captureShaFromLog(patch) {
  if (!existsSync(patch.path)) {
    return { sha: null, detail: `file not found: ${patch.path}` };
  }
  try {
    const content = readFileSync(patch.path, 'utf8');
    const match = content.match(new RegExp(patch.pattern));
    return { sha: match?.[1] || null, detail: 'read' };
  } catch (error) {
    return { sha: null, detail: `read error: ${error.message}` };
  }
}

function captureShaFromCommand(patch) {
  return new Promise((resolve) => {
    const [cmd, ...args] = patch.command;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* dead */ }
      resolve({ sha: null, detail: 'timeout' });
    }, 10_000);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.once('exit', () => {
      clearTimeout(timer);
      const match = stdout.match(new RegExp(patch.pattern || SHA_PATTERN.source));
      resolve({ sha: match?.[1] || null, detail: `exit 0` });
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ sha: null, detail: 'spawn error' });
    });
  });
}

export async function verifyPatchSelection(patchSelection, expectedSha, options = {}) {
  const getExpectedSha = options.getExpectedSha ?? defaultGetExpectedSha;
  const expected = expectedSha ?? await getExpectedSha();

  if (!expected) {
    return {
      state: 'error',
      expected: null,
      observed: null,
      detail: 'could not resolve expected SHA from current checkout',
    };
  }

  const { sha: observed, detail } = await captureRunningSha(patchSelection);

  if (!observed) {
    return {
      state: 'error',
      expected,
      observed: null,
      detail: `could not capture running SHA: ${detail}`,
    };
  }

  if (!SHA_PATTERN.test(observed)) {
    return {
      state: 'mismatch',
      expected,
      observed,
      detail: `observed value is not a 40-char hex SHA: ${observed}`,
    };
  }

  if (observed === expected) {
    return {
      state: 'match',
      expected,
      observed,
      detail: 'running SHA matches current checkout',
    };
  }

  return {
    state: 'mismatch',
    expected,
    observed,
    detail: `running ${observed.slice(0, 7)} != expected ${expected.slice(0, 7)}`,
  };
}

function defaultGetExpectedSha() {
  return new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.once('exit', () => resolve(stdout.trim() || null));
    child.once('error', () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// Failure injection
// ---------------------------------------------------------------------------

export async function runFailureInjection(config, options = {}) {
  const fi = config.failureInjection;
  if (!fi) {
    return { state: 'skipped', durationMs: 0, detail: 'no failureInjection configured' };
  }

  const windowSeconds = fi.expectNotReadyWithinSeconds ?? 30;

  // Clean up log files referenced by log probes so the broken service starts
  // with a fresh state. Otherwise a stale log from the healthy service would
  // satisfy the probe and mask the failure.
  for (const probe of config.readinessProbes) {
    if (probe.type === 'log' && probe.path) {
      try { unlinkSync(probe.path); } catch { /* already absent */ }
    }
  }

  const child = startProcess(fi.startCommand, fi.startEnv ?? {}, options);
  const start = performance.now();

  try {
    const result = await waitForReadiness(config.readinessProbes, {
      timeoutSeconds: windowSeconds,
      pollIntervalSeconds: config.pollIntervalSeconds,
    });
    const durationMs = Math.round(performance.now() - start);

    if (result.state === 'ready') {
      return {
        state: 'not_detected',
        durationMs,
        detail: `probes reported ready after ${durationMs}ms — failure was not detected`,
      };
    }
    return {
      state: 'detected',
      durationMs,
      detail: `probes stayed not-ready for ${windowSeconds}s`,
    };
  } finally {
    stopProcess(child);
  }
}

// ---------------------------------------------------------------------------
// Full qualification orchestration
// ---------------------------------------------------------------------------

export async function qualify(rawConfig, options = {}) {
  const config = validateQualification(rawConfig);
  const startedAt = new Date().toISOString();
  const start = performance.now();

  let child = null;
  let readinessResult;
  let patchResult;
  let failureResult;
  let error = null;

  try {
    // Phase 1: start the service and wait for readiness.
    child = startProcess(config.startCommand, config.startEnv, options);
    readinessResult = await waitForReadiness(config.readinessProbes, {
      timeoutSeconds: config.timeoutSeconds,
      pollIntervalSeconds: config.pollIntervalSeconds,
    });

    if (readinessResult.state !== 'ready') {
      error = {
        code: 'READINESS_FAILED',
        message: `Service did not become ready: ${readinessResult.state}`,
      };
      patchResult = { state: 'skipped', expected: null, observed: null, detail: 'readiness failed' };
      failureResult = { state: 'skipped', durationMs: 0, detail: 'readiness failed' };
    } else {
      // Phase 2: verify exact-patch selection.
      patchResult = await verifyPatchSelection(
        config.patchSelection,
        options.expectedSha,
        { getExpectedSha: options.getExpectedSha },
      );

      if (patchResult.state !== 'match') {
        error = {
          code: 'PATCH_MISMATCH',
          message: `Patch selection failed: ${patchResult.detail}`,
        };
      }
    }

    // Phase 3: failure injection (stop the healthy service first).
    stopProcess(child);
    child = null;

    if (!error) {
      failureResult = await runFailureInjection(config, options);
      if (failureResult.state === 'not_detected') {
        error = {
          code: 'FAILURE_NOT_DETECTED',
          message: failureResult.detail,
        };
      }
    } else {
      failureResult = { state: 'skipped', durationMs: 0, detail: 'earlier phase failed' };
    }
  } catch (err) {
    error = { code: err.code || 'INTERNAL', message: err.message };
    readinessResult = readinessResult || {
      state: 'error',
      durationMs: 0,
      attempts: 0,
      probes: [],
    };
    patchResult = patchResult || { state: 'error', expected: null, observed: null, detail: err.message };
    failureResult = failureResult || { state: 'error', durationMs: 0, detail: err.message };
  } finally {
    if (child) stopProcess(child);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - start);

  const readyOk = readinessResult?.state === 'ready';
  const patchOk = patchResult?.state === 'match';
  const failureOk = failureResult?.state === 'detected' || failureResult?.state === 'skipped';

  const state = (readyOk && patchOk && failureOk && !error) ? 'qualified' : 'failed';

  return {
    schema: SCHEMA,
    project: config.project,
    state,
    startedAt,
    finishedAt,
    durationMs,
    readiness: readinessResult,
    patchSelection: patchResult,
    failureInjection: failureResult,
    error,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
