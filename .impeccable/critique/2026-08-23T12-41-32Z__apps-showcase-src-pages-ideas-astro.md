---
target: apps/showcase/src/pages/ideas.astro
total_score: 34
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
timestamp: 2026-08-23T12-41-32Z
slug: apps-showcase-src-pages-ideas-astro
---
# Design critique: SaaS Maker Ideas

Assessment provenance: two isolated read-only assessments. Assessment A completed before detector evidence entered synthesis. The CLI detector returned no findings; manual evidence found two accessibility gaps that were fixed before this snapshot.

## Design-specificity verdict

The surface is product-specific and clearly belongs to SaaS Maker. The workshop framing, copper signal color, operator-led copy, scoring language, and shared navigation make the catalog feel like a studio decision ledger rather than a standalone ideas brand.

## Heuristic scores

| # | Heuristic | Score | Note |
|---|---|---:|---|
| 1 | Visibility of system status | 4/4 | Live result count, sort state, filtering, and empty state are explicit. |
| 2 | Match between system and real world | 4/4 | Wedge, customer, source, money, fun, and feasibility map to the actual decision process. |
| 3 | User control and freedom | 3/4 | Filters reset cleanly and mobile cards disclose on demand; URL state is not preserved. |
| 4 | Consistency and standards | 4/4 | Shared SaaS Maker shell, tokens, typography, and interaction patterns are preserved. |
| 5 | Error prevention | 3/4 | Bounded numeric inputs and explicit rules help, though unusual score combinations are not explained before input. |
| 6 | Recognition rather than recall | 3/4 | Labels and score breakdowns are visible, but F/M/T/C abbreviations still require the scoring explainer. |
| 7 | Flexibility and efficiency | 3/4 | Search, five filters, and desktop/mobile sorting support fast scanning; no shareable filter URL exists. |
| 8 | Aesthetic and minimalist design | 3/4 | The hierarchy is strong and the hero was compressed; 140 records still create a deliberately dense tool. |
| 9 | Help users recognize and recover from errors | 4/4 | Empty results explain recovery and offer a direct reset. |
| 10 | Help and documentation | 3/4 | Scoring, provenance, JSON, Markdown, and source docs are available; field-level methodology remains concise. |

Total: 34/40.

## Strengths

- The merge is legible: every cue says SaaS Maker, and no independent product identity remains.
- Responsive behavior preserves the same decision model: semantic table headers remain available to assistive technology while mobile records become compact disclosures.
- Public provenance is unusually strong: HTML, JSON, Markdown, build inputs, scoring code, and a compressed ownership document all agree.

## Cognitive load

Three of eight load risks remain: the dataset is intentionally dense, the control row exposes several choices at once, and the best-bet set is broad at 71 of 140. Mobile disclosure and the shorter hero materially reduce the initial burden.

## Emotional journey

The opening establishes confidence and ownership, the workbench gives immediate agency, and the provenance panel ends with an honest limitation: these scores support judgment but do not claim market proof. The weakest moment is the transition from a decisive hero to a still-large best-bet pool.

## Priority issues

- P2: Best bet selects 71 of 140 records, so it is more a broad-fit flag than a scarce recommendation. A later data-method pass could add a stronger shortlist tier without changing the current formula.
- P2: Filter and sort state does not survive reload or produce a shareable URL.
- P2: The compact F/M/T/C notation in score details depends on the separate scoring explainer.

## Persona red flags

- A first-time visitor may read the numeric scores as market validation despite the provenance disclaimer below the ledger.
- A returning operator cannot bookmark a particular cut of the catalog.

## Minor observations

- The gold best-bet star and green strong-score treatment are purposeful but sit outside the core copper palette.
- The exact 768px composition is coherent and retains desktop density; the mobile disclosure activates below that breakpoint.

## Questions

- Should best bet remain an inclusive eligibility signal, or should the surface eventually expose a rarer top-tier shortlist?
- Which filtered cuts are valuable enough to deserve durable URLs?
