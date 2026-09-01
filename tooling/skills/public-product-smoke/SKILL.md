---
name: public-product-smoke
description: Audit whether public websites actually work for users through bounded browser journeys. Use when the user asks to click around a site or the Fleet, verify guest usability, test each product's unique pages, find blank or broken routes, exercise search/detail/primary actions, or produce an actionable public-product repair queue. This is a read-only production audit, not SEO, performance measurement, native-app testing, or automatic repair.
---

# Public Product Smoke

Verify product behavior, not route count. Test at most six genuinely distinct
surfaces per product and perform one safe, meaningful interaction on each where
possible.

## 1. Build the scope

From the Fleet root, generate the canonical target manifest:

```bash
node saas-maker/tooling/skills/public-product-smoke/scripts/build-audit-manifest.mjs
node saas-maker/tooling/skills/public-product-smoke/scripts/build-audit-manifest.mjs \
  --exclude fleet-workspace,drank,protein-index
node saas-maker/tooling/skills/public-product-smoke/scripts/build-audit-manifest.mjs \
  --only pace,starboard --format table
```

The helper reads `site-health/apps/backend/config/projects.json` plus the root `AGENTS.md`
Out Of Fleet section. Do not silently add projects that the manifest excludes.
Apply any explicit user exclusions as `--exclude`.

If the request targets a non-Fleet URL, skip the manifest and audit only that
origin.

### Authentication contract

Use the manifest's `authModel` to decide what a guest must be able to do:

| Model | Public contract | Authenticated core |
| --- | --- | --- |
| `required-user` | Clear explanation and working sign-in handoff | `not_verified` without approved credentials |
| `required-service` | Public docs/health plus safe rejection of protected access | `not_verified` without an approved service identity |
| `public-personalized` | Useful discovery, search, details, or comparison | Auth adds private imports, saves, or personalization |
| `public-persistent` | Full core journey completes as a guest | Auth only adds persistence, sync, or identity |

For public-first models, an unexpected login wall on the declared public core is
a failure. For required-auth models, a clear boundary can pass while the
protected core remains `not_verified`.

## 2. Select meaningful surfaces

Inspect actual visible navigation and product promises. Choose no more than one
representative from each category:

1. Landing or browse
2. Search or filter
3. Detail or content page
4. Primary public action
5. Important secondary workflow
6. Authentication or guest boundary

Use fewer surfaces when the product has fewer unique page types. For a
single-page product, test its real controls without inventing routes. Do not
crawl pagination, every item, or every content page.

Prefer actual links over guessed URLs. A direct route may be used to reproduce
an observed link target or verify a known public contract.

## 3. Exercise functionality

Use the browser-control skill and a named browser session. For each product:

1. Open the canonical origin.
2. Record whether the browser appears signed in.
3. Navigate through the selected surfaces.
4. Perform one safe interaction such as search, filter, detail selection,
   playback, local generation, preview, or a non-persisted calculator.
5. Wait for normal hydration or asynchronous loading before judging.
6. Retry a failed core action once.
7. Capture expected versus observed behavior immediately.

When an existing authenticated profile prevents a clean guest check, do not
sign out or clear user state. Mark guest behavior `not_verified`.

Read [references/interaction-policy.md](references/interaction-policy.md)
before interacting with production. Read
[references/abuse-protection-policy.md](references/abuse-protection-policy.md)
before classifying or recommending any rate-limit change.

### Rate-limit safety

Do not load test, loop requests, or attempt to discover a production threshold.
Only record evidence that occurs during the selected normal journey and its one
permitted retry:

- HTTP `429` and `Retry-After`;
- Cloudflare error `1015`;
- managed or interactive challenges;
- visible recovery guidance and whether the user can continue.

Stop that origin after ordinary use reaches a blocking limit. A limiter is not
healthy merely because it exists: classify its endpoint scope, identity key
when repository evidence is available, and customer impact.

## 4. Classify evidence

Use one verdict per product:

- `fail`: blank or missing primary route, broken CTA/download, repeated primary
  action failure, incorrect guest redirect, visitor-facing 5xx, or ordinary
  navigation triggering a blocking rate limit.
- `degraded`: usable but slow, inaccessible, internally contradictory, stale,
  or producing materially incorrect/untrustworthy output.
- `pass`: every selected surface and safe interaction works.
- `not_verified`: credentials, OAuth, purchase, private service, local companion,
  or production mutation is required.

Do not infer that HTTP 200 means the product works. Do not classify an
intentional credential or local-agent gate as failure when its public
explanation and fallback behave correctly.

Do not report missing application rate limiting on static assets, public HTML,
or ordinary cached/read-only GETs as a defect. Record a cost/security finding
when repository evidence identifies an unauthenticated expensive mutation—such
as AI generation, upload, import, messaging, or email—with no bounded
protection. Never exercise that endpoint repeatedly to prove the finding.

Stop a product pass after a core failure reproduces twice and enough evidence
exists to hand off the repair. Continue only when another distinct surface is
needed to determine scope or ownership.

## 5. Emit the handoff

Write:

- `docs/public-product-smoke-latest.md`
- `docs/public-product-smoke-latest.json`

The Markdown report must lead with customer-visible failures, followed by
degraded and passing products. Include tested surfaces compactly; do not dump
browser traces.

The JSON report uses:

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "exclusions": ["fleet-workspace"],
  "products": [
    {
      "project": "reader",
      "repo": "reader",
      "status": "fail",
      "authModel": "public-persistent",
      "guestState": "guest",
      "surfacesTested": 4,
      "abuseProtectionPosture": "unknown",
      "rateLimitEvidence": [],
      "findings": [
        {
          "surface": "/extension",
          "action": "Open Extension from primary navigation",
          "expected": "Extension installation page",
          "observed": "Blank document",
          "reproduced": 2,
          "evidence": ["visible blank page", "document body empty"],
          "nextAction": "Diagnose extension route rendering"
        }
      ]
    }
  ]
}
```

Every actionable finding must identify project, repository, surface, action,
expected result, observed result, reproduction count, and smallest next
diagnostic step.

For an abuse-protection finding, also identify the exact costly endpoint,
observed or repository evidence, current scope (`targeted`, `broad`, or
`unknown`), current identity key when known, and user recovery behavior. Do not
invent a numeric threshold. Prefer an observe-first rollout, stable
user/session/service-key/project identity, and recoverable `429` with
`Retry-After`.

## 6. Repair boundary

The audit itself is read-only. When the user separately asks to fix findings:

1. Work from the severity-ordered JSON queue.
2. Enter one owning repository at a time.
3. Read its nearest `AGENTS.md` and `PROJECT_STATUS.md`.
4. Inspect git state and preserve unrelated work.
5. Reproduce locally before editing.
6. Apply the smallest coherent fix.
7. Run the smallest relevant check.
8. Do not push, deploy, purchase, authenticate, or change production
   configuration unless explicitly requested.

Do not make speculative changes to passing products. Convert stable high-value
journeys into project-owned regression tests when practical.
