#!/usr/bin/env bash
#
# Fleet health check — update clean repositories, then check git state, CI
# signal, and branch status across the independent repositories in the Fleet
# workspace.
# Backs the fleet-audit skill (health mode).
#
# Usage:
#   bash scripts/fleet-health.sh
#   bash scripts/fleet-health.sh --no-fetch   # skip git fetch/pull
#   bash scripts/fleet-health.sh --only aliveville,codevetter

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FETCH=true
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-fetch) FETCH=false; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: fleet-health.sh [--no-fetch] [--only slug1,slug2]"
      echo "  By default, clean non-diverged branches are fast-forwarded from upstream."
      echo "  --no-fetch skips both fetch and pull."
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Discover the independent Git checkouts present at the Fleet workspace root.
# Canonical product/domain inventory still lives in projects.json; this health
# command audits the repositories that can actually be synchronized locally.
get_projects() {
  find "$ROOT" -mindepth 1 -maxdepth 1 -type d \
    -exec test -d '{}/.git' ';' -print \
    | while IFS= read -r project_dir; do
        basename "$project_dir"
      done \
    | sort -u
}

if [[ -n "$ONLY" ]]; then
  PROJECTS=$(echo "$ONLY" | tr ',' '\n' | sort -u)
else
  PROJECTS=$(get_projects)
fi

printf '%-20s %-10s %-8s %-8s %s\n' "PROJECT" "BRANCH" "GIT" "CI" "NOTES"
printf '%-20s %-10s %-8s %-8s %s\n' "-------" "------" "---" "--" "-----"

clean=0
dirty=0
ci_red=0
ci_unknown=0
ci_off=0
ci_none=0
total=0

for project in $PROJECTS; do
  dir="$ROOT/$project"
  total=$((total + 1))
  notes=""

  if [[ ! -d "$dir/.git" ]]; then
    printf '%-20s %-10s %-8s %-8s %s\n' "$project" "-" "-" "-" "no .git dir"
    continue
  fi

  if [[ "$FETCH" == true ]]; then
    if ! git -C "$dir" fetch --quiet 2>/dev/null; then
      notes="fetch failed"
    fi
  fi

  branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "DETACHED")

  # Never merge or overwrite local work during a health check. A clean branch
  # that is strictly behind its upstream can be updated with a fast-forward.
  upstream=$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  if [[ "$FETCH" == true && -n "$branch" && -n "$upstream" && -z "$(git -C "$dir" status --porcelain 2>/dev/null)" ]]; then
    read -r behind_before ahead_before < <(
      git -C "$dir" rev-list --left-right --count "$upstream...HEAD" 2>/dev/null || echo "0 0"
    )
    if [[ "$behind_before" -gt 0 && "$ahead_before" -eq 0 ]]; then
      if git -C "$dir" pull --ff-only --quiet 2>/dev/null; then
        notes="${notes:+$notes }pulled=$behind_before"
      else
        notes="${notes:+$notes }pull failed"
      fi
    fi
  fi

  if [[ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]]; then
    git_state="dirty"
    dirty=$((dirty + 1))
  else
    git_state="clean"
    clean=$((clean + 1))
  fi

  # CI check via gh
  ci_state="unknown"
  # A repository with no workflow files has no CI to judge. Several Fleet
  # projects are native apps released through TestFlight by hand, so this is a
  # deliberate state rather than a broken one — report it as such instead of
  # folding it into "unknown" alongside genuinely unclear CI.
  if [[ -z "$(find "$dir/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)" ]]; then
    ci_state="none"
    ci_none=$((ci_none + 1))
    notes="${notes:+$notes }no workflows"
  elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    url=$(git -C "$dir" remote get-url origin 2>/dev/null || true)
    slug=""
    case "$url" in
      git@github.com:*) slug="${url#git@github.com:}" ;;
      https://github.com/*) slug="${url#https://github.com/}" ;;
    esac
    slug="${slug%.git}"

    if [[ -n "$slug" ]]; then
      # A repository with Actions switched off has no CI state to judge.
      # Report that plainly rather than counting it as unknown: otherwise a
      # deliberately disabled repository looks identical to one whose CI is
      # silently broken. Note that workflow_dispatch against a disabled
      # repository strands a run in `queued` that cannot be cancelled (HTTP
      # 500) or deleted (HTTP 403), which is how this state usually surfaces.
      actions_enabled=$(gh api "repos/$slug/actions/permissions" --jq '.enabled' 2>/dev/null || true)
      if [[ "$actions_enabled" == "false" ]]; then
        ci_state="off"
        ci_off=$((ci_off + 1))
        notes="${notes:+$notes }Actions disabled"
      else
        # Judge repository CI from pushes to main. Scheduled data refreshes are
        # operational signals and must not replace the product's current CI state.
        ci_record=$(gh run list -R "$slug" --branch main --event push --limit 1 \
          --json conclusion,headSha --jq '.[0] | [.conclusion // "none", .headSha // ""] | @tsv' \
          2>/dev/null || true)
        read -r conclusion ci_sha <<< "$ci_record"
        main_sha=$(git -C "$dir" rev-parse origin/main 2>/dev/null || true)
        if [[ -n "$ci_sha" && -n "$main_sha" && "$ci_sha" != "$main_sha" ]]; then
          ci_state="unknown"
          ci_unknown=$((ci_unknown + 1))
          notes="${notes:+$notes }CI stale"
        else
          case "$conclusion" in
            success) ci_state="green" ;;
            failure|timed_out|action_required|startup_failure)
              ci_state="red"
              ci_red=$((ci_red + 1))
              notes="${notes:+$notes }CI failing"
              ;;
            cancelled)
              ci_state="unknown"
              ci_unknown=$((ci_unknown + 1))
              notes="${notes:+$notes }CI cancelled"
              ;;
            none|"")
              ci_state="unknown"
              ci_unknown=$((ci_unknown + 1))
              ;;
            *) ci_state="$conclusion" ;;
          esac
        fi
      fi
    else
      ci_unknown=$((ci_unknown + 1))
    fi
  else
    ci_unknown=$((ci_unknown + 1))
  fi

  # Check remote sync
  if [[ -n "$upstream" ]]; then
    read -r behind ahead < <(git -C "$dir" rev-list --left-right --count "$upstream...HEAD" 2>/dev/null || echo "0 0")
    if [[ "$ahead" -gt 0 ]]; then
      notes="$notes ahead=$ahead"
    fi
    if [[ "$behind" -gt 0 ]]; then
      notes="$notes behind=$behind"
    fi
  fi

  printf '%-20s %-10s %-8s %-8s %s\n' "$project" "$branch" "$git_state" "$ci_state" "$notes"
done

echo ""
summary="Summary: $total projects — $clean clean, $dirty dirty, $ci_red CI-red, $ci_unknown CI-unknown"
if [[ "$ci_off" -gt 0 ]]; then
  summary="$summary, $ci_off Actions-disabled"
fi
if [[ "$ci_none" -gt 0 ]]; then
  summary="$summary, $ci_none no-workflows"
fi
echo "$summary"

if [[ $ci_red -gt 0 ]]; then
  exit 1
fi
