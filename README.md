# Shared Workflows

Public, credential-free automation shared by the projects under SaaS Maker.

This repository runs only checks whose source and inputs are already public:

- canonical public-site availability and redirect checks;
- repeated HTTP header and total-response latency measurements;
- validation of the allowlisted public site manifest.

Products call reusable workflows here directly. This repository does not own
their source, deployment state, provider inventory, credentials, or production
operations.

## Billing boundary

GitHub associates reusable-workflow usage with the caller repository.

This repository never accepts caller secrets or persists checked-out product
source.

## Commands

```bash
node scripts/audit.mjs --validate-only
node --test
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

Use [GitHub Issues](https://github.com/sass-maker/workflows/issues).
