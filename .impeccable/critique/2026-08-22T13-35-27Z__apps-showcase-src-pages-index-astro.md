---
target: homepage and /projects content boundary
total_score: 27
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 0
timestamp: 2026-08-22T13-35-27Z
slug: apps-showcase-src-pages-index-astro
---
Method: dual-agent (A: directory_design_review · B: directory_detector_review)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Current-state and verification language is visible. |
| 2 | Match system / real world | 4 | Final directory copy is direct and visitor-facing. |
| 3 | User control and freedom | 4 | Standard links and navigation provide direct exits. |
| 4 | Consistency and standards | 4 | The workshop system remains coherent. |
| 5 | Error prevention | 4 | No risky interactions; external destinations are marked. |
| 6 | Recognition rather than recall | 4 | Four focused products and one complete-directory gateway are explicit. |
| 7 | Flexibility and efficiency | n/a | No repeated workflow requires accelerators. |
| 8 | Aesthetic and minimalist design | 3 | Token World remains intentionally expansive on mobile. |
| 9 | Error recovery | n/a | No user-input or error workflow exists on this surface. |
| 10 | Help and documentation | n/a | The landing experience needs no instructional layer. |
| **Total** | | **27/28** | **Excellent** |

## Design Specificity Verdict

The glazier workshop, steel mullions, saturated product panes, and Token World make the homepage recognizably SaaS Maker. The final information architecture is now authored around two distinct jobs: the homepage curates four products and studio evidence; `/projects` owns complete enumeration.

The deterministic scan returned one `single-font` warning in `Layout.astro`. This is a false positive because `DESIGN.md` explicitly defines Schibsted Grotesk as the single-family system and the page establishes hierarchy through scale, weight, proportion, and color.

## Overall Impression

The page is materially clearer and shorter. It presents a studio, not a second directory, and leaves one unambiguous route to all 58 projects.

## What's Working

- Exactly four focused product links appear on the homepage at all reviewed widths.
- One directory gateway replaces the repeated maintained and past catalogs and the self-embedded project strip.
- Latest learning is now a sibling section with its own heading, not semantically part of the directory invitation.

## Priority Issues

- **P3 — Token World remains long on narrow screens.** It is the page's intentional spectacle, but it delays later sections. If the mobile homepage needs further shortening, compact its stage and metrics without removing the proof surface.
- **P3 — Overflow clipping can conceal future regressions.** Current browser measurements show no overflow at 390, 768, or 1440, but keep the viewport assertion in future visual checks.

## Persona Red Flags

- **Jordan:** No current red flag; the four products and one directory gateway now describe distinct choices.
- **Riley:** No duplicate directory promise remains; the 58-row destination matches the gateway claim.
- **Casey:** Token World is still a long mobile interlude before learning and package content.

## Minor Observations

- The homepage title now foregrounds the product studio rather than the directory.
- The agent-readable homepage uses one H1, H2 section headings, and H3 entry headings.

## Questions to Consider

- Should Token World remain the homepage's deliberate spectacle, or become a shorter mobile proof panel in a later pass?
