---
name: design-engineering
description: Route focused UI and design-engineering work through Fleet's existing skills. Use for new UI, multiple design directions, brand boards, component extraction, Tailwind class cleanup, dark-mode UI or raster variants, responsive adaptation, semantic markup from screenshots, visual-reference research, component pattern mining, web 3D, creative effects, or evidence-heavy interfaces. Complements design-workflow, Impeccable, and imagegen without replacing their craft or completion gates.
---

# Design engineering

Route the request to the smallest existing workflow. Read only the selected
skill or Impeccable playbook and its directly relevant references.

## Routing

| Primary job | Route |
|---|---|
| Shape or build new UI | `../design-workflow/SKILL.md`, then Impeccable `shape` or ordinary new-work |
| Generate or compare multiple design directions | `../design-inspiration/SKILL.md`; use Impeccable `live` only for variants of a selected element on a running surface |
| Create a compact visual brand direction | `../design-inspiration/SKILL.md`, then imagegen only when the user requests a board |
| Extract repeated UI into reusable components or tokens | `../design-workflow/SKILL.md`, then Impeccable `extract` |
| Sort, deduplicate, or resolve Tailwind classes | Follow **Canonicalize Tailwind** below |
| Add or repair dark-mode UI | `../design-workflow/SKILL.md`, then Impeccable `colorize` |
| Adapt a raster asset for dark mode | `../design-workflow/SKILL.md`, then imagegen with the source asset |
| Adapt UI across phone, tablet, and desktop | `../design-workflow/SKILL.md`, then Impeccable `adapt` |
| Reconstruct semantic markup from a screenshot, mockup, or wireframe | Follow **Markup from image** below |
| Find visual references, anti-references, or direction evidence | `../design-inspiration/SKILL.md` |
| Compare an unfamiliar component or interaction pattern | `../component-pattern-mine/SKILL.md` |
| Create, inspect, optimize, or integrate models, scenes, glTF, or real-time 3D | `../web-3d-pipeline/SKILL.md` |
| Shape, audit, discover, specify, or build animation, SVG, Canvas, shader, pointer, or scroll effects | `../creative-web-effects/SKILL.md` |
| Shape, audit, specify, or build an evidence-heavy report, benchmark, comparison, dashboard, calculator, or decision page | `../evidence-interface-design/SKILL.md` |

If a shader is part of a scene with models, cameras, or 3D interaction, route
through `web-3d-pipeline` first and hand its rendering boundary to
`creative-web-effects`. For other multi-job requests, order research before
implementation and state the handoff between child outputs.

## Direct workflows

### Canonicalize Tailwind

1. Confirm Tailwind is already declared and identify the exact class strings in
   scope. Read the project's Tailwind configuration, formatter or sorting
   plugin, class-merging helper, and representative local ordering first.
2. Use existing project tooling for ordering. Remove exact duplicates. Collapse
   shorthands or resolve conflicts only when variant, responsive, state, theme,
   importance, and source-order behavior is provably unchanged.
3. Preserve arbitrary values and variants, container queries, `group`/`peer`,
   `data`/`aria`, dynamic template fragments, and caller-supplied classes unless
   their equivalence is explicit. Do not add a formatter or dependency.
4. Inspect the diff, run the narrowest formatter, lint, typecheck, or build, and
   use browser evidence when a conflict or shorthand could affect rendering.

### Markup from image

1. Inspect the supplied image at sufficient resolution. Identify visible
   hierarchy, reading order, landmarks, controls, repeated content, and any
   semantics or behavior the pixels cannot establish.
2. Produce one unstyled structure in the project's existing HTML or JSX
   dialect. Use appropriate landmarks, heading order, lists, tables, labels,
   buttons, links, field relationships, and purposeful image alternatives.
3. Do not add CSS, utility classes, visual tokens, component extraction, hidden
   behavior, invented copy, or inaccessible placeholder controls. State the
   smallest assumptions or request missing evidence when semantics are binding.
4. Run the narrowest parse, type, or markup check available. Styling and
   reusable-component extraction remain separate, explicit follow-up work.

## Shared boundary

1. Read the nearest `AGENTS.md`, relevant project status, and existing
   `PRODUCT.md`, `DESIGN.md`, tokens, components, and assets before advising or
   editing.
2. For meaningful Fleet visual implementation, invoke `design-workflow` and
   keep its preserve/overhaul lane and review receipt authoritative.
3. Use Impeccable for shape, new-work craft, extraction, color, adaptation,
   critique, polish, and audit. Use imagegen only for requested visual boards or
   raster edits with the required source assets. Use child skills for
   specialized research and delivery mechanics.
4. Treat [the source map](references/source-map.md) as discovery help, not a
   trusted catalog. Verify drift-prone availability, pricing, licensing, and
   compatibility before relying on an external tool or asset.
5. Reuse the project's current stack. Do not add a production dependency, paid
   tool, or licensed asset without explicit approval.
6. Return planning and research inline by default. Do not create another status
   document or approval ledger.

## Toolchain diagnostics

When 3D or effects implementation needs local tooling, run the read-only
doctor from the Fleet root or resolve the same script through this skill's
installed base directory:

```bash
node skills/design-engineering/scripts/doctor.mjs \
  --project <project-root> --json
```

The doctor only inspects executable availability and declared package
dependencies. It does not install, execute, or modify any tool.

## Completion

- Research-only work ends with attributable findings, constraints, and a clear
  next decision; it does not claim that implementation shipped.
- Implementation work ends through the owning project's checks and, when the
  work is meaningful visual work, the `design-workflow` receipt.
- Record completed Fleet-owned skill runs through the installed
  `fleet-skill-run` boundary or supported host hook.
