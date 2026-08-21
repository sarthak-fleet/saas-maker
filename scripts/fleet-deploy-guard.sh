#!/usr/bin/env bash
#
# Deploy readiness gate — verifies a project is safe to deploy before
# allowing the deploy command to run. Backs the fleet-deploy-guard skill.
#
# Usage:
#   bash foundry/ops/scripts/fleet-deploy-guard.sh <project>

set -euo pipefail

ROOT="${FLEET_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
FORCE=false

if [[ $# -lt 1 ]]; then
  echo "Usage: fleet-deploy-guard.sh <project> [--force]" >&2
  exit 1
fi

PROJECT="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

DIR="$ROOT/$PROJECT"
PROJECT_DIR="$DIR"

if [[ ! -d "$DIR/.git" ]]; then
  registry="$ROOT/foundry/ops/config/projects.json"
  repo_path=""
  if [[ -d "$ROOT/.git" && -f "$registry" ]] && command -v jq >/dev/null 2>&1; then
    repo_path="$(
      jq -r --arg project "$PROJECT" '
        .projects[]
        | select(.id == $project)
        | .repo // ""
      ' "$registry" 2>/dev/null || true
    )"
  fi

  if [[ -n "$repo_path" && "$repo_path" != /* && "$repo_path" != *".."* &&
    -d "$ROOT/$repo_path" ]]; then
    DIR="$ROOT"
    PROJECT_DIR="$ROOT/$repo_path"
  else
    echo "PROJECT: $PROJECT"
    echo "  ✗ no standalone repo or registered monorepo path for $PROJECT"
    exit 1
  fi
fi

cd "$DIR"

pass=0
fail=0
gates=""

check() {
  local label="$1"
  local result="$2"
  local detail="$3"
  if [[ "$result" == "ok" ]]; then
    gates+="$(printf '%-20s %s ✓ %s\n' "$label" "" "$detail")\n"
    pass=$((pass + 1))
  else
    gates+="$(printf '%-20s %s ✗ %s\n' "$label" "" "$detail")\n"
    fail=$((fail + 1))
  fi
}

read_wrangler_name() {
  local file="$1"
  local name=""
  if [[ "$file" == *.json* ]] && command -v jq >/dev/null 2>&1; then
    name=$(jq -r '.name // empty' "$file" 2>/dev/null || true)
  elif [[ "$file" == *.toml ]]; then
    name=$(grep -E '^\s*name\s*=' "$file" 2>/dev/null | head -1 | sed -E 's/.*=\s*"([^"]+)".*/\1/' || true)
  fi
  # jq intentionally rejects JSONC comments and trailing commas. Wrangler
  # accepts both, so fall back to the top-level name line for JSON configs.
  if [[ -z "$name" && "$file" == *.json* ]]; then
    name=$(sed -nE 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$file" | head -1)
  fi
  printf '%s' "$name"
}

# 1. On main branch?
branch=$(git branch --show-current 2>/dev/null || echo "DETACHED")
if [[ "$branch" == "main" ]]; then
  check "Branch" "ok" "main"
else
  check "Branch" "fail" "on $branch (not main)"
fi

# 2. Clean working tree?
if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
  check "Git" "ok" "clean"
else
  dirty_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  check "Git" "fail" "dirty ($dirty_count uncommitted files)"
fi

# 3. Synced with remote?
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [[ -n "$upstream" ]]; then
  read -r behind ahead < <(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null || echo "0 0")
  if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then
    check "Remote" "ok" "synced"
  else
    check "Remote" "fail" "ahead=$ahead behind=$behind"
  fi
else
  check "Remote" "fail" "no upstream configured"
fi

# 4. CI green for the exact main commit?
if [[ "$FORCE" == true ]]; then
  check "CI" "ok" "skipped (--force)"
else
  ci_result="unknown"
  ci_detail=""

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    url=$(git remote get-url origin 2>/dev/null || true)
    slug=""
    case "$url" in
      git@github.com:*) slug="${url#git@github.com:}" ;;
      https://github.com/*) slug="${url#https://github.com/}" ;;
    esac
    slug="${slug%.git}"

    if [[ -n "$slug" ]]; then
      head_sha=$(git rev-parse HEAD 2>/dev/null || true)
      conclusion=$(gh run list -R "$slug" --branch main --commit "$head_sha" --event push --limit 1 \
        --json conclusion -q '.[0].conclusion // "none"' 2>/dev/null || echo "none")
      case "$conclusion" in
        success) ci_result="ok"; ci_detail="green for ${head_sha:0:8}" ;;
        failure|cancelled|timed_out|action_required|startup_failure)
          ci_result="fail"; ci_detail="red ($conclusion)"
          ;;
        *) ci_result="fail"; ci_detail="no completed push CI for ${head_sha:0:8}" ;;
      esac
    else
      ci_result="fail"; ci_detail="no GitHub remote"
    fi
  else
    ci_result="fail"; ci_detail="gh not available"
  fi

  check "CI" "$ci_result" "$ci_detail"
fi

# 5. Cloudflare target known?
# Check root first, then subdirectories (monorepo support)
cf_target=""
for f in "$PROJECT_DIR/wrangler.toml" "$PROJECT_DIR/wrangler.jsonc" "$PROJECT_DIR/wrangler.json"; do
  if [[ -f "$f" ]]; then
    cf_target=$(read_wrangler_name "$f")
    [[ -n "$cf_target" ]] && break
  fi
done

# If not at root, check one level deep (monorepo: workers/, apps/, etc.)
if [[ -z "$cf_target" ]]; then
  while IFS= read -r -d '' f; do
    cf_target=$(read_wrangler_name "$f")
    [[ -n "$cf_target" ]] && break
  done < <(find "$PROJECT_DIR" -maxdepth 3 -name "wrangler.*" -not -path '*/node_modules/*' -print0 2>/dev/null)
  [[ -n "$cf_target" ]] && cf_target="$cf_target (subdir)"
fi

if [[ -z "$cf_target" && -f "$PROJECT_DIR/package.json" && "$(command -v node || true)" ]]; then
  deploy_script=$(node -e "const p=require(process.argv[1]); process.stdout.write(p.scripts?.deploy || '')" "$PROJECT_DIR/package.json" 2>/dev/null || true)
  if [[ "$deploy_script" == *"wrangler pages deploy"* ]]; then
    cf_target=$(printf '%s\n' "$deploy_script" | sed -nE 's/.*--project-name[= ]([^ ]+).*/\1/p' | head -1)
    [[ -z "$cf_target" ]] && cf_target="package deploy script"
  elif [[ "$deploy_script" == *"manual-deploy"* ]]; then
    cf_target="package manual deploy script"
  fi
fi

# Some products keep a standalone Pages site below the repository root (for
# example, pace/website). Recognize the same guarded deploy scripts there.
if [[ -z "$cf_target" && "$(command -v node || true)" ]]; then
  while IFS= read -r -d '' package_file; do
    deploy_script=$(node -e '
      const fs = require("node:fs");
      const file = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      process.stdout.write(pkg.scripts?.deploy || "");
    ' "$package_file" 2>/dev/null || true)
    if [[ "$deploy_script" == *"wrangler pages deploy"* ]]; then
      cf_target=$(printf '%s\n' "$deploy_script" | sed -nE 's/.*--project-name[= ]([^ ]+).*/\1/p' | head -1)
      [[ -z "$cf_target" ]] && cf_target="package deploy script"
      cf_target="$cf_target (subdir)"
      break
    elif [[ "$deploy_script" == *"manual-deploy"* ]]; then
      cf_target="package manual deploy script (subdir)"
      break
    fi
  done < <(find "$PROJECT_DIR" -maxdepth 2 -name package.json -not -path "$PROJECT_DIR/package.json" -not -path '*/node_modules/*' -print0 2>/dev/null)
fi

if [[ -z "$cf_target" && -f "$ROOT/foundry/ops/config/projects.json" ]] &&
  command -v jq >/dev/null 2>&1; then
  cf_target="$(
    jq -r --arg project "$PROJECT" '
      .projects[]
      | select(.id == $project and .status == "live")
      | if ((.deployTargets // []) | length) > 0 then
          [.deployTargets[].name] | join(", ")
        else
          .cfProject // ""
        end
    ' "$ROOT/foundry/ops/config/projects.json" 2>/dev/null || true
  )"
  [[ -n "$cf_target" ]] && cf_target="$cf_target (registry)"
fi

if [[ -n "$cf_target" ]]; then
  check "CF target" "ok" "$cf_target"
else
  check "CF target" "fail" "no wrangler config found"
fi

# 6. Operational work lives in GitHub Issues. The guard intentionally does not
# reconstruct a second task database from PROJECT_STATUS.md. A future GitHub
# integration can make labelled release blockers a machine gate.
check "Work queue" "ok" "GitHub Issues are authoritative; review linked blockers"

# Output
echo "PROJECT: $PROJECT"
echo ""
printf "$gates"
echo ""

if [[ $fail -gt 0 ]]; then
  echo "→ NOT READY — fix $fail gate(s) above before deploying"
  exit 1
else
  echo "→ READY TO DEPLOY ($pass gates passed)"
  exit 0
fi
