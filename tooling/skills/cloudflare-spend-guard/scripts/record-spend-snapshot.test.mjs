import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  normalizeSnapshot,
  recordSpendSnapshot,
} from './record-spend-snapshot.mjs';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    runId: '2026-07-25-weekly',
    observedAt: '2026-07-25T12:00:00.000Z',
    providers: [
      {
        provider: 'cloudflare',
        spendState: 'unlikely-on-current-evidence',
        evidenceStatus: 'available',
        confidence: 'high',
        period: { label: 'July 2026', start: null, end: null, resetAt: null },
        costs: [],
        quotas: [{ metric: 'Workers requests', used: 10, limit: 100, unit: 'requests' }],
        evidenceGaps: [],
      },
      {
        provider: 'turso',
        spendState: 'unlikely-on-current-evidence',
        evidenceStatus: 'available',
        confidence: 'high',
        period: { label: 'July 2026', resetAt: '2026-08-01T00:00:00.000Z' },
        costs: [],
        quotas: [{ metric: 'Rows read', used: 20, limit: 100, unit: 'rows' }],
        evidenceGaps: [],
      },
    ],
    recommendations: [],
    ...overrides,
  };
}

test('records a private projection and treats a repeated run as idempotent', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'spend-snapshot-'));
  try {
    const first = recordSpendSnapshot(snapshot(), { stateDir });
    unlinkSync(join(stateDir, 'latest.json'));
    unlinkSync(join(stateDir, 'latest.md'));
    const second = recordSpendSnapshot(snapshot(), { stateDir });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(readFileSync(join(stateDir, 'ledger.jsonl'), 'utf8').trim().split('\n').length, 1);
    assert.equal(first.snapshot.alert.severity, 'ok');
    assert.equal(existsSync(join(stateDir, 'latest.json')), true);
    assert.match(readFileSync(join(stateDir, 'latest.md'), 'utf8'), /Alert: ok/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('classifies 85 percent as warning and 95 percent as critical', () => {
  const warningDir = mkdtempSync(join(tmpdir(), 'spend-warning-'));
  const criticalDir = mkdtempSync(join(tmpdir(), 'spend-critical-'));
  try {
    const warning = snapshot();
    warning.providers[1].quotas[0].used = 85;
    assert.equal(recordSpendSnapshot(warning, { stateDir: warningDir }).snapshot.alert.severity, 'warning');

    const critical = snapshot({ runId: '2026-07-25-critical' });
    critical.providers[1].quotas[0].used = 95;
    assert.equal(recordSpendSnapshot(critical, { stateDir: criticalDir }).snapshot.alert.severity, 'critical');
  } finally {
    rmSync(warningDir, { recursive: true, force: true });
    rmSync(criticalDir, { recursive: true, force: true });
  }
});

test('alerts on unavailable evidence and a newly positive cost', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'spend-evidence-'));
  try {
    const unavailable = snapshot();
    unavailable.providers[0].spendState = 'unknown';
    unavailable.providers[0].evidenceStatus = 'unavailable';
    const first = recordSpendSnapshot(unavailable, { stateDir });
    assert.equal(first.snapshot.alert.severity, 'warning');
    assert.match(JSON.stringify(first.snapshot.alert), /evidence-unavailable/);

    const paid = snapshot({ runId: '2026-08-01-weekly', observedAt: '2026-08-01T12:00:00.000Z' });
    paid.providers[0].spendState = 'paying-now';
    paid.providers[0].costs = [{ kind: 'fixed', amount: 5, currency: 'usd' }];
    const second = recordSpendSnapshot(paid, { stateDir });
    assert.match(JSON.stringify(second.snapshot.alert), /new-positive-cost/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('rejects secret-shaped or unsupported data without creating state', () => {
  const stateDir = join(tmpdir(), `spend-reject-${process.pid}-${Date.now()}`);
  const input = snapshot({ token: 'must-not-be-recorded' });
  assert.throws(() => normalizeSnapshot(input), /secret-shaped field/);
  assert.equal(existsSync(stateDir), false);

  const raw = snapshot();
  raw.providers[0].rawPayload = {};
  assert.throws(
    () => recordSpendSnapshot(raw, { stateDir }),
    /secret-shaped field/,
  );
  assert.equal(existsSync(stateDir), false);
});

test('rejects a conflicting payload with the same run id', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'spend-conflict-'));
  try {
    recordSpendSnapshot(snapshot(), { stateDir });
    const changed = snapshot();
    changed.providers[0].quotas[0].used = 11;
    assert.throws(
      () => recordSpendSnapshot(changed, { stateDir }),
      /runId conflict/,
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
