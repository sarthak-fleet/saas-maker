# Fleet portfolio project strip package instructions

Also follow `../../../AGENTS.md`.

This directory owns only the backend-free `@saas-maker/portfolio-project-strip`
React package. It must not gain a default endpoint, credentials, analytics,
storage, or a Fleet-hosted runtime.

Run `pnpm check` before shipping package changes. Publishing remains an explicit
release action.
