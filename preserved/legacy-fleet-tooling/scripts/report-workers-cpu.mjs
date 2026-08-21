#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_ACCOUNT_ID = '7d048325699a5acddb44d3be31cf6ba9';
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

function argument(name) {
  return process.argv.find((value, index) => process.argv[index - 1] === name);
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function readWranglerOAuthToken() {
  const candidates = [
    process.env.WRANGLER_CONFIG_PATH,
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    join(homedir(), '.config/.wrangler/config/default.toml'),
    join(homedir(), '.wrangler/config/default.toml'),
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, 'utf8').match(/^oauth_token\s*=\s*["']([^"']+)["']/m);
    if (match) return match[1];
  }

  return null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function renderTable(rows) {
  const headers = ['Worker', 'CPU ms', 'Share', 'Requests', 'Avg ms', 'p95 ms', 'Errors'];
  const values = rows.map((row) => [
    row.scriptName,
    formatNumber(row.cpuMs),
    `${row.share.toFixed(1)}%`,
    formatNumber(row.requests),
    row.averageCpuMs.toFixed(2),
    row.p95CpuMs.toFixed(2),
    formatNumber(row.errors),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...values.map((value) => value[index].length))
  );
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...values.map(line)].join('\n');
}

const start = new Date(argument('--start') ?? monthStart());
const end = new Date(argument('--end') ?? new Date());
if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start >= end) {
  console.error('Usage: node scripts/report-workers-cpu.mjs [--start ISO_DATE] [--end ISO_DATE] [--json]');
  process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN ?? readWranglerOAuthToken();
if (!token) {
  console.error('Cloudflare credentials unavailable. Set CLOUDFLARE_API_TOKEN or run `wrangler login`.');
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
const query = `
  query WorkersCpu($accountId: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountId }) {
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $start, datetime_lt: $end }
        ) {
          dimensions { scriptName }
          sum { cpuTimeUs requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
        }
      }
    }
  }
`;

const response = await fetch(GRAPHQL_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query,
    variables: { accountId, start: start.toISOString(), end: end.toISOString() },
  }),
});
const body = await response.json();
if (!response.ok || body.errors?.length) {
  console.error(`Cloudflare GraphQL query failed (${response.status}).`);
  for (const error of body.errors ?? []) console.error(`- ${error.message}`);
  process.exit(1);
}

const groups = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
const totalCpuMs = groups.reduce((sum, group) => sum + group.sum.cpuTimeUs / 1000, 0);
const rows = groups
  .map((group) => {
    const cpuMs = group.sum.cpuTimeUs / 1000;
    return {
      scriptName: group.dimensions.scriptName || '(unknown)',
      cpuMs,
      share: totalCpuMs ? (cpuMs / totalCpuMs) * 100 : 0,
      requests: group.sum.requests,
      errors: group.sum.errors,
      subrequests: group.sum.subrequests,
      averageCpuMs: group.sum.requests ? cpuMs / group.sum.requests : 0,
      p50CpuMs: group.quantiles.cpuTimeP50 / 1000,
      p95CpuMs: group.quantiles.cpuTimeP95 / 1000,
      p99CpuMs: group.quantiles.cpuTimeP99 / 1000,
    };
  })
  .sort((left, right) => right.cpuMs - left.cpuMs);

const report = {
  generatedAt: new Date().toISOString(),
  range: { start: start.toISOString(), end: end.toISOString() },
  totalCpuMs,
  includedCpuMs: 30_000_000,
  estimatedOverageCpuMs: Math.max(0, totalCpuMs - 30_000_000),
  estimatedOverageUsd: Math.max(0, totalCpuMs - 30_000_000) / 1_000_000 * 0.02,
  workers: rows,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Workers CPU: ${start.toISOString()} to ${end.toISOString()}`);
  console.log(`Total: ${formatNumber(totalCpuMs)} ms`);
  console.log(
    `Estimated CPU overage: ${formatNumber(report.estimatedOverageCpuMs)} ms ($${report.estimatedOverageUsd.toFixed(3)})\n`
  );
  console.log(renderTable(rows));
}
