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
operational evidence remain outside this public repository.

The scripts and skills were preserved from the former Fleet Workspace rather
than being deleted with the Dashboard product cleanup. Products call reusable
workflows here directly. Agent runtimes link the relevant skills from this
checkout with `scripts/agent-stack.sh`.

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
```

Generated reports contain public URLs, status codes, redirect destinations,
timings, timestamps, and bounded error categories. Response bodies are never
stored.

## License

This repository is publicly readable. No project-wide open-source license is
granted unless a license file is added through a separate owner decision.

## Work queue

Use GitHub Issues in the `sass-maker/workflows-and-skills` repository after the
repository rename is complete.
