---
target: 58-project directory distillation
total_score: 34
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 0
timestamp: 2026-08-22T11-06-06Z
slug: apps-showcase-src-pages-projects-astro
---
Method: dual-agent (A: directory_design_review · B: directory_detector_review)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Live counts, pressed filter states, disclosures, and empty recovery are clear. |
| 2 | Match system / real world | 3 | Fleet and identity still assume some portfolio context. |
| 3 | User control and freedom | 3 | Reset and filter return work; state does not persist across refresh. |
| 4 | Consistency and standards | 4 | Rows, rails, terminology, and responsive restacking are predictable. |
| 5 | Error prevention | 4 | No-JS visitors keep all content without inert filter controls. |
| 6 | Recognition rather than recall | 3 | Essential facts remain visible; evidence is intentionally disclosed. |
| 7 | Flexibility and efficiency | 3 | Search and three filter dimensions provide useful accelerators. |
| 8 | Aesthetic and minimalist design | 3 | The anatomy is compact, though 58 mobile rows remain physically long. |
| 9 | Error recovery | 4 | No-results state names the problem and gives an immediate reset. |
| 10 | Help and documentation | 3 | Retained-history and inventory boundaries are explained inline. |
| **Total** | | **34/40** | **Good, close to excellent.** |

## Design Specificity Verdict

The result is strongly authored for SaaS Maker. Lifecycle bays, black mullions,
the seeded tools rail, and the cobalt count pane preserve the workshop identity
while compact specimen rows avoid generic cards or admin-table styling. The
deterministic detector returned zero findings. The browser overlay was
unavailable because the installed browser client version did not match the
requested runtime; local Chrome DevTools evidence was used separately for
viewport and interaction verification.

## Overall Impression

The distillation succeeds. Name, purpose, shape, prominent tools, and location
stay glanceable; links, deployment evidence, and retained history move behind a
native disclosure. The page is still intrinsically long because the inventory
contains 58 identities, but it no longer repeats four full-height panes per
project.

## What's Working

- Progressive disclosure removes most visual repetition without hiding any
  identity from HTML, search engines, or no-JS visitors.
- Column labels appear once per lifecycle group on wide screens and return only
  when responsive stacking needs local context.
- Native details and summary controls retain keyboard behavior and avoid custom
  state machinery.

## Priority Issues

1. **[P1, resolved] Invisible mobile filter return:** the visually hidden
   fixed button remained focusable. Visibility now uses the `hidden` attribute,
   removing it from the tab order until it is shown.
2. **[P2, resolved] Hidden-field search matches:** deployment providers could
   match a row without appearing in its collapsed anatomy. Search now uses only
   the advertised visible fields.
3. **[P2, resolved] Verbose disclosure names:** summaries exposed roughly 200
   characters to assistive technology. Each now has a concise project-specific
   evidence label.
4. **[P2] Deferred canonical action:** the visible domain is evidence rather
   than a link; visitors open the evidence disclosure before following it.
5. **[P2] Mobile length:** even compact rows remain long across 58 identities,
   and the first row follows the full introduction and filter set.

## Persona Red Flags

- Jordan may still need a moment to interpret Fleet and project identities.
- Sam now receives concise native disclosure names and cannot tab to an
  invisible filter-return control.
- Casey benefits from the fixed return-to-filters action, but the 58-item mobile
  inventory remains a long browse.

## Minor Observations

- Reset remains available at the default state.
- Catalog kind is internal language inside the evidence panel.
- The machine-readable directory is intentionally separated into the closing
  provenance pane.

## Questions to Consider

- Should the canonical domain eventually become a direct action in the compact
  row?
- Should filter state persist in the URL for repeat visits?
- Could the mobile count pane keep the 58 moment in less vertical space?
