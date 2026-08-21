#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeDistribution } from '../../marketing/reel-pipeline/src/distribution.js';
import { PostizClient } from '../../marketing/reel-pipeline/src/postiz-client.js';

const checkoutRoot = resolve(import.meta.dirname, '../../..');

export async function processPostizQueue(options) {
  const runtimeRoot = externalRoot(options.runtimeRoot, options.checkoutRoot ?? checkoutRoot);
  const limit = boundedLimit(options.limit ?? 20);
  const directories = Object.fromEntries(
    ['queue', 'receipts', 'done', 'failed', 'indeterminate'].map((name) => [name, resolve(runtimeRoot, name)]),
  );
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
  const files = (await readdir(directories.queue)).filter((name) => name.endsWith('.json')).sort().slice(0, limit);
  const summary = { scanned: files.length, drafted: 0, skipped: 0, failed: 0, indeterminate: 0 };

  for (const name of files) {
    const source = resolve(directories.queue, name);
    try {
      const envelope = JSON.parse(await readFile(source, 'utf8'));
      if (envelope?.schemaVersion !== 1) throw new Error('unsupported queued distribution schema');
      const requestId = safeName(envelope?.request?.id);
      const receiptPath = resolve(directories.receipts, `${requestId}.json`);
      if (existsSync(receiptPath)) {
        await rename(source, resolve(directories.done, name));
        summary.skipped += 1;
        continue;
      }
      const receipt = await executeDistribution(
        envelope.contentPackage,
        envelope.mediaReceipt,
        envelope.request,
        { postizProvider: options.postizClient },
      );
      if (receipt.provider !== 'postiz' || receipt.status !== 'draft') {
        throw new Error('machine distribution must produce a Postiz draft');
      }
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
      await rename(source, resolve(directories.done, name));
      summary.drafted += 1;
    } catch (error) {
      const ambiguous = Boolean(error?.ambiguous);
      const destination = ambiguous ? directories.indeterminate : directories.failed;
      const outcome = {
        schemaVersion: 1,
        status: ambiguous ? 'indeterminate' : 'failed',
        code: typeof error?.code === 'string' ? error.code : 'DISTRIBUTION_FAILED',
        requestId: typeof error?.requestId === 'string' ? error.requestId : null,
        recordedAt: new Date().toISOString(),
      };
      await writeFile(resolve(destination, `${name}.outcome.json`), `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx' });
      await rename(source, resolve(destination, name));
      if (ambiguous) summary.indeterminate += 1;
      else summary.failed += 1;
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
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('queue limit must be between 1 and 100');
  return parsed;
}

function safeName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new Error('request id is invalid');
  const clean = value.replace(/[^a-zA-Z0-9_.-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 120);
  if (!clean) throw new Error('request id is invalid');
  if (clean === value) return clean;
  return `${clean}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

async function main() {
  const runtimeRoot = process.env.FLEET_MARKETING_RUNTIME_DIR;
  const integrationsPath = process.env.POSTIZ_INTEGRATIONS_CONFIG;
  if (!integrationsPath || !isAbsolute(integrationsPath)) throw new Error('POSTIZ_INTEGRATIONS_CONFIG must be an absolute machine-local path');
  const integrations = JSON.parse(await readFile(integrationsPath, 'utf8'))?.integrations;
  const summary = await processPostizQueue({
    runtimeRoot,
    limit: process.env.POSTIZ_QUEUE_LIMIT ?? 20,
    postizClient: new PostizClient({ integrations }),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'POSTIZ_QUEUE_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
