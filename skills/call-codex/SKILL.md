---
name: call-codex
description: "Delegate repo-local coding work to OpenAI Codex CLI as a teammate agent — scoped implementation, mechanical refactors, test-fix loops, or an independent second-opinion code review from a different model family. Use when the user asks to call/delegate to codex, wants a second opinion on a diff, or when a well-scoped implementation task can run in parallel (e.g. in a worktree) while you do other work. Not for strategy, taste-heavy UX, or vague requirements."
---

# call-codex — delegate to Codex CLI as a teammate

Codex is a specialist contractor, not an oracle. You (the parent agent) own the
outcome: you write the brief, set the authority level, verify the work
independently, and accept or reject it. Never blindly trust the result.

Validated against `codex-cli 0.142.5` on this machine (2026-07-03).

## When to call Codex

- **Scoped implementation** — a feature/fix with known files, clear acceptance
  criteria, and a test command, especially one that can run in an isolated
  worktree while you do something else.
- **Mechanical refactors** — rename/extract/migrate patterns across a repo
  where the spec is crisp and the diff is verifiable.
- **Test-fix loops** — "make this failing test pass" style tasks where Codex
  can iterate against a command.
- **Independent code review** — fresh eyes from a different model family on a
  diff you (or another agent) wrote. Use the `exec review` subcommand.

## When NOT to call Codex

- Vague requirements, product strategy, architecture debates, or taste-heavy
  UI/copy work — that judgment is yours.
- Tasks that depend on conversation context Codex can't see. If the brief
  needs more than ~a screen of context-dumping, do it yourself.
- Trivial edits. Each call has a ~18k-input-token baseline; a one-line fix is
  faster and cheaper done directly.
- Repos containing secrets or untrusted code, unless running `-s read-only`.

## Preflight

1. `codex --version` — installed and roughly 0.142.x.
2. `~/.codex/auth.json` exists (logged in).
3. **Safety-critical on this machine:** `~/.codex/config.toml` defaults to
   `sandbox_mode = "danger-full-access"` and `approval_policy = "never"`.
   **Always pass an explicit `-s` flag.** Never rely on the config default.
4. `~/.local/bin/fleet-skill-run` exists. Refresh Fleet's local command and
   hook with `./scripts/agent-stack.sh install-skills` when missing.

## Command contract

Read-only (analysis, review, questions about a repo):

```bash
codex exec -s read-only -C <repo> --ephemeral \
  -c model_reasoning_effort=medium \
  --output-schema ~/.claude/skills/call-codex/schemas/review_result.json \
  -o <scratchpad>/codex_result.json \
  "<brief>" < /dev/null
```

Implementation (write access — prefer an isolated worktree, see loop below):

```bash
node "$HOME/.local/bin/fleet-skill-run" exec \
  --skill call-codex \
  --project <repo-or-scope> \
  --output-file <scratchpad>/codex_result.json \
  -- codex exec -s workspace-write -C <worktree> \
  --output-schema ~/.claude/skills/call-codex/schemas/implementation_result.json \
  -o <scratchpad>/codex_result.json \
  "<brief>" < /dev/null
```

Built-in code review (its own diff-aware harness; plain-text report):

```bash
codex exec review -C <repo> --uncommitted "<focus instructions>" < /dev/null
codex exec review -C <repo> --base main   "<focus instructions>" < /dev/null
codex exec review -C <repo> --commit <sha> < /dev/null
```

Key flags:

| Flag | Purpose |
| --- | --- |
| `-s read-only \| workspace-write` | Sandbox. Always explicit. Never `danger-full-access`. |
| `-C <dir>` | Working root. Point at the worktree, not the main checkout. |
| `--output-schema <file>` | JSON Schema the final message must conform to. |
| `-o <file>` | Write the final message (the JSON) to a file — parse this. |
| `--json` | JSONL events on stdout (progress, `thread_id`, token usage). |
| `--ephemeral` | No session persisted. Use for read-only one-shots. |
| `-c model_reasoning_effort=low\|medium\|high` | Config default here is `high` — downgrade for small tasks or they crawl. |
| `-m <model>` | Override model (default here: `gpt-5.5`). |
| `--skip-git-repo-check` | Only for non-repo scratch dirs. |

Resume a session to iterate ("fix the review findings"): grab `thread_id`
from the `thread.started` JSONL event, then
`codex exec resume <thread_id> "<follow-up>" < /dev/null` (or `resume --last`).

### Gotchas (verified)

- **Always append `< /dev/null`.** Codex reads piped stdin as extra prompt
  input; an open pipe hangs the call indefinitely. This is the #1 failure
  mode when shelling out from an agent harness.
- Anything non-trivial takes minutes: run it in the background and poll the
  `-o` file / JSONL log rather than blocking.
- `--output-schema` constrains only the **final message**; treat the
  self-reported `tests.result` as a claim, not a fact — re-run tests yourself.

## Briefing contract

A brief must contain, in order: goal, exact files/dirs in scope, constraints
(including "no unrelated edits — smallest diff that satisfies the goal"),
the test command, and what to return. Template and worked example:
[references/codex-prompting.md](references/codex-prompting.md).

## Safety contract

- Default to `-s read-only`; escalate to `workspace-write` only for
  implementation tasks, and prefer pointing `-C` at an isolated worktree.
- Never use `--dangerously-bypass-approvals-and-sandbox`.
- Never delegate work in a dirty checkout — commit or stash first so the
  delegated diff is cleanly attributable and revertible.
- Codex does not commit, push, or touch anything outside `-C`. Git operations
  belong to the parent.
- Don't put secrets in the brief. Codex can read repo files itself.

## Review loop (parent responsibilities)

1. Parse the `-o` result JSON; check `status` and `deviations` first.
2. `git -C <worktree> diff --stat`, then read the full diff. Reject scope
   creep — edits outside the briefed files need a stated reason in
   `deviations`.
3. Run the test command yourself. Codex's `tests.result` is unverified.
4. Verdict: **accept** (merge/apply), **revise** (`codex exec resume` with
   specific findings), or **reject** (discard the worktree). Two failed
   revise rounds → reject and do it yourself; don't loop.
5. Append one line to the scorecard (below).

The Fleet wrapper is required for new delegations. It preserves Codex's exit
status, retains sanitized stdout/stderr plus the schema-constrained result file,
and records the run as private local evidence. The checked-in scorecard remains
the concise routing summary.

## Delegated implementation loop (the standard workflow)

```bash
git -C <repo> worktree add /tmp/wt-<task> -b codex/<task>   # 1. isolate
# 2. brief codex with -C /tmp/wt-<task> -s workspace-write (background)
# 3. review loop above: diff + independent tests in the worktree
git -C <repo> merge --squash codex/<task>                    # 4a. accept
git -C <repo> worktree remove --force /tmp/wt-<task> && git -C <repo> branch -D codex/<task>  # 4b/5. reject / cleanup
```

While Codex works, you keep working — that's the point.

## Scorecard

After every delegation, append one line to `~/.claude/teammates/SCORECARD.md`
(format documented at the top of that file). Before delegating, skim it for
the task type at hand — past rejects tell you what Codex is bad at.
Comparative routing across teammates: `~/.claude/teammates/ROSTER.md`.
