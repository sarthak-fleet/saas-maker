# SaaS Maker agent instructions

## Boundary

SaaS Maker owns only:

- the public product directory;
- Blume package documentation;
- @saas-maker/feedback;
- the feedback API, image upload, project keys, narrow auth, and private inbox.

Fleet Workspace owns shared schedules, skills, host automation, registries,
and portfolio operations. Drank, PSI Swarm, Reel Pipeline, CodeVetter, App
Health, and Mobile Dev Cockpit remain independent products or repositories.

Do not add tasks, workflows, jobs, marketing queues, analytics dashboards,
observability, App Health, AI gateways, changelogs, testimonials, waitlists,
Droid, or fleet-control features here.

## Commands

~~~bash
pnpm test
pnpm typecheck
pnpm build:widget
pnpm build:showcase
pnpm build:docs
pnpm build:cockpit
pnpm catalog:check-public
pnpm check:docs
~~~

Use PROJECT_STATUS.md for durable status. Public catalogue data is generated in
Fleet Workspace and consumed here through the checked-in
catalog/generated/public.json; SaaS Maker never reads private Fleet state at
runtime.

Do not deploy, migrate, publish/deprecate npm packages, change DNS, or archive
repositories without explicit approval.
