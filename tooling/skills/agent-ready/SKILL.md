---
name: agent-ready
description: Subskill of site-health — AI/agent indexing audit (llms.txt, /api/ai, markdown negotiation, robots vs AI crawlers, SPA-fake detection). Route here from site-health for "can AI read my site" checks.
metadata:
  short-description: AI agent indexing audit (llms.txt, markdown, /api/ai)
---

# Agent Ready

Subskill of `site-health` — invoked directly or via the parent router.

Check whether a website is ready for AI agents and crawlers to **discover and
read product truth without JS**. Fleet S-tier is defined in
[`docs/agent-indexing-standard.md`](../../docs/agent-indexing-standard.md).

## Preferred: local fleet auditor

No external rate limits. Detects SPA-fake HTML shells on `/llms.txt`.

```bash
# one origin
node skills/agent-ready/scripts/agent-index-audit.mjs https://rolepatch.com

# one health-contract project
node skills/agent-ready/scripts/agent-index-audit.mjs --project rolepatch

# entire fleet
node skills/agent-ready/scripts/agent-index-audit.mjs --all

# machine-readable
node skills/agent-ready/scripts/agent-index-audit.mjs --all --json
```

### S-tier checks (local)

| Check | Pass |
|---|---|
| `llms_txt` | Real text starting with `#`, not HTML |
| `api_ai` | JSON catalog with `name`, `llms`, `surfaces[]` |
| `homepage_md` | `Accept: text/markdown` **or** `/index.md` |
| `not_spa_fake` | Agent paths are not SPA HTML shells |
| `robots` | Exists with User-agent |
| `sitemap` | `sitemap.xml` or `sitemap-index.xml` |
| `route_markdown` | Public sitemap routes resolve as Markdown; large corpora use a deterministic 250-route sample |
| `catalog_integrity` | Every bounded `/api/ai` surface has a same-origin, readable Markdown target listed in the sitemap |
| `name_agreement` | `/llms.txt`, `/api/ai` and JSON-LD all declare the canonical product name |
| `head_parity` | HEAD returns the same status class as GET on the agent endpoints and a 10-route sample |

Implementation kit: `lib/agent-surfaces/`.

Presence is not identity: a surface that publishes a different product name to
agents than the canonical record carries cannot score S-tier, whatever its
Markdown coverage. Mismatches are classified `casing`, `slug-leak`,
`retired-alias` or `unrecorded`; an `unrecorded` name — one that appears in no
record for that id — floors the tier at C. Canonical names come from
`config/entity-identity-canonical.json` over the Site Health catalog's
`geoIdentities[]`. Full rules in
[`docs/agent-indexing-standard.md`](../../docs/agent-indexing-standard.md).

`head_parity` closes the matching blind spot on verbs: a route that answers 200
to GET and 404 to HEAD is invisible to the crawlers that probe with HEAD first.

The audit reports and the Fleet visibility ledger retain:

- agent-readable coverage percentage;
- readable and checked route counts;
- total public sitemap route count;
- catalog-surface integrity percentage;
- valid and configured catalog-surface counts.

Route volume is context, not a score. A small site with complete coverage is
healthier than a large corpus with sparse Markdown. For more than 250 public
routes, the percentage is a deterministic distributed sample and is always
shown with checked and total counts.

## Optional: isitagentready.com

Use for protocol extras (MCP, OAuth, Web Bot Auth). Not the fleet S-tier gate.

```bash
curl -s 'https://isitagentready.com/api/scan' \
  -H 'content-type: application/json' \
  -H 'origin: https://isitagentready.com' \
  -H 'referer: https://isitagentready.com/' \
  --data-raw '{"url":"<URL>","enabledChecks":["robotsTxt","sitemap","linkHeaders","dnsAid","markdownNegotiation","robotsTxtAiRules","contentSignals","webBotAuth","apiCatalog","oauthDiscovery","oauthProtectedResource","authMd","mcpServerCard","agentSkills","webMcp","x402","mpp","ucp","acp"]}'
```

## What the external checks mean

| Check | What it tests |
|---|---|
| **robotsTxt** | robots.txt exists and is parseable |
| **robotsTxtAiRules** | AI-specific bot rules |
| **sitemap** | sitemap discovery |
| **markdownNegotiation** | `Accept: text/markdown` |
| **mcpServerCard** / **agentSkills** | Agent-native extras (S+, not required for all) |

## Fleet priorities by product type

- **Marketing / content**: `llms.txt`, page markdown, `/api/ai`, sitemap, robots
- **SPA + API**: honest catalog + API resource MD (mode D) — never empty shells
- **Agent-native (Karte-class)**: add `skill.md` + well-known skills (S+)

Do **not** chase 19/19 external checks unless the product is an agent platform.

## Relationship

| Skill | Covers |
|---|---|
| **agent-ready** | GEO / LLM indexing (this skill) |
| **seo-audit** | Classic on-page SEO |
| **psi-swarm** | Performance / Core Web Vitals |
