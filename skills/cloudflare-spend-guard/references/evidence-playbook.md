# Cloudflare spend evidence playbook

Use this reference for full account or Fleet spend audits. Retrieve current
Cloudflare documentation and schemas during every audit; the provider remains
authoritative for prices, allowances, billing dates, and API availability.

## Evidence order

### 1. Money evidence

Use the narrowest available provider surface:

1. Invoice-aligned Billable Usage for current-cycle usage costs.
2. Account and zone subscriptions for fixed recurring fees.
3. Invoice or billing history for completed-cycle confirmation.
4. Credits, adjustments, and committed-contract evidence when relevant.

The Billable Usage view can exclude fixed fees. A zero usage-overage value does
not prove a zero invoice.

Before calling an API, search the current Cloudflare OpenAPI schema. Relevant
surfaces have included account billable usage, PayGo usage and usage info,
account subscriptions, account billing usage, and billing history, but names,
permissions, and response fields can change.

The FOCUS-style billable-usage API can return metered consumption while cost
fields are restricted or unpopulated. Preserve that distinction.

### 2. Runtime usage evidence

Use product analytics to attribute consumption to a resource. Query only the
products discovered in billing data or tracked configuration.

| Product family | Common billable dimensions to verify | Useful attribution key | Optimization questions |
|---|---|---|---|
| Workers / Pages Functions | Requests, CPU, paid-plan base fee | Script name, route, zone | Static assets invoking code? CPU-heavy handler? avoidable polling or retries? |
| Workflows / Queues / Cron | Invocations, CPU, steps, storage, queue operations | Workflow, queue, consumer script | Bounded batches? deduplication? retry storms? dormant schedules? announced billing date? |
| D1 | Rows read, rows written, stored data | Database name or ID | Full scans? missing index? repeated writes? abandoned data? |
| R2 | Stored data, operation classes, optional adjacent services | Bucket name | Small-object churn? unnecessary listing? lifecycle policy candidate? stale artifacts? |
| KV | Reads, writes, lists, deletes, stored data | Namespace | Cache TTL appropriate? write amplification? broad list calls? |
| Durable Objects | Requests, duration, rows/operations, storage | Namespace/class | Dormant retained state? alarms? object fan-out? hibernation opportunity? |
| Vectorize | Queried and stored vector dimensions | Index | Oversized dimensions? repeated queries? stale vectors? |
| Workers AI / AI Gateway | Provider-specific inference units or upstream spend | Model, gateway, route | Cache hits? model right-sized? bounded tokens? duplicate calls? spending limit visible? |
| Browser / Images / Stream / Containers | Product-specific compute, transformations, storage, delivery, or duration | Application, image account, video, container | Needed in production? batch/cache? idle retained capacity? |
| Observability / Analytics | Events, logs, stored data, query volume | Dataset or script | Sampling intentional? retention justified? duplicate telemetry? |

Do not use public request traffic as a universal billing proxy. Static asset
requests, Worker invocations, subrequests, database operations, AI units, and
storage have different billing behavior.

### 3. Configuration exposure

Use `scan-cost-surfaces.mjs` to identify:

- canonical Cloudflare projects and domains;
- tracked Wrangler configs;
- compute, storage, async, AI, and observability bindings;
- scheduled work and explicit CPU limits.

Configuration is useful for finding what to query. It cannot confirm a charge,
runtime usage, or waste.

## Permission fallback

On authentication, permission, or restricted-endpoint failure:

1. Record the failed evidence surface once.
2. Do not retry with alternate credentials or read token files.
3. Continue with provider documentation, product analytics that is already
   authorized, and configuration evidence.
4. Mark current monetary status `unknown`.
5. Ask for only the minimum dashboard evidence:
   - billing-period start and end;
   - product;
   - total usage;
   - billable usage;
   - cumulative usage cost;
   - fixed subscription line items separately.

Do not request or retain payment methods, addresses, tax identifiers, or full
unredacted invoices.

## Attribution rules

1. Prefer exact provider resource IDs or names.
2. Map Workers/Pages names and domains through
   `foundry/ops/config/projects.json`.
3. Map bindings through tracked Wrangler configuration.
4. Keep shared subscription fees at account level unless the user requests an
   explicit management allocation.
5. Keep unattributed metered cost at account level.
6. Never allocate cost by traffic share unless the billing formula itself uses
   that same dimension and the user explicitly wants an estimate.

## Calculation rules

- Align observations to the provider billing cycle.
- Use complete days for rates; call partial-day extrapolation low confidence.
- Keep each consumed unit separate.
- Treat cost-field coverage as part of the result:
  - all records populated: complete for that field;
  - some records populated: partial;
  - none populated: unavailable.
- A positive billed/effective cost confirms usage spend.
- A known fixed subscription confirms current spend even when usage overage is
  zero.
- Zero cost with positive usage means metered-but-not-charged only when the
  provider field is authoritative and complete.
- Free allowance comparisons require the current plan, included amount, reset
  period, and current usage.
- Future pricing or billing start dates belong in `watch` until effective.
- If billing or plan evidence is unavailable, monetary spend state remains
  `unknown`; express configured or runtime concern through the separate
  `low`/`watch`/`high` exposure-risk field.

## Necessity review

For each mapped project, cite:

- attention tier and live/retired state from the Fleet registry;
- shipped/planned requirement from `PROJECT_STATUS.md`;
- runtime activity and freshness;
- cost driver and supported optimization.

Use these questions:

1. Does the resource serve a shipped or planned capability?
2. Is the same capability already served elsewhere?
3. Is the resource shared by another active project?
4. Would pausing it break auth, scheduled jobs, durable state, custom domains,
   rollback, or historical data?
5. Is the saving material relative to added complexity and risk?

## Optimization order

Prefer the smallest safe intervention:

1. Stop duplicate or accidentally repeated work.
2. Bound cron, queue, Workflow, retry, AI, and browser activity.
3. Cache or batch repeated expensive operations.
4. Add query/index/retention/lifecycle improvements supported by evidence.
5. Remove unused paid add-ons or subscriptions after dependency verification.
6. Pause or delete resources only in a separately authorized cleanup task.

## Report evidence labels

Use one or more labels per claim:

- `billing`: invoice, subscription, or invoice-aligned cost.
- `usage`: provider runtime/product analytics.
- `config`: tracked repository configuration.
- `product`: registry or project status.
- `docs`: current provider pricing, limits, or changelog.
- `inference`: clearly explained reasoning from the above.

Every `paying-now` claim needs `billing`. Every project attribution needs
`usage` or `config` plus `product`. Every dollar estimate needs `docs` and
current-cycle `usage` or `billing`.
