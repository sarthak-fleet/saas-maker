#!/usr/bin/env bash
#
# Scaffold a new fleet project — creates GitHub repo, local checkout,
# AGENTS.md, PROJECT_STATUS.md, .gitignore, CI workflow, and fleet README entry.
# Backs the fleet-init skill.
#
# Usage:
#   bash foundry/ops/scripts/fleet-init.sh <name> --category <cat> --desc <desc> --stack <stack> [--private]
#   bash foundry/ops/scripts/fleet-init.sh my-project --category data --desc "evidence tracker" --stack "Astro + CF Workers"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NAME=""
CATEGORY=""
DESC=""
STACK=""
VISIBILITY="--public"
GITHUB_OWNER="${FLEET_GITHUB_OWNER:-sarthakagrawal927}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --category) CATEGORY="$2"; shift 2 ;;
    --desc) DESC="$2"; shift 2 ;;
    --stack) STACK="$2"; shift 2 ;;
    --private) VISIBILITY="--private"; shift ;;
    -h|--help)
      echo "Usage: fleet-init.sh <name> --category <cat> --desc <desc> --stack <stack> [--private]"
      echo "Categories: support, personal, saas, data, research"
      exit 0
      ;;
    *)
      if [[ -z "$NAME" ]]; then
        NAME="$1"
      else
        echo "Unknown arg: $1" >&2; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$NAME" || -z "$CATEGORY" || -z "$DESC" ]]; then
  echo "Usage: fleet-init.sh <name> --category <cat> --desc <desc> --stack <stack> [--private]" >&2
  echo "Missing required args. Name, category, and desc are required." >&2
  exit 1
fi

DIR="$ROOT/$NAME"

if [[ -d "$DIR" ]]; then
  echo "Directory already exists: $DIR" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated" >&2
  exit 1
fi

echo "=== Creating fleet project: $NAME ==="
echo "Category: $CATEGORY"
echo "Description: $DESC"
echo "Stack: ${STACK:-unspecified}"
echo "Visibility: ${VISIBILITY#--}"
echo ""

# 1. Create GitHub repo and clone
echo "1. Creating GitHub repo $GITHUB_OWNER/$NAME..."
gh repo create "$GITHUB_OWNER/$NAME" $VISIBILITY \
  --description "$DESC" \
  2>/dev/null || {
    echo "  gh repo create failed — repo may already exist" >&2
    exit 1
  }

gh repo clone "$GITHUB_OWNER/$NAME" "$DIR" \
  2>/dev/null || {
    echo "  gh repo clone failed — remote was created but local checkout was not" >&2
    exit 1
  }

cd "$DIR"

# 2. .gitignore
cat > .gitignore <<'GITEOF'
node_modules/
dist/
.env*
.wrangler/
.astro/
.agents/
.claude/
.DS_Store
*.log
*.db
*.db-journal
GITEOF

# 3. AGENTS.md
cat > AGENTS.md <<AGENTSEOF
## Shared Fleet Standard

Also read and follow the shared fleet-level agent standard at \`../AGENTS.md\`. Treat this repository as owned product code: protect production stability, keep changes scoped, verify work, and record durable follow-up tasks when something remains incomplete or blocked.

## Project

- **Stack**: ${STACK:-TBD}
- **Local dev**: TBD
- **Deploy**: TBD

## Visual work

For meaningful visual work, use the Fleet-local \`\$design-workflow\` skill and
the shared \`../LANDING_STANDARD.md\` where applicable. Classify preserve or
overhaul before code; keep \`PROJECT_STATUS.md\` authoritative for product
scope, \`PRODUCT.md\` limited to design context, and \`DESIGN.md\` authoritative
for visual direction. Do not claim completion until the Fleet design-review
receipt passes.
AGENTSEOF

# 4. PROJECT_STATUS.md
cat > PROJECT_STATUS.md <<STATUSEOF
# $NAME — PROJECT STATUS

Last updated: $(date +%Y-%m-%d)

## Why / What

$DESC

**Users:** TBD

**IN scope:** TBD

**OUT of scope:** TBD

## Dependencies

### External

- TBD

### Internal

- TBD

## Timeline

- $(date +%Y-%m-%d) — project scaffolded

## Products

- TBD

## Features (shipped)

- (none yet)

## Todo / Planned / Deferred / Blocked

1. TBD
STATUSEOF

# 5. CI workflow
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<CIEOF
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm run check
CIEOF

# 6. Commit and push initial scaffold
git add -A
git commit -m "Initial scaffold

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
git push origin main 2>/dev/null || true

# Keep Fleet and approved external skills available locally without committing
# machine-specific symlinks into the new repository.
"$ROOT/foundry/ops/scripts/link-project-agent-assets.sh" --skills-only "$NAME"

echo ""
echo "2. Scaffold files committed and pushed."
echo ""

# 7. Add to fleet README
echo "3. Adding to fleet README under category: $CATEGORY..."

README="$ROOT/README.md"
ENTRY="- [$NAME](https://github.com/$GITHUB_OWNER/$NAME) — $DESC"

# Find the category section and add the entry
python3 - "$README" "$ENTRY" "$CATEGORY" <<'PYEOF'
import sys, re

readme_path, entry, category = sys.argv[1], sys.argv[2], sys.argv[3]

with open(readme_path, 'r') as f:
    content = f.read()

# Map category to the section header
section_map = {
    'support': 'Support',
    'support+saas': 'Support + SaaS',
    'research': 'Research',
    'personal+free-tool': 'Personal + free-tool',
    'personal+saas': 'Personal + SaaS',
    'data': 'Data',
}

header = section_map.get(category.lower(), category)
# Find the section and add entry before the next blank line that precedes another section
pattern = rf'(\*\*{re.escape(header)}\*\*[^\n]*\n(?:[^\n]*\n)*?)(?=\n\*\*|\n>|\Z)'
match = re.search(pattern, content)
if match:
    section = match.group(1)
    # Add entry at end of section
    new_section = section.rstrip('\n') + '\n' + entry + '\n'
    content = content[:match.start()] + new_section + content[match.end():]
    with open(readme_path, 'w') as f:
        f.write(content)
    print(f"  Added entry under '{header}' section")
else:
    print(f"  WARNING: could not find '{header}' section in README — add manually")
PYEOF

cd "$ROOT"
git add README.md
git commit -m "fleet: add $NAME to README under $CATEGORY

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>" 2>/dev/null || true
git push origin main 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Project: $NAME"
echo "Repo: https://github.com/$GITHUB_OWNER/$NAME"
echo "Local: $DIR"
echo "Fleet README: updated under $CATEGORY"
echo ""
echo "Post-creation checklist:"
echo "  [ ] AGENTS.md, PROJECT_STATUS.md, .gitignore committed"
echo "  [ ] CI workflow committed (may need adjusting for your stack)"
echo "  [ ] Fleet README updated"
echo "  [ ] If visual: run \$design-workflow and pass the Fleet design-review receipt"
echo "  [ ] If Cloudflare: create wrangler config"
echo "  [ ] If DB: create schema + first migration"
