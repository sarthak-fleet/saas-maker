# Workflows and Skills

Public, credential-free automation and agent tooling shared by the projects
under SaaS Maker.

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
```

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

Use [GitHub Issues](https://github.com/sass-maker/workflows-and-skills/issues).
