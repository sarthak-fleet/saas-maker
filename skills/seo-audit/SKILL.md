---
name: seo-audit
description: Subskill of site-health — on-page SEO audit (title/meta/canonical/OG/hreflang/JSON-LD/sitemap/headings/alt/SSR leaks) for any URL list. Route here from site-health for "check my SEO" requests.
metadata:
  short-description: On-page SEO audit (meta, OG, canonical, hreflang, JSON-LD, sitemap, headings, alt, SSR leaks)
---

# seo-audit — on-page SEO audit

Subskill of `site-health` — invoked directly or via the parent router.

Run a consistent on-page SEO audit against any URL or list of URLs.
Covers the checks that matter for search engines and AI crawlers alike:
meta tags, structured data, sitemap coverage, heading hierarchy, image
alt text, and SSR leak detection.

## When to use

- "Audit SEO for <url>"
- "Check my pages for SEO issues"
- "Is <url> SEO-healthy?"
- "Review meta tags / structured data / hreflang for <url>"
- Before launching a new marketing surface
- Before deploying changes to a public page
- As part of a fleet audit alongside `psi-swarm` (perf) and `agent-ready` (AI crawler readiness)

## How to invoke

### Single URL

```bash
bash skills/seo-audit/scripts/seo-audit.sh <url>
```

Example:

```bash
bash skills/seo-audit/scripts/seo-audit.sh https://vaultwealth.com/
```

### Multiple URLs (file, one per line)

```bash
bash skills/seo-audit/scripts/seo-audit.sh <url-file>
```

Example:

```bash
# audit all main nav pages
cat <<'EOF' > /tmp/vault-urls.txt
https://vaultwealth.com/
https://vaultwealth.com/plan/
https://vaultwealth.com/invest/
https://vaultwealth.com/save/
https://vaultwealth.com/fees/
https://vaultwealth.com/team/
https://vaultwealth.com/about/
https://vaultwealth.com/resources/
EOF
bash skills/seo-audit/scripts/seo-audit.sh /tmp/vault-urls.txt
```

### Site-level checks (sitemap + robots)

Pass `--site <origin>` to also run site-level checks (sitemap discovery,
robots.txt parse, sitemap-vs-canonical coverage):

```bash
bash skills/seo-audit/scripts/seo-audit.sh https://vaultwealth.com/ --site https://vaultwealth.com
```

## What it checks

### Per-page checks (every URL)

| Check | What it tests | Pass condition |
|---|---|---|
| **title** | `<title>` present | Non-empty, 30-60 chars |
| **meta-description** | `<meta name="description">` present | Non-empty, 70-160 chars |
| **canonical** | `<link rel="canonical">` present | Self-referencing or valid absolute URL |
| **og:title** | Open Graph title | Present, non-empty |
| **og:description** | Open Graph description | Present, non-empty |
| **og:image** | Open Graph image | Present, valid URL |
| **twitter:card** | Twitter card type | Present (`summary` or `summary_large_image`) |
| **hreflang** | Alternate language tags | Present on multi-language sites; bidirectional; has `x-default` |
| **json-ld** | Structured data blocks | At least one valid JSON-LD block; application rich-result markup includes `aggregateRating` or `review` |
| **h1** | Primary heading | Exactly one `<h1>`, non-empty text |
| **h2** | Section headings | Present (not zero); no skipped levels (no `<h4>` without `<h3>`) |
| **img-alt** | Image accessibility | All `<img>` tags have non-empty `alt` |
| **word-count** | Text content volume | Above 300 words (thin-content floor) |
| **ssr-leak** | Unrendered template literals | No `${`, `{{`, `<%=` in served HTML |
| **broken-internal-links** | Internal href integrity | No hrefs containing template placeholders or empty hash |

### Site-level checks (with `--site`)

| Check | What it tests | Pass condition |
|---|---|---|
| **robots.txt** | Exists and is parseable | 200, has `User-agent` directives |
| **sitemap** | Sitemap referenced in robots.txt | `Sitemap:` directive present, URL resolves |
| **sitemap-coverage** | Canonical URLs in sitemap | All audited page URLs appear in sitemap |

## Output

The script prints a per-page report with pass/fail/warn per check and a
summary line. Exit code is non-zero if any page has a failing check.

```
===== https://vaultwealth.com/ =====
  title              PASS   "Fee-Only Private Wealth Management in the UAE | Vault" (58 chars)
  meta-description   PASS   "Vault is an FSRA-regulated, fee-only private wealth advisor..." (118 chars)
  canonical          PASS   https://vaultwealth.com/
  og:title           PASS
  og:description     PASS
  og:image           PASS   https://cdn.vaultwealth.com/website_assets/banner170125.png
  twitter:card       PASS   summary_large_image
  hreflang           PASS   3 alternates (en-AE, ar-AE, en-SA) + x-default
  json-ld            PASS   2 blocks (Organization, FAQPage)
  h1                 PASS   "You've outgrown simple investing"
  h2                 PASS   10 h2s, no skipped levels
  img-alt            FAIL   17 of 33 images missing alt
  word-count         PASS   ~6922 words
  ssr-leak           PASS   no template literals found
  broken-links       PASS   no broken internal links

  → 13/14 checks passed, 1 FAIL

===== SUMMARY =====
  8 pages audited
  104 checks passed, 7 failed, 3 warnings
  Pages with failures: / (img-alt), /invest/ (img-alt), /resources/ (ssr-leak, broken-links)
```

## Interpretation

- **FAIL** = the check found a real SEO problem (missing tag, broken
  href, SSR leak). Fix before launch or deploy.
- **WARN** = the check found something suboptimal but not broken (title
  too long, no hreflang on a single-language site, og:image shared
  across pages). Fix when convenient.
- **PASS** = the check passed.

Common patterns:
- **img-alt failures** on marketing pages are usually decorative images
  that got `alt=""` or no alt at all. Add descriptive alt.
- **ssr-leak** means the server is emitting unrendered JS template
  literals (`${t.url}`, `{{var}}`) into the HTML — an SSR/hydration bug
  that gives crawlers broken hrefs and garbage text. **Highest-priority
  fix** because it produces broken links in search results.
- **Missing hreflang** on a multi-language site means Google may serve
  the wrong language version. Check that every page has bidirectional
  hreflang to its translated counterparts.
- **Shared og:image** across all pages means social shares all look the
  same. Add page-specific preview images for high-traffic pages.

## Fleet usage

To audit a fleet product, read the production URL from the project's
`PROJECT_STATUS.md` (Products section) or from the canonical
`foundry/ops/config/projects.json` manifest.

To audit all fleet products' main pages:

```bash
node skills/seo-audit/scripts/seo-audit-fleet.mjs --all
```

This reads the canonical visibility inventory, audits every primary homepage,
and updates the bounded artifact consumed by the combined site-health
scorecard. Use `--id <project>` for one product or `--json` for structured
output.

## Relationship to other skills

| Skill | Covers |
|---|---|
| **psi-swarm** | Performance (Lighthouse, Core Web Vitals, LCP/CLS/TBT) |
| **agent-ready** | AI crawler discoverability (robots.txt AI rules, sitemap, llms.txt, MCP) |
| **seo-audit** | On-page SEO (meta, structured data, headings, alt, hreflang, SSR leaks) |

Run all three before launching or deploying a marketing surface.
