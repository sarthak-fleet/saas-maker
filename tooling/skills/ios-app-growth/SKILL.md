---
name: ios-app-growth
description: Plan, instrument, audit, and improve paid growth for consumer iOS subscription apps across positioning, App Store conversion, onboarding, paywalls, attribution, Apple Ads, paid social, and cohort economics. Use for iOS app growth plans or experiments, not ordinary feature implementation or generic marketing copy.
---

# iOS App Growth

Build an evidence-backed growth system, not a promise that ads will print money.
Treat the source article as a useful set of hypotheses from one operator's
experience. Verify platform behavior, policy, pricing, and benchmarks before
using them in a current plan.

## Start here

1. Read the nearest repository `AGENTS.md`, product status, and the smallest
   relevant app, analytics, subscription, and App Store files.
2. Establish the requested mode:
   - **audit**: diagnose the product, funnel, measurement, or economics;
   - **plan**: produce a staged growth plan and experiment manifest;
   - **implement**: make explicitly requested app-side instrumentation or
     funnel changes;
   - **operate**: change provider or ad-platform state only with explicit
     authorization, an exact account/app, and a hard spend cap.
3. Read only the references needed for that mode:
   - Product, App Store page, onboarding, paywall, pricing, and review:
     [product-and-funnel.md](references/product-and-funnel.md)
   - Events, attribution, experiment analysis, unit economics, and cash flow:
     [measurement-and-economics.md](references/measurement-and-economics.md)
   - Apple Ads or paid-social campaign design, creatives, stop rules, and
     scaling: [paid-acquisition.md](references/paid-acquisition.md)
   - Article provenance and claims that must remain hypotheses:
     [source-notes.md](references/source-notes.md)

## Operating invariants

- Start with user value and retention. Paid acquisition amplifies the existing
  funnel; it does not repair a weak or misleading product.
- Model the whole path: ad impression -> App Store page -> install -> onboarding
  -> paywall -> purchase -> renewal/refund. Name the current bottleneck before
  proposing changes.
- Compare acquisition cost with **net cohort value**, not list price, MRR, or
  gross revenue. Reconcile source definitions so taxes, store commission, and
  refunds are neither omitted nor subtracted twice.
- Use the provider-neutral event contract as the source of truth. Map it to the
  MMP, subscription system, analytics system, and ad network; do not let each
  vendor invent a conflicting taxonomy.
- Verify live event delivery and deduplication before optimizing for an in-app
  event. A dashboard mapping or queued postback is not proof of attribution.
- Prefer a small sequence of falsifiable experiments over simultaneous changes
  to the App Store page, onboarding, pricing, paywall, audience, and creative.
- Treat article numbers such as fixed prices, screen counts, conversion targets,
  budgets, creative spend, and percentage budget increases as starting
  hypotheses only. Use current product data and current first-party platform
  guidance.
- Preserve authorization boundaries. Planning never authorizes SDK installs,
  privacy-label changes, pricing changes, App Store submissions, provider setup,
  campaign creation, ad spend, or deployment.

## Workflow

1. **Build an evidence baseline.** Record the app and storefront, target user,
   core outcome, current acquisition channels, funnel counts by cohort, paid
   products, realized proceeds, refunds, renewals, attribution coverage, and
   data gaps. Label self-reported or inferred figures.
2. **Check readiness.** Confirm the product delivers ongoing value, purchase
   terms are clear, restore/manage-subscription paths work, privacy disclosures
   match every SDK, and the App Store page accurately represents the app.
3. **Choose one constraint.** Product-market fit, store-page conversion,
   onboarding completion, paywall conversion, retention, attribution quality,
   creative performance, or channel scale. Do not default to buying traffic.
4. **Define an experiment.** State the hypothesis, primary metric, guardrails,
   audience/cohort, control, changed variable, budget and loss cap, minimum
   observation rule, stop conditions, and decision rule before launch.
5. **Preview mutations.** Show the exact app files, provider fields, campaign
   settings, regions, creatives, schedule, and maximum spend. Stop for approval
   if the request did not already authorize those exact actions.
6. **Verify from end to end.** Use sandbox/test purchases where supported, then
   prove event arrival, mapping, revenue semantics, deduplication, attribution,
   and the user-visible purchase/restore/cancel experience.
7. **Evaluate cohorts.** Separate early conversion signal from mature renewal,
   refund, and net-value evidence. Scale, revise, or stop according to the
   precommitted decision rule; do not rationalize a losing test as an endless
   learning phase.

## Trust, policy, and quality

- Use current first-party Apple, ad-platform, MMP, and subscription-provider
  documentation at action time. Record the pages and access date in the plan.
- Never misrepresent outcomes, fabricate social proof or scientific authority,
  copy another app or creative 1:1, obstruct cancellation, hide material terms,
  or use false scarcity.
- Moderate spam, abuse, and harassment. Do not suppress legitimate criticism or
  filter words such as `cost`, `fake`, or `scam` merely to protect ROAS.
- A hard paywall is a product choice, not a default. It must be appropriate to
  the value delivered and still provide compliant purchase disclosure, restore,
  account, support, privacy, and subscription-management paths.
- Request tracking permission only when the actual data practice requires it;
  do not gate functionality on ATT consent or substitute another identifier to
  evade a refusal.
- Avoid medical, financial, religious, intimacy, addiction, or appearance-based
  positioning that exploits vulnerability. Require stronger evidence and a
  subject-matter review for high-stakes claims.

## Deliverable

Return the smallest useful artifact for the request. For a full plan include:

1. Current evidence and unknowns.
2. Funnel and unit-economics baseline with explicit definitions.
3. Ranked bottlenecks and why the first one wins.
4. One or more staged experiment manifests with spend/loss caps.
5. Required implementation or provider changes, separated by authorization.
6. Verification receipts and a scale/stop decision, when execution was asked.

Never report projected revenue, an enabled integration, campaign delivery, or
provider-reported conversions as realized profit.
