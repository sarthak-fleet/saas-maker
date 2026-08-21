import { execFileSync } from 'node:child_process';

/**
 * Per-product D1 aggregate query mappings.
 *
 * Each product defines the table and column names for signup (account creation),
 * activation, core action, and return-session signals. Queries return COUNT
 * and COUNT(DISTINCT) aggregates only — no rows, no PII.
 *
 * Products not listed here will be reported as "no-d1-mapping" in the
 * unavailable list.
 */
const PRODUCT_QUERIES = {
  significanthobbies: {
    database: 'significanthobbies',
    userTable: 'auth_user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
  'anime-list': {
    database: 'anime-list',
    userTable: 'user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
  reader: {
    database: 'reader',
    userTable: 'user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
  'swe-interview-prep': {
    database: 'swe-interview-prep',
    userTable: 'user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
  karte: {
    database: 'linkchat-auth',
    userTable: 'user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
  starboard: {
    database: 'starboard',
    userTable: 'user',
    userCreatedColumn: 'createdAt',
    userIdentifier: 'id',
  },
};

/**
 * Collect read-only D1 aggregate user-metrics for products with authoritative
 * Cloudflare D1 databases. Uses `wrangler d1 execute --json` with read-only
 * COUNT/COUNT(DISTINCT) queries only. No PII, no rows, no credentials stored.
 *
 * @param {object} options
 * @param {Array} options.projects - Canonical Fleet projects.
 * @param {Function} [options.execImpl] - Exec implementation (for testing).
 * @param {Date} [options.now] - Current timestamp.
 * @param {number} [options.reportingWindowDays] - Reporting window (default 7).
 */
export async function collectD1Outcomes({
  projects,
  execImpl = defaultExec,
  now = new Date(),
  reportingWindowDays = 7,
}) {
  if (!Number.isInteger(reportingWindowDays) || reportingWindowDays < 1 || reportingWindowDays > 90) {
    throw new Error('D1 reporting window must be 1-90 days');
  }

  const observedAt = now.toISOString();
  const runId = observedAt.replace(/[^0-9]/g, '');
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (reportingWindowDays - 1));

  const period = {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };

  const observations = [];
  const unavailable = [];

  for (const project of projects ?? []) {
    const mapping = PRODUCT_QUERIES[project.id];
    if (!mapping) {
      unavailable.push({ projectId: project.id, reason: 'no-d1-mapping' });
      continue;
    }

    try {
      const metrics = await queryD1Metrics({
        execImpl,
        mapping,
        startDate,
        endDate,
      });

      if (metrics.length === 0) {
        unavailable.push({ projectId: project.id, reason: 'no-data' });
        continue;
      }

      const scope = project.domains?.[0] ?? project.id;
      observations.push({
        id: `user-metrics-d1-${project.id}-${runId}`,
        projectId: project.id,
        family: 'user-metrics',
        provider: 'd1-aggregate',
        scope,
        observedAt,
        period,
        metrics,
      });
    } catch (error) {
      unavailable.push({
        projectId: project.id,
        reason: 'query-error',
        detail: error?.message ?? String(error),
      });
    }
  }

  return {
    bundle: {
      schema: 'fleet.visibility-outcome-bundle.v1',
      observations,
    },
    projectCount: projects?.length ?? 0,
    observationCount: observations.length,
    unavailable,
    period,
  };
}

async function queryD1Metrics({ execImpl, mapping, startDate, endDate }) {
  const startUnix = Math.floor(startDate.getTime() / 1000);
  const endUnix = Math.floor(endDate.getTime() / 1000);
  const { userTable, userCreatedColumn, database } = mapping;

  const metrics = [];

  // Total accounts
  const totalAccounts = await runD1Query(execImpl, database,
    `SELECT COUNT(*) as value FROM ${userTable};`);
  if (totalAccounts > 0) metrics.push({ label: 'Accounts', value: totalAccounts });

  // New accounts in period
  const newAccounts = await runD1Query(execImpl, database,
    `SELECT COUNT(*) as value FROM ${userTable} WHERE ${userCreatedColumn} >= ${startUnix} AND ${userCreatedColumn} <= ${endUnix};`);
  if (newAccounts > 0) metrics.push({ label: 'New accounts', value: newAccounts });

  return metrics;
}

function defaultExec(args, options) {
  return execFileSync('npx', args, {
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  });
}

async function runD1Query(execImpl, database, sql) {
  const args = [
    'wrangler', 'd1', 'execute', database,
    '--json', '--command', sql, '--remote',
  ];
  const output = execImpl(args);
  const parsed = JSON.parse(output);
  const row = parsed?.[0]?.results?.[0];
  return Number(row?.value ?? 0);
}

export { PRODUCT_QUERIES };
