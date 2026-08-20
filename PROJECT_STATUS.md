# SaaS Maker Project Status

## Why / What

SaaS Maker is the public product directory and the small shared feedback layer
used by selected products. It exists to make the portfolio discoverable and to
provide one consistent way to collect and review customer feedback.

It is not the Fleet control plane. Fleet Workspace is the single source of truth
for internal project metadata, marketing automation, schedules, skills, Drank,
Reel Pipeline, PSI Swarm, Mobile Dev Cockpit, and common infrastructure.
CodeVetter and App Health remain independent.

## Dependencies

- Fleet Workspace's allowlisted `foundry/ops/public/products.json`, synchronized
  into catalog/generated/public.json before a directory release.
- Cloudflare Workers, D1, and R2 for the feedback API and image uploads.
- better-auth for the private inbox.
- Blume for package documentation.
- React as the peer runtime for @saas-maker/feedback.

## Timeline

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

## Features (shipped)

- Deterministic 19-product public projection consumed without private Fleet
  runtime access.
- Feedback submission for bug, feature, and general feedback.
- Optional screenshots and page-element anchoring.
- Private cross-product feedback inbox with type/status filters and status controls.
- Machine-readable OpenAPI contract for submission, inbox, detail, and status updates.
- Project-key creation and management.
- Blume package docs plus agent/search surfaces.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sass-maker/saas-maker/issues).
