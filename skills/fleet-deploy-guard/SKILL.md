---
name: fleet-deploy-guard
description: Guard a fleet project deploy — verify clean main, green CI, known Cloudflare target, no uncommitted changes before allowing a deploy. Use when the user says "deploy X", "can I deploy?", "is X safe to deploy?", or before any production deploy.
---

# fleet-deploy-guard — deploy readiness gate

Verifies that a project is safe to deploy before allowing the deploy command
to run. Enforces the fleet deployment standard from AGENTS.md.

## When to invoke

- "Deploy X"
- "Can I deploy X?"
- "Is X safe to deploy?"
- "Check deploy readiness for X"
- Before running `wrangler deploy`, `pnpm deploy`, or any deploy command

## What it checks

1. **On main branch** — not a feature branch
2. **Clean working tree** — no uncommitted changes
3. **Synced with remote** — not ahead or behind
4. **CI green for current main** — the exact `HEAD` commit has a successful push workflow; unrelated manual or scheduled workflows do not mask that signal
5. **Cloudflare target known** — wrangler.toml/jsonc exists and names a Worker/Pages project
6. **No known regressions** — check PROJECT_STATUS.md for any flagged blockers

## How to invoke

```bash
bash ~/Desktop/fleet/workflows-and-skills/scripts/fleet-deploy-guard.sh <project>
bash ~/Desktop/fleet/workflows-and-skills/scripts/fleet-deploy-guard.sh codevetter
bash ~/Desktop/fleet/workflows-and-skills/scripts/fleet-deploy-guard.sh codevetter --force  # skip CI check
```

The script checks all 6 gates and exits non-zero if any fail. Use `--force` to
skip the CI gate (only when CI is red for unrelated reasons — name the exception
in the handoff).

## Output

```
PROJECT: <name>
Branch:     main ✓
Git:        clean ✓
Remote:     synced ✓
CI:         green ✓
CF target:  <worker-name> ✓
Blockers:   none ✓

→ READY TO DEPLOY
```

Or if any gate fails:

```
PROJECT: <name>
Branch:     feat/experimental ✗ (not main)
Git:        dirty ✗ (3 uncommitted files)
...

→ NOT READY — fix the issues above before deploying
```

## Rules

- **Never bypass the guard** — if a gate fails, report it and stop
- **Never deploy from a dirty tree** — commit or stash first
- **Never deploy with red CI** — fix the CI failure first
- **Exception:** if CI is red for reasons unrelated to the deploy change, the
  user can explicitly override — but the exception must be named in the handoff
