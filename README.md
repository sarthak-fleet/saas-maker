# SaaS Maker

SaaS Maker owns the public product directory and a small set of reusable,
backend-free product packages. It also provides the focused Feedback service,
image upload, project keys, and private feedback inbox.

Site Health owns private project identity and portfolio operations. SaaS Maker
consumes only its checked-in, privacy-filtered public catalog and never reads
private Fleet state at runtime. Reusable public automation is canonical under
[`tooling/`](tooling/README.md) and indexed at
[sassmaker.com/tools](https://sassmaker.com/tools).

## Products

- [sassmaker.com](https://sassmaker.com) — public product directory.
- [sassmaker.com/ideas](https://sassmaker.com/ideas) — scored product-idea
  decision ledger.
- [sassmaker.com/tools](https://sassmaker.com/tools) — reusable skills,
  workflows, scripts, templates, and guides.
- `@saas-maker/feedback` — React feedback widget backed by the optional hosted
  submission service.
- `@saas-maker/ai-chat-footer` — backend-free links for asking AI assistants
  about a product.
- `@saas-maker/portfolio-project-strip` — accessible project-discovery footer
  backed by the same safe catalog as sassmaker.com.
- `api.sassmaker.com` — Feedback and project-key API.
- `app.sassmaker.com` — private Feedback inbox.

Package and service documentation stays in [`docs/`](docs/README.md) and the
individual package READMEs.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check:shared-packages
pnpm build:widget
pnpm build:showcase
pnpm build:cockpit
```

Production deployment and npm publication remain separate manual actions.
See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for durable product status and
[GitHub Issues](https://github.com/sass-maker/saas-maker/issues) for work.
