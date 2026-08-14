# Fleet Workflows — PROJECT STATUS

Last updated: 2026-08-14

## Why / What

Fleet Workflows is the public, credential-free execution boundary for
automation that needs only public code, public URLs, and sanitized output.

**Users:** Sarthak and Fleet operators.

**In scope:** Public site manifests, bounded availability checks, repeated HTTP
latency measurements, reusable workflow examples, and sanitized public reports.

**Out of scope:** Private source checkout, credentials, product CI, deployment,
provider inventory, private registries, mobile proof, and production changes.

## Dependencies

### External

- GitHub Actions standard hosted runners.
- Public HTTPS product surfaces.
- Node.js 20 or newer with built-in `fetch`.

### Internal

- Fleet Workspace generates and validates the privacy-allowlisted site manifest.
- Fleet pins an exact revision at `foundry/ops/workflows`.

## Timeline

- 2026-08-14 — Expanded the generated public manifest to include India
  Standards at its canonical Significant Hobbies domain; validation remains
  credential-free and no deployment was performed.
- 2026-07-30 — Public repository created with strict manifest validation,
  bounded surface availability checks, repeated HTTP latency evidence, and
  least-privilege Actions.

## Products

- `sass-maker/workflows` — public source and GitHub Actions execution.
- `foundry/ops/workflows` — pinned Fleet Workspace submodule location.

## Features (shipped)

- Exact-schema public site manifest validation across 28 maintained public
  surfaces.
- Bounded redirects, timeouts, concurrency, and sanitized network failures.
- Availability reports with status and redirect evidence.
- Repeated header/total-response latency reports with p50 and p90.
- Read-only pull-request validation and default-branch scheduled evidence.

## Work queue

Open work is tracked only in
[GitHub Issues](https://github.com/sass-maker/workflows/issues).
