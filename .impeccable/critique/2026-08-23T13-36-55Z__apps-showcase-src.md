---
target: Ideas, Tools, and Learnings theme unification
total_score: 32
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 0
timestamp: 2026-08-23T13-36-55Z
slug: apps-showcase-src
---
# SaaS Maker interior theme critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Ideas exposes result and sort state; active navigation is visible. |
| 2 | Match with the real world | 3 | The ledger, register, and workshop metaphors fit; scoring labels still require explanation. |
| 3 | User control and freedom | 3 | Reset and native disclosures work; filtered cuts are not shareable. |
| 4 | Consistency and standards | 4 | All four surfaces now use the same pane, type, navigation, and focus system. |
| 5 | Error prevention | 3 | Constrained controls and safe native elements cover the available interactions. |
| 6 | Recognition rather than recall | 3 | Labels and descriptions are visible; the largest Tools group remains long. |
| 7 | Flexibility and efficiency | 2 | Ideas has filters and sort, but Tools has no search and Ideas has no URL-backed state. |
| 8 | Aesthetic and minimalist design | 4 | The hierarchy is disciplined and saturated color is structural. |
| 9 | Error recognition and recovery | 3 | Ideas has a clear no-results state and reset path. |
| 10 | Help and documentation | 3 | Scoring notes, provenance, canonical paths, and article sources are present. |
| **Total** | | **32/40** | **Good; no P0 or P1 issues remain.** |

## Design Specificity Verdict

The result feels authored for SaaS Maker. Limestone ground, steel mullions, clear and seeded bays, and cobalt/amber/oxblood state panes carry the homepage's workshop premise into four distinct forms: Ideas remains a decision ledger, Tools a capability register, Learnings an editorial index, and the article a question-led reading surface.

The detector reported one `single-font` warning at `apps/showcase/src/layouts/Layout.astro:1`. This is an intentional false positive: `DESIGN.md` requires Schibsted Grotesk throughout and establishes hierarchy through scale, weight, tracking, proportions, and monospace code.

## Overall Impression

The theme is now one coherent public system rather than a landing page followed by unrelated dark interiors. The strongest opportunity left is utility, not visual identity: Tools would benefit from search, and Ideas could eventually preserve filter state in the URL.

## What's Working

- Shared navigation, footer, frame thickness, focus treatment, and material tokens make the surfaces recognizably one product.
- Each page keeps the form demanded by its job instead of becoming a repeated card grid.
- Responsive rendering preserves all decision-critical Ideas fields and has no horizontal overflow at 390, 768, or 1440 pixels.

## Priority Issues

- **P2 — Tools has no lookup path:** Ninety-five capabilities are grouped and anchored but not searchable. Add client-enhanced search with a server-rendered fallback if lookup becomes a primary use case.
- **P2 — Ideas filter state is ephemeral:** A useful cut cannot be bookmarked or shared. Encode query, filters, and sort in the URL if the ledger becomes a recurring operator tool.
- **P2 — Ideas trust caveat arrives late:** Put a short demand-evidence caveat beside scoring help while retaining the full provenance close.

## Persona Red Flags

- **Power user:** Browser Find remains the fastest way to locate a known Tool; Ideas cuts cannot be shared.
- **First-time visitor:** Money, Fun, and Technical scores still require opening the scoring explanation.
- **Keyboard and low-vision visitor:** No remaining blocking issue; white focus on steel/cobalt and oxblood focus on light panes are now explicit.

## Minor Observations

- The repeated pale-left/saturated-right hero should be varied on future interiors so the system remains architectural rather than templated.
- Tools search and URL-backed Ideas filters are product enhancements, not release blockers for this theme pass.

## Questions to Consider

- Should Tools remain primarily a browsable public artifact, or become a lookup utility?
- Should Ideas cuts be shareable, or is the page intentionally a transient personal workbench?
