# Web 3D delivery contract

## Rendering decision

Document:

- purpose and why depth or spatial interaction helps the user;
- cheapest sufficient rendering tier and rejected alternatives;
- target devices, viewports, inputs, and capability floor;
- fallback content and when it replaces the live scene;
- current runtime and dependency implications.

## Asset evidence

For each delivered asset record the applicable evidence:

| Area | Evidence |
|---|---|
| Provenance | Source, creator, license, access date, modification rights |
| Delivery | File type, compressed bytes, request count, cache behavior |
| Geometry | Meshes, triangles or vertices, instancing, unused data removed |
| Materials | Count, transparency, shader variants, expensive features |
| Textures | Count, dimensions, format, compression, color-space correctness |
| Animation | Clips, duration, unused tracks, interruption and reduced motion |

Set numeric budgets from the owning product's performance constraints. If none
exist, establish explicit task-local budgets before implementation rather than
silently accepting whatever an authoring tool exports.

## Runtime contract

- Reserve layout before initialization.
- Render useful fallback content without WebGL or before scene readiness.
- Bound device pixel ratio and resize work to the actual display need.
- Pause or reduce work when hidden or offscreen.
- Dispose geometry, materials, textures, render targets, listeners, and loops.
- Recover or fall back on load failure and WebGL context loss.
- Keep critical content and actions available outside the canvas.

## Browser evidence

Capture:

- fallback before initialization;
- loaded scene at required widths;
- pointer, touch, keyboard, and resize behavior that applies;
- reduced-motion and low-capability behavior;
- loading and error behavior;
- delivered asset bytes, long-task or frame evidence, and layout stability;
- teardown or route-change behavior when the surface is dynamic.
