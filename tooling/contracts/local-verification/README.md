# Local verification qualification contract

Every Fleet product that wants a sub-five-minute local verification pass
supplies one qualification config (`fleet.local-verification-qualification.v1`)
and receives one result envelope (`fleet.local-verification-qualification.v1`).
The reusable workflow owns the probing, timeout, failure-injection, and
patch-selection logic; the product repo owns the start command, probes, and
broken-service command.

## What the qualification proves

1. **Observable readiness** — the service is polled until it actually answers,
   not woken up by a fixed `sleep`. The qualification fails on timeout, not on
   a guess.
2. **Stable worker defaults** — timeout ceiling 300 s, poll interval 2 s,
   per-probe timeout 10 s. A product may narrow these but never widen the
   five-minute ceiling.
3. **Failure injection** — a deliberately broken service is started and the
   readiness probes must stay not-ready for the configured window. This proves
   the probes are meaningful, not just checking that something is listening.
4. **Exact-patch selection** — the running service must expose the current
   checkout's Git SHA. The qualification compares the observed SHA against the
   expected SHA and fails on a mismatch (stale build, cached artifact, wrong
   branch).
5. **Repeatable evidence** — the same contract qualifies two materially
   different project types (an HTTP server and a Cloudflare Worker) with no
   workflow changes.

## Qualification config

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

See `qualification.schema.json` for the full allowlisted schema and
`fixtures/` for two complete examples (HTTP server and Worker).

### Probe types

| Type | What it checks | Required fields |
| --- | --- | --- |
| `http` | HTTP GET returns the expected status and optional body regex | `url`, `status` |
| `tcp` | TCP port accepts a connection | `port` |
| `log` | A regex matches against a log file | `path`, `pattern` |
| `command` | A command exits with the expected code | `command`, `expectExitCode` |

All HTTP and TCP probes must target `127.0.0.1`. No external hosts.

### Patch selection

The running service must expose the Git SHA of the current checkout. The
qualification captures the SHA from an HTTP endpoint, log file, or command
stdout, then compares it against `git rev-parse HEAD`. A mismatch means the
service is running a stale build or cached artifact and the qualification
fails.

## Result envelope

```json
{
  "schema": "fleet.local-verification-qualification.v1",
  "project": "my-project",
  "state": "qualified",
  "startedAt": "2026-08-22T12:00:00.000Z",
  "finishedAt": "2026-08-22T12:00:03.200Z",
  "durationMs": 3200,
  "readiness": {
    "state": "ready",
    "durationMs": 2800,
    "attempts": 3,
    "probes": [{ "name": "health", "type": "http", "ok": true, "detail": "200" }]
  },
  "patchSelection": {
    "state": "match",
    "expected": "abc123...",
    "observed": "abc123..."
  },
  "failureInjection": {
    "state": "detected",
    "durationMs": 15000,
    "detail": "probes stayed not-ready for 15s"
  },
  "error": null
}
```

`state` is `qualified` only when readiness is `ready`, patch selection is
`match`, and failure injection is `detected` (or `skipped` when not configured).
