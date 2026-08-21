---
name: spec-driven
description: Spec-driven development for any new fleet feature. Use when starting non-trivial feature work (multi-file, new surface, behavior change, cross-repo) in any fleet project. Creates a GitHub tracking issue with proposal, design, specs, and task checklist — no local spec files. Trigger automatically at the start of feature work; do not wait for the user to ask.
---

# spec-driven — GitHub Issue spec workflow for new features

Spec-driven development is the fleet standard for non-trivial feature work.
When an agent starts feature work in any fleet project, it must create a
spec-driven tracking issue **before writing feature code**. This skill is the
canonical entry point — invoke it the moment feature intent is detected.

All spec content lives in the GitHub Issue: proposal, design notes,
requirements/scenarios, and the task checklist. There is no local `openspec/`
directory, no local spec files, and no `openspec` CLI.

## When to trigger (strong default)

Trigger automatically when the user's request matches **any** of:

- "build X" / "add a feature" / "implement X" / "let's add X"
- A new product surface, page, route, command, or capability
- Multi-file change that introduces new behavior (not just refactors existing)
- Cross-repo change (umbrella + sub-product, support infra + consumer)
- Anything that would warrant a `docs/plans/` entry under the old convention

**Do NOT trigger for** (skip the spec, just do the work, mention the skip in handoff):

- Bug fixes (single-file or clearly scoped regression)
- Cleanup, dead-code removal, dep bumps, lint/format fixes
- Copy edits, typo fixes, doc tweaks
- Single-file polish / styling tweaks
- Test additions for existing behavior
- Config / env / CI workflow adjustments
- Anything the user explicitly says "just do it" / "quick fix" / "no spec"

When in doubt, default to running the workflow. The cost of a 5-minute
proposal is far lower than the cost of building the wrong thing.

## Pre-flight

1. **Check for existing tracking issues**: search the repo's GitHub Issues for
   open issues related to the feature. If one already exists, continue it
   rather than creating a new one.
2. **Read the project's `PROJECT_STATUS.md`** to understand what's shipped and
   what's in flight.

## Workflow

### 1. Explore (optional, for ambiguous features)

If the feature is not yet well-defined, explore the codebase first. Read
relevant files, weigh options, and shape a plan. Skip straight to step 2 if
the user has already scoped the feature.

### 2. Propose (mandatory)

Create one GitHub tracking issue using `gh issue create`. The issue body is
the complete spec — it must contain:

```
## Why
<problem, user, evidence>

## What
<scope, in vs out>

## Design
<technical approach, affected surfaces, deploy impact>
<inline Mermaid diagram if it materially clarifies 3+ components>

## Specs
### Requirement: <name>
<SHALL/SHOULD statements>
#### Scenario: <name>
- **WHEN** ...
- **THEN** ...

## Tasks
- [ ] 1. <first task>
- [ ] 2. <second task>
```

Use `gh issue create` with the body as a heredoc or `--body-file`. Add the
`spec` label if the repo has one. Assign the issue to the person requesting
the work.

The proposal must answer:
- **Why** — problem, user, evidence
- **What** — scope, in vs out
- **How** — technical approach, affected surfaces, deploy impact
- **Tasks** — ordered, checkable, with verification steps

Use an inline Mermaid diagram in the Design section when it materially
clarifies three or more components or actors, a multi-step interaction, state
transitions, a data/dependency flow, or a cross-repo boundary. Choose the
smallest useful diagram type (`flowchart`, `sequenceDiagram`,
`stateDiagram-v2`, or `erDiagram`). Do not add a diagram when a short
paragraph is clearer.

For **cross-repo features** (umbrella + sub-product, support infra + consumer),
open one tracking issue in the repo that owns the change. Reference it from
every affected repo's PR body (`Part of #<issue>`).

Review the issue with the user before moving on.

### 3. Apply (implement)

Work through the tracking issue's task checklist item by item. The agent
should:

- Check off tasks in the GitHub issue body as they complete (use
  `gh issue edit <N> --body ...` or the web UI)
- Run the smallest relevant verification after each task (lint, typecheck,
  unit test, build)
- Surface failures, skipped checks, and uncertainty immediately
- Keep diffs reviewable — prefer multiple small commits over one large one
- Use `Closes #<issue>` in the implementing pull request body

### 4. Close (when done)

Once all tasks are complete and verification passes:

1. Ensure the pull request uses `Closes #<issue>` so GitHub closes the
   tracking issue automatically on merge. Close it manually if needed.
2. Update the project's `PROJECT_STATUS.md`:
   - Add the shipped feature to **Features (shipped)**
   - Update **Timeline** with the ship date
3. Commit and push the status update.

## Boundary with existing fleet conventions

The tracking issue does **not** replace these — it sits alongside them:

| Artifact | Purpose | When |
|---|---|---|
| GitHub tracking issue | Feature spec + task checklist + operational state | Created at propose; checked off during apply; closed at ship |
| `PROJECT_STATUS.md` | Durable product status | Read before broad work; update on ship |
| `docs/plans/` | Rare design artifacts that outlive the feature | Only if the design has lasting reference value |
| `AGENTS.md` | Per-project agent instructions | Stack, commands, conventions |

Rule of thumb: **the tracking issue owns feature design and task state while
the change is active**. **PROJECT_STATUS.md owns durable shipped/current
product truth**. They meet at ship time: merge the linked PR, close the
tracking issue, and record only the shipped outcome in `PROJECT_STATUS.md`.

## Anti-patterns

- **Skipping propose because "it's obvious"** — if it's obvious, the proposal
  takes 5 minutes and confirms alignment. Skip only for the explicit
  exemptions above.
- **Writing feature code before the tracking issue exists** — the issue is the
  gate. No issue, no feature code.
- **Maintaining local spec files** — all spec content lives in the tracking
  issue. Do not create `openspec/` directories, `proposal.md`, `tasks.md`,
  `design.md`, or `specs/` folders. The tracking issue is the single source
  of truth.
- **Letting tracking issues stay open after ship** — close promptly on merge.
  Open tracking issues after the work is done are spec debt.
- **Duplicating the proposal into `docs/plans/`** — the tracking issue IS the
  plan. Link to it from elsewhere if needed; don't copy.
- **Ignoring the task checklist during implementation** — check off items in
  the issue body as they complete. The tracking issue is the source of truth
  for implementation progress.

## Quick reference

```bash
# Pre-flight
gh issue list --repo <owner/repo> --state open    # check for existing issues

# Propose
gh issue create --repo <owner/repo> \
  --title "Add dark mode" \
  --body-file spec-body.md \
  --label spec \
  --assignee @me

# Apply (check off tasks)
gh issue edit <N> --repo <owner/repo> --body-file updated-body.md

# Close (automatic via PR)
# PR body: Closes #<N>
```
