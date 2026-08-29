# Web product landing template

**This is the canonical starting point for a Fleet web landing page.** Use it
for a web product, developer tool, internal utility, or dashboard that needs a
clear public first view without phone screenshots.

There is no second web starting point. The copy-to-fork iOS template that used
to sit beside this one is [retired](../ios-landing/DEPRECATED.md); iOS product
pages are built by the shared `ios-landings` factory instead. Those two are the
whole candidate engine set — see
[the landing-surface classification](../../docs/landing-surface-classification.md)
for which products are moving to which, and for what a product must show before
a bespoke landing page is the right answer.

The template is deliberately small:

- one product claim and one primary action;
- a real or clearly labelled illustrative product artifact;
- three concrete capabilities instead of a generic feature wall;
- an explicit product boundary;
- a product-owned footer followed by one compact Ask AI utility dock.

Copy it into a product repo as `landing-astro/`, then replace every example
field in `src/site.config.ts`. Product repositories own their copies and stay
independently buildable; this directory is a starting point, not a runtime
dependency.

Before you copy: a product with a working dashboard, search form, or catalog
usually does not need a new `landing-astro/` at all. Frame the real application
as the proof artifact on the page it already has.

```bash
cp -R saas-maker/tooling/templates/web-landing /path/to/product/landing-astro
cd /path/to/product/landing-astro
pnpm install
pnpm build
```

## Preservation rules

1. Inventory existing routes, actions, copy, analytics, and authenticated app
   boundaries before changing the landing page.
2. A dashboard may be the proof artifact. Do not replace a working app with a
   marketing-only shell.
3. Keep a product's authored footer, then load the AI footer once below it.
4. Do not invent screenshots, customers, usage numbers, availability, or
   integrations.
5. Validate the first view and footer at 390, 768, and 1440 pixels.

## Shape, not sameness

The reusable part is the information hierarchy, accessibility floor, spacing
system, and bottom-dock behavior. Typography, color, artifact, voice, and
section order should continue to belong to the product.
