#!/usr/bin/env bash

set -euo pipefail

ROOT="$(pwd)"
ALL=false
FETCH=true

usage() {
  echo "Usage:"
  echo "  git-health.sh                 # scan current repo"
  echo "  git-health.sh --all ~/code    # scan root + immediate child repos under ~/code"
  echo "  git-health.sh --all           # scan root + immediate child repos under current dir"
  echo "  git-health.sh --no-fetch      # skip git fetch"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      ALL=true
      shift
      ;;
    --no-fetch)
      FETCH=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ROOT="$1"
      shift
      ;;
  esac
done

git_path_exists() {
  local repo="$1"
  local pathspec="$2"
  local path

  path="$(git -C "$repo" rev-parse --git-path "$pathspec" 2>/dev/null || true)"
  [[ -n "$path" && -e "$path" ]]
}

is_out_of_fleet_repo() {
  local repo="$1"
  local repo_name

  repo_name="$(basename "$repo")"

  case "$repo_name" in
    open-historia|today-little-log|truehire|companion-robot|device-net-test|forecast-lab|elves-hq|saas-maker-ci-fix)
      return 0
      ;;
  esac

  return 1
}

scan_repo() {
  local repo="$1"

  echo "=================================================="
  echo "Repo: $repo"

  if [[ "$FETCH" == true ]]; then
    git -C "$repo" fetch --all --prune --quiet 2>/dev/null || true
  fi

  local branch
  branch="$(git -C "$repo" branch --show-current 2>/dev/null || true)"
  echo "Branch: ${branch:-DETACHED}"

  if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
    echo "Status: DIRTY"
    git -C "$repo" status --short
  else
    echo "Status: clean"
  fi

  local operation_states=()

  if git_path_exists "$repo" "MERGE_HEAD"; then
    operation_states+=("merge in progress")
  fi

  if git_path_exists "$repo" "rebase-merge" || git_path_exists "$repo" "rebase-apply"; then
    operation_states+=("rebase in progress")
  fi

  if git_path_exists "$repo" "CHERRY_PICK_HEAD"; then
    operation_states+=("cherry-pick in progress")
  fi

  if git_path_exists "$repo" "REVERT_HEAD"; then
    operation_states+=("revert in progress")
  fi

  if git_path_exists "$repo" "BISECT_LOG"; then
    operation_states+=("bisect in progress")
  fi

  if [[ ${#operation_states[@]} -gt 0 ]]; then
    echo "Git operation state:"
    printf '  - %s\n' "${operation_states[@]}"
  fi

  local stash_count
  stash_count="$(git -C "$repo" stash list --format='%gd' | wc -l | tr -d ' ')"

  if [[ "$stash_count" -gt 0 ]]; then
    echo "Stashes: $stash_count"
    git -C "$repo" stash list --format='%gd %s' | sed -n '1,5p' | sed 's/^/  - /'

    if [[ "$stash_count" -gt 5 ]]; then
      echo "  - ... $((stash_count - 5)) more"
    fi
  fi

  local upstream
  upstream="$(git -C "$repo" for-each-ref --format='%(upstream:short)' "refs/heads/$branch")"

  if [[ -n "$upstream" ]]; then
    echo "Upstream: $upstream"
    if git -C "$repo" rev-parse --verify --quiet "$upstream^{commit}" >/dev/null; then
      read -r behind ahead < <(
        git -C "$repo" rev-list --left-right --count "$upstream"...HEAD 2>/dev/null
      )
      echo "Remote gap: ahead $ahead, behind $behind"
    else
      echo "Remote gap: upstream branch is gone"
    fi
  else
    echo "Upstream: none"
    echo "Remote gap: no upstream configured"
  fi

  local no_upstream
  no_upstream="$(
    git -C "$repo" for-each-ref \
      --format='%(refname:short) %(upstream:short)' refs/heads |
      awk '$2 == "" { print $1 }'
  )"

  if [[ -n "$no_upstream" ]]; then
    echo "Branches without upstream:"
    echo "$no_upstream" | sed 's/^/  - /'
  fi

  local gone
  gone="$(
    git -C "$repo" branch -vv |
      awk '/: gone]/{print $1}' |
      sed 's/^\*//'
  )"

  if [[ -n "$gone" ]]; then
    echo "Branches with gone upstream:"
    echo "$gone" | sed 's/^/  - /'
  fi

  local unmerged=""
  if git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1; then
    unmerged="$(
      git -C "$repo" branch --no-merged 2>/dev/null |
        sed 's/^[* ]*//' |
        sed '/^$/d'
    )"
  fi

  if [[ -n "$unmerged" ]]; then
    echo "Local branches not merged into ${branch:-HEAD}:"
    echo "$unmerged" | sed 's/^/  - /'
  fi

  echo
}

if [[ "$ALL" == true ]]; then
  echo "Scanning all Git repos under: $ROOT"
  echo

  find "$ROOT" -maxdepth 2 -type d -name ".git" -prune -print0 |
    while IFS= read -r -d '' gitdir; do
      repo="$(dirname "$gitdir")"
      if is_out_of_fleet_repo "$repo"; then
        continue
      fi
      scan_repo "$repo"
    done
else
  if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Not a Git repo: $ROOT"
    echo "Use --all to scan repos inside this directory."
    exit 1
  fi

  repo="$(git -C "$ROOT" rev-parse --show-toplevel)"
  scan_repo "$repo"
fi
