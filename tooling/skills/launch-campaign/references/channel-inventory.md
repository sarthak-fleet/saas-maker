# Channel inventory

Load the seed inventory only when a campaign needs it:

```bash
node skills/launch-campaign/scripts/channel-inventory.mjs \
  --artifact <article|product|major-feature>
```

The JSON output keeps large, drift-prone registries out of normal skill
context. It is discovery input, not an executable plan.

## Accreditation state

Every channel in the output is annotated from
`.fleet-local/directory-submissions/accreditation-state.json` with
`currentState`, `verifiedAt`, `stale`, and `blocker`. That file is the durable
record across campaigns, so verification work is never repeated without reason.

- **accredited** — probed with recorded evidence (live URL, HTTP status, form
  and blocker detection). Enters the manifest after per-campaign audience-fit
  confirmation, without a full re-probe. An accredited platform whose
  `verifiedAt` is older than `stalenessDays` (default 30) is `stale` and
  returns to the verification queue.
- **seed** — unverified registry evidence. Never ready for submission. It needs
  a live audience, policy, cost, authentication, submission-flow, and account
  probe first, and the outcome recorded back into the state file.
- **blocked** — a recorded blocker using one validated value: `captcha`,
  `signin`, `payment`, `anti-bot`, `moderation`, or `offline`. Enabling one is
  an owner decision, never a bypass.
- **rejected** — excluded unless the owner explicitly overrides with a reason.
- **untracked** — the channel is not in the state file yet; treat it as seed.

Record outcomes with
`scripts/accreditation/update-state.mjs transition`; read state with
`scripts/accreditation/summary.mjs`; plan work in product-priority
order with `scripts/accreditation/generate-queue.mjs`. Accreditation
removes repeat probing, not judgment: every external write still requires an
exact hash-approved immutable manifest.

## Route the inventory

- `protected`: Hacker News, LinkedIn, and X. Create original native plans and
  preserve the quality gate regardless of artifact type.
- `articleSyndication`: full-canonical platforms, editorial platforms,
  discovery communities, and optional owned publication hosts. Require the
  complete body and canonical URL for any full duplicate.
- `curatedDirectories`: the smaller maintained product/listing seed set.
- `longTailSeeds`: the wider historical probe. Treat every entry as unverified
  until the current form and audience fit have been checked.

For a product or major feature, retain relevant profiles, catalogs, comparison
pages, package registries, marketplaces, launch boards, and directories. For
an article, prioritize canonical syndication and genuine discovery surfaces;
do not manufacture unrelated directory submissions.

Map selected destinations to the user's chosen connected account at planning
time. Keep account slugs in private campaign state. During execution, isolate
sign-in, account setup, CAPTCHA/anti-bot, payment, and moderation blockers into
one resumable enablement queue while unrelated authorized items continue.
