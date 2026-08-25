# AI Chat Footer design

## Direction

The footer is a compact utility panel, not a second product hero. It should
read as two deliberate groups when composed: an AI shortcut first and a quiet
"More from the studio" discovery strip second.

## Hierarchy

1. A small AI-shortcut eyebrow establishes the role.
2. A semantic heading names the product-specific action.
3. One sentence explains what will happen.
4. Labelled provider buttons present equal choices with 44px touch targets.

Provider actions use a consistent framed-icon treatment and visible names.
Wide layouts use a deliberate three-plus-two composition. Narrow layouts use
two columns and center an unpaired final provider.

## Host integration

Inherit the host's text color and typography. Use `currentColor`, subtle mixed
borders and surfaces, and a configurable focus color. Do not introduce a new
brand palette, full-height footer, background image, or decorative animation.

The composed extension uses one vertical split on wide screens and stacks the
AI block above project discovery at 760px and below. It must not create page
overflow at 390, 768, or 1440 pixels.

## Accessibility and motion

- Use a labelled region and semantic heading.
- Keep provider names visible and provider icons decorative.
- Preserve visible keyboard focus and external-link semantics.
- Keep every provider action at least 44px tall.
- Respect the project strip's reduced-motion, touch, and keyboard behavior.
