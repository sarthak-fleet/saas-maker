# SaaS Maker Tooling

Public, credential-free automation and agent tooling shared by the projects
under SaaS Maker. This directory is the canonical successor to the standalone
`sass-maker/workflows-and-skills` repository.

This repository is the canonical home for:

- reusable GitHub Actions under `.github/workflows/`;
- Fleet-owned agent skills under `skills/`;
- Fleet operator scripts under `scripts/`;
- reusable script libraries, templates, and public contracts.

Product-specific scripts remain with their products. Private project catalogs,
provider inventories, credentials, production configuration, and retained
operational evidence remain outside this public repository. Historical source
that the owner chose to retain is isolated under
`preserved/legacy-fleet-tooling/` and is not executable product ownership.

Only standalone entrypoints are advertised by the capability catalog. Scripts
preserved for historical reference remain tracked but noncanonical; see
[`docs/preserved-tooling.md`](docs/preserved-tooling.md).

The scripts and skills were preserved when Site Health was narrowed to its five
owner views. Products call the current reusable workflows here directly. Agent
runtimes link the relevant skills from this checkout with
`scripts/agent-stack.sh`.

Capability discovery is repository-relative and does not require the former
`foundry/ops` checkout layout:

```bash
node scripts/fleet-capabilities.mjs doctor --json
```

## Landing pages

Fleet keeps two landing-page engines and no more:

- `Significant-Hobbies/ios-landings` for app-style products — one page engine,
  one site per `products/<id>/`;
- [`templates/web-landing`](templates/web-landing/README.md) for web products,
  developer tools, and dashboards — the canonical web starting point.

[`docs/landing-surface-classification.md`](docs/landing-surface-classification.md)
records every bespoke Fleet landing surface as `adopt`, `keep`, `retire`, or
`undecided`, with the evidence behind each verdict. Read it before starting or
converting a landing page.

The former copy-to-fork `templates/ios-landing` is
[retired](templates/ios-landing/DEPRECATED.md). Scaffolding an iOS landing page
means adding a product directory to the factory, not forking a template.

## Public monitoring

The repository also runs checks whose source and inputs are already public:

- canonical public-site availability and redirect checks;
- repeated HTTP header and total-response latency measurements;
- validation of the allowlisted public site manifest.

## Commands

```bash
node scripts/audit.mjs --validate-only
node --test test/*.test.mjs
node scripts/validate-tooling.mjs
node scripts/audit.mjs --mode availability --runs 1
node scripts/audit.mjs --mode performance --runs 3
node scripts/ahrefs-site-audit-health.mjs
node scripts/ai-client-audit.mjs --check
node scripts/clarity-audit.mjs --check
node scripts/footer-source-audit.mjs --manifest <file> --fleet-root <dir> --check
```

`ai-client-audit.mjs` reports, per supplied project, how that project calls a
hosted model and whether it matches the ratified direct free-model client
standard in
[`config/ai-client-standard.json`](config/ai-client-standard.json). Retired
gateway references and credential literals are blocking; SDK drift and
hand-written clients remain visible migration findings without making known debt
look like a new regression. The project list is an input; no private catalog is
committed here. See
[`docs/ai-client-standard.md`](docs/ai-client-standard.md).

`clarity-audit.mjs` reads the Microsoft Clarity receipt in
[`config/clarity-projects.json`](config/clarity-projects.json) — which Clarity
project belongs to which Fleet product and which landing, browser-app, or
combined surfaces must wire it — and fails on one project claimed by two
products, the retired fleet-wide shared project, a missing surface, or a claim
that is not actually present in the file it names. Privacy-sensitive app roots
can require explicit source masking in the same receipt. A finding carrying a
dated `violation` record is reported rather than failed, because its fix lives
in another repository; once that fix lands the record goes stale and the audit
fails until the receipt is updated. `--strict` fails on every finding. The
receipt records decisions that have been made, not the private catalog, and
`--omit-private` keeps non-public repositories out of a committed report.
It also validates the credential-free desired-state policy in
[`config/clarity-capabilities.json`](config/clarity-capabilities.json). The
policy distinguishes automatic features from provider, source, operator, and
infrastructure work; desired state is never reported as provider verification.
The separate [`config/clarity-journeys.json`](config/clarity-journeys.json)
records one live-root-backed Smart Event and funnel candidate per wired product,
or an explicit rendered-discovery blocker when stable action text was absent.

`footer-source-audit.mjs` reads a caller-owned manifest of relative source
paths and verifies that each named browser surface loads the project strip
before Ask AI, carries both loaders, and has no active `data-compose=false`
opt-out. Dated retirement exceptions stay visible and become blocking when
their recorded debt disappears, preventing stale exceptions. The exact Fleet
surface receipt remains beside Site Health's private canonical catalog rather
than being duplicated in this public repository. From the SaaS Maker root,
`pnpm tooling:footers` runs that Fleet-owned receipt when the sibling checkout
is available.

`ahrefs-site-audit-health.mjs` reads the sibling Site Health brand catalog
and crawls each root. Ahrefs Health Scores are optional and fail closed
without entitlement. See [`docs/ahrefs-site-audit.md`](docs/ahrefs-site-audit.md).

Generated reports contain public URLs, status codes, redirect destinations,
timings, timestamps, and bounded error categories. Response bodies are never
stored.

## License

This repository is publicly readable. No project-wide open-source license is
granted unless a license file is added through a separate owner decision.

## Work queue

Use [SaaS Maker GitHub Issues](https://github.com/sass-maker/saas-maker/issues).
