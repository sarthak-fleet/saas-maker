# Production interaction policy

Use this policy whenever `public-product-smoke` operates against a live site.

## Allowed

- Open public pages and actual visible links.
- Search and filter public data.
- Open public detail pages.
- Play public media.
- Run local-only browser computations or model demos.
- Toggle presentation controls, tabs, accordions, hints, and previews.
- Inspect accessible page text, browser errors, requests, and link targets.
- Verify a download target with a read-only request without retaining the file.
- Retry a failed action once after normal asynchronous loading.

## Do not perform

- OAuth or account creation.
- Sign-in, sign-out, cookie clearing, or session destruction.
- Purchases, checkout, paid API calls, or license activation.
- Email, message, feedback, suggestion, rating, vote, or form submission.
- Saving notes, progress, preferences, collections, or user content.
- Delete, reset, unsubscribe, revoke, archive, or other destructive controls.
- Enter API keys, service keys, passwords, or production credentials.
- Trigger deployments, background jobs, migrations, synchronizations, or data
  refreshes with external side effects.
- Download large binaries when a link/status check is enough.
- Generate repeated requests, discover thresholds, load test, stress test, or
  intentionally trigger abuse controls.

## Authentication state

Record one of:

- `guest`: visibly unauthenticated and no private state used.
- `authenticated`: visibly signed in.
- `unknown`: the surface does not expose enough evidence.
- `not_verified`: a clean guest proof would require altering user state.

An authenticated pass does not prove guest access. Never sign the user out to
obtain a clean guest test.

## Async and retry rules

- Allow normal hydration before classifying blankness.
- For data-heavy discovery or search, wait up to roughly 12 seconds when the UI
  shows a legitimate loading state.
- Retry a core failure once.
- Do not repeatedly hammer a rate-limited origin.
- When ordinary navigation triggers visitor blocking, capture `429`,
  `Retry-After`, Cloudflare `1015`, the challenge type, and visible recovery
  behavior, then stop that origin's pass.
- Never retry a rate-limited request beyond the single retry already permitted
  for the selected journey.

## Evidence quality

Capture:

- Canonical URL or route.
- Visible action taken.
- Expected and observed result.
- Whether the issue reproduced.
- Authentication state.
- Declared authentication model.
- Any exact visible error or empty state.
- Naturally observed rate-limit status, headers, challenge, and recovery path.
- Whether a direct read-only link check agrees with the browser.

Distinguish:

- hard functionality failure;
- correct gate or intentional limitation;
- content/data trust problem;
- performance or accessibility degradation;
- audit limitation.
