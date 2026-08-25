# Measurement and economics

Use this reference for event design, attribution, integration validation,
experiment interpretation, lifetime value, or profitability.

## Provider-neutral event contract

Define events before mapping them to vendors. Keep names stable and document
the source, timestamp, user or device key, product, currency, value semantics,
environment, and deduplication key.

Start with only the events that support a decision:

- `app_first_open`
- `onboarding_started`
- `onboarding_step_viewed`
- `onboarding_completed`
- `paywall_viewed`
- `purchase_started`
- `trial_started`
- `subscription_started`
- `subscription_renewed`
- `subscription_refunded`
- `subscription_expired`

Add activation and retained-value events specific to the product. A subscription
is a revenue event; it is not proof that the promised outcome occurred.

## Attribution topology

Draw the actual path before installing anything:

```text
app/store attribution -> MMP -> ad network
app -> analytics
store/subscription system -> lifecycle postbacks -> MMP/ad network/analytics
```

For each event, assign one authoritative revenue emitter. If a subscription
provider sends server-side lifecycle events, do not also send the same purchase
as revenue from the app unless the integration documents a reliable
deduplication contract. Test sandbox and production semantics separately.

Before calling an integration complete, prove:

1. the app generated the expected test event;
2. the source provider received it with the intended value and currency;
3. the downstream partner received or accepted it;
4. the partner mapped it to the intended optimization event;
5. repeated or server-side events were not double counted;
6. privacy choices and non-consenting paths behave as designed.

## Funnel definitions

Always show numerator, denominator, cohort, and time window. Examples:

```text
store conversion = first-time downloads / App Store product-page views
onboarding completion = completed onboarding / started onboarding
download-to-paid = new paying customers / first-time downloads
paywall conversion = purchase successes / unique paywall viewers
refund rate = refunded transactions / paid transactions
renewal rate_n = subscriptions renewed at period n / subscriptions eligible at period n
```

Provider dashboards can use different attribution windows and denominators.
Reconcile definitions instead of comparing labels.

## Unit economics

Use realized cohort data where possible. Make the money source explicit:

```text
net realized proceeds
  = gross customer billings
  - refunds
  - taxes or VAT not included in reported proceeds
  - store commission not included in reported proceeds
  - variable billing or paywall fees

cohort contribution
  = net realized proceeds
  - acquisition spend
  - variable infrastructure, support, and fulfillment cost

cohort contribution margin
  = cohort contribution / net realized proceeds

risk-adjusted allowable CPA
  = conservative net cohort LTV
  - target contribution per customer
  - non-ad variable cost per customer
```

Do not subtract tax or store commission twice when App Store proceeds or a
subscription dashboard already reports a net value. Keep business income tax
outside product contribution margin unless the owner asks for an after-tax cash
model.

Early cohorts have censored LTV. Show observed value through a fixed horizon,
the retention model used to project later periods, uncertainty, and downside.
Revenue in one month is not MRR unless it is recurring, normalized, and defined
consistently.

## Experiment rules

Pre-register:

- hypothesis and single primary metric;
- control and changed variable;
- eligible population and randomization unit;
- expected effect or minimum useful lift;
- maximum spend and maximum acceptable loss;
- minimum observation rule and maximum duration;
- refund, complaint, crash, and retention guardrails;
- scale, iterate, and stop decision rules.

Do not stop a controlled product experiment only because the early graph looks
good, and do not keep an acquisition test running indefinitely under the label
of “learning.” When volume is too low for a confident winner, report the result
as inconclusive and use the bounded next test.

## Cash flow

Separate profit from liquidity. Model ad-platform billing timing, Apple payout
timing, refunds, tax settlement, credit limits, and a reserve. A campaign can be
profitable on paper and still be impossible to fund safely.

## Primary documentation to refresh

- AppsFlyer iOS SDK and event guides:
  <https://dev.appsflyer.com/hc/docs/ios-sdk>
- RevenueCat attribution providers:
  <https://www.revenuecat.com/docs/integrations/attribution>
- RevenueCat AppsFlyer integration:
  <https://www.revenuecat.com/docs/integrations/attribution/appsflyer>
- RevenueCat experiments:
  <https://www.revenuecat.com/docs/tools/experiments-v1/experiments-overview-v1>
