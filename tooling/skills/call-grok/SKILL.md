---
name: call-grok
description: "Delegate coding work to Grok CLI (xAI's terminal agent) as a teammate — scoped implementation with native worktree isolation, best-of-N parallel attempts on hard tasks, or a cross-model second opinion. Use when the user asks to call/delegate to grok, wants N parallel attempts at one task, or wants an opinion from a non-Anthropic/non-OpenAI model family."
---

# call-grok — delegate to Grok CLI as a teammate

Same stance as all teammate skills: Grok is a specialist contractor. You brief
it, bound its authority, verify its output independently, accept or reject.

Validated against `grok 0.2.93` on this machine (2026-07-12); logged in with
grok.com. Default model: `grok-4.5`. Smoke test:
`grok -p "Reply with exactly: GROK_OK" --always-approve` returned `GROK_OK`.

## When to call Grok

- **Cross-model second opinion** — review or re-derivation from a third model
  family when Codex (OpenAI) and you (Anthropic) already looked.
- **Best-of-N on hard, verifiable tasks** — `--best-of-n <N>` runs the task N
  ways in parallel and picks the best (headless only). Unique to Grok here.
- **Scoped implementation in a worktree** — `-w <name>` creates the git
  worktree natively; no manual `git worktree add` needed.

## When NOT to call Grok

- Same exclusions as every teammate: vague/strategy/taste tasks, briefs that
  need your conversation context, trivial edits.
- Tasks needing a strict machine-readable output contract — Grok has **no**
  `--output-schema`; you must request JSON in the prompt and parse it out of
  the response `text` (may need fenced-block stripping).

## Command contract

Single-shot headless (verified):

```bash
grok -p "<brief>" --output-format json --cwd <dir> < /dev/null
```

Returns one JSON object: `{"text": "...", "stopReason": "EndTurn",
"sessionId": "...", "thought": "..."}`. Parse `.text`; keep `.sessionId` for
resume (`grok -r <sessionId> -p "<follow-up>" ...`).

**Success = `stopReason == "EndTurn"` plus your own verification.** The exit
code is 0 even when the run dies mid-task (see gotchas).

Implementation run (verified). Headless implementation **requires blanket
approval** — permission prompts can't be asked in `-p` mode and any prompt
(e.g. running the VERIFY command; `acceptEdits` covers only file edits)
silently cancels the run. So `--always-approve` is mandatory, which makes
isolation mandatory too. **Do NOT rely on `--worktree` for that isolation**
(see gotchas — verified to mutate the main checkout in headless mode);
create the worktree yourself and point `--cwd` at it:

```bash
git -C <repo> worktree add /tmp/wt-<task> -b grok/<task>
grok -p "<brief>" --output-format json --always-approve \
  --max-turns 20 --cwd /tmp/wt-<task> < /dev/null
```

(Granular `--allow` rules do NOT substitute — verified failed: Claude-Code
style rules like `--allow "Bash(python3 *)"` alongside `acceptEdits` still
ended `Cancelled` before the first edit on 0.2.60.)

Hard task, parallel attempts with self-verification:

```bash
grok -p "<brief>" --output-format json --best-of-n 3 --check \
  --always-approve --cwd /tmp/wt-<task> < /dev/null
```

Key flags:

| Flag | Purpose |
| --- | --- |
| `-p "<prompt>"` | Headless mode; prints response and exits. |
| `--output-format json\|streaming-json` | Machine-readable envelope. |
| `--permission-mode` | `default\|acceptEdits\|auto\|dontAsk\|bypassPermissions\|plan`. Prefer `acceptEdits` in a worktree; never `bypassPermissions` on normal repos. |
| `--allow / --deny <RULE>` | Fine-grained tool permission rules (Claude Code `--allowedTools` semantics). |
| `-w, --worktree [<name>]` | Run in a fresh git worktree — native isolation. |
| `--best-of-n <N>` | N parallel attempts, best one wins (headless only). |
| `--check` | Appends a self-verification loop (headless only). |
| `--max-turns <N>` | Bound runaway sessions. |
| `--cwd <dir>` | Working directory. |
| `-r, --resume [<id>]` | Resume session; `--restore-code` re-checks-out its commit. |
| `--sandbox <profile>` | Filesystem/network sandbox (`GROK_SANDBOX` env). |
| `-m <model>` | Override model (`grok models` lists them). |

### Gotchas (all verified live, 2026-07-03)

- **Silent cancellation with exit code 0.** Any un-approvable permission
  prompt ends the run as `stopReason: "Cancelled"` — partial narration in
  `.text`, no error, exit 0. Never judge success by exit code; check
  `stopReason == "EndTurn"`, then verify the diff and tests yourself.
- **Headless `--worktree` does not isolate.** A `-w <name>` run left no
  worktree registered anywhere and the **main checkout dirty** with the
  edits. Treat `-w` as interactive-only sugar; isolate manually as above.
- **`--effort` / `--reasoning-effort` fail on the default `grok-build` model**
  with an API 400 ("does not support parameter reasoningEffort"). Omit them
  unless you've switched `-m` to a reasoning model.
- **`.text` prefixes narration before the final JSON** even when the brief
  says "reply with ONLY a JSON object" — extract the trailing JSON object
  rather than parsing `.text` wholesale.
- Append `< /dev/null` — same shelling-out hygiene as every teammate CLI.
- No output schema enforcement (unlike codex/claude): request JSON in the
  brief, validate what comes back, retry once via `-r` if it returns prose.

## Briefing, safety, review, scorecard

Identical protocol to [call-codex](../call-codex/SKILL.md): brief with
GOAL/SCOPE/CONTEXT/VERIFY/RETURN
([template](../call-codex/references/codex-prompting.md)), never delegate from
a dirty checkout, review the diff for scope creep, re-run tests yourself, then
append one line to `~/.claude/teammates/SCORECARD.md`. Comparative routing
notes live in `~/.claude/teammates/ROSTER.md`.
