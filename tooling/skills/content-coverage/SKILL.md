---
name: content-coverage
description: Audit whether a product has the SEO and search-intent pages expected in its category, find competitive content gaps, draft source-backed pages, and publish approved pages through the owning repository. Use for SEO article coverage, comparison/alternative/use-case/integration pages, content inventories, or requests to create missing durable search pages.
---

# Content Coverage

Produce an evidence-backed coverage verdict and complete page previews before
changing a repository or publishing.

The machine-readable runtime recommendation lives in
[`execution-profile.json`](execution-profile.json). Hosts map its capability
tiers to their own available providers and models.

## Workflow

1. Read the target repository's nearest `AGENTS.md`, root
   `PROJECT_STATUS.md`, product truth, content model, and git state.
2. Inventory the registry product:

   ```bash
   node skills/content-coverage/scripts/content-inventory.mjs --product <id> --json
   ```

   Use `--input <fixture.json>` for deterministic or offline work. Use
   `--live` only when current sitemap evidence is needed.
3. Browse current search results and leading competitors for the relevant
   customer intents. Record URL, query, archetype, and verification time.
4. Apply [coverage-model.md](references/coverage-model.md). Judge intent
   coverage, not an arbitrary article count. Check cannibalization and claims.
5. Draft every approved candidate page in full. Include title, description,
   slug, intent, outline/body, sources, internal links, schema, CTA, and claim
   ledger.
6. Build a `content_coverage` manifest with the shared CLI and show its complete
   preview:

   ```bash
   node scripts/campaign-manifest.mjs preview --manifest <path>
   ```

7. Stop for owner approval of the exact manifest hash. Follow
   [publishing.md](references/publishing.md) only after approval.
8. Before each write or publish action, run `campaign-manifest gate`. Record a
   receipt after confirmed completion. A changed manifest requires approval
   again.

## Boundaries

- Research and preview are read-only.
- Do not invent comparison claims, statistics, testimonials, or customer proof.
- Merge or refresh overlapping pages instead of creating keyword cannibalism.
- Repository writes, commits, pushes, and deploys are separate manifest items.
- If the product has no suitable article surface, preview a spec-driven change;
  do not silently add content infrastructure.
- Never publish from fixtures or treat a generated draft as verified product
  truth.
