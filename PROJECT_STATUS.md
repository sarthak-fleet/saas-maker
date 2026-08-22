# SaaS Maker Project Status

## Why / What

SaaS Maker is the public product directory, the small shared feedback layer
used by selected products, and the home of backend-free SaaS Maker UI packages.
It exists to make the portfolio discoverable, provide one consistent way to
collect and review customer feedback, and package reusable public-facing
components without pulling product code into Foundry.

It is not the Fleet control plane. Site Health is the source of truth for the
private project catalog and portfolio health. Workflows and Skills owns shared
automation and agent skills. Drank, Reel Pipeline, PSI Swarm, Mobile Dev
Cockpit, CodeVetter, and App Health remain independent repositories.

## Dependencies

- Site Health's canonical `apps/backend/config/projects.json`, projected into
  `catalog/generated/public.json` before a directory release.
- Cloudflare Workers, D1, and R2 for the feedback API and image uploads.
- better-auth for the private inbox.
- Blume for package documentation.
- React as the peer runtime for @saas-maker/feedback.
- React as the peer runtime for the AI Chat Footer and Portfolio Project Strip.

## Timeline

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
  Worker custom domain. npm publication of `@saas-maker/feedback` and the
  Anime List consumer merge are still blocked.
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
| saas-maker-packages.pages.dev | Canonical Blume documentation for the feedback package |
| api.sassmaker.com | Feedback and project-key API |
| app.sassmaker.com | Private feedback inbox |
| @saas-maker/feedback | Maintained public runtime package |
| @saas-maker/ai-chat-footer | Backend-free AI assistant footer package |
| @saas-maker/portfolio-project-strip | Backend-free portfolio discovery strip package |

## Features (shipped)

- Deterministic 58-identity public projection consumed without private Fleet
  runtime access, with deny-by-default field validation.
- Searchable `/projects` register grouped by current, supporting/parked, and
  past work, with form-family and platform filters, mobile filter return,
  compact project anatomy, prominent tools, and native disclosures for public
  links, deployment context, and retained Git-history bounds.
- Matching human, JSON, Markdown, sitemap, and agent-readable directory
  surfaces.
- Feedback submission for bug, feature, and general feedback.
- Optional screenshots and page-element anchoring.
- Private cross-product feedback inbox with type/status filters and status controls.
- Machine-readable OpenAPI contract for submission, inbox, detail, and status updates.
- Project-scoped agent tokens that default to read-only.
- Immutable status-change audit records with actor identity.
- Page URL, Pinpoint context, and screenshots stored as original customer evidence.
- Project-key creation and management.
- Blume package docs plus agent/search surfaces.
- Backend-free AI assistant links with provider-specific prompt handoff.
- Accessible portfolio discovery with bundled first paint and optional cached
  revalidation from sassmaker.com.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sass-maker/saas-maker/issues).
