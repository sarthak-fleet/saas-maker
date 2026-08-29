# Landing-surface classification

Recorded: 2026-08-30. Refs `sass-maker/saas-maker#62`.

Issue #62 asks for one written classification of every bespoke Fleet landing
surface — `adopt`, `keep`, or `retire` — plus a recorded decision on how many
page engines Fleet keeps. That classification did not exist anywhere. This
document is it.

This is a decision record, not a catalog. It carries repository paths, engine
versions, and verdicts. The private project catalog, deploy configuration, and
per-project operational state stay in Site Health.

## Candidate engine set: two

- **`Significant-Hobbies/ios-landings`** — the app-style engine. One page
  engine, one site per `products/<id>/`. Currently serves `anchor`, `calorie`,
  `habits`, `indulge`, `journal`, `kith`, `motion`, `setline`.
- **[`tooling/templates/web-landing`](../templates/web-landing/README.md)** —
  the content-first web starting point, for products whose proof is an
  interface or a data artifact rather than a phone screenshot.

There is no third. The copy-to-fork `tooling/templates/ios-landing` template
was the third mechanism and is
[retired](../templates/ios-landing/DEPRECATED.md); it produced a divergent
bespoke copy on every use, which is the behaviour the issue set out to end.

## Verdicts

- **adopt** — move to one of the two engines. Recorded here; the migration
  itself is separate work in the product's own repository.
- **keep** — stays bespoke, and the reason is written down. A `keep` needs a
  positive reason the surface must be special, not merely the absence of an
  instruction to change it.
- **retire** — the surface duplicates something that already exists, or has
  already been removed.
- **undecided** — the evidence available does not settle it. Each one below
  says what would settle it. No verdict here is a guess.

Evidence for `adopt` and `keep` is the owner-approved web-template batch
recorded on issue #62 on 2026-08-24, and Site Health's
`docs/landing-page-audit-latest.md` (2026-08-24), which reviewed every public
origin at 1440 and 390 px. Evidence for `retire` is the commit that removed the
surface, cited per row.

## The inventoried surfaces — 11

The inventory is the table in issue #62, measured 2026-08-22. Verified against
the local Fleet checkout on 2026-08-30; drift since the inventory is noted.

| Surface | Astro | Verdict | Reason |
| --- | --- | --- | --- |
| `codevetter/apps/landing-page-astro` | `^7.2.2` | keep | Flagship storefront; the audit rates it above the shared baseline on thesis, typographic scale and authored mobile composition, and names it as a surface the template must not replace. Already ahead of the shared engine's Astro major. |
| `starboard/landing-astro` | `^7.2.0` | undecided | See below. |
| `knowledge-base/landing-astro` | `7.1.6` | adopt | In the owner-approved batch. Utility-led product whose marketing surface is not a differentiator; its search interface is the proof artifact the web template is built to frame. |
| `email-manager/landing-astro` | `^6.4.6` (inventory said `^5.18.2`) | adopt | In the owner-approved batch as Kinetic. Its live page overflows at 390 px and the navigation does not collapse; the template replacement is source-ready around its browser artifact. |
| `high-signal/apps/web/landing-astro` | `^5.18.2` | undecided | See below. |
| `karte/landing-astro` | `^5.18.2` | keep | The six-card Onyx deck is product-specific and responsive, with inbound surfaces, assistant behaviour, sample cards and an embedded live interaction path. Converting it would remove product proof the template cannot carry. |
| `reader/landing-astro` | `^5.18.2` | adopt | In the owner-approved batch. Secondary reading utility; a consistent maintained baseline is worth more here than a separate visual system. |
| `rolepatch/landing-astro` | `^5.18.2` | keep | Receipt-first thesis with real before/after resume output and explicit automation safeguards — a narrative the shared template has no slot for. |
| `saas-maker/apps/cockpit/landing-astro` | `^5.18.2` | retire | Already done. Source removed in `1c769be4` ("chore: remove redundant workspace packages (#74)"); nothing under the path is tracked. Only a stale local `dist/` remains in working copies. |
| `significanthobbies/landing-astro` | `^5.18.2` | retire | Already done. Removed in `007cc25` ("refactor: leave the Hub in its canonical repository"); `significanthobbies.com` is now served from the `Significant-Hobbies/live` repository, which the audit rates above the shared baseline. |
| `anchor/landing` | `^5.18.2` | retire | Duplicate of `ios-landings/products/anchor`. The Astro tree was removed in the Anchor repository in `20eaaa7` ("chore(landing): remove superseded anchor/landing Astro tree"). See the known item below. |

**Counts: 3 adopt · 3 keep · 3 retire · 2 undecided.**

## Undecided, and what would settle each

**`starboard/landing-astro`** and **`high-signal/apps/web/landing-astro`.**

The 2026-08-24 audit points both ways for these two, and only these two. It
places each in its "landing page worse than our template" bucket — Starboard
with an explicit finding that its generic dark SaaS treatment and weak
first-viewport proof do not clear the factory bar — while also naming both in
the sentence listing surfaces the template should not replace. Neither appears
in the "use the template now" list, and neither is in the owner-approved batch,
which states that no other product is approved by implication.

So there is a recorded instruction not to replace them and a recorded finding
that they are below the bar, and nothing that reconciles the two.

**What would settle it:** the owner saying which reading holds — that these are
primary brand surfaces excluded from template adoption on identity grounds
(`keep`, and the identity reason gets written down here), or that the quality
finding governs and they join a second adoption batch (`adopt`). One sentence
from the owner closes both rows. Do not infer it from the audit alone.

## Surfaces the 2026-08-22 inventory omits

Scanning the Fleet checkout on 2026-08-30 for `astro.config.*` outside
`node_modules` finds five bespoke Astro landing surfaces the inventory table
does not list. They are classified on the same evidence.

| Surface | Astro | Verdict | Reason |
| --- | --- | --- | --- |
| `psi-swarm/web` | `^7.1.3` | adopt | In the owner-approved batch. |
| `live/landing-astro` | `^5.18.2` | keep | The successor to the retired `significanthobbies/landing-astro`. Cinematic hero backed by a full life-phase artifact, hobby imagery, journey examples and community profiles; audit-rated above the shared baseline. |
| `truehire/apps/web/landing-astro` | `^5.18.2` | keep | Archived with no public URL, but audit-rated above the baseline on its scored-candidate artifact, signal-stack diagrams and monochrome system. Nothing to migrate while archived; do not fund a conversion. |
| `aliveville/astro-landing` | `^6.3.6` | keep | Audit-rated above the shared baseline, and its authored direction was previously agreed. The audit's explicit instruction is that the AliveVille surfaces wait for that direction rather than receive generic template work. |
| `open-historia/landing-astro` | `^5.18.2` | undecided | Same contradiction as Starboard and High Signal: placed below the template bar and simultaneously named as a surface the template should not replace. Settled the same way — one owner sentence. |

Two products in the approved batch have no separate Astro landing at all:
**GitStat** and **Anime List**. Their application homepage is their landing
page, so their `adopt` is applied in place — the template's information
hierarchy and footer contract are adopted around the existing app, and no
route, control, state, or data behaviour is removed. They are recorded as
`adopt` without a row above because there is no bespoke Astro surface to
classify.

## Totals across both tables

| Verdict | Count | Surfaces |
| --- | --- | --- |
| adopt | 6 | Knowledge Base, Reader, Kinetic, PSI Swarm, GitStat, Anime List |
| keep | 6 | CodeVetter, Karte, RolePatch, Live, TrueHire, AliveVille |
| retire | 3 | SaaS Maker cockpit landing, Significant Hobbies landing, Anchor landing |
| undecided | 3 | Starboard, High Signal, Open Historia |

The six `adopt` surfaces are exactly the owner-approved batch of 2026-08-24,
derived here independently from the audit's own recommendation lists. That the
two agree is the main check on this table.

## Known items

**`anchor/landing` duplicates `ios-landings/products/anchor` — recorded, not
fixed here.** The Anchor repository is owned by another agent and was not
touched. What the evidence shows: the tracked Astro tree was already removed in
`20eaaa7`, which is present on the repository's `main` and level with
`origin/main`, so the duplicate is resolved in source control. What remains in
the local working copy is an untracked `landing/.wrangler/` build-cache
directory and nothing else — no tracked file under `landing/`. That stray
directory is why a filesystem scan still reports the duplicate. Closing it out
means deleting one untracked cache directory in the Anchor checkout, which is
that repository's owner's call, not this one's.

**Two preserved scripts still describe the retired copy workflow.**
`preserved/legacy-fleet-tooling/scripts/scaffold-ios-landing.sh` and
`sync-ios-landing.sh` copy an iOS landing template into a product repository.
Both resolve `foundry/ops/templates/ios-landing`, a path that no longer exists,
so both were already inert before this change. Per `tooling/AGENTS.md` that
tree is noncanonical history and was left untouched.

**One cross-repository follow-up.** Site Health's Astro technology evidence for
SaaS Maker lists `tooling/templates/ios-landing/astro.config.mjs`. That path is
gone; the detection still holds on `apps/showcase/astro.config.mjs` and
`tooling/templates/web-landing/astro.config.mjs`. Site Health owns that record.

**Scan noise.** A naive `find` over the Fleet checkout also reports
`undefined/live/landing-astro`. That is a stray local clone of the `live`
repository into a directory literally named `undefined`, not a landing surface.
It is a working-copy accident and is not classified.

## Reproducing the scan

```bash
find . -maxdepth 6 -name 'astro.config.*' \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -not -path '*/dist/*' -not -path '*/.astro/*'
```

Run from the Fleet checkout root. Filter out documentation sites (`.blume/`,
`docs-site/`), application surfaces that are not landing pages, and this
repository's own templates. Confirm each remaining candidate has tracked files
before classifying it — three of the eleven rows above are already-removed
surfaces that a filesystem scan still reports because of leftover build output.
