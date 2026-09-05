#!/usr/bin/env node
// Backfill accreditation state from a historical directory-submission probe log.
//
// The 2026-07-17 spray run (removed from the tree by 25c460a0) probed 125
// directories and recorded, per destination, whether a CAPTCHA, sign-in wall or
// Cloudflare challenge stood in front of the submit form. Those wall
// observations are still factual, and re-probing 117 destinations to rediscover
// them is pure waste.
//
// Only definitive wall observations are replayed. `no_form`, `error` and
// `submitted_*` rows are deliberately ignored: the first two are indeterminate,
// and the last describes an automated submission path that launch-campaign
// forbids. Nothing here advances a platform toward `accredited` — a wall is a
// reason to hold, never a reason to publish.
//
// Usage:
//   node scripts/accreditation/backfill-from-submission-log.mjs --log <path> [--apply]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};

const logPath = option('--log');
const apply = args.includes('--apply');
if (!logPath) {
  console.error('usage: backfill-from-submission-log.mjs --log <path> [--apply]');
  process.exit(2);
}

// Strongest-wins: a destination that showed a CAPTCHA on one product and only a
// sign-in on another is still CAPTCHA-walled.
const WALL_RANK = { captcha: 3, 'anti-bot': 2, signin: 1 };

const rows = readFileSync(resolve(logPath), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const walls = new Map();
for (const row of rows) {
  const id = row.directory;
  if (!id) continue;
  const w = row.walls ?? {};
  let blocker = null;
  if (w.captcha || row.status === 'blocked_captcha') blocker = 'captcha';
  else if (w.cloudflare || row.status === 'blocked_cloudflare') blocker = 'anti-bot';
  else if (w.signin || row.status === 'needs_auth') blocker = 'signin';
  if (!blocker) continue;

  const prev = walls.get(id);
  if (prev && WALL_RANK[prev.blocker] >= WALL_RANK[blocker]) continue;
  walls.set(id, {
    blocker,
    liveUrl: row.finalUrl || row.submitUrl,
    observedAt: row.ts,
    title: row.title ?? '',
  });
}

const statePath = resolve(
  import.meta.dirname,
  '../../config/directory-submissions/accreditation-state.json',
);
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const known = new Set(state.platforms.map((platform) => platform.id));

const planned = [];
const unknown = [];
for (const [id, ev] of walls) {
  (known.has(id) ? planned : unknown).push({ id, ...ev });
}

console.log(
  `${rows.length} log rows -> ${walls.size} destinations with a definitive wall ` +
    `(${planned.length} in registry, ${unknown.length} unregistered)`,
);
for (const p of planned) console.log(`  ${p.blocker.padEnd(9)} ${p.id}`);
if (unknown.length) {
  console.log(`  skipped (not in registry): ${unknown.map((u) => u.id).join(', ')}`);
}

if (!apply) {
  console.log('\ndry run — pass --apply to record these transitions');
  process.exit(0);
}

let applied = 0;
for (const p of planned) {
  try {
    execFileSync(
      process.execPath,
      [
        resolve(import.meta.dirname, 'update-state.mjs'),
        'transition',
        '--platform', p.id,
        '--to', 'blocked',
        '--outcome', 'confirmed',
        '--blocker', p.blocker,
        '--live-url', p.liveUrl,
        '--observed-at', p.observedAt,
        '--reason', `wall observed by the 2026-07-17 directory probe: ${p.blocker}`,
        '--note', p.title.slice(0, 120),
      ],
      { stdio: 'pipe' },
    );
    applied += 1;
  } catch (error) {
    console.error(`  FAILED ${p.id}: ${(error.stderr ?? error.stdout ?? error).toString().trim()}`);
  }
}
console.log(`\nrecorded ${applied}/${planned.length} transitions into ${statePath}`);
