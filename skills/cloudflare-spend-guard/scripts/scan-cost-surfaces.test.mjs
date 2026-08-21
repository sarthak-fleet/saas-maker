import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanFleetCostSurfaces } from './scan-cost-surfaces.mjs';

test('maps tracked Wrangler bindings as configuration-only exposure', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloudflare-spend-guard-'));
  try {
    mkdirSync(join(root, 'foundry/ops/config'), { recursive: true });
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'foundry/ops/config/projects.json'), JSON.stringify({
      projects: [{
        id: 'example',
        family: 'example',
        tier: 'active',
        status: 'live',
        repo: 'app',
        deployKind: 'worker+pages',
        cfProject: 'example-worker',
        d1Databases: ['example-db'],
        tursoDatabases: ['example-db'],
        databaseResources: [
          { provider: 'cloudflare-d1', name: 'example-db', state: 'prepared' },
          { provider: 'turso', name: 'example-db', state: 'authoritative' },
        ],
        domains: ['example.com'],
      }],
    }));
    writeFileSync(join(root, 'app/wrangler.jsonc'), `{
      "name": "example-worker",
      "d1_databases": [{ "binding": "DB", "database_name": "example-db" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "example-files" }],
      "queues": { "consumers": [{ "queue": "example-jobs" }] },
      "ai": { "binding": "AI" },
      "triggers": { "crons": ["0 * * * *"] },
      "limits": { "cpu_ms": 1000 },
    }\n`);
    writeFileSync(join(root, 'app/package.json'), JSON.stringify({
      dependencies: {
        '@libsql/client': '0.17.3',
      },
    }));
    writeFileSync(join(root, 'app/.env.example'), [
      'TURSO_DATABASE_URL=libsql://example.invalid',
      'TURSO_AUTH_TOKEN=fixture-secret-must-not-appear',
      'TURSO_MANGA_DATABASE_URL=',
      'DATABASE_URL=',
      '',
    ].join('\n'));
    mkdirSync(join(root, 'app/functions'), { recursive: true });
    writeFileSync(join(root, 'app/functions/api.ts'), 'export const onRequest = () => new Response("ok");\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', [
      'add',
      'foundry/ops/config/projects.json',
      'app/.env.example',
      'app/package.json',
      'app/wrangler.jsonc',
      'app/functions/api.ts',
    ], { cwd: root });

    const report = scanFleetCostSurfaces({ fleetRoot: root });
    const project = report.projects[0];
    const products = project.costSurfaces.map((surface) => surface.product);

    assert.equal(report.evidence, 'configuration-only');
    assert.deepEqual(products, [
      'd1',
      'pages',
      'pages-functions',
      'queues',
      'r2',
      'turso',
      'workers',
      'workers-ai',
    ]);
    assert.equal(project.configs[0].signals.scheduled, true);
    assert.equal(project.configs[0].signals.cpuLimitConfigured, true);
    assert.deepEqual(project.declared.d1Databases, ['example-db']);
    assert.deepEqual(project.declared.tursoDatabases, ['example-db']);
    assert.deepEqual(project.declared.databaseResources, [
      { provider: 'cloudflare-d1', name: 'example-db', state: 'prepared' },
      { provider: 'turso', name: 'example-db', state: 'authoritative' },
    ]);
    assert.deepEqual(
      project.costSurfaces.find((surface) => surface.product === 'd1').identifiers,
      ['DB', 'example-db'],
    );
    const turso = project.costSurfaces.find((surface) => surface.product === 'turso');
    assert.deepEqual(turso.sourceFiles, ['app/.env.example', 'app/package.json', 'projects.json']);
    assert.deepEqual(turso.identifiers, [
      'DATABASE_URL',
      'TURSO_AUTH_TOKEN',
      'TURSO_DATABASE_URL',
      'TURSO_MANGA_DATABASE_URL',
      'example-db',
    ]);
    assert.equal(JSON.stringify(report).includes('fixture-secret-must-not-appear'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an unknown project filter', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloudflare-spend-guard-'));
  try {
    mkdirSync(join(root, 'foundry/ops/config'), { recursive: true });
    writeFileSync(join(root, 'foundry/ops/config/projects.json'), '{"projects":[]}');
    assert.throws(
      () => scanFleetCostSurfaces({ fleetRoot: root, projectId: 'missing' }),
      /Unknown Fleet project/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid database resource states', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloudflare-spend-guard-'));
  try {
    mkdirSync(join(root, 'foundry/ops/config'), { recursive: true });
    writeFileSync(join(root, 'foundry/ops/config/projects.json'), JSON.stringify({
      projects: [{
        id: 'invalid',
        databaseResources: [{ provider: 'turso', name: 'example-db', state: 'retired' }],
      }],
    }));
    assert.throws(
      () => scanFleetCostSurfaces({ fleetRoot: root }),
      /invalid state/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
