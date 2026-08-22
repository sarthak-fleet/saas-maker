#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COST_FIELDS = ['BilledCost', 'EffectiveCost', 'ContractedCost', 'ListCost'];

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function costCoverage(records, field) {
  const known = records.filter((record) => finiteNumber(record[field]));
  return {
    knownRecords: known.length,
    missingRecords: records.length - known.length,
    complete: records.length > 0 && known.length === records.length,
    sumKnown: known.reduce((sum, record) => sum + record[field], 0),
  };
}

function stringValue(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function dateRange(records) {
  const starts = records.map((record) => record.ChargePeriodStart).filter(Boolean).sort();
  const ends = records.map((record) => record.ChargePeriodEnd).filter(Boolean).sort();
  return {
    start: starts[0] ?? null,
    end: ends.at(-1) ?? null,
  };
}

function groupKey(record) {
  return JSON.stringify([
    stringValue(record.x_ProductFamilyName, 'unknown-product'),
    stringValue(record.x_BillableMetricId, stringValue(record.x_BillableMetricName, 'unknown-metric')),
    stringValue(record.x_BillableMetricName, 'unknown-metric'),
    stringValue(record.ConsumedUnit, 'unknown-unit'),
    stringValue(record.BillingCurrency, 'unknown-currency'),
    stringValue(record.x_ZoneName, ''),
    stringValue(record.SubAccountName, ''),
  ]);
}

function summarizeRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const key = groupKey(record);
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, grouped]) => {
      const [product, metricId, metricName, unit, currency, zone, subAccount] = JSON.parse(key);
      const costs = Object.fromEntries(COST_FIELDS.map((field) => [field, costCoverage(grouped, field)]));
      return {
        product,
        metricId,
        metricName,
        consumedUnit: unit,
        billingCurrency: currency,
        zone: zone || null,
        subAccount: subAccount || null,
        records: grouped.length,
        chargePeriod: dateRange(grouped),
        consumedQuantity: grouped.reduce(
          (sum, record) => sum + (finiteNumber(record.ConsumedQuantity) ? record.ConsumedQuantity : 0),
          0,
        ),
        costs,
      };
    })
    .sort((left, right) =>
      left.product.localeCompare(right.product)
      || left.metricId.localeCompare(right.metricId)
      || left.consumedUnit.localeCompare(right.consumedUnit)
      || String(left.zone).localeCompare(String(right.zone)));
}

function totalsByCurrency(records) {
  const currencies = new Map();
  for (const record of records) {
    const currency = stringValue(record.BillingCurrency, 'unknown-currency');
    const current = currencies.get(currency) ?? [];
    current.push(record);
    currencies.set(currency, current);
  }
  return [...currencies.entries()]
    .map(([currency, currencyRecords]) => ({
      currency,
      records: currencyRecords.length,
      costs: Object.fromEntries(COST_FIELDS.map((field) => [field, costCoverage(currencyRecords, field)])),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function normalizeBillableUsage(payload) {
  const records = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(records)) {
    throw new TypeError('Expected a Cloudflare response with a result array, or an array of usage records.');
  }
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`Usage record ${index} is not an object.`);
    }
  }

  const warnings = [];
  const fieldCoverage = Object.fromEntries(COST_FIELDS.map((field) => [field, costCoverage(records, field)]));
  if (records.length > 0 && COST_FIELDS.every((field) => fieldCoverage[field].knownRecords === 0)) {
    warnings.push('All provider cost fields are unavailable. Consumption does not prove either a charge or zero cost.');
  } else if (COST_FIELDS.some((field) => fieldCoverage[field].knownRecords > 0 && !fieldCoverage[field].complete)) {
    warnings.push('One or more provider cost fields are only partially populated. Known sums are not complete totals.');
  } else if (records.length === 0) {
    warnings.push('No provider usage records were supplied. This does not prove either a charge or zero cost.');
  }

  const positiveCostEvidence = records.some((record) =>
    finiteNumber(record.BilledCost) && record.BilledCost > 0
    || finiteNumber(record.EffectiveCost) && record.EffectiveCost > 0);

  return {
    schemaVersion: 1,
    sourceRecords: records.length,
    chargePeriod: dateRange(records),
    positiveCostEvidence,
    costFieldCoverage: fieldCoverage,
    totalsByCurrency: totalsByCurrency(records),
    groups: summarizeRecords(records),
    warnings,
  };
}

function argument(argv, name) {
  return argv.find((value, index) => argv[index - 1] === name);
}

function usage() {
  return 'Usage: normalize-billable-usage.mjs [--input FILE|-]';
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const inputPath = argument(argv, '--input') ?? '-';
  const allowed = new Set(['--input']);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    if (!allowed.has(value)) throw new Error(`Unknown option: ${value}`);
    index += 1;
  }
  const source = inputPath === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(inputPath), 'utf8');
  const payload = JSON.parse(source);
  console.log(JSON.stringify(normalizeBillableUsage(payload), null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
  });
}
