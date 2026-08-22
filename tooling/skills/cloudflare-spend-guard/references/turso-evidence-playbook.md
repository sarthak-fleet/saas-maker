# Turso spend evidence playbook

Use this reference for Turso project or Fleet audits. Retrieve current official
pricing, usage-and-billing, CLI, and Platform API documentation during every
audit. Do not store plan prices, quotas, or reset behavior as durable truth.

## Evidence order

### 1. Plan and money evidence

Prefer authenticated read-only surfaces that keep credentials hidden:

```bash
turso --version
turso plan show
```

Capture only:

- organization;
- current plan;
- overage mode;
- used and limit for each compatible resource dimension;
- exact reset time and timezone;
- confirmed recurring price or positive overage cost when the provider exposes
  it.

`turso plan show` can establish a zero-cost fail-closed plan only when it
explicitly shows the current plan and disabled overages. A paid plan confirms
fixed spend only when current provider evidence also establishes its current
price. Missing price or invoice evidence stays missing.

Retrieve these current official surfaces before monetary claims:

- Turso pricing;
- Usage & Billing;
- `turso plan show`;
- organization plans and current-cycle usage Platform API schemas.

Do not run authentication, token-minting, plan-selection, plan-upgrade, or
overage-changing commands.

### 2. Organization and database usage

Inventory live databases without printing their URLs in the report:

```bash
turso db list
turso db inspect <database-name>
```

The organization usage Platform API may provide current-cycle totals for:

- rows read;
- rows written;
- storage bytes;
- bytes synced;
- database count;
- groups;
- locations;
- database and instance totals.

Map database UUIDs to names through the read-only database inventory when using
the API. Do not guess a project mapping from usage share.

### 3. Query-efficiency evidence

In Turso, rows read are row scans, not merely result rows. Full scans,
aggregates, joins, subqueries, updates without an indexed filter, and index
creation can read many more rows than returned.

Only when database-level evidence shows a material driver, inspect query
statistics:

```bash
turso db inspect <database-name> --queries
```

Treat SQL text as sensitive. Do not persist or quote raw SQL, literals, URLs,
identifiers containing user data, or application values. Report only sanitized
query shape, execution count, row-scan behavior, and the smallest verification:

- run `EXPLAIN QUERY PLAN` separately only with explicit authorization to query
  production;
- verify whether the relevant filter/join has an index;
- verify whether a scheduled refresh or aggregate can be cached, bounded, or
  made incremental;
- distinguish a one-time migration/index build from steady-state traffic.

The spend audit itself does not run SQL.

## Configuration exposure

`scan-cost-surfaces.mjs` detects tracked Turso/libSQL package dependencies and
safe variable names from tracked example environment files. It never reads
local environment files, connection values, token stores, or Turso CLI config.

Configuration proves dependency exposure only. It does not prove:

- a database exists;
- the project still owns it;
- current usage;
- current plan;
- overage mode;
- a charge or zero cost.

## Classification rules

- **Paid plan or positive overage cost:** `paying-now`.
- **Overages enabled and usage has a supported path to excess:** usually
  `likely-this-cycle`; show inputs.
- **Overages disabled and usage near a quota:** monetary state can remain
  `unlikely-on-current-evidence` when the plan is confirmed free, while
  exposure risk becomes `high` because queries may be blocked.
- **Plan or overage mode unavailable:** monetary state `unknown`.
- **Unused database on a free plan:** low monetary urgency; use lifecycle
  evidence before `pause-candidate`.

Do not label quota exhaustion as spend. Do not label a zero-cost plan safe when
fail-closed usage can break an active product.

## Permission fallback

If the CLI or Platform API cannot authenticate:

1. Stop after one failed attempt per evidence surface.
2. Do not read Turso config/token files or mint another token.
3. Continue with tracked configuration and project status.
4. Mark monetary and current-quota state `unknown`.
5. Ask for one of:
   - sanitized output of `turso plan show`;
   - Turso dashboard organization **Usage** and **Billing/Plan** views showing
     plan, overage mode, reset, used, limit, and current cost;
   - sanitized organization usage JSON without tokens, URLs, or payment data.

## Attribution and necessity

Map exact database names through Fleet registry, tracked dependency evidence,
and current project status. Common mismatches include renamed products,
separate catalog databases, retired databases, and databases shared by more
than one runtime.

For every material database ask:

1. Which shipped or planned feature needs it?
2. Is it the primary store, a cache, a catalog, a vector index, or a rollback?
3. Is usage driven by public traffic, scheduled jobs, migrations, or operator
   tooling?
4. Would pausing it break auth, durable state, sync, history, or recovery?
5. Is optimization smaller and safer than migration?

Keep unmatched databases unowned until evidence resolves them.

## Report shape

Keep Turso's calendar-month reset separate from Cloudflare's billing cycle.
Report:

| Database/resource | Plan/spend state | Quota risk | Current usage | Fleet owner | Needed? | Decision | Next step |
|---|---|---|---|---|---|---|---|

End with a safety statement confirming that no plan, overage, database, query,
schema, index, group, location, token, migration, or production change occurred.
