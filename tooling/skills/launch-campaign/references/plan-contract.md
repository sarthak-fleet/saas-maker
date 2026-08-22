# Campaign plan contract

The preview is the operator interface. It must contain:

- campaign objective, product revision, launch scope, readiness verdict, and
  source evidence;
- ordered steps and timing;
- every item with tier, destination, exact account, cost, authentication state,
  policy check time, execution mode, and expected receipt;
- full canonical article, email, announcement, Product Hunt copy, launch-page
  copy, and flagship social posts;
- destination-specific secondary titles, descriptions, categories, tags,
  URLs, assets, and form fields;
- canonical/source attribution for every full-article syndication item;
- backlink evidence fields: expected page type, live result URL, unique
  referring domain, follow state, indexability, permanence, and topical fit;
- explicit exclusions and blockers;
- one consolidated resumable enablement queue grouped by sign-in, account
  setup, CAPTCHA/anti-bot, unexpected payment, and moderation;
- every repository path, command, commit/push action, and deploy action;
- attribution, launch-day metrics, and 7-day/30-day checkpoints.

## Lanes

`protected` contains Hacker News, LinkedIn, and X. Each eligible item gets an
original native post, exact account, timing, policy constraints, and individual
approval-visible execution plan.

`canonical` owns the first-party article, launch page, email, changelog, and
other source assets. These establish the claims and URL used by other lanes.

`article_syndication` inventories:

- full-canonical publication on Medium, DEV Community, and Hashnode;
- editorial submission to HackerNoon;
- discovery adaptations for daily.dev and other relevant communities; and
- configured owned publications such as Substack, Ghost, WordPress, Blogger,
  Tumblr, or Beehiiv.

Only include a platform when current eligibility and account state are known.
Full duplicates carry the complete approved body and first-party canonical URL.

`broad_backlink` covers relevant product profiles, directories, catalogs,
comparison pages, package registries, marketplaces, launch boards, and
community adaptations. Reuse factual source material, but adapt every required
field and retain a visible result URL as the success receipt.

`manual_or_blocked` includes press outreach, moderation-sensitive communities,
paid placement, missing authentication, unsupported accounts, CAPTCHA,
anti-bot challenges, ambiguous policies, fake-review requests, and irrelevant
destinations. A blocked item does not stop independent authorized items. Group
the owner actions into one enablement queue and resume only the affected items.

One approval applies to the complete canonical JSON hash. Any material field
change invalidates it.
