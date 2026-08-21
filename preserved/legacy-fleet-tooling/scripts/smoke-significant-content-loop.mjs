#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const fleetRoot = resolve(import.meta.dirname, '../../..');
const hobbiesRoot = resolve(fleetRoot, 'significanthobbies');
const reelRoot = resolve(fleetRoot, 'foundry/marketing/reel-pipeline');
const scratch = mkdtempSync(resolve(tmpdir(), 'significant-content-loop-'));
const fixture = JSON.parse(readFileSync(resolve(reelRoot, 'test/fixtures/significant-content-reels-v1.json'), 'utf8'));
const documentPath = resolve(scratch, 'content-packages.json');
const envelopePath = resolve(scratch, 'reels.json');
const ideasPath = resolve(scratch, 'ideas.json');
const receiptInputPath = resolve(scratch, 'receipt-input.json');
const receiptPath = resolve(scratch, 'render-receipt.json');

const fixtureVariants = [
  ...fixture.variants,
  {
    ...fixture.variants[1],
    id: 'field-note-memory',
    format: 'memory-payoff',
    hypothesis: 'A place-memory payoff will increase qualified article clicks.',
    hook: 'This tiny sketch can hold an entire afternoon.',
    scenes: fixture.variants[1].scenes.map((scene, index) => index === 0
      ? { ...scene, narration: 'This tiny sketch can hold an entire afternoon.', onScreenText: 'KEEP THE AFTERNOON' }
      : scene),
  },
];
const reels = fixtureVariants.map((variant) => ({
  ...variant,
  destinationUrl: variant.destinationUrl.replace('www.significanthobbies.com', 'significanthobbies.com'),
  state: 'approved',
  receipts: [],
  metrics: [],
}));
writeFileSync(documentPath, `${JSON.stringify({
  schemaVersion: 1,
  packages: [{
    id: fixture.packageId,
    revision: fixture.packageRevision,
    state: 'ready',
    slug: 'urban-sketching-field-notes',
    title: 'Urban Sketching Field Notes',
    excerpt: 'A fixture-backed cross-repository handoff.',
    category: 'Creative Practice',
    emoji: '✏️',
    readTime: 5,
    relatedHobbies: ['Urban Sketching'],
    sections: [{ heading: 'Start small', paragraphs: ['Draw one doorway for ten minutes.'] }],
    takeaways: ['Memory matters more than mastery.'],
    productActions: [{ label: 'Start a field note', url: '/timeline/new' }],
    sources: [{ title: 'Fixture source', url: fixture.sourceUrl, claim: 'Bounded practice prompt.' }],
    youtube: null,
    reels,
  }],
}, null, 2)}\n`);

function hobbies(...args) {
  return execFileSync('pnpm', ['exec', 'tsx', 'scripts/content-cli.ts', ...args], {
    cwd: hobbiesRoot,
    encoding: 'utf8',
  }).trim();
}

function reel(...args) {
  return execFileSync('node', ['scripts/significant-content.js', ...args], {
    cwd: reelRoot,
    encoding: 'utf8',
  }).trim();
}

hobbies('validate', '--document', documentPath);
hobbies('export', '--document', documentPath, '--package', fixture.packageId,
  '--exported-at', fixture.exportedAt, '--output', envelopePath);
const firstImport = JSON.parse(reel('import', '--input', envelopePath, '--store', ideasPath));
const duplicateImport = JSON.parse(reel('import', '--input', envelopePath, '--store', ideasPath));
assert.equal(firstImport.imported, fixtureVariants.length);
assert.equal(duplicateImport.imported, 0);

writeFileSync(receiptInputPath, `${JSON.stringify({
  packageId: fixture.packageId,
  packageRevision: fixture.packageRevision,
  variantId: fixture.variants[0].id,
  provider: 'offline-fixture',
  status: 'completed',
  externalId: 'fixture-render-1',
  externalUrl: 'https://assets.example.test/fixture-render-1.mp4',
  occurredAt: '2026-07-13T07:00:00.000Z',
  details: { simulated: true },
}, null, 2)}\n`);
reel('receipt', '--stage', 'render', '--input', receiptInputPath, '--out', receiptPath);
const firstApply = JSON.parse(hobbies('apply-receipt', '--document', documentPath, '--receipt', receiptPath));
const duplicateApply = JSON.parse(hobbies('apply-receipt', '--document', documentPath, '--receipt', receiptPath));
assert.deepEqual(firstApply, { applied: true, idempotent: false });
assert.deepEqual(duplicateApply, { applied: false, idempotent: true });
const report = JSON.parse(hobbies('report', '--document', documentPath, '--package', fixture.packageId));

process.stdout.write(`${JSON.stringify({
  ok: true,
  offlineOnly: true,
  scratch,
  firstImport: firstImport.imported,
  duplicateImport: duplicateImport.imported,
  firstApply,
  duplicateApply,
  report,
}, null, 2)}\n`);
