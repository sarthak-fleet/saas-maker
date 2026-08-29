# Retired: the copy-to-fork iOS landing template

**Status: retired 2026-08-30.** This directory no longer contains a template.
Do not copy anything from here.

## Use the factory instead

iOS product landing pages are built by the shared factory
`Significant-Hobbies/ios-landings`. It renders one site per config directory
from a single page engine, so a new product gets a finished landing page from
configuration and real screenshots — without adding another codebase to
upgrade.

To add a product:

1. Create `products/<id>/` in the `ios-landings` checkout.
2. Fill its domain, design tokens, copy, screenshots, and distribution links.
3. Build and verify that product site from the factory root.

Per-product identity — domain, tokens, copy, screenshots, App Store and
TestFlight links, privacy and support routes — still belongs to the product.
Convergence means one engine, not one appearance.

## Why it was retired

The old `README.md` here instructed `cp -R … /path/to/app/site`. Every use
produced a divergent bespoke copy that then had to be upgraded on its own
schedule, which is the behaviour `sass-maker/saas-maker#62` set out to end.
Nothing in this repository referenced the template, and the two preserved
scripts that mention it (`preserved/legacy-fleet-tooling/scripts/`
`scaffold-ios-landing.sh` and `sync-ios-landing.sh`) already resolve a
`foundry/ops/templates/ios-landing` path that no longer exists; they are
noncanonical history and were left untouched.

The Apple marketing rules the old README carried — real screenshots only,
no invented App Store badge or Smart App Banner, first-class privacy and
support routes, `testflight.apple.com` links only — are properties of the
factory's page set, not of this directory.

## Recovering the old source

The full 27-file template is in history:

```bash
git show 3cb20d4b:tooling/templates/ios-landing/README.md
git checkout 3cb20d4b -- tooling/templates/ios-landing
```

Recover it only to read it. Restoring it as a live starting point re-creates
the problem.

## Web products

Web products, developer tools, and dashboards start from
[`../web-landing`](../web-landing/README.md), the canonical web starting point.
