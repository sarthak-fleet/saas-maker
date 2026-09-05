# SaaS Maker Tooling — PROJECT STATUS

Last updated: 2026-09-01

## Why / What

SaaS Maker Tooling is the public, credential-free source and execution boundary
for reusable GitHub Actions, Fleet-owned agent skills, and Fleet operator
scripts. It lives under `tooling/` in `sass-maker/saas-maker`.

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

- 2026-09-01 — Added a credential-free Clarity capability desired-state
  contract covering 17 automatic, provider, source, operator, and
  infrastructure features. The source audit now validates and reports the
  policy separately from provider proof: 39 wired surfaces produce 507 desired,
  117 conditional, and 39 blocked assignments across the 56-project receipt,
  with zero provider settings falsely marked verified. A live-root scan also
  produced 36 concrete Smart Event/funnel candidates and three explicit
  rendered-discovery blockers; both active discovery gaps were resolved from
  stable rendered-source evidence, so the three remaining blockers are inactive
  retained identities. Focused Clarity tests and the complete source
  audit pass with no blocking findings. Refs
  `sass-maker/site-health#485`.
- 2026-09-01 — Completed the signed-in Clarity project gap: created dedicated
  projects for Live, High Signal, High Signal Podcasts, IssuePages, and Journal;
  wired their owning public sources; and updated the registry to 56 distinct
  IDs across 56 canonical products with every declared source verified and no
  blocking findings. No analytics project was deleted, no additional terms
  were accepted, and deployment remains a separate gate. Refs #63.
- 2026-09-01 — Owner resolved the landing classification: Starboard, High
  Signal, and Open Historia are the second `adopt` batch, leaving 9 adopt, 6
  keep, 3 retire, and 0 undecided across the inventory. The owner also
  confirmed there is no paid Tailwind Plus access; Preline or a better-fitting
  maintained free upstream is the active web fallback. Refs #62, #80.
- 2026-09-01 — Corrected issue #76's source ledger after an exact Fleet scan
  found obsolete `data-compose="false"` flags on active consumers. Removed the
  active opt-outs, regenerated Calorie from the shared iOS factory, added
  late-strip composition to the hosted loader, and passed product-owned builds
  plus a controlled 40-identity built-document composition matrix at 390, 768,
  and 1440 px. Every checked document rendered one Ask AI surface and one
  project strip inside one extension without the extension widening the
  document; existing product-specific responsive receipts remain authoritative
  for each host page. The only remaining source opt-out is in the
  retired Protein Index repository, whose instructions require explicit
  reactivation. Added a generic, credential-free source audit with five focused
  tests; the caller-owned Site Health receipt now reproduces 51/52 visual
  identities source-ready, 1/1 shared factory source-ready, one dated retired
  exception, and zero blocking findings. No deployment ran. Refs #76.
- 2026-09-01 — Qualified the newly wired App Health changelog, Web Playables
  hub, Materia reference homepage, Mashup public proof, and CodeVetter
  marketing homepage at 390, 768, and 1440 px. All five keep the shared footer
  composed within the viewport and have no document-level horizontal overflow.
  The check exposed and fixed a CodeVetter comparison-panel min-content width
  defect, then passed after rebuild. No deployment ran. Refs #76.
- 2026-09-01 — Reconciled the Clarity receipt against the current 56-entry
  public catalog and the signed-in account inventory: 53 entries have an ID,
  52 IDs are distinct, 36 public surfaces have source wiring, and the other 20
  entries have explicit no-surface, privacy, retirement, or pending decisions.
  Five account-side project creations remain: three absent projects plus clean
  replacements for the shared Live and legacy High Signal IDs. No Clarity
  project was created and no site was deployed. Refs #63.
- 2026-08-31 — Revalidated the ratified direct free-model client standard across
  all 56 canonical projects: 14 exact pinned SDK clients, 8 dated native or
  product-boundary exceptions, 34 non-model callers, zero drift, zero
  hand-written migration debt, and no blocking retired-gateway references.
  Corrected the Tooling README's stale unratified wording and linked the
  separately approval-gated Free AI decommission runbook. No deploy, DNS,
  credential, provider-resource, or data action ran. Refs #61.
- 2026-08-30 — Retired the copy-to-fork `templates/ios-landing` template and
  left a pointer to the `ios-landings` factory in its place, promoted
  `templates/web-landing` as the canonical web starting point, and recorded the
  first per-surface landing classification in
  `docs/landing-surface-classification.md` — 6 adopt, 6 keep, 3 retire, 3
  undecided across sixteen bespoke Astro surfaces and two app-homepage
  products, with the candidate engine set fixed at two. Refs #62.
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

- `sass-maker/saas-maker/tooling` — reusable workflows, skills, scripts, and
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
[SaaS Maker GitHub Issues](https://github.com/sass-maker/saas-maker/issues).
