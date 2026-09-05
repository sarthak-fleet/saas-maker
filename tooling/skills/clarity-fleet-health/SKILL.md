---
name: clarity-fleet-health
description: Audit Microsoft Clarity across every Fleet product, including project-ID integrity, source wiring, desired capability coverage, provider settings, cached aggregate traffic, and explicit live traffic refreshes. Use for Clarity counts, fleet-wide Clarity health, missing analytics, feature adoption, or requests to test Clarity on all applications; use clarity-fleet-rollout instead for project creation or source installation.
---

# Clarity Fleet Health

Account for every canonical product without pretending every product should be
tracked. Local-only, native-only, private, inactive, and deliberately
analytics-free products can pass with an explicit unwired reason.

## Choose the evidence mode

Run commands from the Fleet root.

### Source integrity

For ID ownership, duplicate IDs, retired shared IDs, declared entrypoints, and
undeclared loaders:

```bash
pnpm --dir saas-maker tooling:clarity
```

This is credential-free and read-only. It accounts for all registry entries
and verifies declared source files in available sibling checkouts. It also
validates `saas-maker/tooling/config/clarity-capabilities.json`, which separates
automatic, provider, source, operator, and infrastructure capabilities. A
desired assignment is policy, not proof that the provider setting is enabled.

### Provider capability audit

Use the signed-in Clarity workspace when the user asks to enable or verify the
full feature set. Audit one project before batching and keep these gates
separate:

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

### Cached traffic health

For a no-network inventory of the latest Site Health snapshots:

```bash
pnpm --dir site-health clarity -- status-all
```

This mode must not resolve tokens or call Microsoft. Use it first when the user
asks for current counts without explicitly requesting a live refresh.

### Live fleet refresh

When the user explicitly asks to refresh, retest live, or test every
application, run:

```bash
pnpm --dir site-health clarity -- fetch-all --days 1
```

The request authorizes at most one Data Export request per eligible current
project. The collector runs projects sequentially, continues after missing
tokens or provider failures, stores only bounded aggregate snapshots, and
returns one result for every canonical identity. Do not retry failures in the
same run: Microsoft permits only ten export requests per project per day.

For one product, prefer:

```bash
pnpm --dir site-health clarity -- status <project-id>
pnpm --dir site-health clarity -- fetch <project-id> --days 1
```

## MCP role

The official `@microsoft/clarity-mcp-server` is an MCP stdio server, not a
normal human-facing reporting CLI. Use it only for a focused follow-up on one
project when an MCP client and that project's private `CLARITY_API_TOKEN` are
already available. Never pass the token as a command-line argument. Treat MCP
answers as exploratory evidence; the deterministic Site Health Data Export
adapter is the fleet health authority.

Do not retain session recordings, heatmaps, URLs, visitor identifiers, or raw
provider payloads in a fleet sweep. If the user explicitly requests a targeted
recording investigation, keep it to the selected project and record only a
bounded conclusion.

## Interpret and report

Use these states without collapsing them:

- `measured`: the live aggregate request succeeded.
- `fresh`, `stale`, or `not-measured`: cached Site Health state.
- `unavailable`: an eligible product lacks a resolvable private token.
- `failed`: Clarity rejected or could not serve the request.
- `unwired`: the canonical receipt intentionally records no tracked surface.
- `inactive`: the identity is retained but excluded from live refresh.
- `not-cataloged`: receipt/catalog drift that needs repair.
- `desired`: the capability policy calls for adoption, but provider state is
  not yet verified.
- `conditional`: adoption requires real project evidence such as a GA4
  property, consent flow, or stable internal IPv4 range.
- `blocked`: adoption needs separately authorized infrastructure or spend.
- `provider-verified`: the saved Clarity setting was reread after mutation.

Report totals first, then failures and unavailable eligible products, then
intentional exclusions. Call `uniqueBrowsers` unique browser/device identities,
never registered users. Separate source wiring, provider measurement,
deployment, and public verification; evidence for one gate does not prove the
others.

Use `clarity-fleet-rollout` for creating projects, changing IDs, wiring source,
or repairing receipt drift. Those mutations require their own authorization.
