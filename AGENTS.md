# Fleet AI Chat Footer package instructions

Also follow `../../../AGENTS.md`.

This directory owns only the backend-free `@saas-maker/ai-chat-footer` React
package. It must not gain a default endpoint, project keys, auth, storage,
analytics, a backend, or a Fleet-hosted runtime.

Run `pnpm check` before shipping package changes. Publishing remains an explicit
release action.
