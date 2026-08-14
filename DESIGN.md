---
name: Portfolio Project Strip
description: A neutral, compact discovery rail that inherits its host product.
colors:
  focus: "#2563eb"
  light-surface: "#fafaf9"
  light-text: "#292524"
  light-muted: "#6f6964"
  light-border: "#e7e5e4"
  dark-surface: "#171717"
  dark-text: "#f5f5f4"
  dark-muted: "#a8a29e"
  dark-border: "#30302f"
typography:
  label:
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "0.12em"
  link:
    fontSize: "0.8125rem"
rounded:
  control: "0.25rem"
spacing:
  compact: "0.5rem"
  standard: "1rem"
components:
  pause-control:
    textColor: "{colors.light-muted}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.45rem"
---

# Design System: Portfolio Project Strip

## Overview

**Creative North Star: "The Quiet Colophon"**

The strip behaves like a restrained colophon attached to many different host
products. Its identity comes from compact typography, hairline separation, and
steady lateral movement; it does not import a competing brand world.

**Key Characteristics:**

- Neutral defaults that inherit the host's current color.
- Compact, readable density with no logos or decorative assets.
- Motion that is slow, interruptible, and never required for comprehension.

## Colors

Auto mode inherits the host foreground and derives soft surface, muted, and
border roles. Explicit light and dark modes use the normative frontmatter
tokens. The focus color is reserved for keyboard visibility.

**The Host Leads Rule.** Consumer custom properties outrank the bundled light,
dark, and auto defaults.

## Typography

Use the host font stack. The label is compact, semibold, uppercase metadata;
project links remain ordinary readable text rather than adopting a display
voice.

## Layout

The component is one horizontal rail at wide and intermediate widths. At 560px
and below, metadata stacks above a full-width track. The moving sequence uses
two identical halves with no internal track padding so its loop has no visual
jump.

## Elevation & Depth

The surface is flat. Hairline block borders establish separation; shadows and
floating cards do not belong to the base component.

## Shapes

Corners are used only for focusable controls and links. The strip itself stays
rectilinear so it can join a footer without looking like an inserted card.

## Components

### Portfolio strip

- The label and pause control form one compact metadata group.
- The project track clips at soft masked edges and pauses on hover, focus, or
  explicit user request.
- Duplicate links are hidden from assistive technology and removed from the tab
  order.
- Lists of two or fewer projects are static.

## Do's and Don'ts

### Do:

- **Do** preserve semantic anchors and an explicit accessible name.
- **Do** expose motion control and a static reduced-motion presentation.
- **Do** keep consumer-facing color and spacing roles overrideable.

### Don't:

- **Don't** add logos, analytics, runtime storage, or a product-specific visual
  identity to the shared component.
- **Don't** make network success or animation necessary to discover projects.
- **Don't** add card chrome around the rail.
