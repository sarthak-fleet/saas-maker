# Ideas catalog

`sassmaker.com/ideas` is SaaS Maker's scored product-idea decision surface. It
is not an independent product or deployment.

## Source and build

- `apps/showcase/ideas/build.py` owns the curated ideas and scoring logic.
- `apps/showcase/ideas/data/` retains the imported public case-study inputs.
- `apps/showcase/src/data/ideas.json` is generated and checked in for the
  static site.
- `apps/showcase/src/pages/ideas.astro` renders the server-first catalog.

Run `pnpm -F @saas-maker/landing-page build:ideas` after changing an idea or
score. `pnpm build:showcase` also regenerates the dataset before building.

## Scoring

- `F`, `M`, `T`, and `C` score fun, raw money potential, technical challenge,
  and competition pressure out of ten.
- `fun = F + T`.
- `money = M + F_feas - C`, where `F_feas` is solo feasibility.
- A best bet serves a customer other than an individual developer and has
  `fun >= 14` or `money >= 5`.
- Only ideas with `T >= 7` are published.

Scores organize judgment; they are not market validation. Competitor context,
the wedge, customer type, and feasibility reasoning remain visible with each
idea.

## Public surfaces

- `/ideas` — human catalog.
- `/ideas.json` — complete generated dataset.
- `/ideas.md` — agent-readable catalog.
- `/api/ai`, `/llms.txt`, and `/sitemap.xml` — discovery indexes.

The retired `sass-maker/saas-ideas` repository remains only as historical Git
provenance. Do not restore its Pages project or domain.
