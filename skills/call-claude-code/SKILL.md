---
name: call-claude-code
description: "Delegate work to a fresh headless Claude Code instance as a teammate — a parallel worker in a worktree, a fresh-context review unbiased by the current conversation, or a run under the other profile (personal ~/.claude vs work ~/.claude-work, separate auth/config). Use when the user asks to call/delegate to claude or claude-work, or when you want an independent Claude with clean context."
---

# call-claude-code — delegate to a fresh Claude Code instance

Why delegate Claude-to-Claude: a fresh instance has **no conversation bias**
(honest second opinion on your own work), runs **in parallel** while you
continue, and can run under a **different profile** with separate auth,
settings, and MCP servers. This file is also the invocation contract other
parent agents (Codex, Grok, Devin) can use to call Claude Code.

Validated against `claude 2.1.187` on this machine (2026-07-03).

## Profiles on this machine

- **Personal**: plain `claude` (config in `~/.claude`).
- **Work**: `CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude` — the user's
  `claude-work` alias expands to exactly this. In scripts, use the env-var
  form; the alias doesn't exist in non-interactive shells.
- A nested invocation **inherits** `CLAUDE_CONFIG_DIR` from the current
  session — set it explicitly when the profile matters.

## When to call

- **Parallel implementation** in a worktree while you keep working.
- **Fresh-context review** of a diff you produced — the reviewer hasn't seen
  your reasoning, so it can't rubber-stamp it.
- **Profile-boundary tasks** — work that must run under work auth/config.

## When NOT to call

- The subtask needs the conversation context you have — do it yourself or
  use the in-session Agent tool (cheaper: shares your session, no cold start).
- Trivial edits. Cold start costs ~20k+ tokens of system/context overhead.

## Command contract (verified)

```bash
claude -p "<brief>" --output-format json --model <model> \
  --json-schema "$(cat ~/.claude/skills/call-codex/schemas/implementation_result.json)" \
  --permission-mode acceptEdits --add-dir <worktree> < /dev/null
```

Run it with `cd <worktree>` (or from the target dir); `--add-dir` widens file
access when needed. The stdout is one JSON envelope:

- `.result` — the final message; with `--json-schema` it is a **stringified**
  JSON object conforming to the schema: `jq -r '.result' out.json | jq .`
- `.is_error`, `.num_turns`, `.session_id` (resume with
  `claude -p --resume <session_id> "<follow-up>"`), `.total_cost_usd` and
  `.usage` — record cost in the scorecard.

Key flags:

| Flag | Purpose |
| --- | --- |
| `-p` | Headless print mode. |
| `--output-format json\|stream-json\|text` | `json` for one envelope; `stream-json` to tail progress on long runs. |
| `--json-schema <schema-string>` | Enforced structured final output. Reuse the schemas in `~/.claude/skills/call-codex/schemas/` (canonical home). |
| `--model haiku\|sonnet\|opus\|<id>` | Match model to task size; haiku for mechanical work. |
| `--permission-mode` | `default\|plan\|acceptEdits\|bypassPermissions`. `acceptEdits` in an isolated worktree; **never** `bypassPermissions` on normal repos (user rule). |
| `--allowedTools / --disallowedTools` | Tool allowlist, e.g. `--allowedTools "Read,Edit,Write,Bash(pnpm test*)"`. |
| `--add-dir <dirs…>` | Extra writable roots. |
| `--max-turns <N>` | Bound runaway sessions. |
| `--append-system-prompt <text>` | Inject teammate-specific standing orders without replacing defaults. |

### Gotchas

- Append `< /dev/null` — same stdin hygiene as every teammate CLI.
- With `--json-schema`, `stop_reason` is `tool_use` in the envelope — that's
  normal (structured output is delivered via a tool call), not an error.
- Long tasks: run in background and parse the envelope on completion; use
  `--output-format stream-json` only when you actually need live progress.
- Cost is real and visible: the trivial verified call was $0.048 on haiku.
  Check `.total_cost_usd` before making N-instance fan-outs a habit.

## Briefing, safety, review, scorecard

Identical protocol to [call-codex](../call-codex/SKILL.md): brief with
GOAL/SCOPE/CONTEXT/VERIFY/RETURN
([template](../call-codex/references/codex-prompting.md)), delegate only from
a clean checkout into a worktree, review the diff for scope creep, re-run
tests yourself, then append one line to `~/.claude/teammates/SCORECARD.md`.
Comparative routing notes: `~/.claude/teammates/ROSTER.md`.
