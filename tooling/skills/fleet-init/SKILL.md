---
name: fleet-init
description: Scaffold a new fleet project — create the GitHub repo, AGENTS.md, PROJECT_STATUS.md, wrangler config, CI workflow, and fleet README entry. Use when the user says "create a new project", "scaffold X", "add a new fleet product", or "init a new repo".
---

# fleet-init — new project scaffolding

Creates a new fleet project with the standard structure: GitHub repo under the
personal incubator account by default, AGENTS.md, PROJECT_STATUS.md, CI
workflow, and a README entry in the fleet root. Set `FLEET_GITHUB_OWNER` when a
project should start directly inside a durable product organization.

## When to invoke

- "Create a new project called X"
- "Scaffold a new fleet product"
- "Add a new fleet project"
- "Init a new repo for X"

## What it creates

1. **GitHub repo** — `sarthakagrawal927/<name>` by default (private or public
   per user request), or `$FLEET_GITHUB_OWNER/<name>` when explicitly set
2. **Local checkout** — `~/Desktop/fleet/<name>/`
3. **AGENTS.md** — standard fleet agent file with shared standard reference
4. **PROJECT_STATUS.md** — with the 6 required sections (Why/What, Dependencies,
   Timeline, Products, Features, Todo/Planned/Deferred/Blocked)
5. **.gitignore** — standard Node/Cloudflare ignores
6. **CI workflow** — `.github/workflows/ci.yml` with lint + typecheck + test
7. **Fleet README entry** — adds the project to the appropriate category

## How to invoke

Confirm with the user:
- **Project name** (repo name, kebab-case)
- **Category** (support, personal+free-tool, personal+saas, data, research, support+saas)
- **One-line description**
- **Stack** (Astro/Vite/Next.js/Worker/Tauri/etc.)
- **Visibility** (public or private)

Then run the backing script:

```bash
bash ~/Desktop/fleet/saas-maker/tooling/scripts/fleet-init.sh <name> \
  --category <cat> \
  --desc "<one-line description>" \
  --stack "<stack>" \
  [--private]
```

The script:
1. Creates the GitHub repo (`sarthakagrawal927/<name>` by default) and clones it
2. Scaffolds AGENTS.md, PROJECT_STATUS.md, .gitignore, CI workflow
3. Commits and pushes the initial scaffold
4. Adds the project to the fleet README under the specified category
5. Commits and pushes the README update

## Post-creation checklist

- [ ] GitHub repo created and cloned
- [ ] AGENTS.md, PROJECT_STATUS.md, .gitignore committed
- [ ] CI workflow committed and passing (or skeleton)
- [ ] Fleet README updated with new project in the right category
- [ ] If the project uses Cloudflare: wrangler config created
- [ ] If the project uses a DB: schema + first migration created
