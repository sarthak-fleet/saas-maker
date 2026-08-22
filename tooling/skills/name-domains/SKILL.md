---
name: name-domains
description: >
  Generate tasteful, likely-available domain names for a startup idea. Orchestrated
  pipeline (run-pipeline.sh): taste scoring, collision scan, two-pass RDAP/DNS
  availability, markdown shortlist. Reads PROJECT_STATUS.md in fleet repos. Use for
  domain names, brandable domains, naming help, "name my startup", or /name-domains.
  No backend, no signup.
---

# Name Domains

Give me an idea. I'll return tasteful, likely-available domains that don't collide with the market.

**Single skill. No backend. No API keys.**

## Resolve skill root (works anywhere)

Scripts auto-locate the skill via their own path. Optional override:

```bash
export NAME_DOMAINS_SKILL_ROOT="/absolute/path/to/name-domains"
```

Fleet default: `.agents/skills/name-domains/`

Symlinks: `~/.grok/skills/name-domains`, `~/.claude/skills/name-domains`

## Quick start (preferred)

```bash
SKILL="${NAME_DOMAINS_SKILL_ROOT:-.agents/skills/name-domains}"

# 1. Validate environment
bash "$SKILL/scripts/validate-setup.sh"

# 2. Write candidates (≥50 lines) — see examples/candidates-format.txt
#    Format: sld<TAB>style  OR  sld:style

# 3. Run pipeline
bash "$SKILL/scripts/run-pipeline.sh" \
  --candidates /tmp/candidates.txt \
  --idea "Your product one-liner" \
  --vibe "classy, warm, premium" \
  --category health \
  --competitors "Examine,BioDigital" \
  --avoid "examine,diagnose" \
  --existing materia \
  --top 20 --limit 25 \
  > /tmp/final.tsv

# 4. Optional markdown skeleton
python3 "$SKILL/scripts/format-markdown.py" \
  --idea "Your product" --vibe "classy, warm" \
  /tmp/final.tsv
```

**Self-test:** `bash "$SKILL/scripts/self-test.sh"`

## Tool map

| Script | Role |
| --- | --- |
| `run-pipeline.sh` | **Primary** — taste → collision → Pass A `.com` → Pass B `.io,.co` → final TSV |
| `check-domains.sh` | Standalone availability probe |
| `score-taste.py` | Mechanical taste 0–100 + misleading-pattern penalties |
| `score-collision.py` | Competitor collision |
| `merge-rank.py` | Called by pipeline (do not run alone) |
| `format-markdown.py` | TSV → markdown skeleton |
| `validate-setup.sh` | Dependency + file check |
| `self-test.sh` | Smoke test |

## Category seeds (pick one `--category`)

| Category | When | File |
| --- | --- | --- |
| `health` | supplements, med education, anatomy, wellness evidence | `competitor-seeds-health.txt` |
| `saas` | B2B software, productivity, collab | `competitor-seeds-saas.txt` |
| `devtools` | dev infra, CLI, hosting, observability | `competitor-seeds-devtools.txt` |
| `consumer` | consumer apps, social, marketplaces | `competitor-seeds-consumer.txt` |
| `ai` | LLM products, agents, ML tooling | `competitor-seeds-ai.txt` |
| `general` | default / mixed | `competitor-seeds-general.txt` |

Always merge user `--competitors` on top of the seed file.

## Mandatory checklist

Agent must complete **all** before replying:

- [ ] `validate-setup.sh` passes (or self-test if unsure)
- [ ] Step 0: repo context + existing domain checked
- [ ] Step 1: brief complete (`idea` required)
- [ ] Step 2: ≥50 candidates, ≥4 styles (agent brainstorm → candidates file)
- [ ] Step 3: `run-pipeline.sh` executed (or manual equivalent — see below)
- [ ] Step 4: say-aloud line for every **Top pick** (human judgment — not scripted)
- [ ] Step 5: fill "Why" and "Risk" columns; don't ship empty markdown skeleton
- [ ] Step 6: live-check links on every listed domain
- [ ] Output: Existing name · grouped table · Top picks · Taken/skipped

## Workflow

### 0. Project context (fleet repos)

Read **before** asking questions:

1. `PROJECT_STATUS.md` — Why/What, Products
2. `package.json` — `homepage`, `name`, `description`
3. `README.md` lede

Pass `--existing {sld}` to pipeline. Open with **Keep vs switch**:

| Signal | Meaning |
| --- | --- |
| `likely_taken` + `may_be_parked_or_reserved` | May be **yours**, parked, or live — check registrar |
| Short + on-brand existing name | Recommend **keep**; new names are backups |

### 1. Brief

| Field | Required | Notes |
| --- | --- | --- |
| `idea` | Yes | One clear sentence |
| `vibe` | No | e.g. classy, playful, technical |
| `category` | No | See table above |
| `competitors` | No | Comma-separated; added to seeds |
| `avoid` | No | Substrings → `--avoid` |
| `tlds` | No | Pipeline defaults: Pass A `com`, Pass B `io,co` |

### 2. Brainstorm ≥50 candidates

Write to a temp file. Include **style** per line for better scoring.

**Stem bank** (mix into compounds/portmanteaus):

| Bucket | Examples |
| --- | --- |
| Product | core nouns from idea (body, herb, calendar, code) |
| Moat | cite, proof, grade, graph, sync, flow |
| Tone | calm, clear, true, vital, wise |

**Styles** — aim ≥8 each: compound, portmanteau, metaphor, abstract, descriptive, playful (if vibe fits).

**Auto-rejected by `score-taste.py`:** entries in `blocked-slds.txt`, `--avoid` hits, `misleading-patterns.txt` (e.g. `herbograph`, `-ograph` suffix).

### 3. Run pipeline

Use `run-pipeline.sh` (see Quick start). It:

1. Scores taste → keeps top 60 → trims to `--top` (default 20)
2. Collision scan → drops **high**
3. Pass A: primary TLD RDAP/DNS
4. Pass B: secondary TLDs for survivors only (max 15 SLDs)
5. `merge-rank.py`: availability-adjusted taste; drops `likely_taken` and score <70

**Manual fallback** (only if pipeline cannot run): run each script in Tool map in same order.

### 4. Say-aloud test (Top picks only)

For each top pick:

> *"I'd introduce this at a dinner party as ______."_

Drop picks that mislead or need too much explanation. Do not re-run pipeline for 1–2 drops — note under Taken/skipped.

### 5. Final response

Use `format-markdown.py` as **skeleton only** — you must add:

- Existing name recommendation
- Say-aloud column or inline quote
- Why / Risk prose (not "—")
- Taken/skipped with reasons

## Taste scoring (mechanical)

Base 50. Key bands in `score-taste.py`:

| Signal | Points |
| --- | ---: |
| Length 5–10 | +15 |
| Pronounceable vowel ratio | +10 |
| Idea/vibe stem hits | +0–15 |
| `likely_available` (post-check) | +12 |
| `likely_taken` | −20 |
| Misleading pattern (e.g. `-ograph`) | −15 to −25 |
| Blocked/generic SLD | reject |

## Availability notes

| note | Action |
| --- | --- |
| `may_be_parked_or_reserved` | Say "verify at registrar — may be yours" |
| `nxdomain_only_verify_at_registrar` | Promising; live-check before loving it |
| `check_manually` | Include with `unknown`; add registrar links |

**TLD strategy** (`check-domains.sh`): `.com/.net/.org` RDAP→DNS; `.io/.co/.dev/.app` DNS(+NS)→RDAP.

## Quality bar (Top picks)

1. `taste_final` ≥75 (≥82 if `unknown`)
2. Collision ≤ medium
3. Say-aloud passes in one sentence
4. `likely_available` on at least one preferred TLD
5. Premium/classy vibe → prefer abstract/compound over SEO slugs

## Agent anti-patterns (do not)

- Skip pipeline and guess availability
- Reimplement RDAP/curl inline — use scripts
- Present `herbograph`-class names without say-aloud
- Ignore existing domain in repo
- Claim trademark clearance
- Offer registrar checkout

## Failure modes

| Situation | Action |
| --- | --- |
| Missing `idea` | Ask user |
| All `.com` taken | Report Pass B `.io`/`.co`; brainstorm more abstract |
| Pipeline error | Run `validate-setup.sh`; fall back to manual script order |
| User doesn't care which domain | Still run skill fully — quality is the point |

## Out of scope

Purchase flow, registrar/trademark/social APIs, saved lists, alerts, backend Worker.