#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { handleCodexStopHook } from '../../lib/skill-run-codex-hook.mjs';

const MAX_STDIN_BYTES = 1024 * 1024;
const RECORDER_TIMEOUT_MS = 2_000;
const recorderPath = resolve(import.meta.dirname, 'fleet-skill-run.mjs');

async function readPayload() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_STDIN_BYTES) return null;
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function record(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [recorderPath, 'record', '--json'],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('skill-run recorder timed out'));
    }, RECORDER_TIMEOUT_MS);

    child.once('error', finish);
    child.once('close', (code) => {
      finish(code === 0 ? null : new Error(`skill-run recorder exited ${code}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

try {
  const payload = await readPayload();
  if (payload) await handleCodexStopHook(payload, { record });
} catch {
  // Codex lifecycle hooks must never change or delay the completed turn.
}
