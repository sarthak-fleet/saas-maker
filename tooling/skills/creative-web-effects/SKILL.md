---
name: creative-web-effects
description: Shape, audit, discover, specify, implement, and validate purposeful creative browser effects using CSS animation, SVG, Canvas, WebGL shaders, scroll progress, pointer input, particles, transitions, or procedural visuals. Use when a web surface needs a new expressive effect, an audit of existing animation code, identification of genuine motion opportunities, or precise vocabulary for an unclear motion brief. Requires project-native direction, reduced-motion and low-capability fallbacks, input safety, lifecycle cleanup, and measurable performance evidence.
---

# Creative web effects

Make the effect serve the page. Spectacle is not its own success criterion.

## 1. Choose one mode

Read only the mode-specific output in
[the effect contract](references/effect-contract.md):

- `shape`: define or implement a requested effect. Continue through every
  section below; write code only when implementation is explicitly requested.
- `audit`: inventory existing effects and return prioritized, source-linked
  findings plus validation steps. Remain read-only unless the user separately
  asks for fixes.
- `opportunities`: identify where motion would improve orientation, feedback,
  continuity, or comprehension and where the surface should stay still. Do not
  implement.
- `vocabulary`: translate imprecise motion intent into named states, timing
  relationships, easing roles, choreography, interruption, and fallback
  behavior. Do not invent implementation scope.

If the request names multiple modes, run them in dependency order and keep
their outputs separate. For example, run `audit` before `shape` when the user
asks to review and then fix an existing effect.

## 2. Establish context

Read the nearest project instructions, design context, incumbent motion
language, target surface, and real content. Read
[the effect contract](references/effect-contract.md). For `shape`, define:

- the communication or interaction purpose;
- what starts, changes, completes, and interrupts the effect;
- input model and user control;
- rendering tier and measurable budget;
- reduced-motion, low-capability, offscreen, and failure behavior.

For meaningful visual implementation, invoke `design-workflow`. Use Impeccable
for the direction, craft, critique, polish, and audit of the complete surface.

For `audit`, `opportunities`, or `vocabulary`, produce the selected read-only
output and stop. Do not continue into implementation mechanics unless the user
also requested `shape`.

## 3. Choose the cheapest sufficient tier

Choose in order:

1. CSS transitions or keyframes for DOM state and simple choreography;
2. SVG for vector paths, masks, filters, and scalable illustration;
3. Canvas 2D for many independently drawn elements;
4. an existing WebGL runtime for shader or high-volume GPU work;
5. a new runtime only with explicit dependency approval and clear evidence.

Use `web-3d-pipeline` first when the effect depends on a scene, model, camera,
material system, or spatial 3D interaction. Do not add a motion or rendering
library when project-native APIs are sufficient.

## 4. Prototype the risk

Prototype the hardest visual or performance uncertainty before building the
whole composition. Use representative content and target dimensions. Test the
fallback at the same time; it is part of the effect, not cleanup work.

Prefer composited properties for DOM motion. Keep read and write phases
separate, bind animation to actual state or progress, and avoid continuous work
when the effect is idle, hidden, or offscreen. Bound canvas resolution and
particle or shader complexity to the experience rather than raw device power.

## 5. Integrate safely

- Preserve reading order, selectable text, links, controls, and focus.
- Do not make pointer movement, hover, or scroll interception the only path to
  content or action.
- Treat `prefers-reduced-motion` as a redesigned state, not merely duration
  zero.
- Support coarse pointers and missing hover when input matters.
- Avoid layout shift and reserve effect geometry before activation.
- Pause observers and loops offscreen; remove listeners, frames, workers, and
  graphics resources on teardown.
- Keep decorative canvases and SVGs out of the accessibility tree.

## 6. Validate and simplify

Exercise the effect contract across required Fleet widths, input types,
reduced motion, visibility changes, low-capability or fallback paths, and
route/component teardown. Measure the agreed budget in the browser and run the
smallest relevant project check.

If the effect obscures content, traps input, destabilizes layout, or misses the
budget, simplify or remove it. Finish meaningful visual work through the active
design-review receipt.
