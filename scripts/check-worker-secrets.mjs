#!/usr/bin/env node
/**
 * Pre-deploy secret preflight.
 *
 * `smoke-prod.mjs` already catches a broken auth surface, but it runs *after*
 * `wrangler deploy` — so a Worker missing its secrets goes live and stays live
 * until someone reads the smoke output. This runs first and refuses to deploy.
 *
 * Why it exists: on 2026-08-22 `saasmaker-dashboard` shipped with zero secrets.
 * better-auth 1.6.30 (bumped in b9b5858a to clear an OAuth advisory) refuses to
 * run on its default secret instead of warning, so every `/api/auth/*` request
 * returned 500 and nobody could sign in to the feedback inbox.
 *
 * Usage:
 *   node ../../scripts/check-worker-secrets.mjs <worker-name> SECRET_A SECRET_B
 *
 * Exit code:
 *   0  — every required secret is present
 *   1  — at least one is missing, or the secret list could not be read
 *
 * Set SKIP_SECRET_PREFLIGHT=1 to bypass (for a first deploy that creates the
 * Worker before any secret can be attached to it).
 */

import { spawnSync } from 'node:child_process';

const [worker, ...required] = process.argv.slice(2);

if (!worker || required.length === 0) {
  console.error('usage: check-worker-secrets.mjs <worker-name> <SECRET_NAME...>');
  process.exit(1);
}

if (process.env.SKIP_SECRET_PREFLIGHT === '1') {
  console.log(`⚠ secret preflight skipped for ${worker} (SKIP_SECRET_PREFLIGHT=1)`);
  process.exit(0);
}

const res = spawnSync('wrangler', ['secret', 'list', '--name', worker, '--format', 'json'], {
  encoding: 'utf8',
  shell: false,
});

if (res.status !== 0) {
  console.error(`✗ could not read secrets for ${worker}`);
  console.error((res.stderr || res.stdout || '').trim().slice(0, 600));
  console.error('\nIf the Worker does not exist yet, run the first deploy with');
  console.error('SKIP_SECRET_PREFLIGHT=1 and attach its secrets immediately after.');
  process.exit(1);
}

// wrangler prints a banner before the JSON payload; take the last array.
const out = res.stdout ?? '';
const start = out.indexOf('[');
const end = out.lastIndexOf(']');

let present = [];
if (start !== -1 && end > start) {
  try {
    present = JSON.parse(out.slice(start, end + 1)).map((entry) => entry?.name ?? entry);
  } catch {
    console.error(`✗ could not parse the secret list for ${worker}`);
    process.exit(1);
  }
} else {
  console.error(`✗ no secret list in wrangler output for ${worker}`);
  process.exit(1);
}

const missing = required.filter((name) => !present.includes(name));

for (const name of required) {
  console.log(`${missing.includes(name) ? '✗' : '✓'} ${name}`);
}

if (missing.length > 0) {
  console.error(`\n✗ ${worker} is missing ${missing.length} required secret(s). Not deploying.`);
  console.error('\nSet each one without writing it to disk or your shell history:');
  for (const name of missing) {
    const hint =
      name === 'BETTER_AUTH_SECRET'
        ? 'openssl rand -base64 32 | '
        : `# paste the value from your provider, then:\n  `;
    console.error(`  ${hint}wrangler secret put ${name} --name ${worker}`);
  }
  process.exit(1);
}

console.log(`\n✓ ${worker} has every required secret.`);
