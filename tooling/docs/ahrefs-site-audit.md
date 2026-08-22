# Canonical-root site audit

The working path is a local sitemap crawl of Site Health's canonical roots,
then source actions for 4xx pages, missing titles, and missing h1s. A report
without remediation is incomplete.

Ahrefs Health Scores are optional. The Infisical `AHREFS_API_KEY` currently
returns HTTP 401, so provider scores stay fail-closed until an entitled key
exists.

This is a reusable operator workflow. It is not a Site Health product surface
and it is not part of the credential-free public availability catalog.

## Command

```bash
node scripts/ahrefs-site-audit-health.mjs
```

The command crawls each root sitemap and emits source actions. It also
attempts Ahrefs when a key is present; missing entitlement does not skip
the local crawl. Use `--no-act` only when you need the provider report
without actions.

Optional flags:

- `--brands-path <file>` — JSON catalog with a `brands` array. Defaults to
  the sibling Site Health file
  `../site-health/apps/backend/config/root-brands.json`.
- `--output <file>` — markdown report path. Defaults to
  `docs/ahrefs-site-audit-latest.md`.
- `--max-age-days <n>` — crawl freshness window. Defaults to `14`.
- `--no-act` — skip the local crawl and action table.

## Act on the results

The markdown report includes a **Local crawl and source actions** table.
Every `error` row is work:

| Issue | Source action |
|---|---|
| `http-4xx` | Restore the page or remove it from the sitemap |
| `missing-title` | Add a unique HTML title |
| `missing-h1` | Add one visible page-level `h1` |
| `missing-canonical` | Warning only unless the page is already being edited |

Apply error actions in the owning repository. Do not deploy. Do not invent
review scores, aggregate ratings, or other social proof. Skip agent surfaces
(`llms.txt`, Markdown alternates, `/api/*`).

The process exits non-zero while Ahrefs is blocked or any error action remains.

## Credentials

Set `AHREFS_API_KEY` in the runtime environment only. Do not commit it, put
it in this repository's secrets, or persist provider response bodies.

Site Audit is a paid Ahrefs Management API. The free Domain Rating key used
by Drank and PSI Swarm is not sufficient; a missing entitlement fails closed
with `auth-entitlement-error` (HTTP 401 or 403) and writes no zero scores.
The local crawl still runs so there are actions to apply.

The collector fails closed when:

- the API key is missing;
- Ahrefs returns 401 or 403 (missing Site Audit entitlement);
- the Site Health brand catalog is missing;
- the provider request fails or returns an invalid payload.

Unavailable metrics stay null. They are never written as zero.

## Ownership

| Concern | Owner |
|---|---|
| Canonical root brand catalog | Site Health |
| Dashboard, Search Console, AI visibility, performance portfolio | Site Health |
| Reusable collector, local crawl, action table, and this skill adapter | Workflows and Skills |
| Source fixes for a flagged page | The product repository that owns the domain |

The preserved copy under `preserved/legacy-fleet-tooling/` is historical. Do
not invoke it.

## Report

The generated markdown at `docs/ahrefs-site-audit-latest.md` is operator
evidence. It contains public root domains, crawl dates, Site Audit counts,
and source actions. It does not contain API keys, Authorization headers, or
raw Ahrefs payloads.
