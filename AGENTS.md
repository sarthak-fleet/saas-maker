# Workflows and Skills agent instructions

## Scope

This repository owns public, credential-free reusable automation, Fleet-owned
agent skills, and operator scripts. Product repositories call workflows
directly and may link skills from a sibling checkout. It is not a submodule.

**One documented exception:** `update-global-dr.yml` accepts an optional
`AHREFS_API_KEY` secret (passed by the caller via `secrets: inherit`), because
Ahrefs requires it on `domain-rating-free` from 2026-08-10. It is a third-party
read-only API key, not a credential that can read a private repository, and
the workflow remains functional without it before that date.

## Hard boundaries

- Never add a credential that can read a private repository.
- Never explicitly clone or fetch another private repository; reusable CI may
  use the standard caller checkout supplied by GitHub Actions.
- Keep the manifest schema allowlisted; reject unknown fields.
- Persist no response bodies, headers, cookies, environment values, or private
  provider data.
- Production deploys and provider-authenticated inventory stay out of scope.
- Never commit private project catalogs, provider inventories, retained skill
  output, host state, or production configuration.
- Keep product-specific scripts in their product repositories; do not duplicate
  them here.
- Treat everything under `preserved/legacy-fleet-tooling/` as noncanonical
  history. Do not invoke or extend it as an active capability.
- Site Health owns AI visibility, Search Console, and portfolio performance
  collection. Never update the retained copies here as a second source of
  truth.
- Keep each skill self-contained under `skills/<name>/` and run the tooling
  validator after changing scripts or skills.
- Use only standard GitHub-hosted runners.
- Pin third-party actions to full commit SHAs.

## Commands

```bash
node scripts/audit.mjs --validate-only
node --test test/*.test.mjs
node scripts/validate-tooling.mjs
node scripts/audit.mjs --mode availability --runs 1
node scripts/audit.mjs --mode performance --runs 3
node scripts/ahrefs-site-audit-health.mjs
```

Canonical-root site audit is an operator workflow whose working path is a
local sitemap crawl plus source actions. Keep any `AHREFS_API_KEY` runtime-only
and fail closed without entitlement. Do not advertise the script as a
credential-free catalog entrypoint.

Use Node.js 20 or newer. The repository intentionally has no npm runtime or
development dependencies.
