---
name: call-teammate
description: Delegate work to Codex, Grok, Hermes, or optional Devin. Use for independent review, parallel attempts, bounded specialist work, and explicit-spend external agent runs.
---

# call-teammate — parent skill

Routes to the right teammate subskill based on which CLI the user wants to
delegate to. Subskills live as sibling directories under `skills/`.

## Routing table

| User intent | Subskill | Path | Strengths |
|---|---|---|---|
| "delegate to codex" / "call codex" / "second opinion from a different model" / "mechanical refactor / test-fix loop" | `call-codex` | `../call-codex/SKILL.md` | OpenAI model family, scoped implementation, independent review |
| "delegate to grok" / "call grok" / "N parallel attempts" / "cross-model second opinion" / "non-Anthropic/non-OpenAI opinion" | `call-grok` | `../call-grok/SKILL.md` | xAI model family, native worktree isolation, best-of-N attempts |
| "delegate to hermes" / "call hermes" / "repeat this workflow" | `call-hermes` | `../call-hermes/SKILL.md` | Open-source self-improving specialist and persistent skills |
| "delegate to devin" / "call devin" / "external autonomous agent" | `call-devin` | `../call-devin/SKILL.md` | Proprietary optional agent platform; requires explicit spend approval |

## How to use

1. Identify which teammate the user is asking for (by name or by the task shape).
2. Read the subskill's SKILL.md for the full contract (invocation syntax, briefing template, output schema, safety bounds).
3. Follow that subskill's instructions.

## Shared rules (all teammates)

Regardless of which teammate you call:

- **Explicit sandbox/permission flags** — never rely on CLI config defaults.
- **Delegate from a clean checkout into a worktree** — don't delegate from a dirty tree.
- **`< /dev/null` on every invocation** — prevent stdin hang.
- **Fail closed on autonomy warnings** — confirmation or policy warnings count
  as failures even when the teammate process exits successfully.
- **Verify diffs and tests yourself** — the teammate's output is a draft, not a finished product.
- **Record the run and sanitized output** through `fleet-skill-run`; the
  scorecard remains the concise routing verdict rather than the raw log store.
- **Devin is optional/proprietary** — use only when the user explicitly asks for it or confirms the spend/lock-in tradeoff.
- **Fail over intentionally** if a teammate hits usage or rate limits. Record
  the selected provider and outcome through `fleet-skill-run`.
- **Don't retry an exhausted teammate** or silently drop the task.

## Outcomes

Use the routing table above and the retained `fleet-skill-run` history. Do not
create a second operational scorecard in this public repository.
