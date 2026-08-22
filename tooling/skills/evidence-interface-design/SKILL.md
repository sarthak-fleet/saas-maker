---
name: evidence-interface-design
description: Shape, audit, specify, or implement evidence-heavy web interfaces such as reports, benchmarks, comparisons, dashboards, scorecards, calculators, ROI tools, and decision pages. Use when facts, formulas, units, sources, uncertainty, visual encoding, or fast-versus-audit reading paths must remain trustworthy while the interface makes a conclusion or decision clear. Produces a project-native evidence and composition contract without importing another brand system.
---

# Evidence interface design

Make the evidence easier to understand without changing what it means.

## 1. Establish authority and scope

Read the nearest project instructions, `PROJECT_STATUS.md`, relevant
`PRODUCT.md` and `DESIGN.md`, incumbent interface, real content, and supplied
source material. Read [the evidence contract](references/evidence-contract.md).

For meaningful visual implementation, invoke `design-workflow` before editing.
Use Impeccable for general direction, craft, critique, polish, and audit. This
skill owns evidence framing, information architecture, encoding, and
interactive-model integrity.

If the request is analysis, audit, or specification only, remain read-only and
stop with the contract's compact output.

## 2. Frame the reader's decision

Before choosing a layout, establish:

- who opens the surface, in what context, to understand or decide what;
- the strongest answer the material actually supports;
- the evidence that earns that answer;
- the caveat, uncertainty, or limit that could change its interpretation;
- the detail that must remain available for audit without leading the first read.

If an unknown could change commercial meaning, privacy, security or legal
claims, formulas, units, populations, periods, recommendations, approvals, or
calls to action, ask one bounded group of questions. Otherwise omit it or label
the gap honestly and continue.

## 3. Normalize the evidence

Build the contract's claim ledger before visualizing. Preserve supplied facts,
formulas, units, precision, periods, populations, comparison bases, qualifiers,
sources, and privacy constraints. Distinguish observation, derivation,
projection, recommendation, and causation instead of presenting them as one
kind of truth.

Order the interface by reader questions, not source-document order. Support a
fast path through the answer and decisive evidence plus an audit path through
exact records, assumptions, methods, caveats, and sources. Give every material
claim one primary evidence home; repeated appearances must serve a different
reader task.

## 4. Choose composition and encoding

Make the central relationship, decision, or working tool—not merely the title
or atmosphere—the first viewport's memorable object. Within the approved visual
direction, compare two structural hypotheses privately when topology is
materially open. Change hierarchy, density, sequence, or evidence placement,
not just styling. Do not use this comparison to bypass overhaul approval.

Choose geometry before components. Use:

- prose for one conclusion or interpretation;
- tables for precise lookup;
- charts only when a relationship becomes faster to understand visually;
- aligned comparisons for qualitative alternatives;
- diagrams for process, sequence, or dependency;
- interaction when changing an assumption is itself the reader's job.

Do not manufacture confidence with decorative charts, repeated metric cards,
fake precision, cropped scales, or unsupported recommendations. Use the
contract's encoding and accessibility rules.

## 5. Model interactive evidence explicitly

Before implementing a calculator or interactive model, define one canonical
state model: variables, fixed inputs, formulas, units, full precision, ranges,
increments, defaults, display precision, dependencies, invalid states, and
fallback behavior.

One control owns each variable. Pre-render a useful default. Update dependent
results atomically from full-precision state, then format for display. Preserve
invalid entries and the last valid result rather than silently clamping or
substituting a default.

## 6. Implement and validate

Preserve the host framework, routes, components, tokens, content, analytics,
and established visual direction. Adapt external principles without copying
brand assets, proprietary code, token systems, or a fixed house style. Do not
add a production dependency without explicit approval.

Render and inspect the first viewport, full surface, required Fleet widths,
supported themes and states, long and missing content, semantics, focus,
reading order, and text alternatives. Confirm that visual salience matches the
strength of the evidence and that removing decoration does not weaken meaning.
Run the smallest relevant project check and finish meaningful visual work
through the active design-review receipt.
