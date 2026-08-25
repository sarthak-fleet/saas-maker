# SaaS Maker Project Status

## Why / What

SaaS Maker is the public product directory, the small shared feedback layer
used by selected products, and the home of backend-free SaaS Maker UI packages.
It exists to make the portfolio discoverable, provide one consistent way to
collect and review customer feedback, and package reusable public-facing
components without pulling product code into Foundry.

It is not the Fleet control plane. Site Health is the source of truth for the
private project catalog and portfolio health. SaaS Maker Tooling owns shared
automation and agent skills under `tooling/`. Drank, Reel Pipeline, PSI Swarm, Mobile Dev
Cockpit, CodeVetter, and App Health remain independent repositories.

## Dependencies

- Site Health's canonical `apps/backend/config/projects.json`, projected into
  `catalog/generated/public.json` before a directory release.
- Cloudflare Workers, D1, and R2 for the feedback API and image uploads.
- better-auth for the private inbox.
- React as the peer runtime for @saas-maker/feedback.
- React as the peer runtime for the AI Chat Footer and Portfolio Project Strip.

## Timeline

- **2026-08-25 — Shared AI footer simplified and released:** Replaced the
  studio discovery rail and project ticker with a compact, host-neutral utility
  dock. Kept visible labels and 44px actions, added recognisable colour to all
  five provider icons, and made each action open a pre-filled AI conversation
  in a new tab. The hosted loader now removes the legacy project strip by
  default while retaining `data-compose="false"` as a migration escape hatch,
  and the shared landing template loads only the AI footer. Released feature
  commit `0bc7aed1` through Pages deployment
  `b7be0170-45b8-4878-a614-3fd446dd1c6c`; exact-SHA CI passed, production smoke
  passed 4/4, and cache-busted live checks confirmed the new loader contract.
  The shared package source changed but no npm package publication ran.

- **2026-08-25 — Studio identity and shared public footer released:** Published
  the canonical founder-led studio thesis at `/studio` with matching Markdown,
  homepage, `llms.txt`, `/api/ai`, metadata, and distinct Person, Organization,
  and WebSite JSON-LD projections. Moved representative product evidence ahead
  of the operating principles, exposed direct product and source links, aligned
  expanded project evidence to the directory column grid, and replaced the
  letter-mark AI footer with labelled provider icons and a structured studio
  discovery rail. Released feature commit `99bfbf26` through Pages deployment
  `62dccdc0-d6e0-4b54-9779-00d0a3fb6e83`; production smoke passed 4/4, live
  visual checks passed at 390/768/1440 with no overflow or console errors, and
  the agent-index audit passed S-tier at 100%. The shared package source changed
  but no npm package publication ran.

- **2026-08-24 — Public project profiles expanded:** Added one generated HTML
  and Markdown profile for each of the 53 non-directory identities, while SaaS
  Maker remains canonical at `/`. Every profile leads with a reviewed
  first-person maker note, then exposes privacy-safe product anatomy and public
  evidence. `/projects`, sitemap, JSON, and agent discovery share the same
  schema-v4 projection. `/p/saas-maker` redirects remain intact. No deployment
  or npm publication ran.

- **2026-08-23 — Public interior theme unified:** Applied the homepage's
  limestone-and-steel workshop system to Ideas, Tools, Learnings, and the
  learning article; simplified navigation to Products, Ideas, Tools, Learnings,
  and GitHub; and removed Package from shared navigation while retaining its
  homepage section. The Ideas UI now omits the 92 `starterstory` entries and
  shows 48 curated ideas, while `/ideas.json` retains all 140 source records.
  The package remains unpublished; this release changes only the public site.

- **2026-08-23 — Ideas absorbed into SaaS Maker:** Added `/ideas` as a native
  scored catalog with the preserved 140-item dataset, filters, sorting,
  responsive comparison, JSON, Markdown, sitemap, and agent discovery. Removed
  `saas-ideas` from Site Health's canonical project identities and regenerated
  the public directory at 57 identities. The retired repository remains only
  as source history. Released feature commit `11084b6a` through Pages deployment
  `1ea12d31-4abf-42f6-9ffe-eb117f4ae75d`; production smoke passed 4/4 and the
  HTML, JSON, and Markdown routes were verified on `sassmaker.com`. No DNS
  action ran.

- **2026-08-23 — Redundant workspace packages removed:** Removed the private
  `@saas-maker/ui` package after switching its only consumer to the dashboard's
  existing local components. Removed the duplicate Astro login overlay and use
  the dashboard's native `/` and `/login` routes. Removed the Blume app and its
  missing Pages target while retaining checked-in Markdown docs and link
  validation. No deployment, migration, DNS, or npm action ran.

- **2026-08-23 — Shared tooling consolidated:** Imported the complete public
  Workflows and Skills history under `tooling/`, moved reusable GitHub workflow
  entrypoints to the repository root, and added human and JSON capability
  directories at `/tools` and `/tools.json`. Callers resolve one SaaS Maker
  source; predecessor archival is verified separately after cutover.

- **2026-08-22 — Homepage and directory roles separated:** Reduced the public
  homepage to four products in focus, one complete-directory gateway, the
  current learning entry, and SaaS Maker's package surfaces. Removed the
  repeated maintained/past catalogs and SaaS Maker's self-embedded portfolio
  strip; `/projects` remains the sole complete 58-identity register, with the
  same boundary reflected in the agent-readable homepage.
- **2026-08-22 — Complete directory distilled:** Replaced 58 repeated,
  full-height anatomy panels with compact specimen rows. Purpose, form,
  platforms, prominent tools, and destination remain visible; public links,
  deployment evidence, and retained Git bounds use accessible native
  disclosures. Wide layouts label columns once per lifecycle group, while
  stacked layouts restore local labels for context.
- **2026-08-22 — Complete Fleet directory published:** Expanded the public,
  privacy-filtered projection from the maintained subset to all 58 retained
  Fleet identities. The new `/projects` register separates current,
  supporting/parked, and past work; exposes public destinations, deployment
  classification, platforms, curated technology, and first/latest retained Git
  commit dates; and keeps the HTML, JSON, Markdown, sitemap, and agent surfaces
  aligned without runtime access to Site Health.
- **2026-08-22 — Feedback agent contract deployed:** Applied D1 migration
  `0025` (both preserved feedback rows kept), deployed `saasmaker-api` and
  `saasmaker-dashboard` at `c5d3e845`, and attached `app.sassmaker.com` as a
  Worker custom domain. The Anime List consumer merge is still blocked.
  `@saas-maker/feedback` is published on npm at `0.4.0` (4 versions).
- **2026-08-22 — Inbox sign-in is down; package docs host is missing:**
  `saasmaker-dashboard` carries no Worker secrets, so every `/api/auth/*` route
  returns 500 — better-auth 1.6.30 (bumped in `b9b5858a`) refuses to run on its
  default secret instead of warning. `BETTER_AUTH_SECRET`, `AUTH_GOOGLE_ID` and
  `AUTH_GOOGLE_SECRET` all need attaching; `pnpm deploy:cockpit` now blocks
  while any is absent. Separately, Pages project `saas-maker-packages` does not
  exist, so `saas-maker-packages.pages.dev` has no DNS and the feedback package
  documentation this file and README both advertise is unreachable. The public
  submit path, `api.sassmaker.com`, and the npm package are unaffected.
- **2026-08-22 — Standalone catalog boundary repaired:** Repointed public
  catalog synchronization to Site Health's canonical `projects.json`, retained
  the checked-in privacy-filtered projection for runtime use, and repointed the
  deploy guard to Workflows and Skills. No deployment or package publication
  ran.
- **2026-08-21 — Shared UI packages moved out of Foundry:** Imported
  `@saas-maker/ai-chat-footer` and `@saas-maker/portfolio-project-strip` with
  their component histories, added them to the SaaS Maker workspace and CI,
  and changed Portfolio Project Strip generation to consume SaaS Maker's
  checked-in 31-product public catalog projection. No npm publication or
  deployment ran.
- **2026-08-20 — Standalone ownership restored:** Restored SaaS Maker as the
  canonical public-directory and Feedback repository, synchronized the current
  directory and package sources from Fleet, and narrowed Feedback to public
  submission plus an authenticated private inbox and JSON agent contract.

- **2026-07-22 — Feedback package 0.3.0 prepared:** Versioned the current
  page-element anchoring release, restored React 18 and 19 peer compatibility,
  completed npm metadata and quickstart styling instructions, and verified the
  packed artifact in clean React 18 and React 19 consumers. Publishing remains
  a separate manual release action.
- **2026-07-22 — Public directory links hardened:** Fleet's public projection
  now omits unavailable roadmaps and private source links instead of rendering
  dead GitHub URLs. Human-readable and agent-readable directory surfaces both
  render only links that are actually public.
- **2026-07-21 — Narrow production deployed:** Directory, feedback API,
  feedback inbox, and Blume package docs are live. The directory consumes the
  synchronized Fleet projection, shows the five approved spotlight entries,
  and links package docs to their live Pages origin until the vanity domain is
  attached. Shared production smoke passes 9/9.
- **2026-07-21 — Production cutover authorized:** The narrowed source, four
  canonical Cloudflare targets, and manual deploy commands are the approved
  production state. Every deploy remains gated on clean, synchronized `main`,
  green CI for the exact commit, and live smoke verification of all surfaces.
- **2026-07-21 — Narrow-source cleanup completed locally:** Removed duplicated
  Fleet services, operational Cockpit pillars, non-feedback API routes, Droid,
  App Health copies, SDK/CLI, retired widgets, skills, host automation, and stale
  planning/docs source. The private Cockpit now contains only feedback and
  project-key surfaces. No production migration, deploy, DNS change, npm action,
  or repository archival was performed. Historical database tables remain
  untouched for a safe cutover.
- **2026-07-20 — Fleet Workspace boundary established:** Imported and reconciled
  Fleet Ops, Reel Pipeline, Content Factory, Drank, Mobile Dev Cockpit, PSI
  Swarm, registries, marketing operations, and host automation into
  sass-maker/fleet-workspace with component-native checks.

## Products

| Surface | Purpose |
| --- | --- |
| sassmaker.com | Public product directory |
| sassmaker.com/ideas | Scored product-idea decision ledger |
| api.sassmaker.com | Feedback and project-key API |
| app.sassmaker.com | Private feedback inbox |
| @saas-maker/feedback | Maintained public runtime package |
| @saas-maker/ai-chat-footer | Backend-free AI assistant footer package |
| @saas-maker/portfolio-project-strip | Backend-free portfolio discovery strip package |
| sassmaker.com/tools | Public directory for reusable skills, scripts, templates, and guides |
| tooling/ | Canonical credential-free shared automation source |

## Features (shipped)

- Canonical `/studio` identity with a personal position on AI, representative
  catalog-backed work, honest studio boundaries, selective commission path,
  matching Markdown/API projections, and entity-correct structured data.
- Curated public homepage with four products in focus and a single gateway to
  the complete register, without duplicating the 54-project directory.
- Deterministic 54-identity public projection consumed without private Fleet
  runtime access, with deny-by-default field validation.
- Expanded project profiles with a reviewed first-person maker note, public
  anatomy, canonical destinations, public repository evidence, matching
  Markdown, and honest local-only/no-public-destination states.
- Native `/ideas` catalog with 48 UI-curated ideas, decision filters, sortable
  desktop and mobile layouts, and complete 140-record JSON/Markdown archives;
  `starterstory` records remain in the archives but are not rendered in the UI.
- Searchable `/projects` register grouped by current, supporting/parked, and
  past work, with form-family and platform filters, mobile filter return,
  compact project anatomy, prominent tools, and native disclosures for public
  links, deployment context, and retained Git-history bounds.
- Matching human, JSON, Markdown, sitemap, and agent-readable directory
  surfaces.
- Public human and JSON indexes for reusable Fleet capabilities, backed by the
  same checked-in catalog validator used by operators and agents.
- Feedback submission for bug, feature, and general feedback.
- Optional screenshots and page-element anchoring.
- Private cross-product feedback inbox with type/status filters and status controls.
- Machine-readable OpenAPI contract for submission, inbox, detail, and status updates.
- Project-scoped agent tokens that default to read-only.
- Immutable status-change audit records with actor identity.
- Page URL, Pinpoint context, and screenshots stored as original customer evidence.
- Project-key creation and management.
- Repository-native package and service docs with link validation.
- Backend-free AI assistant links with provider-specific prompt handoff.
- Accessible portfolio discovery with bundled first paint and optional cached
  revalidation from sassmaker.com.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sass-maker/saas-maker/issues).
