#!/usr/bin/env node
/**
 * Post-deploy smoke test for SaaS Maker production.
 *
 * Hits a fixed set of endpoints that, if any single one breaks, indicate
 * a broken release. Used as the final gate after `wrangler deploy` for
 * both the API Worker and the cockpit Worker.
 *
 * Exit code:
 *   0  — every check passed
 *   1+ — at least one check failed (number = count of failures)
 *
 * Run:
 *   node scripts/smoke-prod.mjs
 *   node scripts/smoke-prod.mjs --directory-only
 *   SAAS_MAKER_API=https://api.sassmaker.com SAAS_MAKER_APP=https://app.sassmaker.com node scripts/smoke-prod.mjs
 */

const API = process.env.SAAS_MAKER_API ?? 'https://api.sassmaker.com';
const APP = process.env.SAAS_MAKER_APP ?? 'https://app.sassmaker.com';
const DIRECTORY = process.env.SAAS_MAKER_DIRECTORY ?? 'https://sassmaker.com';
const DIRECTORY_ONLY = process.argv.includes('--directory-only');

const directoryChecks = [
  {
    name: 'Public directory index renders',
    fn: async () => {
      const res = await fetch(DIRECTORY);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = await res.text();
      if (!body.includes('SaaS Maker')) throw new Error('missing SaaS Maker identity');
    },
  },
  {
    name: 'Complete project directory renders 58 identities',
    fn: async () => {
      const res = await fetch(`${DIRECTORY}/projects`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = await res.text();
      const rows = body.match(/<details class="directory-row" data-directory-row/g)?.length ?? 0;
      if (rows !== 58) throw new Error(`expected 58 directory rows, got ${rows}`);
      if (!body.includes('First retained commit') || !body.includes('Latest retained commit')) {
        throw new Error('missing Git-history bounds');
      }
    },
  },
  {
    name: 'Machine-readable directory exposes 58 identities',
    fn: async () => {
      const res = await fetch(`${DIRECTORY}/projects.json`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body) || body.length !== 58) {
        throw new Error(
          `expected 58 JSON entries, got ${Array.isArray(body) ? body.length : 'non-array'}`
        );
      }
    },
  },
];

const productChecks = [
  {
    name: 'API /health returns ok',
    fn: async () => {
      const res = await fetch(`${API}/health`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = await res.json();
      if (body?.status !== 'ok') throw new Error(`unexpected body ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'API rejects unauthenticated /v1/projects',
    fn: async () => {
      const res = await fetch(`${API}/v1/projects`);
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    },
  },
  {
    name: 'API CORS allows app.sassmaker.com',
    fn: async () => {
      const res = await fetch(`${API}/health`, {
        headers: { Origin: 'https://app.sassmaker.com' },
      });
      const allow = res.headers.get('access-control-allow-origin');
      if (allow !== 'https://app.sassmaker.com') {
        throw new Error(`unexpected CORS origin: ${allow}`);
      }
    },
  },
  {
    name: 'Cockpit /login renders',
    fn: async () => {
      const res = await fetch(`${APP}/login`, { redirect: 'manual' });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
    },
  },
  {
    name: 'Cockpit /projects redirects unauthenticated to /login',
    fn: async () => {
      const res = await fetch(`${APP}/projects`, { redirect: 'manual' });
      if (res.status !== 307 && res.status !== 302) {
        throw new Error(`expected redirect, got ${res.status}`);
      }
      const loc = res.headers.get('location') ?? '';
      if (!loc.includes('/login')) throw new Error(`unexpected redirect target: ${loc}`);
    },
  },
  {
    name: 'Cockpit /api/auth/sign-in/social returns Google OAuth URL',
    fn: async () => {
      const res = await fetch(`${APP}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/projects' }),
      });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = await res.json();
      if (!body?.url?.includes('accounts.google.com')) {
        throw new Error(`auth response missing Google URL: ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: 'Cockpit bundle does NOT contain localhost:8787',
    fn: async () => {
      const res = await fetch(`${APP}/projects`, { redirect: 'manual' });
      const html = await res.text();
      if (html.includes('localhost:8787')) {
        throw new Error(
          'shipped HTML references localhost:8787 — NEXT_PUBLIC_API_URL was missing at build'
        );
      }
    },
  },
];

const checks = DIRECTORY_ONLY ? directoryChecks : [...directoryChecks, ...productChecks];

const start = Date.now();
let failures = 0;

for (const check of checks) {
  process.stdout.write(`→ ${check.name} ... `);
  try {
    await check.fn();
    process.stdout.write('✓\n');
  } catch (err) {
    failures++;
    process.stdout.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

const ms = Date.now() - start;
console.log(
  `\n${failures === 0 ? '✓' : '✗'} ${checks.length - failures}/${checks.length} passed in ${ms}ms`
);
process.exit(failures);
