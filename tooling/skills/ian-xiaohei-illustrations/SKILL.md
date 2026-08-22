---
name: ian-xiaohei-illustrations
description: Design or generate English-language editorial illustrations in Ian's licensed Xiaohei visual language for essays, blog posts, Notion documents, methods, workflows, and abstract concepts. Use for Xiaohei illustrations, sparse absurd hand-drawn article art, illustration shot lists, or edits to an existing Xiaohei image. Do not use for general illustration, formal diagrams, slide graphics, brand key art, or editable vector assets.
license: MIT
---

# Ian Xiaohei Illustrations

Turn one important idea from an English-language article into a sparse,
memorable 16:9 editorial illustration. The result should feel like an absurd
product sketch on white paper, not a commercial illustration, presentation
diagram, or cute cartoon.

The recurring character is **Xiaohei**: a solid-black creature with white dot
eyes, thin legs, an irregular hand-drawn silhouette, and a blank, serious
expression. Xiaohei must perform the conceptual action; it is never a mascot
placed beside an otherwise complete diagram.

## Read only what the task needs

- Read [style-dna.md](references/style-dna.md) before planning or generating.
- Read [xiaohei-character.md](references/xiaohei-character.md) when deciding
  Xiaohei's role or correcting character drift.
- Read [composition-patterns.md](references/composition-patterns.md) when
  choosing a structure or inventing a metaphor.
- Read [prompt-template.md](references/prompt-template.md) immediately before
  generation or image editing.
- Read [qa-checklist.md](references/qa-checklist.md) after generation.

## Choose the output

If the user asks where illustrations would help, produce a shot list and stop.
If the user asks to generate, create the images without pausing for another
confirmation. Load the installed `imagegen` skill before generating or editing
an image.

Use the smallest useful set: usually 4-8 images for an article, 1-3 for a short
piece, and no more than 9 without a clear editorial reason. Do not illustrate
every section. Select cognitive anchors such as a central judgment, break in a
process, feedback loop, split, before/after state, handoff, recurring failure,
or change in the reader's mental model.

For each proposed image, specify:

- placement in the article;
- theme and one-sentence meaning;
- composition family;
- the physical metaphor;
- Xiaohei's essential action;
- key objects;
- up to 3-5 short English labels.

## Generate one image at a time

Each image must express one idea. Invent a new low-tech physical metaphor from
the current text, then make Xiaohei do the work that explains it. Do not stitch
multiple illustrations into one sheet or reproduce a prior example's objects
and layout unless the user explicitly asks for that composition.

Include these invariants in each image request:

- 16:9 horizontal editorial illustration;
- pure white background and substantial empty space;
- thin, slightly wobbly black hand-drawn lines;
- sparse red, orange, and blue handwritten English annotations;
- Xiaohei as the subject of the core action;
- no title in the top-left corner;
- no presentation slide, formal flowchart, polished vector art, realistic UI,
  dense architecture, paper texture, gradients, shadows, or cute mascot style.

Generate labels directly in English. Prefer concrete labels of 1-4 words;
longer text increases rendering errors and makes the illustration feel like a
slide. If exact wording matters, generate with fewer labels and add typography
separately only when the user requests an editable production asset.

## Check and deliver

Review every result with [qa-checklist.md](references/qa-checklist.md). Regenerate
or edit when Xiaohei is decorative, the canvas is crowded, the image resembles
a diagram, the labels are wrong, or the background is not clean white.

When working in a project and a local image path is available, save new files
without overwriting existing assets:

```text
assets/<article-slug>-illustrations/01-topic-name.png
assets/<article-slug>-illustrations/02-topic-name.png
```

Report the number of images, each image's editorial purpose, its path or
generated artifact, and which images are strongest versus optional. Keep the
handoff concise.

## Attribution

This English adaptation is derived from
[Ian Xiaohei Illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations)
by [Ian](https://github.com/helloianneo), revision
`91b560849e8f883922cc2fa8a358a668caa94105`. It preserves the Xiaohei name and
character attribution requested by the upstream notice. See
[LICENSE.upstream](LICENSE.upstream).
