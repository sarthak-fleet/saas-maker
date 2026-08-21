# Recurring spend run

The minimum recurring run is weekly, read-only, and private. Its purpose is to
detect material change, not to reproduce a billing dashboard.

## Output location

The recorder defaults to:

```text
.fleet-local/spend-guard/
  ledger.jsonl
  latest.json
  latest.md
```

This directory is machine-local and ignored by Git.

## Sanitized input

Create one JSON envelope and pass it to:

```bash
node skills/cloudflare-spend-guard/scripts/record-spend-snapshot.mjs \
  --input /path/to/sanitized-snapshot.json --json
```

The envelope has this shape:

```json
{
  "schemaVersion": 1,
  "runId": "2026-07-25-weekly",
  "observedAt": "2026-07-25T12:00:00.000Z",
  "providers": [
    {
      "provider": "cloudflare",
      "spendState": "unknown",
      "evidenceStatus": "unavailable",
      "confidence": "low",
      "period": {
        "label": "provider billing period unavailable",
        "start": null,
        "end": null,
        "resetAt": null
      },
      "costs": [],
      "quotas": [],
      "evidenceGaps": ["Billing API authentication failed"]
    }
  ],
  "recommendations": [
    {
      "projectId": "example",
      "resource": "example-worker",
      "decision": "optimize",
      "nextStep": "Verify whether the scheduled refresh still serves a shipped feature"
    }
  ]
}
```

Allowed cost kinds are `fixed`, `usage`, `credit`, and `tax`. Allowed
recommendation decisions are `keep`, `optimize`, `pause-candidate`, and
`insufficient-evidence`.

Include a quota only when both used and limit are known. The recorder calculates
the percentage. Do not turn an unknown cost into zero; an empty `costs` array
means no cost was confirmed, not that cost is zero.

Never put provider payloads, URLs, tokens, credentials, raw SQL, database URLs,
application rows, request bodies, or payment details in the envelope. The
recorder rejects secret-shaped and unsupported fields.

## Alerts

The recorder derives:

- `critical`: a quota is at least 95% used.
- `warning`: a quota is at least 85% used, provider evidence is unavailable, or
  a fixed/usage cost becomes newly positive.
- `ok`: none of the above.

For `warning` or `critical`, emit one deduplicated event through
`scripts/agent-bin/fleet-notify`. Use only the provider, alert code,
quota percentage, and machine-local report location in the message. Never
include raw evidence.
