---
name: daily-learning
description: Create a fresh private 30-minute Fleet learning session from Telegram, OpenClaw, Hermes, or the terminal. Use when the operator asks to learn, study, review, get today's session, or focus on a named Fleet project or learning source.
---

# Daily Learning

Use the Fleet Ops learning control:

```bash
scripts/agent-bin/learning-control sync
scripts/agent-bin/learning-control today [source]
scripts/agent-bin/learning-control start [source]
scripts/agent-bin/learning-control status
scripts/agent-bin/learning-control complete <session-id>
```

Run commands from the Fleet Ops repository. Use `sync` only when the operator
asks to refresh the checked-in source catalog; it may commit and push a catalog
update. Use `today` or `start` to create and durably record a fresh session.
Omit `source` for balanced High Signal plus due learning, or pass a current
product/source such as `posttrainllm`, `MAL Explorer`, or `Research Papers`.

Use `status` for aggregate catalog freshness and active/recent session state.
It emits no learning content, credentials, or private Reader item details. Use
`complete` with the returned session ID after the operator finishes. Completing
the control record is idempotent; the web session remains responsible for item
progress, notes, answers, and FSRS ratings.

Return the generated URL directly. The site requires the owner's Google account.
Each invocation creates a new session ID, so there is no daily limit. Questions
come at the end and their result controls FSRS rescheduling.

The managed machine cron sends one balanced link through OpenClaw Telegram at
08:05 Asia/Kolkata each day. This scheduled link does not limit on-demand runs.

If the command reports that its catalog is missing, run `sync` once and retry.

OpenClaw, Hermes, Telegram, and terminal requests use the same five commands.
Return the generated private URL for `today`/`start`; summarize only aggregate
fields for `status`. Never paste Reader bodies or credentials into chat.
