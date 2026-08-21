# Fleet Agent Indexing Standard (GEO)

Make every public fleet surface readable by AI agents **without scrolling or
running JavaScript**. Classic SEO (titles, OG, H1) is out of scope here — see
`seo-audit` for that. Landing copy rules stay in `LANDING_STANDARD.md`.

**Canonical home for agent/LLM discoverability.** Other docs link here.

## Why

ChatGPT, Claude, Gemini, and Perplexity crawl and cite public text. Agents
drop content that requires scroll, hydration, or opaque SPAs. The TrustMRR
pattern works: public markdown pages, `llms.txt`, and a small structured
`/api/ai` catalog so agents get the same product truth as humans — faster.

## S-tier checklist (required)

Per public **origin**:

| Surface | Pass rule |
|---|---|
| `GET /llms.txt` | 200; `text/plain` or `text/markdown`; body starts with `#`; **not** HTML |
| `GET /api/ai` | 200 JSON with `name`, `llms`, `sitemap`, `markdown`, `surfaces[]` |
| Homepage markdown | `Accept: text/markdown` on `/` **or** `GET /index.md` returns real markdown |
| Public route markdown | Every **public** sitemap URL has a markdown alternate (`.md` and/or negotiation); audit every small-site route and a deterministic distributed sample for large corpora |
| SPA honesty | Agent paths never return an HTML SPA shell for missing files |
| robots + sitemap | Public crawl allowed; `Sitemap:` present; private/auth Disallow |

**S+ (agent-native products only):** `skill.md`, `/.well-known/skills/index.json`,
install scripts, authenticated agent APIs. Karte is the reference.

**Not required for S-tier:** MCP card, OAuth discovery, x402, Web Bot Auth, DNS AID.

## Contract

```
GET /llms.txt
GET /llms-full.txt          # optional expanded index / corpus dump
GET {path}.md               # markdown mirror
GET {path} + Accept: text/markdown
GET /api/ai                 # discovery catalog
```

`/api/ai` shape:

```json
{
  "name": "rolepatch",
  "version": "1",
  "url": "https://rolepatch.com",
  "llms": "https://rolepatch.com/llms.txt",
  "llmsFull": null,
  "sitemap": "https://rolepatch.com/sitemap.xml",
  "markdown": { "suffix": ".md", "negotiation": true },
  "surfaces": [
    { "id": "home", "url": "/", "md": "/index.md", "kind": "static" }
  ],
  "auth": { "public": true, "notes": "Dashboard requires session." }
}
```

Implementation helpers live in `lib/agent-surfaces/`.
Templates: `templates/agent-surfaces/`.
Audit: `skills/agent-ready/scripts/agent-index-audit.mjs`.

The audit retains route coverage as percentage, readable/checked counts, and
the total public sitemap count. It separately retains `/api/ai` surface
integrity as valid/configured counts and percentage. A sampled large-corpus
percentage must never be shown without its checked and total denominators.

## Auto modes

| Mode | Use when | Markdown source |
|---|---|---|
| **A Static marketing** | Few routes, Astro/Pages | Build-emitted `public/**/*.md` |
| **B Content collection** | Astro collections / MDX | Source MD/MDX (not HTML scrape) |
| **C DB-dynamic** | OpenNext/Hono + D1/Turso | Same loaders as HTML; cache aggressively |
| **D SPA + API** | Vite SPA shells | Curated `llms.txt` + API resource MD — never empty shells |

Detect: collections → B; OpenNext/Hono HTML → C; pure static → A; Vite SPA → D.

## Stack injection points

| Stack | Where to inject |
|---|---|
| OpenNext Worker | Prepend agent handler in `worker.mjs` **before** `openNext.fetch` |
| Hono + assets | Hono routes **before** SPA fallback (`run_worker_first`) |
| CF Pages | Build emit + optional `functions/_middleware.ts` for negotiation |
| Astro static | `adapter-astro-build` emits `.md` + `llms.txt` into `public/`/`dist/` |

**SPA rule:** agent paths must win over `not_found_handling: single-page-application`.
A file in `public/llms.txt` is worthless if the SPA catch-all returns HTML 200.

## Content rules

1. Markdown is the public product truth — same claims as HTML.
2. Prefer source→MD (collections, loaders) over HTML→MD conversion.
3. Auth/private surfaces stay out of indexes; declare them in `/api/ai.auth`.
4. SPA shells must say they are shells and point at APIs.
5. `llms.txt` = map; page MD / `llms-full` = substance.
6. Huge corpora use indexes + deep links — do not dump millions of entities to the edge.

## JSON-LD structured data

Every public product homepage ships a `@graph` JSON-LD block with:

1. **Organization** — fleet publisher (SaaS Maker / Foundry), `sameAs` → hub URL + GitHub repo
2. **WebSite** by default, or an eligible application type — the product node with `name`, `url`, `description`, `publisher` ref, and optional `applicationCategory` / `offers`

The block is generated from `agent-surfaces-registry.json` by
`apply-agent-surfaces.mjs --jsonld` and injected into each product's head file
(layout, index.html, or app.html). A marked comment block
(`<!-- fleet-jsonld:start/end -->`) wraps the injection for idempotent re-runs.

### Registry fields

| Field | Required | Purpose |
|---|---|---|
| `headFile` | yes (text-injectable) | Path to the head file (layout, index.html) |
| `schemaType` | yes | Prefer `WebSite`; application types require real `aggregateRating` or `review` evidence |
| `sameAs` | recommended | Array of canonical URLs (GitHub repo, etc.) |
| `applicationCategory` | optional | e.g. `DeveloperApplication`, `EntertainmentApplication` |
| `offers` | optional | Schema.org Offer object (price, currency, availability) |
| `searchUrlTemplate` | optional | Real search URL template for `WebSite` markup, including `{search_term_string}` |

`WebSite` entries only emit a `SearchAction` when `searchUrlTemplate` is set.
Do not advertise a site-search action for products that do not provide one.

### Injection modes

| Mode | Products | How |
|---|---|---|
| **Text injection** | Astro layouts, HTML files | `--jsonld` inserts marked block before `</head>` |
| **JSX snippet** | Next.js layouts (.tsx) | `--jsonld-emit` generates snippet; insert by hand |
| **Manual** | Starlight, no-src sites | Copy JSON from `foundry/ops/out/jsonld/<id>.json` |

```bash
# Dry-run (print JSON + would-be action, no writes)
node scripts/apply-agent-surfaces.mjs --jsonld --dry-run

# Inject into all text-injectable head files
node scripts/apply-agent-surfaces.mjs --jsonld

# Emit standalone snippet files for JSX layouts
node scripts/apply-agent-surfaces.mjs --jsonld-emit
```

### Safety checks

The injector verifies after each write:
1. **Parse-back** — re-extract the marked block and `JSON.parse` the script contents
2. **Head balance** — `</head>` count in the written file matches the original
3. **Restore-on-fail** — if any check fails, the original file is restored

### Audit

The `jsonld` column in `agent-index-audit.mjs` reports (bonus, not required for
S-tier): fleet-marked block presence, `@graph` structure, Organization +
SoftwareApplication/WebSite nodes, and valid JSON count.

## Audit

```bash
# one origin
node skills/agent-ready/scripts/agent-index-audit.mjs https://rolepatch.com

# all fleet health-contract prod URLs
node skills/agent-ready/scripts/agent-index-audit.mjs --all
```

External isitagentready.com scans remain optional; the local auditor is the
fleet gate (no rate limits, SPA-fake detection).

## Roll-out order

1. Kit + auditor (fleet-ops)
2. Pilots: protein-index (D, fix SPA llms), codevetter (A), materia (B), high-signal (C)
3. OpenNext bulk via `worker.mjs`
4. Remaining static exports + SPA honesty
5. Sub-products / dynamic completeness + CI smoke

## References in-fleet

- Karte skill stack: `karte/src/lib/karte-agent-skill.ts`
- Docs corpus generator: `saas-maker/apps/docs/scripts/generate-llms-txt.mjs`
- Accept negotiation: `significanthobbies/src/app/llms-full.txt/route.ts`
- GEO checks: `high-signal/workers/api/src/lib/seo-audit.ts`
