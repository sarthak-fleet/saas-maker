---
name: clarity-fleet-health
description: Audit Microsoft Clarity across every Fleet product, including project-ID integrity, source wiring, desired capability coverage, provider settings, cached aggregate traffic, and explicit live traffic refreshes. Use for Clarity counts, fleet-wide Clarity health, missing analytics, feature adoption, or requests to test Clarity on all applications; use clarity-fleet-rollout instead for project creation or source installation.
---

# Clarity Fleet Health

Account for every canonical product without pretending every product should be
tracked. Local-only, native-only, private, inactive, and deliberately
analytics-free products can pass with an explicit unwired reason.

## Pick one mode

Run commands from the Fleet root. Escalate only as far as the question needs:
**source-audit** answers wiring questions with no credentials at all,
**cached-health** answers "what are the numbers" with no network, and
**provider-refresh** is the only mode that spends provider quota.

| Mode | Touches | Use it for |
| --- | --- | --- |
| `source-audit` | Files only | ID ownership, duplicate/retired IDs, declared entrypoints, undeclared loaders, capability policy validity |
| `cached-health` | Local snapshots | Current counts and per-project state without a provider call |
| `provider-refresh` | Clarity Data Export | An explicitly requested live refresh across every eligible current product |
| `mcp-investigation` | Clarity MCP, one project | A focused follow-up question after aggregate evidence points somewhere |

Never start at `provider-refresh` because the user said "check Clarity". Only an
explicit refresh, retest-live, or test-every-application request authorizes it.

---

## Mode 1 — `source-audit` (credential-free)

**Inputs:** the sibling Fleet checkouts. No token, no network, no provider.

```bash
pnpm --dir saas-maker tooling:clarity
```

**Checks:** every registry entry is accounted for; every declared entrypoint
exists in an available sibling checkout; no duplicate or retired shared ID
survives on a wired surface; and per the browser-surface policy, each identity
declares its landing, browser-app, combined, or explicit no-browser-surface
coverage. It also validates
`saas-maker/tooling/config/clarity-capabilities.json`, which separates
automatic, provider, source, operator, and infrastructure capabilities.

**Output:** a per-identity source verdict. A `desired` capability assignment is
policy — it is not proof that the provider setting is enabled.

**Safety:** read-only. Safe to run unprompted whenever Clarity comes up.

---

## Mode 2 — `cached-health` (no network)

**Inputs:** the last bounded local snapshots in Site Health's store. Resolves no
token and issues no provider request — that is asserted by test, not convention.

```bash
pnpm --dir site-health clarity -- status-all
pnpm --dir site-health clarity:table            # same run as a markdown table
pnpm --dir site-health clarity -- status <project-id>
```

**Output:** one bounded JSON summary
(`site-health.clarity-fleet-collection.v2`, `mode: cached-health`) with one row
per canonical identity, or the same data as a markdown table. Schema and the
six classes: [Clarity fleet health](../../docs/clarity-fleet-health.md).

**Safety:** use this first when the user asks for current counts without
explicitly asking for a live refresh. Say plainly when a number is cached and
how old it is; a stale snapshot under a weekly cadence means "it isn't Monday",
not "the refresh failed".

---

## Mode 3 — `provider-refresh` (explicit, spends quota)

**Inputs:** project-scoped private Data Export tokens, resolved by Site Health
from private environment, Infisical, or the macOS Keychain. Tokens are never
passed on a command line, never printed, and never persisted by this skill.

```bash
pnpm --dir site-health clarity -- fetch-all --days 1
pnpm --dir site-health clarity -- fetch-all --days 3 --format markdown
pnpm --dir site-health clarity -- fetch <project-id> --days 1
```

**Behavior:** at most one Data Export request per eligible current project, run
sequentially. Missing tokens and provider failures do not stop the run: the
affected project is reported `unavailable` or `failed` and the rest continue.
Exclusions never reach the adapter.

**Output:** the same bounded summary with `mode: provider-refresh`. Only
normalized aggregates are stored.

**Safety:** Microsoft permits roughly ten export requests per project per day,
and the widest window the API serves is three days. Do not retry failures in the
same run. Prefer one project when one project is the question.

---

## Mode 4 — `mcp-investigation` (optional, never a gate)

**Inputs:** an MCP client that is already configured, and one project's private
`CLARITY_API_TOKEN` already available in the environment.

The official `@microsoft/clarity-mcp-server` is an MCP stdio server, not a
human-facing reporting CLI. Register it in the client's MCP configuration with
the token supplied through the server's environment — never as a command-line
argument, and never inside a file that gets committed.

**Use it only** for a focused follow-up on one project after aggregate evidence
already identified it. Ask one bounded question; record one bounded conclusion.

**Safety:** MCP output is exploratory evidence, not the fleet health result. The
deterministic Data Export adapter in `cached-health` and `provider-refresh` is
the authority. Do not retain session recordings, heatmaps, URLs, visitor
identifiers, or raw provider payloads. If the user explicitly requests a
targeted recording investigation, keep it to the selected project.

---

## Related, but not a mode: provider settings audit

Use the signed-in Clarity workspace when the user asks to enable or verify the
full feature set. That is capability adoption, not health measurement; audit one
project before batching and keep these gates separate:

1. **Automatic baseline:** recordings, heatmaps, behavioral/frustration
   insights, Copilot, automatic Smart Events, benchmarks, and citations after
   domain verification.
2. **Project-specific provider setup:** custom Smart Events, funnels, masking,
   stable internal IPv4 exclusions, and GA4 when a real property exists.
3. **Infrastructure setup:** AI Bot Activity requires a supported CDN/server
   connection and an explicit production-cost/configuration decision.
4. **Source setup:** Consent API v2 belongs in an existing consent flow; never
   invent consent or send identifiers merely to increase Clarity coverage.
5. **Operator setup:** Data Export and MCP need project-scoped private tokens.

Inspect actual routes and button labels before defining a custom event or
funnel. Prefer one primary conversion event and one truthful multi-step funnel;
mark a single-action surface not applicable instead of inventing steps. Keep
provider state `unverified` until the saved setting is reread from Clarity.

## Interpret and report

Every canonical identity lands in exactly one of six reported classes:

- `measured`: a live aggregate request succeeded this run.
- `cached`: stored aggregate evidence exists and no provider call was made.
- `unavailable`: eligible, but no resolvable private token and no snapshot.
- `unwired`: the canonical receipt intentionally records no tracked surface.
- `inactive`: the identity is retained but excluded from live refresh.
- `failed`: Clarity rejected or could not serve the request — or the receipt has
  no catalog project, which is drift that needs repair, not a quiet pass.

The collector's detailed state travels alongside the class, so do not collapse
`fresh`, `stale`, `not-measured`, or `not-cataloged` when they matter. Capability
states stay separate again: `desired` (policy, provider unverified),
`conditional` (needs a real GA4 property, consent flow, or stable internal IPv4
range), `blocked` (needs separately authorized infrastructure or spend), and
`provider-verified` (the saved setting was reread after mutation).

Report totals first, then failures and unavailable eligible products, then
intentional exclusions. Call `uniqueBrowsers` unique browser/device identities,
never registered users. Separate source wiring, provider measurement,
deployment, and public verification; evidence for one gate does not prove the
others.

Use `clarity-fleet-rollout` for creating projects, changing IDs, wiring source,
or repairing receipt drift. Those mutations require their own authorization.
This skill never creates a project, generates a token, edits source wiring,
deploys a product, or installs a schedule.
