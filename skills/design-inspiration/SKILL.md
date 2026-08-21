---
name: design-inspiration
description: Research, compare, and visualize attributable design directions for web interfaces. Use for landing pages, product surfaces, dashboards, component families, interaction languages, multiple UI concepts, compact brand-direction boards, or Fleet overhaul evidence, including temporary code probes when static evidence cannot show interaction or responsive behavior. Produces transferable principles and design-workflow receipt inputs without copying another product's brand, content, assets, or proprietary implementation.
---

# Design inspiration

Find evidence for a direction, not a collage of attractive screenshots.

## 1. Establish the search frame

Read the nearest project instructions and the relevant `PRODUCT.md`,
`DESIGN.md`, surface brief, tokens, incumbent UI, and real content. State:

- surface and user outcome;
- preserve or overhaul lane when `design-workflow` is active;
- desired qualities and explicit anti-qualities;
- platform, viewport, content, brand, accessibility, and performance limits.

If meaningful implementation is also requested, invoke `design-workflow`
before changing UI. Research-only work does not need a review receipt.

## 2. Choose the evidence output

Choose the smallest output that resolves the decision:

- **Reference brief:** attributable sources, anti-references, and project-native
  principles; default for research-only work.
- **Direction set:** two or three materially different concepts using the same
  real content and evaluation scenario. Vary composition, hierarchy,
  typography, density, color role, and interaction thesis—not superficial
  palettes on one template.
- **Brand board:** one compact visual board with two representative product
  contexts plus legible typography and semantic color guidance. Generate it
  only when the user asks for a visual identity artifact; otherwise return the
  direction in text.

## 3. Search broadly, then narrow

Read [the research contract](references/research-contract.md). Use current web
research and the parent [source map](../design-engineering/references/source-map.md)
to discover candidates. Search by the actual interaction, content type,
audience, and mood rather than only by product category.

Survey enough candidates to reveal patterns, then keep only two or three
material references. Prefer original product pages and primary explanations.
Record source URL, access date, relevant surface, and why it matters. Verify
drift-prone availability, account, price, and license claims before reporting
them as current.

## 4. Extract principles

For each retained reference, separate:

- transferable hierarchy, composition, density, rhythm, typography, color,
  motion, interaction, and responsive behavior;
- project-incompatible styling, content, assets, or behavior;
- the principle to test in a project-native direction probe.

Name at least one anti-reference or failure mode. Do not copy brand styling,
marketing copy, proprietary code, protected assets, or an entire visual
language. Generated direction probes are new interpretations, not screenshots
to trace.

## 5. Build code probes only when necessary

Use static direction probes unless interaction or responsive behavior is the
decision. When the owner requests or approves working probes for an overhaul:

1. Create two or three materially different probes with the project's existing
   stack, tokens, components, assets, and representative content.
2. Put them behind one temporary comparison surface or switcher that is absent
   from production navigation, analytics, search indexing, and normal user
   journeys.
3. Give every probe the same content and evaluation scenario. Label the
   direction, not the reference it interprets.
4. Do not add a production dependency or silently change protected routes,
   navigation labels, form structure, analytics identifiers, or legal copy.
5. Record probe ids and paths in the existing design-review receipt and obtain
   the normal owner selection or delegation.
6. After selection, integrate the chosen direction into the real surface and
   remove the comparison scaffold and rejected probes. If the owner explicitly
   retains the comparison surface, record that product decision.

Before completion, verify that no temporary route, navigation entry, analytics
event, build artifact, or unreachable probe remains.

Use Impeccable `live` only to compare variants of one selected element on an
already running surface. Do not use it as the frame for broad page or brand
directions; use the direction-set contract above.

## 6. Generate a brand board only when requested

1. Define the product idea, audience, visitor mode, identity thesis, confirmed
   assets, typography strategy, semantic color roles, image or texture
   language, and explicit anti-patterns before generating.
2. Verify font availability and licensing before recommending a specific
   family. Treat named brands as principle references, never as styles to
   reproduce.
3. Load the installed imagegen skill and generate one new board containing two
   distinct, realistic product contexts plus compact, readable type and color
   guidance. Use representative content; do not trace a reference or invent
   product claims.
4. Treat the board as a north star for hierarchy, composition, density, and
   visual language—not a screenshot specification. Record its path as direction
   evidence and retain the text contract alongside it.
5. When the board implies a new or replacement identity, keep the overhaul
   lane blocked until the owner selects it or explicitly delegates the choice.

## 7. Hand off the evidence

Return the compact output defined in the research contract. When an active
overhaul receipt exists, place only the two or three final reference names in
`direction.references` and keep generated probe paths in `direction.probes`.
Do not put source screenshots in the probe fields or create a second approval
ledger. For a requested brand board, include the board path and its text
contract with the normal direction evidence; the board is not approval.

Stop after evidence and a recommended next decision unless the user also asked
for probes or implementation. Do not present research as owner approval.
