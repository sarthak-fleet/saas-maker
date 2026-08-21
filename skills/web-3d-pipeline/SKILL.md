---
name: web-3d-pipeline
description: Shape, inspect, optimize, integrate, and validate web 3D experiences and assets. Use for glTF or GLB files, models, scenes, cameras, materials, lighting, spatial interaction, product viewers, 3D heroes, WebGL delivery, Three.js or React Three Fiber work, and decisions about whether an experience needs real-time 3D at all. Requires provenance, fallbacks, loading behavior, accessibility, and browser performance evidence.
---

# Web 3D pipeline

Use the least expensive rendering tier that delivers the intended experience.

## 1. Establish purpose and constraints

Read the nearest project instructions, design context, current stack, assets,
and delivery surface. State the user-visible purpose of 3D, required
interaction, target devices, content fallback, loading expectations, and
performance boundary. If 3D is decorative, say so explicitly.

For meaningful visual implementation, invoke `design-workflow` and use
Impeccable for the surrounding surface and final audit.

## 2. Inspect available capability

Run the parent doctor only when local asset or implementation tooling matters:

```bash
node skills/design-engineering/scripts/doctor.mjs \
  --project <project-root> --json
```

Read [the delivery contract](references/delivery-contract.md). Inspect existing
packages and asset metadata before proposing a new runtime. Do not install or
add a production dependency without explicit approval.

## 3. Choose the rendering tier

Choose in order:

1. optimized static image or video;
2. CSS transforms or layered DOM;
3. SVG;
4. Canvas 2D;
5. an existing project WebGL or 3D runtime;
6. a new runtime only with explicit dependency approval and clear evidence.

Use real-time 3D only when camera, geometry, material, lighting, or spatial
interaction must respond at runtime. Do not choose WebGL merely to imitate
depth that a cheaper tier can deliver.

## 4. Prepare assets

Record source, creator, license, modification rights, and access date before
editing an external asset. Inspect file bytes, geometry, materials, textures,
animations, coordinate scale, and naming. Preserve an original source outside
the optimized delivery file when the project already has an asset-source
convention.

Optimize only with available approved tooling. Measure before and after; do not
claim improvement from a changed file extension. Keep texture dimensions,
compression, geometry, draw calls, animations, and material count proportional
to the actual viewport and interaction.

## 5. Integrate defensively

Provide:

- reserved layout space and immediate non-WebGL fallback;
- explicit loading, error, unsupported, and context-loss behavior;
- keyboard-accessible controls when interaction is required;
- touch and coarse-pointer behavior;
- reduced-motion and data-saving treatment;
- offscreen pause or disposal and complete resource cleanup;
- meaningful text outside the canvas rather than canvas-only critical content.

Hand shaders or expressive post-processing that do not own scene structure to
`creative-web-effects` after the scene boundary is stable.

## 6. Validate in the browser

Use the delivery contract's evidence matrix. Exercise required Fleet widths,
low-capability and fallback paths, loading, interaction, resize, visibility,
reduced motion, and cleanup. Measure actual delivered bytes and runtime
behavior. Run the project's smallest relevant check and finish through the
active design-review receipt.
