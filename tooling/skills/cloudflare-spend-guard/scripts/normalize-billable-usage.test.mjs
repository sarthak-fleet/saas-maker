import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeBillableUsage } from './normalize-billable-usage.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

test('normalizes mixed units and preserves partial cost coverage', () => {
  const fixture = JSON.parse(readFileSync(join(SCRIPT_DIR, 'fixtures/billable-usage.json'), 'utf8'));
  const report = normalizeBillableUsage(fixture);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.sourceRecords, 4);
  assert.equal(report.positiveCostEvidence, true);
  assert.equal(report.groups.length, 3);
  assert.equal(report.groups.find((group) => group.metricId === 'workers_standard_requests').consumedQuantity, 250000);
  assert.equal(report.costFieldCoverage.BilledCost.complete, false);
  assert.equal(report.costFieldCoverage.BilledCost.sumKnown, 1.25);
  assert.match(report.warnings[0], /partially populated/i);
});

test('does not coerce fully absent cost fields to zero', () => {
  const report = normalizeBillableUsage([
    {
      ChargePeriodStart: '2026-07-01T00:00:00Z',
      ChargePeriodEnd: '2026-07-02T00:00:00Z',
      ConsumedQuantity: 10,
      ConsumedUnit: 'Requests',
      x_BillableMetricId: 'example',
      x_ProductFamilyName: 'Workers',
    },
  ]);

  assert.equal(report.positiveCostEvidence, false);
  assert.equal(report.costFieldCoverage.BilledCost.knownRecords, 0);
  assert.equal(report.costFieldCoverage.BilledCost.missingRecords, 1);
  assert.match(report.warnings[0], /does not prove either a charge or zero cost/i);
});

test('does not call empty evidence complete or zero cost', () => {
  const report = normalizeBillableUsage([]);

  assert.equal(report.sourceRecords, 0);
  assert.equal(report.positiveCostEvidence, false);
  assert.equal(report.costFieldCoverage.BilledCost.complete, false);
  assert.match(report.warnings[0], /does not prove either a charge or zero cost/i);
});

test('rejects unsupported payloads', () => {
  assert.throws(() => normalizeBillableUsage({ result: {} }), /result array/i);
});
