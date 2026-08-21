# Image prompt template

Generate each image separately. Replace every brace-delimited field with
specific editorial content.

```text
Generate one standalone 16:9 horizontal editorial illustration for an English-language article.

Visual language:
Pure white background. Minimal black hand-drawn line art with thin, slightly wobbly pen lines. Large areas of empty white space. Sparse handwritten English annotations in black with restrained red, orange, and blue accents. Clean, absurd product-sketch feeling. No gradients, shadows, paper texture, complex background, commercial vector polish, presentation infographic, cute mascot poster, children's illustration, or realistic UI.

Recurring character:
Xiaohei, a small solid-black absurd creature with white dot eyes, tiny thin legs, a blank serious expression, and a slightly uneven hand-drawn silhouette. Xiaohei must perform the core conceptual action and must not merely stand beside the scene. Keep the character deadpan and slightly bizarre, never cute.

Theme:
{editorial theme}

Core idea:
{one sentence the image must communicate}

Composition family:
{process / system fragment / before and after / character states / conceptual metaphor / layered method / route / mini comic}

Physical scene:
{where Xiaohei is, the action Xiaohei performs, the one or two main objects, and how the relationship changes}

Suggested objects:
{object 1} / {object 2} / {optional object 3}

Exact short English labels:
{label 1} / {label 2} / {label 3} / {optional label 4} / {optional label 5}

Color roles:
Black for the main drawing and Xiaohei. Orange only for the primary path or movement. Red only for the key warning, problem, or result. Blue only for secondary notes, feedback, or system state.

Constraints:
Explain exactly one idea. Keep the subject within roughly 40%-60% of the canvas and preserve at least 35% clean white space. Use no more than 5-8 short labels, each ideally 1-4 words. Do not add a title in the top-left corner or print the composition family. Do not create a formal diagram, course slide, or dense explainer. Invent a fresh physical metaphor for this article rather than copying a prior example. The result should be clear but not instructional, interesting but not childish, strange but clean.
```

## Editing prompts

Remove an unwanted heading:

```text
Edit the provided image. Remove only the handwritten heading "{text}" and its underline from the top-left area. Restore the same clean white background. Preserve every other character, label, path, line, color, composition, aspect ratio, and image-quality detail. Add nothing new.
```

Make Xiaohei essential:

```text
Regenerate the illustration with the same core meaning and sparse layout, but make Xiaohei perform the strange physical action that explains the idea. Xiaohei must not stand beside an otherwise complete diagram. Keep the result deadpan, hand-drawn, spacious, and not cute.
```

When label spelling is unreliable, regenerate with fewer labels. Do not accept
plausible-looking misspellings in an English production asset.
