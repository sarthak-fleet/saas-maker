---
name: fleet-ops
description: Route Fleet-wide audits, deploy checks, public-product smoke tests, spend reviews, project setup, and workspace decisions to the relevant subskill.
---

# fleet-ops — parent skill

Routes to the right subskill based on what the user is asking for.
Subskills live as sibling directories under `skills/`.

## Routing table

| User intent | Subskill | Path |
|---|---|---|
| "Is the fleet healthy?" / "check all projects" / "what's broken?" / "fleet status" / "what's everyone working on?" / "audit the fleet" | `fleet-audit` | `../fleet-audit/SKILL.md` |
| "Create a new project" / "scaffold X" / "add a new fleet product" / "init a new repo" | `fleet-init` | `../fleet-init/SKILL.md` |
| "Deploy X" / "can I deploy?" / "is X safe to deploy?" / "check deploy readiness" | `fleet-deploy-guard` | `../fleet-deploy-guard/SKILL.md` |
| "Does this work belong in a child project or fleet-ops?" / cross-project workspace decisions | `fleet-workspace` | `../fleet-workspace/SKILL.md` |
| "Do the public products work?" / "open every website and click around" / "test guest journeys" / "check each product's unique pages" | `public-product-smoke` | `../public-product-smoke/SKILL.md` |
| "Is everything deployed to the latest?" / "is production in sync with main?" / "what's not deployed yet?" / "are all sites live?" | `fleet-deploy-parity` | `../fleet-deploy-parity/SKILL.md` |
| "Am I paying Cloudflare or Turso?" / "will this project cost money?" / "will Turso block queries?" / "is this usage needed?" / "optimize cloud spend" | `cloudflare-spend-guard` | `../cloudflare-spend-guard/SKILL.md` |

## How to use

1. Read the user's request and match it to a row in the routing table.
2. Read the subskill's SKILL.md for the full contract (triggers, commands, output format).
3. Follow that subskill's instructions.

If the request spans multiple subskills (e.g. "audit the fleet, then scaffold a new project for the gap you find"), run them in sequence.

## What this skill does NOT cover

- Cross-repo open issue lists ("what's open across the fleet?", "the fleet
  backlog") → GitHub already aggregates this across every org. Use
  `gh search issues --state open --author @me --limit 100`, or the web view at
  `https://github.com/issues?q=is:open+author:@me+sort:updated-desc`. Fleet has
  no homegrown aggregator for this on purpose.
- Delegating to other agent CLIs → use the `call-teammate` skill
- Domain name generation → use `name-domains` skill
- Lighthouse/perf audits → use `psi-swarm` skill
- Public browser journeys → use the `public-product-smoke` subskill
- AI crawler readiness → use `agent-ready` skill
- On-page SEO audits → use `seo-audit` skill
- Codex context/token audits → use `token-budget` skill
- Fleet-wide "is production in sync with main?" → use `fleet-deploy-parity` skill
