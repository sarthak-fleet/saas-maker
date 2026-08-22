---
name: call-devin
description: Optional proprietary Devin teammate. Use only when the user explicitly asks for Devin or approves the spend/lock-in tradeoff.
---

# Call Devin

Devin is a proprietary agent platform. It is allowed as an optional Fleet
teammate only when the user explicitly asks for it or confirms the spend and
vendor-lock-in tradeoff. Prefer Codex, Grok, or Hermes when they can do the job.

## Current Local State

The local `devin` CLI is installed and logged in to Sarthak's Devin Pro account.
Prefer the CLI for teammate calls and use `glm-5.2` for Devin runs. The user
asked for "glm2"; the Devin CLI model registry exposes that as `glm-5.2`, while
literal `glm2` is rejected.

Use the autonomous wrapper for implementation tasks. It requires a clean linked
Git worktree, routes the call through `fleet-skill-run`, supplies no stdin, and
fails closed when Devin prints a confirmation or policy warning even if its exit
code is zero. The current organization policy rejects `--sandbox` because it
forces Devin's restricted autonomous mode, so the wrapper uses
`--permission-mode dangerous` only inside that isolated worktree.

Fleet Ops also includes `scripts/agent-bin/devin-session.mjs`, a narrow adapter
for the official Devin v3 REST API. The adapter is optional and still needs a
least-privilege service-user token and organization ID in `DEVIN_API_KEY` and
`DEVIN_ORG_ID`. Keep both machine-local. The adapter refuses session creation
unless the invoking process also sets `DEVIN_ALLOW_SPEND=yes`.

```sh
./scripts/devin-autonomous-run.sh \
  --project <repo-or-scope> \
  --dir <clean-linked-worktree> \
  --prompt-file <brief.txt> \
  --expect-changes

./scripts/agent-bin/devin-session.mjs status
DEVIN_ALLOW_SPEND=yes ./scripts/agent-bin/devin-session.mjs create \
  --title "Bounded Fleet task" \
  "GOAL: ... SCOPE: ... CONSTRAINTS: ... VERIFY: ... RETURN: ..."
```

## Guardrails

- Confirm the task is worth ACU/spend before invoking.
- Do not send secrets, env files, private keys, or production credentials.
- Use the autonomous wrapper only in a clean linked worktree and with a narrow
  brief. Never point it at a primary or dirty checkout.
- Fully autonomous means no per-tool confirmations inside the approved brief. It
  does not authorize commits, pushes, deploys, destructive actions, or scope
  expansion unless the user separately requested them.
- Treat Devin output as a draft: inspect the diff and rerun checks locally.
- Route every new CLI delegation through `fleet-skill-run` so sanitized output,
  timing, status, and project scope are retained in the private local history.
- Record outcomes through `fleet-skill-run`; do not maintain a second scorecard.

## Brief

Use the same shape as other teammates:

```text
GOAL:
SCOPE:
CONSTRAINTS:
VERIFY:
RETURN:
```

If Devin credentials are unavailable or spend is not approved, report that
status and fall back to Codex, Grok, or Hermes.
