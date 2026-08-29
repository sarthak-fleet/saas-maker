---
name: design-engineering
description: "Use explicitly for isolated design-engineering mechanics that do not need end-to-end visual direction: Tailwind canonicalization, semantic markup reconstruction, or routing a specialized 3D, effects, component-pattern, or evidence-interface task. Meaningful UI implementation and visual direction belong to design-workflow."
---

# Design engineering

This is an explicit specialist helper, not the default design entry point. Route
only the isolated mechanical or specialist task requested. For meaningful UI
implementation, stop and use `../design-workflow/SKILL.md` as the sole design
authority.

## Allowed scope

- Sort, deduplicate, or resolve Tailwind classes: follow **Canonicalize
  Tailwind** below.
- Reconstruct semantic markup from a screenshot, mockup, or wireframe: follow
  **Markup from image** below.
- For an explicitly requested specialist job, point to the narrow child skill:
  `component-pattern-mine`, `web-3d-pipeline`, `creative-web-effects`, or
  `evidence-interface-design`.

Do not use this helper to choose a visual direction, shape a page, or complete
meaningful UI work. Those jobs belong to `design-workflow`.

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
