# SaaS Maker agent instructions

## Boundary

SaaS Maker owns only:

- the public product directory;
- package documentation;
- @saas-maker/feedback;
- @saas-maker/ai-chat-footer;
- @saas-maker/portfolio-project-strip;
- the feedback API, image upload, project keys, narrow auth, and private inbox.
- public, credential-free reusable workflows, Fleet-owned skills, operator
  scripts, templates, and their capability directory under `tooling/`.

SaaS Maker Tooling owns shared schedules, skills, and host automation. Site
Health owns the private project catalog and portfolio operations. Drank, PSI
Swarm, Reel Pipeline, CodeVetter, App Health, and Mobile Dev Cockpit remain
independent products or repositories.

Do not add product task systems, marketing queues, analytics dashboards,
observability, App Health, AI gateways, testimonials, waitlists, Droid, or
fleet-control features here. Shared tooling must remain public,
credential-free, provider-bounded, and independently validated.

## Commands

~~~bash
pnpm test
pnpm typecheck
pnpm build:widget
pnpm check:shared-packages
pnpm build:showcase
pnpm build:cockpit
pnpm catalog:check-public
pnpm check:docs
~~~

Use PROJECT_STATUS.md for durable status. Public catalogue data is projected
from Site Health's canonical private `projects.json` and consumed here through
the checked-in `catalog/generated/public.json`; SaaS Maker never reads private
Fleet state at runtime.

The public directory labels each entry's curated `technologies` as “Prominent
tools.” When a product's material stack changes, update the canonical
`publicDirectory.projects[<id>].technologies` entry in Site Health and run
`pnpm catalog:sync-public` here in the same task. Never hand-edit the generated
catalog or expand this field into a dependency inventory.

Do not deploy, migrate, publish/deprecate npm packages, change DNS, or archive
repositories without explicit approval.
