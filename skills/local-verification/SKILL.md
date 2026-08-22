---
name: local-verification
description: Verify a Fleet product starts and serves the current patch locally in under five minutes using observable readiness probing, failure injection, and exact-patch selection. Use when the user asks to verify a project locally, run local verification, qualify a local build, check that a patch is live locally, or prove a service is ready without fixed sleeps.
---

# local-verification — sub-five-minute local verification qualification

Answers one focused question: **does the project start and serve the current
patch locally, with meaningful readiness probes, in under five minutes?**

This is a reusable qualification, not a product-specific test. Products supply
a qualification config; the reusable engine handles probing, failure injection,
and patch selection.

## When to invoke

- "Verify X locally"
- "Is X running the current patch?"
- "Qualify the local build for X"
- "Check local readiness for X"
- "Does X start in under five minutes?"
- Before a deploy, after a patch, or when confirming a stale-build-free local
  environment.

## What it checks

1. **Observable readiness** — polls HTTP, TCP, log, or command probes until
   the service actually answers. No fixed `sleep` waits. Fails on timeout.
2. **Stable worker defaults** — five-minute ceiling (300 s), 2 s poll interval,
   10 s per-probe timeout. Products may narrow but never widen the ceiling.
3. **Failure injection** — starts a deliberately broken service and verifies
   the readiness probes stay not-ready. Proves the probes are meaningful.
4. **Exact-patch selection** — captures the running Git SHA from an HTTP
   endpoint, log file, or command stdout and compares it against
   `git rev-parse HEAD`. A mismatch means a stale build or cached artifact.
5. **Repeatable evidence** — the same contract qualifies two materially
   different project types (HTTP server, Cloudflare Worker) with no engine
   changes.

## How to invoke

### CLI (local)

```bash
node workflows-and-skills/scripts/verify-local.mjs --config qualification.json
node workflows-and-skills/scripts/verify-local.mjs --config qualification.json --output result.json
node workflows-and-skills/scripts/verify-local.mjs --config qualification.json --skip-failure-injection
node workflows-and-skills/scripts/verify-local.mjs --config qualification.json --validate-only
```

### Reusable workflow (CI)

Product repos call the reusable workflow from their own CI:

```yaml
jobs:
  verify-local:
    uses: sass-maker/workflows-and-skills/.github/workflows/verify-local.yml@main
    with:
      config-path: verify-local.json
      node-version: "22"
```

The workflow checks out both the caller repo and the reusable tooling, runs
the qualification, and fails the job if the result is not `qualified`.

## Qualification config

Each product repo supplies a `fleet.local-verification-qualification.v1` config.
See [../../contracts/local-verification/qualification.schema.json](../../contracts/local-verification/qualification.schema.json)
for the full allowlisted schema and
[../../contracts/local-verification/README.md](../../contracts/local-verification/README.md)
for the contract explanation.

Two example configs live in
[../../contracts/local-verification/fixtures/](../../contracts/local-verification/fixtures/):

- `http-server.json` — a plain Node HTTP server with an HTTP health probe.
- `worker.json` — a Cloudflare Worker with an HTTP probe plus a log probe.

### Minimal example

```json
{
  "schema": "fleet.local-verification-qualification.v1",
  "project": "my-project",
  "startCommand": ["npm", "start"],
  "readinessProbes": [
    {
      "type": "http",
      "name": "health",
      "url": "http://127.0.0.1:8787/health",
      "status": 200,
      "bodyPattern": "ok"
    }
  ],
  "patchSelection": {
    "type": "http",
    "url": "http://127.0.0.1:8787/__sha",
    "pattern": "([0-9a-f]{40})"
  },
  "failureInjection": {
    "startCommand": ["npm", "run", "start:broken"],
    "expectNotReadyWithinSeconds": 15
  }
}
```

## Output format

The qualification emits a `fleet.local-verification-qualification.v1` result
envelope:

```
== Local Verification Qualification ==
Project:     my-project
State:       qualified
Duration:    3200ms
Readiness:   ready (3 attempts, 2800ms)
Patch:       match (abc1234)
Failure inj: detected (15000ms)
```

The full JSON envelope follows
[../../contracts/local-verification/result.schema.json](../../contracts/local-verification/result.schema.json).

### How to interpret

- `qualified` — readiness is `ready`, patch selection is `match`, and failure
  injection is `detected` (or `skipped` when not configured).
- `failed` — one or more phases did not pass. The `error` field names the
  failing phase and reason.
- `readiness.timeout` — the service did not answer all probes within the
  ceiling. Check the start command and probe targets.
- `patchSelection.mismatch` — the running SHA does not match the current
  checkout. Rebuild or clear the cache.
- `failureInjection.not_detected` — the probes reported ready for the broken
  service. The probes are not meaningful; tighten them.

## What this skill does NOT cover

- Single-project deploy readiness gate → `fleet-deploy-guard`
- Cross-project deploy parity → `fleet-deploy-parity`
- Public product browser journeys → `public-product-smoke`
- Full fleet audit → `fleet-audit`
- Product-specific test suites — those stay in the product repository.
