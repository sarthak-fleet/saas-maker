# Clarity fleet health

Fleet keeps one Microsoft Clarity project per catalog identity. Two skills own
different halves of that, and they must not be confused:

| Skill | Owns |
| --- | --- |
| `clarity-fleet-rollout` | Creating projects, assigning IDs, wiring source, repairing receipt drift — all mutations |
| `clarity-fleet-health` | Repeatable read-only health checks across every identity |

This page is the operator index for the health half. The full protocol is
[`skills/clarity-fleet-health/SKILL.md`](../skills/clarity-fleet-health/SKILL.md).

## Four modes, in escalation order

| Mode | Command | Touches |
| --- | --- | --- |
| `source-audit` | `pnpm --dir saas-maker tooling:clarity` | Files only — no token, no network |
| `cached-health` | `pnpm --dir site-health clarity -- status-all` | Local snapshots only |
| `provider-refresh` | `pnpm --dir site-health clarity -- fetch-all --days 3` | One bounded Data Export request per eligible current project |
| `mcp-investigation` | `@microsoft/clarity-mcp-server`, one project | Optional follow-up, never the pass/fail gate |

Only an explicit refresh / retest-live / test-every-application request
authorizes `provider-refresh`. "Check Clarity" means `cached-health`.

## What this repository owns

| File | Role |
| --- | --- |
| `config/clarity-projects.json` | The canonical receipt (`fleet.clarity-registry.v2`) — identity, Clarity ID, hostname, `browserSurfaces`, and the exclusion reason for every unwired product |
| `config/clarity-capabilities.json` | Capability policy split by mode: automatic, provider, source, operator, infrastructure |
| `config/clarity-journeys.json` | Per-product conversion events and funnels, defined from real routes |
| `scripts/clarity-audit.mjs` | The credential-free `source-audit` implementation |
| `templates/clarity-snippet.html` | The standard loader used when wiring a surface |

SaaS Maker Tooling **never** handles or stores a Clarity token. Token
resolution, provider requests, and snapshot persistence live in Site Health.

## The six reported classes

Every canonical identity lands in exactly one: `measured`, `cached`,
`unavailable`, `unwired`, `inactive`, or `failed`. A run reports all of them —
one missing token or provider failure never erases the other projects.

`unwired` and `inactive` are passes when the receipt records a reason (local
only, native only, private, retired, no browser surface). A receipt entry with
no catalog project is drift and reports as `failed`, not as a quiet exclusion.

The bounded summary schema (`site-health.clarity-fleet-collection.v2`), the
state-to-class mapping, and the markdown table format are documented once, in
Site Health: `site-health/docs/clarity-fleet-health.md`.

## Boundaries

- No recordings, heatmaps, URLs, visitor identifiers, or raw provider payloads
  leave a health run — in any mode.
- No project creation, token generation, source wiring change, deploy, or
  schedule installation. Those are `clarity-fleet-rollout` or separate,
  separately authorized work.
- MCP output is exploratory evidence. The deterministic Data Export adapter is
  the fleet health authority.
- `uniqueBrowsers` counts browser/device identities, never registered users.
- Source wiring, provider settings, deployment, and observed traffic are four
  separate gates; evidence for one never proves another.
