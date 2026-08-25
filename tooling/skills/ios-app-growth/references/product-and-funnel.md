# Product and funnel

Use this reference for product positioning, App Store conversion, onboarding,
paywalls, pricing, or App Review work.

## Product thesis

Describe the product without growth jargon:

- target user and situation;
- painful or valuable job they already recognize;
- concrete outcome the app produces;
- why the app is meaningfully better than alternatives;
- evidence that users receive ongoing value after purchase.

A strong human desire can make positioning legible, but it is not permission to
manufacture insecurity or exploit vulnerability. Convert a desire into a real,
bounded product promise that the app can substantiate.

Starting with iOS and SwiftUI can reduce surface area when the audience,
economics, and team support it. It is not a universal rule. Compare audience
share, willingness to pay, required device APIs, acquisition channel, existing
code, and opportunity cost before recommending a platform.

## Funnel audit

Audit the stages independently before redesigning them together:

| Stage | Question | Useful evidence |
| --- | --- | --- |
| Ad or source | Did the promise match the intended user? | impression, tap, creative, campaign |
| App Store page | Did the listing make the outcome credible? | product-page views, conversion, variant |
| Install/open | Did the user arrive and launch successfully? | installs, first opens, attribution gaps |
| Onboarding | Did each step increase understanding or readiness? | per-step views, exits, completion time |
| Paywall | Were value, products, terms, and choice clear? | impression, product selection, purchase start |
| Purchase | Did payment and entitlement activation work? | success, failure reason, restore result |
| Retention | Does value continue after day one? | activation, use, renewal, refund, expiry |

Every onboarding screen must earn its place. Do not target an arbitrary count.
Use one idea per screen, minimize input, request permissions in context, and
measure step-level loss. Necessary friction can improve decision quality; empty
friction merely drops users.

## Paywall and pricing

The paywall should:

- state the user outcome without implying guaranteed results;
- explain the few capabilities that make the outcome credible;
- show authentic, attributable social proof only when permission and evidence
  exist;
- display product duration, price, renewal behavior, trial or introductory
  terms, and the primary CTA clearly;
- make restore, terms, privacy, support, and subscription management accessible;
- remain usable with Dynamic Type, VoiceOver, reduced motion, and smaller
  devices.

Competitor prices are a research input, not the pricing strategy. Model price
against willingness to pay, realized retention, refunds, local storefronts,
and the value delivered. Test one interpretable change at a time. Do not declare
a winner from conversion alone when variants change duration or price; compare
net cohort value and refund/renewal guardrails.

Remote paywalls can reduce release latency and enable experiments. They also add
SDK, privacy, outage, versioning, and remote-configuration risk. Keep a safe
fallback, test every product/locale combination, and ensure remote content
cannot create a noncompliant or broken purchase flow.

## Offers and cancellation

An offer must be clear, voluntary, and consistent with current Apple rules.
Never make cancellation harder, mislabel the next action, or imply that an
in-app screen completes a cancellation when it does not. If showing a save or
retention offer, give users a direct path to the actual subscription-management
surface and measure complaints/refunds as guardrails.

## Review readiness

Before submission, verify current App Review and subscription rules. Prepare
accurate review notes, a working demo account when needed, and a short video only
when it materially helps the reviewer reach or understand the feature. Use
expedited review only for a legitimate qualifying need.

Do not advise resetting ratings to obscure a quality problem. Diagnose the
rating, respond through supported channels, report only reviews that violate
policy, and fix the underlying issue.

## Primary documentation to refresh

- Apple App Review Guidelines:
  <https://developer.apple.com/app-store/review/guidelines/>
- Apple auto-renewable subscriptions:
  <https://developer.apple.com/app-store/subscriptions/>
- App Store Connect Help:
  <https://developer.apple.com/help/app-store-connect/>
- Apple user privacy and data use:
  <https://developer.apple.com/app-store/user-privacy-and-data-use/>
