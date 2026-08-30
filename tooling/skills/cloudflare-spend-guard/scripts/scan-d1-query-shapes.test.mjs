import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanD1QueryShapes } from './scan-d1-query-shapes.mjs';

test('classifies bounded, unbounded, and optional dynamic D1 aggregates', () => {
  const root = mkdtempSync(join(tmpdir(), 'd1-query-shapes-'));
  try {
    const repo = join(root, 'app');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'wrangler.toml'), `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "app-db"\n`);
    writeFileSync(join(repo, 'src/queries.ts'), [
      'const bounded = `SELECT kind, count(*) FROM events WHERE created_at >= ? GROUP BY kind`;',
      'const unbounded = `SELECT kind, count(*) FROM events WHERE status = "live" GROUP BY kind`;',
      'const global = `SELECT kind, count(*) FROM events GROUP BY kind LIMIT 20`;',
      'const dynamic = `SELECT kind, count(*) FROM events ${where} GROUP BY kind`;',
      'const scoped = db.select().from(events).where(eq(events.userId, userId)).groupBy(events.kind);',
      '// d1-scan: reviewed-unbounded issue=OPS-1 reason=small materialized ledger',
      'const reviewed = `SELECT kind, count(*) FROM ledger GROUP BY kind`;',
      '',
    ].join('\n'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', 'wrangler.toml', 'src/queries.ts'], { cwd: repo });

    const report = scanD1QueryShapes({ fleetRoot: root });
    assert.equal(report.repoCount, 1);
    assert.deepEqual(report.databaseNames, ['app-db']);
    assert.deepEqual(report.summary, { bounded: 2, dynamicReview: 1, reviewedUnbounded: 1, unbounded: 2 });
    assert.equal(report.repos[0].findings.find((finding) => finding.classification === 'reviewed-unbounded')?.review, 'issue=OPS-1 reason=small materialized ledger');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores repositories without tracked D1 configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'd1-query-shapes-'));
  try {
    const repo = join(root, 'app');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'wrangler.toml'), 'name = "pages-only"\n');
    writeFileSync(join(repo, 'src/query.ts'), 'const sql = `SELECT kind FROM events GROUP BY kind`;\n');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', 'wrangler.toml', 'src/query.ts'], { cwd: repo });
    assert.equal(scanD1QueryShapes({ fleetRoot: root }).repoCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
