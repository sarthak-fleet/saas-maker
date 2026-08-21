# Execution

Use the most semantic verified integration available:

1. purpose-built connector, API, or official CLI;
2. Postiz for social accounts that are mapped and pass its readiness gates;
3. the connected in-app Browser or Chrome skill for normal visible UI work;
4. manual/blocked receipt when safe automation is unavailable.

Before every item:

```bash
node scripts/campaign-manifest.mjs gate --manifest <path> --item <key>
```

Execute only when the result is `authorized`. Then record confirmed provider
IDs, repository revisions, live URLs, or visible success evidence. `queued`
means a provider accepted a scheduled/draft item; it is not a live post.
Ambiguous navigation or form text is `indeterminate` and must be reconciled
before retry.

Browser work uses the user's connected session and ordinary visible
interaction. Stop on unexpected payment, changed fields/content, CAPTCHA,
anti-bot controls, missing authentication, or unclear success. Never use hidden
standalone browser automation, force-submit, automation-evasion, or blind retry.

Treat blockers per item, not per campaign. After recording a blocked or manual
receipt, continue every other independently authorized item. Return one
enablement queue containing the destination, blocker type, exact owner action,
and safe resume key. Prefer the user's regular connected Chrome profile when it
is the explicitly selected account-bearing browser; never copy cookies or
credentials into campaign state.

For a published link, capture the final visible URL and referring hostname.
Record follow state and indexability only when verified; use `unknown` when
they cannot be observed. A submitted form, draft, or queued moderation review
is not a live backlink.
