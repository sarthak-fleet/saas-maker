---
name: geo-observatory
description: >
  Subskill of site-health — recurring GEO/SEO outcome measurement: probe
  configured queries on live web search, classify A/B/C, append to the
  ledger, regenerate the trend report. Route here from site-health for
  "did results move" and scheduled weekly runs.
---

# geo-observatory — fleet GEO outcome measurement

Subskill of `site-health` — invoked directly, via the parent router, or by the weekly routine.

You are recording **comparable, evidence-backed observations over time**.
Discipline matters more than cleverness: run the configured queries exactly,
classify coarsely, record honestly.

## Protocol

1. **Load config**: choose the scope named by the caller.
   - **Scheduled weekly scope**: load only the active queries in
     `site-health/apps/backend/config/root-search-queries.json`. This is the canonical ten
     roots × four intents contract; do not add the legacy all-project queries.
   - **Explicit broad/manual scope**: load
     `site-health/apps/backend/config/geo-observatory.json` plus the root contract.
   Never rephrase an existing query (`qid` history breaks); to track something
   new, ADD a query with a new qid and retain the old one as historical.
2. **Probe**: for each query in the selected scope, run live web search (WebSearch
   tool). Look at the top ~10 organic results. Use the configured query
   verbatim and record `query` with that exact text plus
   `"source": "web-search"`. Never substitute a scraper, cached SERP, generic
   fallback results, or another search provider's inferred answer. At least
   two captured results must plausibly answer or collide with the configured
   query. If the result set is plainly unrelated, rerun that query
   individually; if it remains unusable, fail the run rather than recording
   it.
3. **Classify** each query:
   - **A** — the product's own origin appears in the top 3 organic results.
   - **B** — the product has partial page-1 visibility: its own origin is
     below the top 3, or it is reachable only via sassmaker.com, GitHub, or a
     directory/aggregator.
   - **C** — the product is absent from the first page entirely.
   Record the top 2-3 result URLs as evidence and a one-line note (who owns
   the SERP, collisions, anything surprising). An empty result list is
   permitted only for class C when the note explicitly states that the exact
   query returned no organic results.
4. **Record**: write all entries to a temp JSON file
   (`[{date, product, qid, query, source: "web-search", class, top: [urls],
   notes}]`, date = today YYYY-MM-DD). For the scheduled weekly scope, require
   exactly 40 entries on the same date, then run:
   `node scripts/geo-observatory-record.mjs --root-search <file>`
   For an explicitly requested broad/manual scope, run:
   `node scripts/geo-observatory-record.mjs <file>`
   The script validates (unknown product/qid/class → rejected, nothing
   written). Root mode additionally rejects missing, duplicate, extra,
   historical, rewritten, or mixed-date entries. A valid batch regenerates
   `docs/geo-observatory-latest.md`.
5. **Commit + push** the ledger + report from the fleet root:
   Commit the changed ledger and report in the `site-health` repository.
   with message `geo-observatory: <date> run (<n> observations)`.
6. **Report to the user** (or the scheduled-run summary): the Movers section
   verbatim, plus anything that needs a decision (e.g. a collision worsened,
   a C that should be A given work already shipped — flag likely cause:
   not deployed? not indexed? blocked?).

## Rules

- Evidence over vibes: never classify without listing the top URLs seen.
- One observation per product/query per day (re-runs same day overwrite in
  the report, ledger keeps both — avoid re-running without reason).
- SERPs are noisy: a single-step change is signal only if it persists two
  runs; say so in the summary rather than announcing victory.
- Citation probes (Perplexity/ChatGPT APIs) are phase-2: only run if the
  relevant API key is available in the environment; never scrape engine UIs.
- Cost: one run should be one focused session — probe, classify, record,
  commit, summarize. Don't expand scope mid-run.
