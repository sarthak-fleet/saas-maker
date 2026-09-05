import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildDelta,
  percentile,
  readDistribution,
  readTargets,
} from '../scripts/psi-portfolio-delta.mjs';

function historyWith(runs) {
  const path = join(mkdtempSync(join(tmpdir(), 'psi-delta-')), 'history.db');
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, preset TEXT NOT NULL,
    started_at INTEGER NOT NULL, finished_at INTEGER, lcp REAL, cls REAL, inp REAL,
    tbt REAL, fcp REAL, ttfb REAL, si REAL, performance_score REAL, error TEXT, tag TEXT
  );`);
  const insert = database.prepare(`INSERT INTO runs
    (url, preset, started_at, performance_score, lcp, cls, tbt, ttfb, fcp, si, error, tag)
    VALUES (?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const run of runs) {
    insert.run(
      run.url, run.startedAt, run.score, run.lcp, run.cls ?? 0, run.tbt ?? 0,
      run.ttfb ?? 200, run.fcp ?? 900, run.si ?? 1000, run.error ?? null, run.tag ?? 'console-portfolio',
    );
  }
  database.close();
  return path;
}

function targetsFile(targets) {
  const path = join(mkdtempSync(join(tmpdir(), 'psi-targets-')), 'targets.json');
  writeFileSync(path, JSON.stringify(targets));
  return path;
}

test('percentile uses nearest-rank and tolerates single-sample sets', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.75), 30);
  assert.equal(percentile([5], 0.75), 5);
  assert.equal(percentile([], 0.5), null);
});

test('readTargets normalises www and defaults the display name', () => {
  const targets = readTargets(targetsFile([{ projectId: 'alpha', domain: 'www.alpha.test' }]));
  assert.deepEqual(targets, [{ projectId: 'alpha', domain: 'alpha.test', name: 'alpha', priority: null }]);
});

test('readTargets rejects a target without a domain', () => {
  assert.throws(
    () => readTargets(targetsFile([{ projectId: 'alpha' }])),
    /needs projectId and domain/u,
  );
});

test('readDistribution filters by tag and skips errored runs', () => {
  const history = historyWith([
    { url: 'https://alpha.test/', startedAt: 1000, score: 90, lcp: 1000, tag: 'console-portfolio' },
    { url: 'https://alpha.test/', startedAt: 2000, score: 10, lcp: 9000, tag: 'other' },
    { url: 'https://beta.test/', startedAt: 3000, score: 0, lcp: 0, error: 'NO_FCP' },
  ]);
  const byDomain = readDistribution(history, { tag: 'console-portfolio' });
  assert.deepEqual([...byDomain.keys()], ['alpha.test']);
  assert.equal(byDomain.get('alpha.test').runs.length, 1);
});

test('a surface passing every vital but under 90 is score-only, not a CWV miss', () => {
  const history = historyWith([
    { url: 'https://alpha.test/', startedAt: 1000, score: 86, lcp: 1979, cls: 0, tbt: 0, ttfb: 301 },
  ]);
  const [row] = buildDelta(
    readTargets(targetsFile([{ projectId: 'alpha', domain: 'alpha.test' }])),
    readDistribution(history),
  );
  assert.equal(row.status, 'score-only');
  assert.deepEqual(row.failingVitals, []);
  assert.equal(row.cause, 'paint');
});

test('a slow origin is attributed to the edge rather than the render path', () => {
  const history = historyWith([
    { url: 'https://alpha.test/', startedAt: 1000, score: 40, lcp: 5200, cls: 0, tbt: 0, ttfb: 2400 },
  ]);
  const [row] = buildDelta(
    readTargets(targetsFile([{ projectId: 'alpha', domain: 'alpha.test' }])),
    readDistribution(history),
  );
  assert.equal(row.status, 'poor');
  assert.deepEqual(row.failingVitals, ['lcp']);
  assert.equal(row.cause, 'ttfb');
  assert.equal(row.effort, 'origin/edge');
});

test('priority weights impact so an equal regression ranks higher on a P1', () => {
  const history = historyWith([
    { url: 'https://alpha.test/', startedAt: 1000, score: 40, lcp: 5000, cls: 0, tbt: 900, ttfb: 200 },
    { url: 'https://beta.test/', startedAt: 1000, score: 40, lcp: 5000, cls: 0, tbt: 900, ttfb: 200 },
  ]);
  const rows = buildDelta(
    readTargets(targetsFile([
      { projectId: 'beta', domain: 'beta.test', priority: 'P3' },
      { projectId: 'alpha', domain: 'alpha.test', priority: 'P1' },
    ])),
    readDistribution(history),
  );
  assert.deepEqual(rows.map((row) => row.projectId), ['alpha', 'beta']);
  assert.ok(rows[0].impact > rows[1].impact);
});

test('a target with no runs is reported as not-measured rather than passing', () => {
  const [row] = buildDelta(
    readTargets(targetsFile([{ projectId: 'gamma', domain: 'gamma.test' }])),
    readDistribution(historyWith([])),
  );
  assert.equal(row.status, 'not-measured');
  assert.equal(row.runCount, 0);
  assert.equal(row.leverage, 0);
});
