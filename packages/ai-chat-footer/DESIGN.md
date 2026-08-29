# AI Chat Footer design

## Direction

The footer is a compact utility dock, not a second product hero. When the
portfolio strip is present, both surfaces form one restrained extension below
the product's authored footer: Ask AI first, project discovery second.

## Hierarchy

1. A framed sparkle mark and semantic heading name the product-specific action.
2. One sentence explains what will happen.
3. Compact provider artwork buttons present equal choices with 44px touch targets.

Provider actions use publisher-supplied artwork files without permanent text.
Provider names remain available to assistive technology and native tooltips.
Never redraw, recolour, trace, or substitute generic geometry, initials, or
lookalike marks. Provider colour stays inside its original artwork; labels,
borders, and surfaces inherit the host so the shared component does not become
a competing brand. Wide layouts keep the action copy and provider choices on
one row. Narrow layouts keep the five compact controls together beneath the
copy instead of expanding them into cards.

## Host integration

Inherit the host's text color and typography. Use `currentColor`, subtle mixed
borders and surfaces, and a configurable focus color. Do not introduce a new
brand palette, full-height footer, background image, or decorative animation.

The composed extension uses one split row on wide screens and stacks the AI
dock above project discovery at 760px and below. It must not create page
overflow at 390, 768, or 1440 pixels or become a second full-height footer.

## Accessibility and motion

- Use a labelled region and semantic heading.
- Give every icon-only provider action an accessible name and tooltip.
- Preserve visible keyboard focus and external-link semantics.
- Keep every provider action at least 44px tall.
- Respect reduced-motion preferences for the dock's subtle hover response.
