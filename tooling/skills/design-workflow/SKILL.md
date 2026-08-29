---
name: design-workflow
description: Primary Fleet entry point for meaningful frontend design work that creates or changes visual language, layout, navigation, interaction patterns, responsive behavior, theming, reusable components, landing pages, dashboards, app shells, or substantial UI polish. Owns product clarity, visual direction, implementation alignment, browser evidence, quality gates, and owner feedback; use Impeccable as a supporting mechanics playbook. Skip copy-only edits, invisible refactors, and trivial CSS corrections.
---

# Fleet design workflow

Use Impeccable for design mechanics. Use this skill for Fleet's approval and
shipping contract. Project `PRODUCT.md` and `DESIGN.md` outrank generic
component, palette, or detector recommendations.

## 0. Product-purpose gate

Before choosing a visual lane or writing UI, resolve the product truth for the
surface from `PRODUCT.md`, the surface brief, and supplied evidence. In Fleet,
also load the project's `purposeContract` from
`site-health/apps/backend/config/projects.json`; when only public data is
available, use the same generated contract in SaaS Maker's `projects.json`:

`[Product] helps [specific audience] achieve [specific outcome] by [distinct mechanism].`

For a landing or other `Persuade` surface, the first viewport must make four
things clear within seconds: what the product is, who it is for, why it matters
now, and what the visitor can do next. It must use the product's own vocabulary
and show or link to credible product-specific proof. If that cannot be stated
without vague category language, resolve the missing product truth in this
skill's direction contract before coding; use `$impeccable shape` only for an
explicit concept round or a genuine scope/identity blocker. Do not use visual
polish to hide an unclear proposition.

Record the canonical sentence and source in `direction.contract`. Compare all
six purpose fields with repository-local `PRODUCT.md` or `PROJECT_STATUS.md`.
Use `purposeAlignment: match` when they agree. If the repository has newer
truth, use `repository-override`, record the exact drift in `driftNote`, and
update the canonical Site Health contract in the same task before approving the
landing page. A live page that contradicts audience, outcome, mechanism, proof,
lifecycle, or next action cannot pass comprehension regardless of visual score.

## 1. Classify

Choose exactly one lane before implementation:

- `preserve`: keep the established visual language. Capture a before
  screenshot, follow existing design context, and do not manufacture alternate
  directions.
- `overhaul`: create or materially replace a visual language. Define one
  subject-specific direction and implement it in the first pass. Record one to
  three references only when they materially informed the direction. Generate
  comparison probes only when the user requests exploration or the decision is
  genuinely ambiguous; do not block ordinary work on owner approval.

If `PRODUCT.md` or `DESIGN.md` is missing, run `$impeccable init` before
meaningful work. Do not initialize untouched projects fleet-wide.

Create the receipt:

```bash
node scripts/design-workflow.mjs create \
  --project <project-root> \
  --mode <preserve|overhaul> \
  --register <brand|product> \
  --surface-mode <persuade|operate|read|experience> \
  --target "<surface>"
```

When invoked inside an independent child repo, call the same script through the
relative Fleet root.

## 2. Shape and build

- Preserve: use the tracked system and before evidence as the contract.
- Overhaul: record reference names, probe ids/paths, selected probe, and
  `agent-selected`, `approved`, or `delegated` in `.fleet/design-review.json`.
- Before coding, fill the receipt's direction contract: purpose, audience,
  screen job, visual thesis, role-based color/type/spacing/layout system, one
  memorable signature drawn from the product's world, and one deliberate risk
  with a reason. Run a subject-swap test and revise any choice that would work
  unchanged for an unrelated product.
- Use a specialist only when the task genuinely needs it: use
  `../design-inspiration/SKILL.md` for external reference research or direction
  evidence, `../component-pattern-mine/SKILL.md` for an unfamiliar component,
  `../web-3d-pipeline/SKILL.md` for real-time 3D, or
  `../creative-web-effects/SKILL.md` for a browser effect. Treat specialist
  output as evidence and implementation guidance; this skill remains the single
  completion authority. Do not route ordinary UI work through a second design
  router.
- Do not copy another system's brand styling, tokens, assets, proprietary code,
  or whole visual language. Record material references and anti-patterns when
  they influence a direction; project `PRODUCT.md`, `DESIGN.md`, and existing
  components remain authoritative.
- Use real product content and assets. Do not substitute a component-gallery
  aesthetic for project identity.
- For every new or materially redesigned web surface, read
  `references/ui-library-standard.md`. Use its upstream-first selection order:
  preserve a healthy project-native pattern, otherwise start with Tailwind Plus
  when licensed access is available and use Preline as the free fallback.
  Record exact source URLs in `direction.library`. Standard interface patterns
  are reused, not reinvented. A custom replacement requires explicit owner
  authorization and a recorded upstream gap. Keep any runtime dependency to the
  smallest selective import. Apple-native interfaces are excluded from this web
  standard.
- Use the same reference's priority-scaled delivery profile. P1 receives
  benchmark-grade bespoke composition and the deepest checks; lower priorities
  progressively reuse more of the selected upstream/template system. Priority
  never lowers the product-purpose, lifecycle truth, accessibility, responsive,
  or primary-action requirements.
- Invoke the narrowest Impeccable workflow that owns the job:
  - new UI: resolve the brief with this skill's direction contract and proceed
    in one pass. Use `$impeccable shape` only when the user explicitly requests
    a concept round or when an unresolved product-identity decision materially
    changes scope; never make its approval flow a routine dependency;
  - reusable components or tokens: use `$impeccable extract`, preserve rendered
    behavior and public APIs, migrate every caller, and run focused checks;
  - dark mode: use `$impeccable colorize`, define semantic roles for surfaces,
    text, actions, focus, borders, status, overlays, and every interaction state,
    and compose rather than mechanically invert the light theme;
  - phone, tablet, or desktop adaptation: use `$impeccable adapt`, choose
    content-driven breakpoints, preserve core capability, and validate reflow,
    navigation, forms, tables, text size, touch targets, overflow, and input
    methods.
- For a raster asset that needs a dark-mode counterpart, first load the
  installed imagegen skill and require the source image to be attached or
  locally available. Retain the original, create a distinct variant, preserve
  dimensions, composition, important content, softness, fades, transparency,
  and interface purpose, and inspect it on its intended dark surface. Do not
  substitute a blanket CSS filter.
- For requested external reference research or a visual brand board, use
  `../design-inspiration/SKILL.md`; research, probes, or generated boards are
  direction evidence, not a prerequisite for ordinary implementation.

## 3. Review

Before completion:

1. Inspect the running surface in a browser.
2. Capture after screenshots at 390, 768, and 1440 pixels.
3. For `Persuade` surfaces, run a fresh-visitor comprehension check:
   without reading the whole page, an independent reviewer must be able to
   state the product, intended audience, primary value, proof of the promise,
   and next action. Record the answers and any mismatch in
   `evidence.comprehension`; set its status to `pass`. Use `not-applicable` for
   other surface modes.
   Score comprehension independently out of 100: product identity 25;
   audience 15; value/outcome 15; distinct mechanism 15; credible proof 15;
   honest next action and lifecycle 15. The minimum passing score is 85. Any
   material contradiction is a failure, even if the arithmetic total or visual
   scores would otherwise pass.
4. Run `$impeccable critique`, fix all P0/P1 findings, then run
   `$impeccable polish` and `$impeccable audit`.
5. Run the project's smallest relevant build/check.
6. Fill the receipt with evidence paths, scores, unresolved counts, purpose
   comprehension result, and check command.

The minimum floors come from `config/design-workflow.json`: purpose 85/100,
critique 32/40, audit 16/20, and zero unresolved P0/P1. Purpose and visual
scores stay separate. Never average them; visual craft cannot compensate for an
unclear or incorrect product promise. Scores are floors, not proof of taste.

Detector findings are advisory. Record them, but never rewrite an intentional
`DESIGN.md` decision only to silence an aesthetic heuristic.

## 4. Close with a decision record

Record `agent-selected` when the agent made the direction call, `keep` when the
owner accepted it, or `delegated` when the owner explicitly delegated judgment.
Ask only when a material ambiguity or a clearly wrong lane would change the
scope or product identity; do not create a routine approval dependency.
Preserve the note in the receipt so the next design pass can learn from it.

Validate:

```bash
node scripts/design-workflow.mjs check --project <project-root>
```

Do not claim the meaningful visual change is complete until this command
passes. Report the lane, evidence, scores, owner decision, and any advisory
detector findings.
