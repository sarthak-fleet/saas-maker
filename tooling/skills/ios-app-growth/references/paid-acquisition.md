# Paid acquisition

Use this reference for Apple Ads, TikTok, Meta, Snapchat, or another paid mobile
acquisition channel.

## Preflight gate

Do not buy traffic until:

- the App Store page and purchase flow are accurate and working;
- the activation and retention signal is good enough to justify amplification;
- subscription lifecycle revenue reaches the measurement stack without double
  counting;
- the operator has approved the app, account, countries, schedule, billing
  currency, maximum daily spend, and maximum total loss;
- creative and targeting comply with current platform policy and applicable
  privacy law.

Treat ad credits as spend with opportunity cost, not as proof the channel is
free.

## Channel selection

Choose from audience behavior and the constraint:

- **Apple Ads** captures App Store intent and can be efficient when users search
  for the problem, category, brand, or adjacent apps. Search volume can cap
  scale.
- **Paid social** can create demand and scale through creative discovery when
  the target user is active on the platform. It usually requires faster
  creative iteration and stronger attribution discipline.
- **Organic or partnership channels** may be the better first move when LTV is
  uncertain, the niche is policy-sensitive, or paid auctions are structurally
  uneconomic.

Do not claim one algorithm is universally superior. Run bounded channel tests
against the same net-value definition.

## Experiment manifest

For every campaign or ad group capture:

```yaml
hypothesis:
app_and_storefront:
platform_and_account:
optimization_event:
audience_and_exclusions:
countries_and_languages:
placements:
creative_ids_and_rights:
bid_strategy:
daily_budget_cap:
total_spend_cap:
maximum_acceptable_loss:
start_and_end:
minimum_observation_rule:
stop_conditions:
scale_rule:
primary_metric:
guardrails:
attribution_window_and_source:
approval_receipt:
```

Preview this manifest before any provider mutation. A goal-based budget increase
or automated scaling feature must still respect the approved total cap.

## Apple Ads

Separate intent classes when the available volume justifies it: brand, generic,
competitor, and discovery. Use exact/broad match, Search Match, and negative
keywords deliberately; “Search Match off” is not a universal rule. Review the
search-term report and move useful terms into controlled groups without
duplicating bids blindly.

Competitor terms may be supported by the platform, but ads and product metadata
must not imply affiliation or misuse another brand. Segment countries only when
economics, language, creative, or bid behavior differ. Budget controls risk and
data speed; it never “doesn't matter.”

## Paid social

Start with materially different creative hypotheses, not minor edits presented
as separate formats. Useful directions can include creator-led explanation,
problem/solution demonstration, product proof, story, comparison, or slideshow,
provided each is truthful and properly licensed.

Study category language and public organic patterns, but do not copy a post,
person, script, likeness, voice, or creative 1:1. Label synthetic media where
required and review the platform's current AI-content policy. Obtain releases
for people appearing in ads.

Use the broadest targeting that is consistent with the hypothesis, product
eligibility, and platform policy. Demographic targeting must have a legitimate
product reason; do not use sensitive traits or proxies opportunistically.

Keep comments available when safe. Moderate abuse and spam with a documented
policy; preserve good-faith criticism and use it as product evidence.

## Learning and stopping

Set test spend from target CPA, conversion delay, event frequency, and the
maximum acceptable loss. A fixed `$50 per creative` is only an anecdotal seed,
not a reliable sample-size rule. If zero conversions occur, first verify event
delivery and campaign eligibility, then apply the precommitted spend stop.

Platform learning is real but does not override business economics. Diagnose:

- no delivery: eligibility, bid, audience, budget, creative review, event
  availability;
- delivery without store views: hook or click quality;
- store views without installs: listing relevance and conversion;
- installs without onboarding completion: promise mismatch or friction;
- completions without purchases: value, timing, paywall, price, or trust;
- purchases without contribution: refunds, weak retention, bad attribution, or
  an uneconomic auction.

Scale only after measurement is trustworthy and the cohort clears the chosen
economics threshold. Prefer bounded percentage or rule-based changes consistent
with current platform guidance. Keep a control, monitor CPA, net value, refunds,
retention, and cash reserve, and stop automatically at the approved cap.

## Primary documentation to refresh

- Apple Ads keyword guidance:
  <https://ads.apple.com/app-store/help/keywords/0014-add-and-manage-keywords>
- Apple Ads Search Match:
  <https://ads.apple.com/app-store/help/campaigns/0006-understand-search-match>
- TikTok App Promotion objective:
  <https://ads.tiktok.com/help/article/what-is-app-promotion-objective>
- Apple user privacy and attribution:
  <https://developer.apple.com/app-store/user-privacy-and-data-use/>
