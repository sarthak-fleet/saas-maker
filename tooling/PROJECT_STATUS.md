# Workflows and Skills — PROJECT STATUS

Last updated: 2026-08-22

## Why / What

Workflows and Skills is the public, credential-free source and execution
boundary for reusable GitHub Actions, Fleet-owned agent skills, and Fleet
operator scripts.

**Users:** Sarthak and Fleet operators.

**In scope:** Reusable workflows, public site checks, Fleet-owned skills,
operator scripts, reusable libraries and templates, and sanitized public
reports.

**Out of scope:** Credentials, private project catalogs, provider inventory,
retained operational output, production configuration, deploys, and scripts
owned by individual products.

## Dependencies

### External

- GitHub Actions standard hosted runners.
- Public HTTPS product surfaces.
- Node.js 20 or newer with built-in `fetch`.

### Internal

- Site Health owns the private project catalog consumed by portfolio-aware tools.
- Product repositories call reusable workflows by an exact revision.

## Timeline

- 2026-08-22 — Restored a canonical-root site-audit operator workflow. Ahrefs
  Health Scores stay optional and fail-closed without entitlement; the working
  path is a local sitemap crawl that emits source actions for 4xx pages,
  missing titles, and missing h1s. Infisical `AHREFS_API_KEY` currently returns
  HTTP 401.
- 2026-08-22 — Finished the cross-project sub-five-minute local verification
  qualification: a reusable contract (`fleet.local-verification-qualification.v1`),
  observable readiness probing (HTTP, TCP, log, command — no fixed waits),
  failure injection, exact-patch selection checks, a reusable GitHub Actions
  workflow, an operator script, a skill, and repeatable evidence on two
  materially different project types (HTTP server and log-probe worker).
  Also committed the Clarity fleet rollout skill and apply-clarity-id operator
  script from issue #18.
- 2026-08-21 — Added an English-language adaptation of Ian's MIT-licensed
  Xiaohei editorial-illustration skill, preserved upstream attribution, and
  exposed it through the Fleet skill installer.
- 2026-08-21 — Physically isolated preserved Console, analytics, catalog, Site
  Health, and extracted-product workflow sources under
  `preserved/legacy-fleet-tooling/`. Removed the retired Console from active
  agent-stack commands, corrected standalone Fleet-root resolution, and kept
  every historical script and all 44 skills tracked.
- 2026-08-21 — Completed the standalone capability-catalog boundary: removed
  the retired teammate skill root, made catalog paths repository-relative,
  added execution profiles for all 44 cataloged skills, and added focused
  regression coverage. Active standalone entrypoints are now separated from
  preserved noncanonical Console, marketing, analytics, and Site Health code.
  Historical Fleet issues were reconciled into this repository's issue
  tracker; no skills or operator scripts were deleted.
- 2026-08-21 — Restored all Fleet-owned scripts and skills removed during the
  Dashboard cleanup into this repository, together with reusable libraries,
  templates, contracts, syntax validation, and skill packaging validation.
- 2026-08-21 — Moved the maintained personal habit surface from the Indulge
  compatibility domain to the canonical Habits domain without changing the
  credential-free probe contract or the 31-site scope.
- 2026-08-20 — Repointed the reusable Fleet contract workflow from the retired
  nested public-directory lockfile to Fleet Ops' own quality-tool lockfile after
  SaaS Maker became a standalone repository. No deployment behavior changed.
- 2026-08-16 — Expanded the generated public manifest to cover the approved
  informational surfaces for Office OS and Local AI Video Studio plus the
  Indulge product and trust site, bringing credential-free monitoring to 31
  maintained public surfaces.
- 2026-08-14 — Expanded the generated public manifest to include India
  Standards at its canonical Significant Hobbies domain; validation remains
  credential-free and no deployment was performed.
- 2026-07-30 — Public repository created with strict manifest validation,
  bounded surface availability checks, repeated HTTP latency evidence, and
  least-privilege Actions.

## Products

- `sass-maker/workflows-and-skills` — reusable workflows, skills, scripts, and
  public automation evidence.

## Features (shipped)

- Exact-schema public site manifest validation across 31 maintained public
  surfaces.
- Bounded redirects, timeouts, concurrency, and sanitized network failures.
- Availability reports with status and redirect evidence.
- Repeated header/total-response latency reports with p50 and p90.
- Read-only pull-request validation and default-branch scheduled evidence.
- Forty-seven agent skills with validated provider-neutral execution profiles,
  including the attributed English Xiaohei illustration adaptation, the Clarity
  fleet rollout skill, and the local-verification qualification skill.
- Nine standalone operator entrypoints exposed through the capability catalog,
  with retired product/control-plane sources physically isolated as
  noncanonical history and still covered by shell and Node syntax validation.
- Cross-project sub-five-minute local verification qualification with
  observable readiness probing (HTTP, TCP, log, command), failure injection,
  exact-patch selection checks, a reusable GitHub Actions workflow, and
  repeatable evidence on two materially different project types.
- Canonical-root site-audit operator workflow: local sitemap crawl and
  source-action rows for 4xx, missing titles, and missing h1s. Ahrefs Health
  Scores remain optional and fail-closed without entitlement.

## Work queue

Open work is tracked only in
[GitHub Issues](https://github.com/sass-maker/workflows-and-skills/issues).
