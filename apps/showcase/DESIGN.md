# SaaS Maker public directory

## Direction

The public directory is a sunlit product workshop expressed as a black
steel-framed glass wall. Clear panes carry the studio story, seeded glass holds
supporting material, and three saturated panes—cobalt, amber, and oxblood—mark
work that deserves attention. The system should feel architectural and
handmade, not translucent app chrome.

## Color and material

- Limestone ground: `#eee8dc`
- Clear pane: `rgba(250, 247, 239, 0.88)`
- Seeded pane: `#ddd6c7`
- Steel: `#11120f`
- Ink: `#141511`
- Muted ink: `#5f5d55`
- Cobalt: `#1746a2`
- Amber: `#c9820d`
- Oxblood: `#7b211c`
- Pale line: `rgba(20, 21, 17, 0.2)`

Pane color is structural, not decorative. A saturated pane owns a whole
product or interaction state; do not scatter accent-colored text across the
page.

## Typography

Use Schibsted Grotesk throughout. Character comes from large, calm grotesque
type inside hard architectural proportions, not from switching to a display
serif. Keep display tracking above `-0.04em`, body copy at or above `1rem`, and
long prose near 70 characters.

## Layout

Compose public product discovery as a wall elevation. Matte-black mullions
separate unevenly proportioned panes; each pane carries one statement or
destination. The homepage first viewport pairs one large studio pane with four
featured product panes. Supporting products become disciplined specimen rows
rather than cards.

Product detail pages inherit the same workshop world: one clear identity pane
shares a steel frame with a saturated canonical-product action, while public
evidence becomes a run of specimen panes. On narrow screens, bays restack into
one column while preserving bar thickness and reading order. Learning and legal
pages remain quieter reading surfaces until their own redesign.

The changelog is the workshop ledger: a clear editorial pane shares the first
frame with one cobalt explanation pane, then dated milestones alternate seeded
date bays with quiet reading bays. Oversized ledger numbers expose chronology
without replacing semantic dates.

## Imagery

One editorial photograph of a real-feeling glazier's atelier supplies physical
light and depth. It remains atmosphere behind semantic HTML, never a rasterized
interface. Avoid generic abstract gradients, fake product screenshots, doodles,
and decorative glass blur.

## Motion

The wall arrives once: clear panes brighten, then the saturated panes settle
into full color. Hover and focus backlight one pane without translating the
layout. Disable nonessential motion under `prefers-reduced-motion`.
