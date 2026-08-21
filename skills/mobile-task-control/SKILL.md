---
name: mobile-task-control
description: Start, supervise, and report durable Fleet work requested from Telegram or another chat surface. Use when the operator asks to spin up work, run something in the background, show task status, or test mobile control.
---

# Mobile Task Control

Use OpenClaw's task ledger as the source of truth.

## Normal task flow

1. Restate the requested outcome, target project, and permission boundary in one short message.
2. Use `sessions_spawn` for work that is more than a direct answer. Set a stable `taskName`, a useful `label`, `runtime: "subagent"`, `mode: "run"`, and the narrowest `cwd`.
3. Immediately report the accepted run ID and tell the operator `/tasks` shows current status. Do not claim the task has completed.
4. Use `sessions_yield` when the result is required before continuing. Do not poll task or session lists in a loop.
5. Execute requested machine work under the configured host policy. Report concrete results and the task's terminal status separately.

The operator can use `/tasks`, `/subagents list`, and `/status` from Telegram.

## End-to-end control test

When asked to test the complete mobile flow:

1. Create a run ID such as `mobile-e2e-YYYYMMDD-HHMMSS`.
2. Spawn a read-only subagent named `mobile_control_test`. Its task is to return a concise plan containing the run ID and confirm the Fleet Ops workspace. It must not modify files.
3. Report that the task is running and expose `/tasks` before waiting for the child result.
4. After the child completes, call `exec` on:

   ```text
   skills/mobile-task-control/scripts/control-flow-test complete <run-id>
   ```

   Use the Fleet Ops workspace and configured gateway policy.
5. Verify with:

   ```text
   skills/mobile-task-control/scripts/control-flow-test status <run-id>
   ```

6. Reply with separate evidence for task completion and marker status.
