---
name: fleet-workspace
description: Use when working across the Fleet workspace, deciding whether work belongs in a child project, Fleet policy, or project-local task tracking.
---

# Fleet Workspace

Use this skill for Fleet-wide workspace decisions and cross-project maintenance.

## Read First

1. Read the nearest project `AGENTS.md`.
2. Read `/Users/sarthak/Desktop/fleet/AGENTS.md` for Fleet-wide policy.
3. Read this repository's `README.md` and `docs/preserved-tooling.md` before
   changing shared tooling ownership or reviving preserved legacy scripts.

## Rules

- Treat each immediate child directory with its own `.git/` as an independent
  repository.
- Keep shared workspace policy in the Fleet root.
- Keep project-specific build, deploy, and architecture rules in the child
  project.
- Use the owning repository's GitHub Issues for all operational follow-up.
  `PROJECT_STATUS.md` records only durable current/shipped product truth.
- Do not install Fleet behavior globally unless the user explicitly asks for
  Fleet behavior to appear outside `/Users/sarthak/Desktop/fleet`.

## When Adding Shared Agent Assets

- Put shared skills under `/Users/sarthak/Desktop/fleet/saas-maker/tooling/skills/`.
- Use `/Users/sarthak/Desktop/fleet/saas-maker/tooling/scripts/link-project-agent-assets.sh`
  when project-local agent assets need to be exposed.
- Keep global machine config private and personal.
