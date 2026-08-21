---
name: design-workflow
description: Use for meaningful Fleet frontend work that creates or changes visual language, layout, navigation, interaction patterns, responsive behavior, theming, reusable components, landing pages, dashboards, app shells, or substantial UI polish. Covers new UI, component extraction, dark mode, and device adaptation by routing to Impeccable and imagegen while preserving direction alignment, browser evidence, quality gates, and owner feedback. Skip copy-only edits, invisible refactors, and trivial CSS corrections.
---

# Fleet design workflow

Use Impeccable for design mechanics. Use this skill for Fleet's approval and
shipping contract. Project `PRODUCT.md` and `DESIGN.md` outrank generic
component, palette, or detector recommendations.

## 1. Classify

Choose exactly one lane before implementation:

- `preserve`: keep the established visual language. Capture a before
  screenshot, follow existing design context, and do not manufacture alternate
  directions.
- `overhaul`: create or materially replace a visual language. Name 2-3 concrete
  references and anti-references, generate 2-3 materially different direction
  probes, and stop until the owner approves one or explicitly delegates the
  choice.

If `PRODUCT.md` or `DESIGN.md` is missing, run `$impeccable init` before
meaningful work. Do not initialize untouched projects fleet-wide.

Create the receipt:

```bash
node scripts/design-workflow.mjs create \
  --project <project-root> \
  --mode <preserve|overhaul> \
  --register <brand|product> \
  --target "<surface>"
```

When invoked inside an independent child repo, call the same script through the
relative Fleet root.

## 2. Shape and build

- Preserve: use the tracked system and before evidence as the contract.
- Overhaul: record reference names, probe ids/paths, selected probe, and
  `approved` or `delegated` in `.fleet/design-review.json` before code.
- For reference research, unfamiliar components, web 3D, creative browser
  effects, or evidence-heavy interfaces, route through
  `../design-engineering/SKILL.md` and load only its matching child skill. Treat
  the child output as evidence and implementation guidance;
  this skill remains the completion authority.
- Do not copy another system's brand styling, tokens, assets, proprietary code,
  or whole visual language. Record material references and anti-patterns when
  they influence a direction; project `PRODUCT.md`, `DESIGN.md`, and existing
  components remain authoritative.
- Use real product content and assets. Do not substitute a component-gallery
  aesthetic for project identity.
- Invoke the narrowest Impeccable workflow that owns the job:
  - new UI: use `$impeccable shape` when the brief is unresolved, then follow
    Impeccable's ordinary new-work route after confirmation;
  - reusable components or tokens: use `$impeccable extract`, preserve rendered
    behavior and public APIs, migrate every caller, and run focused checks;
  - dark mode: use `$impeccable colorize`, define semantic roles for surfaces,
    text, actions, focus, borders, status, overlays, and every interaction state,
    and compose rather than mechanically invert the light theme;
  - phone, tablet, or desktop adaptation: use `$impeccable adapt`, choose
    content-driven breakpoints, preserve core capability, and validate reflow,
    navigation, forms, tables, text size, touch targets, overflow, and input
    methods.
- For a raster asset that needs a dark-mode counterpart, first load the
  installed imagegen skill and require the source image to be attached or
  locally available. Retain the original, create a distinct variant, preserve
  dimensions, composition, important content, softness, fades, transparency,
  and interface purpose, and inspect it on its intended dark surface. Do not
  substitute a blanket CSS filter.
- For multiple directions or a visual brand board, route through
  `../design-inspiration/SKILL.md`; research, probes, or generated boards are
  direction evidence, not owner approval.

## 3. Review

Before completion:

1. Inspect the running surface in a browser.
2. Capture after screenshots at 390, 768, and 1440 pixels.
3. Run `$impeccable critique`, fix all P0/P1 findings, then run
   `$impeccable polish` and `$impeccable audit`.
4. Run the project's smallest relevant build/check.
5. Fill the receipt with evidence paths, scores, unresolved counts, and check
   command.

The minimum floors come from
`foundry/ops/config/design-workflow.json`: critique 32/40, audit 16/20, and zero
unresolved P0/P1. Scores are floors, not proof of taste.

Detector findings are advisory. Record them, but never rewrite an intentional
`DESIGN.md` decision only to silence an aesthetic heuristic.

## 4. Close with owner feedback

Ask for one final decision:

- `keep`: accepted;
- `close`: direction is near but needs another iteration;
- `wrong-lane`: return to direction selection;
- `delegated`: the owner explicitly delegated final judgment.

Only `keep` or `delegated` can pass. Preserve the note in the receipt so the
next design pass can learn from it.

Validate:

```bash
node scripts/design-workflow.mjs check --project <project-root>
```

Do not claim the meaningful visual change is complete until this command
passes. Report the lane, evidence, scores, owner decision, and any advisory
detector findings.
