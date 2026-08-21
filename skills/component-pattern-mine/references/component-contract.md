# Component pattern contract

## Comparison matrix

Compare each source across the applicable rows:

| Area | Questions |
|---|---|
| Anatomy | Which parts are required, optional, repeated, or composed? |
| States | Default, hover, focus, active, selected, disabled, loading, empty, error, success, overflow? |
| Input | Keyboard, pointer, touch, drag, voice, and assistive-technology behavior? |
| Semantics | Native element or ARIA pattern, names, roles, relationships, announcements? |
| Focus | Entry, movement, trapping, restoration, escape, and destructive-action handling? |
| Responsive | Reflow, collapse, disclosure, density, and small-screen alternative? |
| Motion | What changes, why, duration/easing family, interruption, reduced motion? |
| Data | Controlled state, async boundaries, persistence, pagination, virtualization? |
| Recovery | Validation, retry, undo, partial failure, stale or offline behavior? |

## Output

Return:

1. **Problem frame** — user job, context, data, and constraints.
2. **Sources compared** — two or three direct sources and access dates.
3. **Convergence and disagreement** — shared anatomy plus meaningful choices.
4. **Project-native contract** — anatomy, states, inputs, semantics, responsive,
   motion, data, and recovery behavior.
5. **Reuse decision** — existing primitive, source-visible adaptation, or new
   implementation; include license and dependency implications.
6. **Validation matrix** — exact states, inputs, widths, and checks to exercise.
7. **Open product decisions** — only choices research cannot resolve.

Prefer native HTML behavior where it satisfies the contract. ARIA does not
replace keyboard behavior, focus management, or visible states.
