#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.database || !args.output) {
  console.error('usage: node foundry/ops/scripts/export-codevetter-token-seed.mjs --database <codevetter.db> --output <private-seed.json>');
  process.exit(1);
}

const lifetime = queryOne(`
SELECT COALESCE(SUM(total_input_tokens + total_output_tokens), 0) AS lifetimeTokens,
       COUNT(*) AS sessionCount,
       MAX(indexed_at) AS lastUpdatedAt
FROM cc_sessions;
`);
const latest = queryOne(`
WITH session_total AS (
  SELECT session_id, SUM(msg_count) AS total_n FROM cc_session_days GROUP BY session_id
), latest AS (SELECT MAX(day) AS day FROM cc_session_days)
SELECT latest.day AS snapshotDate,
       ROUND(COALESCE(SUM((s.total_input_tokens+s.total_output_tokens)*d.msg_count*1.0/t.total_n), 0)) AS todayTokens
FROM latest
LEFT JOIN cc_session_days d ON d.day=latest.day
LEFT JOIN session_total t ON t.session_id=d.session_id
LEFT JOIN cc_sessions s ON s.id=d.session_id;
`);
const seed = {
  schemaVersion: 1,
  snapshotDate: latest.snapshotDate,
  lastUpdatedAt: lifetime.lastUpdatedAt,
  authoritative: true,
  lifetimeTokens: lifetime.lifetimeTokens,
  todayTokens: latest.todayTokens,
  publicAggregationFloor: 5,
  coverage: 'Verified CodeVetter usage baseline. Additional products join the cumulative total through authoritative daily seeds.',
  projects: [{ id: 'codevetter', name: 'CodeVetter', tokens: lifetime.lifetimeTokens }],
  pulses: [],
  provenance: {
    source: 'codevetter.cc_sessions',
    accounting: 'SUM(total_input_tokens + total_output_tokens); input is cache-inclusive; cache columns are not added again',
    sessions: lifetime.sessionCount,
  },
};
await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
await writeFile(path.resolve(args.output), `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote private CodeVetter seed for ${seed.snapshotDate} with ${seed.lifetimeTokens.toLocaleString('en-US')} tokens`);

function queryOne(sql) {
  const rows = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', path.resolve(args.database), sql], { encoding: 'utf8' }));
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('CodeVetter query did not return one aggregate row');
  return rows[0];
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, '');
    const value = values[index + 1];
    if (!key || !value) throw new Error('arguments must be --key value pairs');
    parsed[key] = value;
  }
  return parsed;
}
