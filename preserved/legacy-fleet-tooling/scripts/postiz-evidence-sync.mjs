#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostizClient } from '../../marketing/reel-pipeline/src/postiz-client.js';

const checkoutRoot = resolve(import.meta.dirname, '../../..');

export async function syncPostizEvidence(options) {
  const runtimeRoot = externalRoot(options.runtimeRoot, options.checkoutRoot ?? checkoutRoot);
  const receiptDir = resolve(runtimeRoot, 'receipts');
  const eventDir = resolve(runtimeRoot, 'events');
  await mkdir(eventDir, { recursive: true });
  const files = (await readdir(receiptDir).catch(() => [])).filter((name) => name.endsWith('.json')).sort().slice(0, boundedLimit(options.limit ?? 50));
  const summary = { scanned: files.length, measured: 0, skipped: 0, failed: 0 };
  for (const name of files) {
    try {
      const receipt = JSON.parse(await readFile(resolve(receiptDir, name), 'utf8'));
      if (receipt?.provider !== 'postiz' || typeof receipt.externalId !== 'string') {
        summary.skipped += 1;
        continue;
      }
      const analytics = await options.postizClient.analytics(receipt.externalId, 30);
      const event = {
        schemaVersion: 1,
        kind: 'postiz-analytics',
        projectSlug: receipt.brand,
        requestId: receipt.requestId,
        recordedAt: analytics.recordedAt,
        provider: 'postiz',
        metrics: analytics.metrics,
      };
      await writeFile(resolve(eventDir, `${safeName(receipt.requestId)}-analytics.json`), `${JSON.stringify(event, null, 2)}\n`);
      summary.measured += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

function externalRoot(value, checkout) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('FLEET_MARKETING_RUNTIME_DIR must be absolute');
  const rel = relative(resolve(checkout), resolve(value));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('marketing runtime state must remain outside the checkout');
  return resolve(value);
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('evidence limit must be between 1 and 100');
  return parsed;
}

function safeName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,160}$/u.test(value)) throw new Error('request id is not safe for an event filename');
  return value;
}

async function main() {
  const runtimeRoot = process.env.FLEET_MARKETING_RUNTIME_DIR;
  const integrationsPath = process.env.POSTIZ_INTEGRATIONS_CONFIG;
  if (!integrationsPath || !isAbsolute(integrationsPath)) throw new Error('POSTIZ_INTEGRATIONS_CONFIG must be an absolute machine-local path');
  const integrations = JSON.parse(await readFile(integrationsPath, 'utf8'))?.integrations;
  const summary = await syncPostizEvidence({
    runtimeRoot,
    limit: process.env.POSTIZ_EVIDENCE_LIMIT ?? 50,
    postizClient: new PostizClient({ integrations }),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'POSTIZ_EVIDENCE_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
