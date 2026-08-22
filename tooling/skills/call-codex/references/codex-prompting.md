# Writing a Codex brief

Codex sees only: the brief, the files under `-C`, and what it discovers by
running commands. It has none of your conversation context. The brief is the
entire interface — everything the user told you that matters must be restated.

## Template

```text
GOAL
<One paragraph. What must be true when you are done. State acceptance
criteria as observable behavior, not implementation steps.>

SCOPE
- Edit only: <exact files/dirs>
- Do not touch: <files/dirs explicitly off-limits, e.g. billing/, migrations/>
- No unrelated edits: produce the smallest diff that satisfies the goal.
  No drive-by refactors, no formatting sweeps, no dependency changes.

CONTEXT
<Only what Codex can't discover from the repo: the user's intent, prior
decisions, known constraints, links between requirements. Do NOT paste file
contents it can read itself.>

VERIFY
- Run: <exact test/build command>
- The task is not complete unless this passes. If you cannot make it pass,
  return status "blocked" with what you tried.

RETURN
Report honestly in the structured result: every file changed, the real test
outcome, and every deviation from this brief with its reason.
```

## Rules of thumb

- **Behavioral goal, not a step list.** "GET /health returns 200 with build
  sha" beats "add a route in server.ts" — Codex is good at finding the how.
- **Name the test command explicitly.** Without VERIFY, Codex declares
  victory on compile.
- **Off-limits list beats politeness.** "Do not touch billing/" works;
  "be careful around billing" doesn't.
- **One task per call.** Two loosely related tasks → two calls (or one call
  and `exec resume` for the second). Mixed briefs produce mixed diffs you
  can't cleanly accept or reject.
- **Match effort to size.** `-c model_reasoning_effort=low` for mechanical
  edits, `medium` for typical features, keep `high` only for genuinely hard
  debugging.

## Worked example

```bash
codex exec -s workspace-write -C /tmp/wt-rate-limit \
  -c model_reasoning_effort=medium \
  --output-schema ~/.claude/skills/call-codex/schemas/implementation_result.json \
  -o "$SCRATCH/codex_result.json" \
  "GOAL
Requests to POST /api/subscribe beyond 5/minute per IP receive HTTP 429 with
a Retry-After header. Existing behavior for other routes is unchanged.

SCOPE
- Edit only: src/middleware/, src/routes/subscribe.ts, tests/subscribe.test.ts
- Do not touch: src/billing/, package.json
- No unrelated edits: smallest diff that satisfies the goal.

CONTEXT
This is a Hono app on Cloudflare Workers; state must live in the existing
KV binding RATE_KV, not in-memory.

VERIFY
- Run: pnpm test tests/subscribe.test.ts
- Not complete unless it passes.

RETURN
Report every file changed, real test outcome, and any deviations." < /dev/null
```
