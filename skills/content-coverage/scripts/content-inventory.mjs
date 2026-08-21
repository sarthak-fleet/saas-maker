#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildCoverageAudit,
  fetchSitemapPages,
  inventoryRegistryProduct,
} from '../../../lib/content-coverage.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const inputPath = option('--input');
const productId = option('--product');
if (!inputPath && !productId) {
  process.stderr.write('usage: content-inventory.mjs (--input <json>|--product <id>) [--live] [--json]\n');
  process.exitCode = 2;
} else {
  const input = inputPath
    ? JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
    : inventoryRegistryProduct(productId, { live: args.includes('--live') });
  if (args.includes('--live') && input.product.url) {
    const live = await fetchSitemapPages(input.product.url);
    input.pages.push(...live.pages);
    input.unavailableEvidence = input.unavailableEvidence.filter(
      (entry) => entry.source !== 'live-sitemap',
    );
    if (live.pages.length === 0 && live.errors.length) {
      input.unavailableEvidence.push({
        source: 'live-sitemap',
        reason: live.errors.join('; '),
      });
    }
  }
  const audit = buildCoverageAudit(input);
  const artifactPath = option('--artifact');
  if (artifactPath) {
    const absoluteArtifact = resolve(artifactPath);
    const artifact = existsSync(absoluteArtifact)
      ? JSON.parse(readFileSync(absoluteArtifact, 'utf8'))
      : {};
    const counts = Object.fromEntries(
      ['keep', 'update', 'merge', 'create', 'redirect', 'prune', 'blocked', 'research']
        .map((action) => [
          action,
          audit.coverage.filter((entry) => entry.action === action).length,
        ]),
    );
    const hasCoverageModel = audit.coverage.length > 0;
    let verdict = 'solid';
    if (!hasCoverageModel) verdict = 'research';
    else if (counts.blocked > 0) verdict = 'blocked';
    else if (counts.create + counts.update + counts.merge > 0) verdict = 'gaps';
    artifact[audit.product.id] = {
      verdict,
      coverageModel: hasCoverageModel,
      ...counts,
      date: audit.generatedAt.slice(0, 10),
    };
    mkdirSync(dirname(absoluteArtifact), { recursive: true });
    writeFileSync(absoluteArtifact, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}
