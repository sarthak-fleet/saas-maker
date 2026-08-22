---
name: site-health
description: Route site health, AI indexing, technical SEO, competitive content coverage, performance, visibility trends, and public guest-journey audits to one relevant Fleet subskill.
---

# site-health — fleet website measurement (routing parent)

Route by intent. Each subskill's SKILL.md is the full protocol — read the
one you need, not all of them.

| Intent | Read and follow |
|---|---|
| AI/agent readiness: llms.txt, /api/ai, index.md, robots vs AI crawlers, GEO surfaces | `skills/agent-ready/SKILL.md` |
| On-page SEO: title/meta/canonical/OG/JSON-LD/hreflang/sitemap coverage | `skills/seo-audit/SKILL.md` |
| SEO content sufficiency: article inventory, competitive intent/page gaps, comparison/alternative/use-case pages, create or publish missing pages | `skills/content-coverage/SKILL.md` |
| Performance: Core Web Vitals, Lighthouse distributions, "why is X slow" | `psi-swarm/SKILL.md` (standalone product; exposed through the skill symlink) |
| Outcome trends: SERP classes over time, "did results move", weekly run | `skills/geo-observatory/SKILL.md` |
| Canonical-root crawl and source fixes | Run `node scripts/ahrefs-site-audit-health.mjs`, then apply every **error** action in the owning repo. The working path is the local sitemap crawl. Ahrefs Health Scores are optional and currently blocked (Infisical `AHREFS_API_KEY` returns 401). See [canonical-root site audit](../../docs/ahrefs-site-audit.md). Do not deploy. Do not invent ratings. |
| Public usability: click around, guest journeys, blank/broken pages, navigation, search/detail, downloads, primary product actions | `skills/public-product-smoke/SKILL.md` |

## Combined mode — "full health check"

For "audit everything", "full health check", or "fleet health scorecard",
run the relevant subskills above and reconcile their evidence in the private
Site Health product. There is no active portfolio scorecard script in this
repository; its former implementation is retained only under
`preserved/legacy-fleet-tooling/`.

## Conventions (all subskills)

- Targets resolve via `scripts/lib/registry.mjs`.
  `../site-health/apps/backend/config/projects.json` is the canonical product
  list. Optional agent-surface metadata may enrich it but does not replace it.
- Reports land at `docs/<skill>-latest.md`.
- Evidence over vibes: cite URLs/numbers for every failing grade.
