#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectAhrefsSiteAuditHealth,
  renderAhrefsSiteAuditErrorMarkdown,
  renderAhrefsSiteAuditMarkdown,
} from '../lib/ahrefs-site-audit.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const BRANDS_PATH = resolve(FLEET_ROOT, 'foundry/ops/config/root-brands.json');
const OUTPUT_PATH = resolve(FLEET_ROOT, 'foundry/ops/docs/ahrefs-site-audit-latest.md');

const maxAgeDays = argument('--max-age-days') ?? 14;
const brands = JSON.parse(readFileSync(BRANDS_PATH, 'utf8'));

try {
  const result = await collectAhrefsSiteAuditHealth({
    apiKey: process.env.AHREFS_API_KEY,
    brands,
    maxAgeDays,
  });
  writeFileSync(OUTPUT_PATH, renderAhrefsSiteAuditMarkdown(result), 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'complete') process.exitCode = 1;
} catch (error) {
  writeFileSync(OUTPUT_PATH, renderAhrefsSiteAuditErrorMarkdown(error), 'utf8');
  process.stdout.write(`${JSON.stringify({
    schema: 'fleet.ahrefs-site-audit-health-error.v1',
    status: 'blocked',
    code: error?.code ?? 'unknown-error',
    httpStatus: error?.httpStatus ?? null,
    message: error?.message ?? 'Ahrefs Site Audit collection failed',
    outputPath: OUTPUT_PATH,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}
