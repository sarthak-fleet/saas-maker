#!/usr/bin/env node
/**
 * reporting-loop-preflight — liveness + staleness gate for the recurring
 * SEO/GEO reporting loop (SAR-8).
 *
 * Exists because a core measurement skill failed silently for 20 days (SAR-2):
 * `geo-observatory-record.mjs` crashed on startup from 2026-08-21 and nothing
 * noticed, because "the recorder ran" was an assumption rather than a checked
 * precondition. This script turns it into a precondition.
 *
 * Usage:
 *   node scripts/reporting-loop-preflight.mjs [--weekly|--monthly] [--json]
 *                                             [--strict] [--no-smoke]
 *
 *   --weekly   (default) checks the weekly GEO loop only
 *   --monthly  checks every stream the monthly scorecard reads
 *   --json     machine-readable report on stdout
 *   --strict   exit non-zero on warn as well as fail
 *   --no-smoke skip the recorder child-process smoke test
 *
 * Exit codes: 0 = clear to run, 1 = a check failed, 2 = the preflight itself
 * broke (which is also a finding — do not treat it as "no news").
 *
 * Reads only. The one exception is the recorder smoke test, which regenerates
 * a report that is a pure function of the ledger. No network, no credentials.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ -> tooling/ -> saas-maker/ -> fleet root. Getting this wrong by one
// segment is the exact bug this script exists to catch; it is asserted below.
const FLEET_ROOT = resolve(__dirname, '../../..');
const SITE_HEALTH = join(FLEET_ROOT, 'site-health');
const BACKEND = join(SITE_HEALTH, 'apps/backend');
const RECORDER = join(__dirname, 'geo-observatory-record.mjs');

const GEO_LEDGER = join(BACKEND, 'data/geo-observatory/ledger.jsonl');
const GEO_REPORT = join(BACKEND, 'docs/geo-observatory-latest.md');
const ROOT_QUERIES = join(BACKEND, 'config/root-search-queries.json');
const BROAD_QUERIES = join(BACKEND, 'config/geo-observatory.json');
const AI_VISIBILITY = join(BACKEND, 'config/ai-visibility.json');

const DAY_MS = 24 * 60 * 60 * 1000;
/** A collector still 'running' this long after it started has died, not stalled. */
const STUCK_RUNNING_MS = 6 * 60 * 60 * 1000;

/**
 * Age budgets, in days, past which a stream is reported stale. The weekly GEO
 * budget is 10 rather than 7 so a routine that fires a day late is not an
 * alert; 20 days — the SAR-2 outage — is unambiguously a failure either way.
 */
const AGE_BUDGET_DAYS = {
  geo: 10,
  ai: 40, // monthly panel, plus grace
  drank: 10,
  psi: 40, // explicit cadence; only the monthly scorecard demands a refresh
  search: 10,
  clarity: 10,
};

/** Evidence families the monthly scorecard reads, in report order. */
const MONTHLY_FAMILIES = ['drank', 'psi', 'search', 'clarity'];

const checks = [];

function record(id, label, state, detail, extra = {}) {
  checks.push({ id, label, state, detail, ...extra });
}

function daysSince(iso, now) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / DAY_MS));
}

/** Calendar-day distance, so a run recorded earlier today reads as 0d, not -1d. */
function daysSinceDate(yyyyMmDd, now) {
  const parsed = Date.parse(`${yyyyMmDd}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.max(0, Math.round((today - parsed) / DAY_MS));
}

function ageState(days, budget) {
  if (days === null) return 'fail';
  if (days > budget) return 'fail';
  if (days > budget - 2) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------
// 1. Path resolution — the SAR-2 failure mode itself.
// ---------------------------------------------------------------------------

function checkPaths() {
  const required = [
    ['fleet root', FLEET_ROOT],
    ['site-health backend', BACKEND],
    ['geo recorder', RECORDER],
    ['geo ledger', GEO_LEDGER],
    ['root query contract', ROOT_QUERIES],
    ['ai-visibility config', AI_VISIBILITY],
  ];
  const missing = required.filter(([, path]) => !existsSync(path));
  if (missing.length > 0) {
    record(
      'paths',
      'Tooling paths resolve',
      'fail',
      `${missing.length} required path(s) missing: ${missing.map(([name]) => name).join(', ')}. ` +
        'This is the SAR-2 failure mode — a script resolving the fleet root one segment short. ' +
        'Fix the path resolution before trusting any number below.',
      { missing: missing.map(([name, path]) => ({ name, path })) },
    );
    return false;
  }
  record('paths', 'Tooling paths resolve', 'ok', `${required.length}/${required.length} resolved from ${FLEET_ROOT}`);
  return true;
}

// ---------------------------------------------------------------------------
// 2. Recorder smoke test — proves the binary still starts.
// ---------------------------------------------------------------------------

function checkRecorderSmoke(skip) {
  if (skip) {
    record('recorder-smoke', 'GEO recorder starts', 'warn', 'skipped (--no-smoke)');
    return;
  }
  const before = existsSync(GEO_REPORT) ? readFileSync(GEO_REPORT, 'utf8') : null;
  const run = spawnSync(process.execPath, [RECORDER, '--report-only'], {
    cwd: dirname(__dirname),
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.status !== 0) {
    record(
      'recorder-smoke',
      'GEO recorder starts',
      'fail',
      `\`geo-observatory-record.mjs --report-only\` exited ${run.status}. ` +
        `stderr: ${String(run.stderr ?? '').trim().slice(0, 400) || '(none)'}`,
    );
    return;
  }
  const after = readFileSync(GEO_REPORT, 'utf8');
  if (before !== null && before !== after) {
    record(
      'recorder-smoke',
      'GEO recorder starts',
      'warn',
      'Recorder runs, but the checked-in report was out of date with the ledger and has been ' +
        'regenerated. Commit the regenerated report.',
    );
    return;
  }
  record('recorder-smoke', 'GEO recorder starts', 'ok', 'runs clean; report matches the ledger');
}

// ---------------------------------------------------------------------------
// 3. GEO ledger freshness + scope completeness.
// ---------------------------------------------------------------------------

function loadLedger() {
  return readFileSync(GEO_LEDGER, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function activeRootKeys() {
  const contract = JSON.parse(readFileSync(ROOT_QUERIES, 'utf8'));
  const keys = new Set();
  for (const root of contract.roots) {
    for (const query of root.queries) {
      if (query.status === 'active') keys.add(`${root.projectId}|${query.id}`);
    }
  }
  return keys;
}

function activeBroadKeys() {
  const config = JSON.parse(readFileSync(BROAD_QUERIES, 'utf8'));
  const keys = new Set();
  for (const product of config.products ?? []) {
    for (const query of product.queries ?? []) {
      if ((query.status ?? 'active') === 'active') keys.add(`${product.id}|${query.qid}`);
    }
  }
  return keys;
}

function checkGeoLedger(now) {
  const ledger = loadLedger();
  if (ledger.length === 0) {
    record('geo-ledger', 'GEO ledger freshness', 'fail', 'ledger is empty');
    return;
  }
  const dates = [...new Set(ledger.map((entry) => entry.date))].sort();
  const latest = dates[dates.length - 1];
  const age = daysSinceDate(latest, now);
  const state = ageState(age, AGE_BUDGET_DAYS.geo);

  const seen = new Set(ledger.filter((entry) => entry.date === latest).map((e) => `${e.product}|${e.qid}`));
  const rootKeys = activeRootKeys();
  const rootHits = [...rootKeys].filter((key) => seen.has(key)).length;
  const broadKeys = activeBroadKeys();
  const broadHits = [...broadKeys].filter((key) => seen.has(key)).length;

  const scope = rootHits === rootKeys.size ? 'complete root contract' : `partial root contract (${rootHits}/${rootKeys.size})`;
  record(
    'geo-ledger',
    'GEO ledger freshness',
    rootHits === rootKeys.size ? state : state === 'ok' ? 'warn' : state,
    `last run ${latest} (${age}d ago, budget ${AGE_BUDGET_DAYS.geo}d) — ${seen.size} observations, ` +
      `${scope}, broad set ${broadHits}/${broadKeys.size}` +
      (state === 'fail'
        ? '. STALE: the weekly routine has not landed a run. Check the routine fired AND the recorder still starts.'
        : ''),
    { latestDate: latest, ageDays: age, observations: seen.size, rootHits, rootExpected: rootKeys.size, broadHits, broadExpected: broadKeys.size, runDates: dates.length },
  );
}

// ---------------------------------------------------------------------------
// 4. AI-visibility panel integrity + last run.
// ---------------------------------------------------------------------------

function openStoreReadOnly() {
  const home = process.env.HOME;
  if (!home) return null;
  const path = join(home, 'Library', 'Application Support', 'Fleet Ops', 'founder-control', 'foundry.sqlite');
  if (!existsSync(path)) return null;
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

function checkPanelIntegrity() {
  const config = JSON.parse(readFileSync(AI_VISIBILITY, 'utf8'));
  const panel = config.baselinePanel;
  if (!panel) {
    record('panel-integrity', 'Frozen panel intact', 'fail', 'baselinePanel block is missing from ai-visibility.json');
    return null;
  }
  let prompts = 0;
  let units = 0;
  const unfrozen = [];
  for (const project of config.projects ?? []) {
    for (const set of project.promptSets ?? []) {
      if (set.id !== panel.id) continue;
      if (!set.frozen) unfrozen.push(project.slug);
      prompts += set.prompts.length;
      units += set.prompts.length * Math.max(1, (project.personas ?? []).length);
    }
  }
  const problems = [];
  if (prompts !== panel.promptCount) problems.push(`prompt count drifted: config has ${prompts}, contract declares ${panel.promptCount}`);
  if (unfrozen.length > 0) problems.push(`promptSet not frozen on: ${unfrozen.join(', ')}`);
  if (problems.length > 0) {
    record(
      'panel-integrity',
      'Frozen panel intact',
      'fail',
      `${problems.join('; ')}. The month-over-month trend is only valid if the prompt set is ` +
        'append-only — reword an id and the trend is worthless.',
    );
    return { panel, units };
  }
  record(
    'panel-integrity',
    'Frozen panel intact',
    'ok',
    `${panel.id}: ${prompts} prompts x personas = ${units} capture units across ${panel.surfaces.length} surfaces, ` +
      `${panel.engines.length} declared engine columns, frozen ${panel.frozenOn}`,
    { panelId: panel.id, prompts, units, engines: panel.engines.map((e) => e.id) },
  );
  return { panel, units };
}

function checkPanelLastRun(store, now, panelInfo) {
  if (!store) {
    record('panel-run', 'AI-visibility last run', 'fail', 'evidence store unreadable — cannot tell when the panel last ran');
    return;
  }
  const rows = store
    .prepare(
      "SELECT project_id, occurred_at, payload_json FROM events WHERE type = 'visibility.run-recorded' ORDER BY sequence DESC LIMIT 200",
    )
    .all();
  if (rows.length === 0) {
    record('panel-run', 'AI-visibility last run', 'fail', 'no visibility.run-recorded events in the store');
    return;
  }
  const latestAt = rows[0].occurred_at;
  const age = daysSince(latestAt, now);
  const sameDay = rows.filter((row) => row.occurred_at.slice(0, 10) === latestAt.slice(0, 10));
  let completed = 0;
  const surfaces = new Set();
  const columns = new Set();
  for (const row of sameDay) {
    const payload = JSON.parse(row.payload_json);
    completed += payload?.coverage?.completed ?? 0;
    surfaces.add(row.project_id);
    for (const receipt of payload?.cost?.receipts ?? []) {
      const engine = receipt.providerId ?? receipt.engineId ?? receipt.provider;
      if (engine) columns.add(engine);
    }
  }
  const expected = panelInfo?.units ?? null;
  const coverageNote = expected ? `${completed}/${expected} capture units` : `${completed} capture units`;
  const state = ageState(age, AGE_BUDGET_DAYS.ai);
  record(
    'panel-run',
    'AI-visibility last run',
    expected && completed !== expected && state === 'ok' ? 'warn' : state,
    `last panel run ${latestAt.slice(0, 10)} (${age}d ago, budget ${AGE_BUDGET_DAYS.ai}d) — ${coverageNote} ` +
      `across ${surfaces.size} surfaces` +
      (columns.size > 0 ? `, columns: ${[...columns].sort().join(', ')}` : '') +
      (state === 'fail' ? '. STALE: the monthly panel re-run has not landed.' : ''),
    { lastRunAt: latestAt, ageDays: age, completed, expected, surfaces: surfaces.size },
  );
}

// ---------------------------------------------------------------------------
// 5. Evidence-refresh receipts for the streams the monthly scorecard reads.
// ---------------------------------------------------------------------------

function checkEvidenceReceipts(store, now) {
  if (!store) {
    record('evidence-receipts', 'Scorecard evidence streams', 'fail', 'evidence store unreadable');
    return;
  }
  const rows = store
    .prepare("SELECT key, value_json FROM local_metadata WHERE key LIKE 'evidence-refresh:%'")
    .all();

  /**
   * A family can be spread over many project scopes (clarity has 28). Grading
   * on one arbitrary scope turns "26 succeeded, 2 were never configured" into a
   * fleet-wide outage. Aggregate instead, and grade on the worst scope that has
   * ever succeeded — a scope that has never succeeded is a configuration gap,
   * not a regression.
   */
  const byFamily = new Map();
  for (const row of rows) {
    const family = row.key.split(':')[1];
    let receipt;
    try {
      receipt = JSON.parse(row.value_json);
    } catch {
      continue;
    }
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push(receipt);
  }

  for (const family of MONTHLY_FAMILIES) {
    const receipts = byFamily.get(family);
    const budget = AGE_BUDGET_DAYS[family] ?? 30;
    if (!receipts || receipts.length === 0) {
      record(`evidence-${family}`, `Evidence: ${family}`, 'fail', 'no refresh receipt in the store — this stream has never reported');
      continue;
    }

    const tally = { succeeded: 0, failed: 0, unavailable: 0, running: 0, stuck: 0 };
    const everSucceeded = [];
    const neverSucceeded = [];
    let oldestSuccessAge = null;
    let worstFailure = null;

    for (const receipt of receipts) {
      tally[receipt.state] = (tally[receipt.state] ?? 0) + 1;
      if (receipt.lastSuccessAt) {
        everSucceeded.push(receipt);
        const age = daysSince(receipt.lastSuccessAt, now);
        if (oldestSuccessAge === null || age > oldestSuccessAge) oldestSuccessAge = age;
      } else {
        neverSucceeded.push(receipt);
      }
      // A collector left 'running' with no finishedAt for hours did not finish,
      // it died. Without this, a dead run reads as "in progress" forever and the
      // stream's real age hides behind a state that sounds healthy.
      if (receipt.state === 'running' && !receipt.finishedAt) {
        const startedAt = Date.parse(receipt.lastAttemptAt ?? '');
        if (Number.isFinite(startedAt) && now - startedAt > STUCK_RUNNING_MS) tally.stuck += 1;
      }
      if (['failed', 'unavailable'].includes(receipt.state) && receipt.failure && !worstFailure) {
        worstFailure = receipt.failure;
      }
    }

    // Grade: a regression on a scope that used to work, or a stale success, fails.
    let state = 'ok';
    const notes = [];
    if (everSucceeded.length === 0) {
      state = 'fail';
      notes.push('no scope has ever succeeded');
    } else {
      state = ageState(oldestSuccessAge, budget);
      if (oldestSuccessAge > budget) notes.push(`oldest successful scope is ${oldestSuccessAge}d old`);
    }
    const regressed = everSucceeded.filter((r) => ['failed', 'unavailable'].includes(r.state));
    if (regressed.length > 0) {
      state = 'fail';
      notes.push(`${regressed.length} scope(s) previously succeeded and are now ${regressed[0].state}`);
    }
    if (tally.stuck > 0 && state === 'ok') {
      state = 'warn';
      notes.push(`${tally.stuck} scope(s) stuck in 'running' — the run started and never finished`);
    } else if (tally.stuck > 0) {
      notes.push(`${tally.stuck} scope(s) stuck in 'running'`);
    }
    if (neverSucceeded.length > 0) {
      notes.push(`${neverSucceeded.length} scope(s) never configured (not a regression)`);
    }

    const summary = Object.entries(tally)
      .filter(([key, value]) => value > 0 && key !== 'stuck')
      .map(([key, value]) => `${value} ${key}`)
      .join(', ');
    record(
      `evidence-${family}`,
      `Evidence: ${family}`,
      state,
      `${receipts.length} scope(s): ${summary}. Oldest success ` +
        `${oldestSuccessAge === null ? 'never' : `${oldestSuccessAge}d`} ago (budget ${budget}d)` +
        (notes.length > 0 ? ` — ${notes.join('; ')}` : '') +
        (worstFailure ? `. ${worstFailure.code}: ${worstFailure.message}`.slice(0, 300) : ''),
      { family, scopes: receipts.length, tally, oldestSuccessAgeDays: oldestSuccessAge, neverConfigured: neverSucceeded.length },
    );
  }
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const strict = argv.includes('--strict');
  const noSmoke = argv.includes('--no-smoke');
  const monthly = argv.includes('--monthly');
  const now = Date.now();

  if (checkPaths()) {
    checkRecorderSmoke(noSmoke);
    checkGeoLedger(now);
    if (monthly) {
      const store = openStoreReadOnly();
      const panelInfo = checkPanelIntegrity();
      checkPanelLastRun(store, now, panelInfo);
      checkEvidenceReceipts(store, now);
      store?.close();
    }
  }

  const failed = checks.filter((c) => c.state === 'fail');
  const warned = checks.filter((c) => c.state === 'warn');
  const verdict = failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'ok';

  if (json) {
    console.log(JSON.stringify({ scope: monthly ? 'monthly' : 'weekly', verdict, checkedAt: new Date(now).toISOString(), checks }, null, 2));
  } else {
    const glyph = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' };
    console.log(`reporting-loop preflight — ${monthly ? 'monthly' : 'weekly'} scope\n`);
    for (const check of checks) {
      console.log(`${glyph[check.state].padEnd(5)} ${check.label}`);
      console.log(`      ${check.detail}`);
    }
    console.log(
      `\nverdict: ${verdict.toUpperCase()} (${checks.length - failed.length - warned.length} pass, ` +
        `${warned.length} warn, ${failed.length} fail)`,
    );
    if (failed.length > 0) {
      console.log('\nDo not report numbers from a failing stream as if they were current. Fix the');
      console.log('collector first, or say explicitly in the report that the stream is stale.');
    }
  }

  if (failed.length > 0) process.exit(1);
  if (strict && warned.length > 0) process.exit(1);
  process.exit(0);
}

try {
  main();
} catch (error) {
  console.error(`reporting-loop-preflight crashed: ${error?.stack ?? error}`);
  console.error('A crashing preflight is itself the SAR-2 failure mode. Treat this as a FAIL, not as silence.');
  process.exit(2);
}
