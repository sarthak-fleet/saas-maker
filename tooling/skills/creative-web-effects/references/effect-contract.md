# Creative web effect contract

## Mode outputs

### Shape

Return the effect brief below, the chosen rendering tier, prototype risk,
implementation boundary, fallback plan, and browser validation matrix. Write
code only when the user requested implementation.

### Audit

Return:

1. scope and files inspected;
2. an inventory of effects with trigger, duration or progress model, rendering
   tier, fallback, and lifecycle behavior;
3. prioritized findings tied to source paths and observable impact;
4. effects that should be removed or simplified;
5. validation steps for each proposed correction.

Do not edit source in audit mode.

### Opportunities

Return:

1. user states or transitions where motion can improve orientation, feedback,
   continuity, or comprehension;
2. a purpose and cheapest sufficient tier for each opportunity;
3. surfaces that should remain still and why;
4. a priority order and evidence needed before implementation.

Do not implement opportunities in this mode.

### Vocabulary

Translate the user's intent into:

- named start, transition, rest, exit, interruption, and cancellation states;
- spatial relationship and direction of travel;
- duration relationships rather than arbitrary isolated numbers;
- easing role: enter, exit, direct manipulation, spring, or continuous progress;
- choreography, overlap, stagger, anticipation, and follow-through when useful;
- input coupling, replay, reduced motion, and fallback behavior.

Return an implementation-neutral motion contract. Do not choose a dependency or
add code unless the user also requests `shape`.

## Effect brief

Record before implementation:

| Field | Decision |
|---|---|
| Purpose | What the effect communicates or makes easier |
| Trigger | Load, state change, progress, scroll, pointer, or explicit action |
| Completion | Resting state, exit, replay, interruption, and cancellation |
| Rendering | CSS, SVG, Canvas 2D, or existing WebGL runtime and why |
| Input | Keyboard, pointer, touch, coarse pointer, missing hover |
| Fallback | Reduced motion, low capability, disabled script, load failure |
| Budget | Delivered bytes, main-thread work, frame behavior, layout stability |

## Technique guidance

- **CSS:** Prefer transforms and opacity; use layout animation only with
  measured need and evidence.
- **SVG:** Keep semantic content outside decorative SVGs; bound filters, masks,
  and path work to the visible result.
- **Canvas 2D:** Bound pixel ratio and object count; redraw only when needed;
  expose equivalent DOM content and controls.
- **Shaders/WebGL:** Bound resolution, passes, texture reads, branching, and
  allocation; compile deliberately and provide a non-WebGL result.
- **Scroll:** Derive from explicit progress; avoid hijacking native scroll;
  preserve anchor navigation and reading.
- **Pointer:** Coalesce or sample high-frequency input; do not require precise
  pointing or hover for core use.

## Browser evidence

Validate:

- first frame and final resting state;
- activation, interruption, replay, and rapid repeated input;
- 390, 768, and 1440 pixel widths when Fleet design review applies;
- keyboard, touch, coarse pointer, and missing-hover paths that apply;
- reduced-motion and fallback composition;
- hidden/offscreen pause and teardown;
- layout stability, delivered bytes, and the agreed frame or main-thread
  evidence.

The effect passes only when the underlying content and action remain usable
without it.
