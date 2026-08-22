---
name: call-cursor
description: "Delegate coding work to Cursor Agent CLI (cursor-agent) as a teammate — fast scoped implementation with a clean JSON envelope, read-only plan/ask modes, or access to Cursor's model roster (GPT, Claude, Gemini variants) under a separate subscription quota. Use when the user asks to call/delegate to cursor, or as an implementation fallback when other teammates are quota-limited."
---

# call-cursor — delegate to Cursor Agent CLI as a teammate

Same stance as all teammate skills: specialist contractor. Brief precisely,
bound authority, verify independently, accept or reject.

Live-verified against `cursor-agent 2026.06.19` on this machine (2026-07-04):
a test-fix delegation returned a minimal in-scope diff, honest fenced-JSON
report, and an independently passing test — in ~11 seconds.

## When to call Cursor

- **Fast scoped implementation** — same niche as Codex, on a separate
  (Cursor subscription) quota; a natural failover when Codex is limited.
- **Read-only analysis** — `--mode plan` / `--mode ask` are enforced
  read-only modes, good for reviews without granting write access.
- **Model arbitrage** — `--model` spans GPT/Claude/Gemini variants
  (`cursor-agent models` lists them; bracket overrides like
  `'claude-opus-4-8[effort=high]'`).

## When NOT to call Cursor

- Standard exclusions: vague/strategy/taste tasks, briefs needing your
  conversation context, trivial edits.
- When schema-enforced output matters — like Grok, Cursor has no
  `--output-schema`; the fenced-JSON-in-prompt pattern is best-effort.

## Preflight

`cursor-agent status` → "Logged in". Note the binary is `cursor-agent`;
plain `cursor` is the editor launcher, not the agent.

## Command contract (verified)

```bash
cursor-agent -p "<brief>" --output-format json --force --trust \
  --workspace <dir> < /dev/null
```

Stdout is one JSON envelope (Claude Code-like): `.result` (final message —
prose with your requested fenced JSON at the end; extract it),
`.is_error`, `.session_id` (resume with `--resume <id>`), `.usage`
(input/output/cache tokens).

| Flag | Purpose |
| --- | --- |
| `-p, --print` | Headless mode; has access to all tools including write and shell. |
| `--output-format json\|stream-json\|text` | `json` for one envelope. |
| `--force` | Allow commands unless explicitly denied — required for headless implementation (VERIFY commands). Scope it with worktree/scratch isolation. `--yolo` is an alias; don't use it as a word to reviewers. |
| `--trust` | Trust the workspace without prompting (headless only). |
| `--mode plan\|ask` | Enforced read-only modes for analysis/review runs (omit `--force` there). |
| `--workspace <dir>` | Target directory (defaults to cwd). |
| `-w, --worktree [name]` | **Verified real isolation** (unlike grok): registered git worktree + branch at `~/.cursor/worktrees/<repo>/<name>`, main checkout untouched; changes stay uncommitted in the worktree for your review. Prefer this for implementation runs. |
| `--model <m>` | Cross-family roster; `cursor-agent models` to list. |
| `--resume <chatId>` | Continue a prior session. |
| `--sandbox enabled\|disabled` | Toggle sandbox mode (overrides config). |

### Gotchas

- `--force` is the authority switch: without it, headless implementation
  runs can stall on command approval; with it, the agent runs any
  non-denied command — so isolation (worktree or scratch repo) is
  mandatory, same rule as grok's `--always-approve`.
- No output schema enforcement — request a fenced JSON block and parse the
  tail of `.result`.
- Append `< /dev/null` — standard teammate stdin hygiene.

## Briefing, safety, review, scorecard

Identical protocol to [call-codex](../call-codex/SKILL.md): brief with
GOAL/SCOPE/CONTEXT/VERIFY/RETURN
([template](../call-codex/references/codex-prompting.md)), clean checkout,
isolate implementation runs, review the diff for scope creep, re-run tests
yourself, then append one line to `~/.claude/teammates/SCORECARD.md`.
Comparative routing: `~/.claude/teammates/ROSTER.md`.
