# Agent instructions

## Scope

This repository owns public, credential-free Fleet automation. It is also
mounted as the `foundry/ops/workflows` submodule in the private Fleet workspace.

**One documented exception:** `update-global-dr.yml` accepts an optional
`AHREFS_API_KEY` secret (passed by the caller via `secrets: inherit`), because
Ahrefs requires it on `domain-rating-free` from 2026-08-10. It is a third-party
read-only API key, not a credential that can read a private repository, and
the workflow remains functional without it before that date.

## Hard boundaries

- Never add a credential that can read a private repository.
- Never check out `sass-maker/fleet-workspace` from a workflow here.
- Keep the manifest schema allowlisted; reject unknown fields.
- Persist no response bodies, headers, cookies, environment values, or private
  provider data.
- Production deploys and provider-authenticated inventory stay out of scope.
- Use only standard GitHub-hosted runners.
- Pin third-party actions to full commit SHAs.

## Commands

```bash
node scripts/audit.mjs --validate-only
node --test
node scripts/audit.mjs --mode availability --runs 1
node scripts/audit.mjs --mode performance --runs 3
```

Use Node.js 20 or newer. The repository intentionally has no npm runtime or
development dependencies.
