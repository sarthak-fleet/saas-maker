#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/unlink-project-agent-assets.sh [--dry-run] [project ...]

Removes Fleet-owned agent links and managed Fleet reference blocks from child
projects. With no projects, every immediate child directory containing .git is
used.
USAGE
}

log() {
  printf '%s\n' "$*"
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %q' "$1"
    shift
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

project_list() {
  if [[ "$#" -gt 0 ]]; then
    printf '%s\n' "$@"
  else
    find "$FLEET_ROOT" -mindepth 1 -maxdepth 1 -type d \
      ! -name '.git' ! -name '.agents' ! -name '.claude' ! -name '.codex' \
      ! -name '.omx' ! -name 'docs' ! -name 'scripts' \
      -exec test -d '{}/.git' ';' -print | sort
  fi
}

remove_managed_block() {
  local file="$1"

  [[ -f "$file" ]] || return 0
  grep -q '<!-- FLEET-ROOT:START -->' "$file" || return 0

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] remove Fleet reference from $file"
    return 0
  fi

  python3 - "$file" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
text = re.sub(
    r'<!-- FLEET-ROOT:START -->.*?<!-- FLEET-ROOT:END -->\n\n?',
    '',
    text,
    count=1,
    flags=re.S,
)
path.write_text(text)
PY
  log "update: $file"
}

remove_skill_links() {
  local source_root="$1"
  local dest_root="$2"

  [[ -d "$source_root" && -d "$dest_root" ]] || return 0

  local skill
  for skill in "$source_root"/*; do
    [[ -d "$skill" ]] || continue
    local dest="$dest_root/$(basename "$skill")"
    if [[ -L "$dest" ]]; then
      run rm "$dest"
      log "remove: $dest"
    fi
  done
}

projects=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      projects+=("$1")
      shift
      ;;
  esac
done

targets=()
if [[ "${#projects[@]}" -gt 0 ]]; then
  while IFS= read -r target; do
    [[ -n "$target" ]] && targets+=("$target")
  done < <(project_list "${projects[@]}")
else
  while IFS= read -r target; do
    [[ -n "$target" ]] && targets+=("$target")
  done < <(project_list)
fi

if [[ "${#targets[@]}" -eq 0 ]]; then
  log "No child Git projects found."
  exit 0
fi

for project in "${targets[@]}"; do
  if [[ "$project" != /* ]]; then
    project="$FLEET_ROOT/$project"
  fi

  [[ -d "$project" ]] || continue

  log ""
  log "Project: $project"

  remove_skill_links "$FLEET_ROOT/.agents/skills" "$project/.agents/skills"
  remove_skill_links "$FLEET_ROOT/.claude/skills" "$project/.claude/skills"
  remove_managed_block "$project/AGENTS.md"
  remove_managed_block "$project/CLAUDE.md"
done
