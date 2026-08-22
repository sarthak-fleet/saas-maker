# Evidence interface contract

## Decision frame

Capture before choosing the composition:

| Field | Required answer |
|---|---|
| Reader | Who opens this and what context they bring |
| Job | What they need to understand, compare, test, or decide |
| Supported answer | Strongest conclusion the material justifies |
| Decisive evidence | Smallest evidence set that earns the answer |
| Material caveat | Limit or uncertainty that changes interpretation |
| Audit need | Exact records that must remain inspectable |

Do not invent urgency, ownership, certainty, causation, approval, deadlines, or
next actions. When the evidence supports no decision, lead with the strongest
known state, implication, limitation, or unresolved question.

## Claim ledger

Normalize each material claim before designing:

| Field | Record |
|---|---|
| Claim | Exact meaning to preserve |
| Kind | Observation, derivation, projection, recommendation, or causal claim |
| Value | Value plus unit and honest precision |
| Basis | Population, period, denominator, baseline, comparator, and scope |
| Provenance | Source, access or measurement date, and supplied qualifier |
| Method | Formula, transformation, assumption, or model when applicable |
| Caveat | Missing data, uncertainty, contradiction, privacy, or interpretation limit |

Resolve contradictions only with source evidence. If a missing field could
change meaning, ask; otherwise label it unknown. Keep source material out of
public output when its privacy constraint does not permit disclosure.

## Reading architecture

Support two speeds without building two pages:

- **Fast path:** identity, question, supported answer, decisive values or
  relationship, short interpretation, and decision or unresolved question.
- **Audit path:** exact tables, assumptions, formulas, methodology, caveats,
  sources, and secondary comparisons.

Each section answers a new reader question. Give each claim one primary
evidence home. A repeated value, chart, table, or conclusion is justified only
when it enables a distinct lookup, comparison, input, or audit task. Combine
duplicates and remove ceremonial setup.

## Encoding selection

Choose the representation from the relationship:

| Reader task | Preferred encoding | Guardrail |
|---|---|---|
| One conclusion | Short prose beside decisive evidence | Do not repeat it in several summary blocks |
| Exact lookup | Semantic table | Align numeric headers and cells; preserve units and precision |
| Magnitude or rank | Position or length on a common scale | Use an honest baseline and shared basis |
| Change over time | Aligned horizontal order and position | Keep periods and missing intervals explicit |
| Composition | Proportion | State the whole and keep parts on one basis |
| Threshold or range | Distance from a labelled boundary | Do not imply precision the source lacks |
| Process or dependency | Connection and sequence | Preserve semantic reading order outside the diagram |
| Qualitative alternatives | Aligned rows or contrasted columns | Compare true peers using the same attributes |
| Assumption testing | Interactive model | Expose inputs, units, formulas, limits, and fallback |

Use direct labels when they reduce reconstruction work. A material chart needs
a concise takeaway or limitation and a semantic table or text alternative.
Never use bar length, area, color, or motion as ornament when readers could
mistake it for data.

## Calculator state model

Record:

- variables and the one control that owns each;
- fixed inputs that remain visible but are not controls;
- formulas and dependency order;
- units, full precision, display precision, ranges, increments, and defaults;
- validation, incomplete input, invalid input, and recovery behavior;
- pre-rendered default result and no-script or load-failure fallback;
- atomic update and announcement behavior;
- keyboard, touch, screen-reader, reduced-motion, and responsive behavior.

Calculate from full-precision state and format only for display. Preserve an
invalid entry and the last valid result so the interface does not silently
rewrite the reader's assumption.

## Validation matrix

Verify:

1. **First read:** the central relationship, decision, or tool dominates the
   first viewport rather than the title, shell, or mood.
2. **Meaning:** facts, formulas, units, bases, qualifiers, and uncertainty match
   the source and every derived claim is identifiable.
3. **Architecture:** the fast path stands alone, the audit path preserves the
   record, and no repeated evidence competes at equal prominence.
4. **Encoding:** geometry matches the stated relationship, scales and precision
   are honest, labels are legible, and comparators share a basis.
5. **Interaction:** defaults, changes, invalid states, repeated input, and
   dependencies produce deterministic, announced results.
6. **Access and reflow:** source order, headings, tables, figures, focus, text
   alternatives, zoom, long content, missing content, and required widths hold.
7. **Restraint:** every surface, border, icon, color, chart, effect, or repeated
   summary carries meaning, affordance, or hierarchy.

## Output

Return:

1. **Decision frame** — reader, job, supported answer, evidence, and caveat.
2. **Claim ledger** — normalized material facts and provenance.
3. **Reading architecture** — fast path, audit path, and primary evidence homes.
4. **Composition and encoding plan** — focal relationship, structure, and why
   each representation fits.
5. **Interactive model** — only when applicable; canonical state and fallback.
6. **Open questions** — only meaning-changing gaps that cannot be inferred.
7. **Validation** — exact states, widths, inputs, and checks to exercise.

For research-only work, stop here. For requested implementation, add browser
evidence, the project check, and the active design-workflow receipt result.
