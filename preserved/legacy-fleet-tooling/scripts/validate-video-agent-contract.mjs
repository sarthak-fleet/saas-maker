#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const fixtures = JSON.parse(readFileSync(path.join(root, 'foundry/ops/contracts/video-agent/fixtures/manifest-requests.json'), 'utf8'));
const expected = new Set(['studio', 'mashup', 'reel-pipeline']);
const forbidden = new Set(['command', 'shell', 'script', 'sourceCode', 'code', 'plugin', 'executable']);

assert.equal(fixtures.length, expected.size);
for (const request of fixtures) {
  assert.equal(request.schema, 'fleet.video-agent-operation.v1');
  assert.equal(request.operation, 'manifest');
  assert.deepEqual(request.input, {});
  assert(expected.delete(request.product), `duplicate or unknown product ${request.product}`);
  assert(!Object.keys(request.input).some((key) => forbidden.has(key)));
}
assert.equal(expected.size, 0);

for (const file of ['request.schema.json', 'result.schema.json', 'manifest.schema.json', 'event.schema.json']) {
  JSON.parse(readFileSync(path.join(root, 'foundry/ops/contracts/video-agent', file), 'utf8'));
}

process.stdout.write('video-agent contract fixtures valid\n');
