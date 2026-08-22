---
name: component-pattern-mine
description: Compare mature implementations of an unfamiliar web component or interaction pattern and turn them into project-adapted guidance. Use for command palettes, comboboxes, timelines, tables, editors, navigation, uploaders, multi-state controls, spatial UI, or any component whose anatomy, states, accessibility, responsive behavior, motion, or data boundary needs research before implementation.
---

# Component pattern mine

Mine behavior and anatomy. Do not import another system's visual language.

## 1. Check the project first

Read the nearest project instructions, design context, tokens, dependencies,
and representative components. Search for an existing primitive or adjacent
pattern before looking externally. If the project already establishes the
component, prefer extending it and explain why external research is still
needed.

For meaningful visual implementation, keep `design-workflow` authoritative and
use Impeccable for shaping and review. If the request is research-only, stop at
the pattern brief.

## 2. Define the behavior problem

Read [the component contract](references/component-contract.md). Establish:

- user job and context;
- content and data shape;
- required states and failure modes;
- keyboard, pointer, touch, screen-reader, and responsive needs;
- performance, virtualization, persistence, and latency constraints.

## 3. Compare mature implementations

Inspect two or three relevant implementations using current primary sources or
live browser evidence. The parent [source map](../design-engineering/references/source-map.md)
is only a starting point. Verify source license, framework compatibility, and
package status before recommending reuse.

Compare anatomy, state model, input behavior, semantics, focus, announcements,
responsive transformation, motion, density, and error recovery. Treat visual
polish as evidence only when behavior is also inspectable. Record disagreement
between sources rather than inventing false consensus.

## 4. Produce the project-native contract

Return the output in the component contract. Separate:

- behavior to adopt;
- styling to reinterpret through project tokens;
- behavior to reject and why;
- open product decisions that research cannot settle.

Do not copy proprietary code or whole component styling. Do not add a production
dependency without explicit approval.

## 5. Implement only when requested

Reuse project primitives and dependencies. Build the smallest complete state
model, including empty, loading, error, disabled, overflow, and long-content
conditions that apply. Validate semantics, focus order, keyboard and pointer
behavior, touch targets, announcements, responsive states, reduced motion, and
the project's smallest relevant test or browser check.
