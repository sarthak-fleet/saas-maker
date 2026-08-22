#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_OPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FLEET_ROOT="${FLEET_WORKSPACE_ROOT:-$(cd "$FLEET_OPS_DIR/.." && pwd)}"
DRY_RUN=0
SKILLS_ONLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/link-project-agent-assets.sh [--dry-run] [--skills-only] [project ...]

Links Fleet-owned agent assets into child projects. With no projects, every
immediate child directory containing .git is used.

Use --skills-only to link skill directories without modifying AGENTS.md or
CLAUDE.md files.

Examples:
  scripts/link-project-agent-assets.sh --dry-run
  scripts/link-project-agent-assets.sh reader karte
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

relpath() {
  python3 - "$1" "$2" <<'PY'
import os
import sys

target, base = sys.argv[1], sys.argv[2]
print(os.path.relpath(target, base))
PY
}

link_skill_dir() {
  local source_root="$1"
  local dest_root="$2"

  [[ -d "$source_root" ]] || return 0
  run mkdir -p "$dest_root"

  local dest
  local expected
  local current
  local name
  local skill

  for dest in "$dest_root"/*; do
    [[ -L "$dest" ]] || continue
    name="$(basename "$dest")"
    [[ -e "$source_root/$name" ]] && continue
    expected="$(relpath "$source_root/$name" "$dest_root")"
    current="$(readlink "$dest")"
    if [[ "$current" == "$expected" ]]; then
      run rm "$dest"
      log "remove stale: $dest"
    fi
  done

  for skill in "$source_root"/*; do
    [[ -d "$skill" ]] || continue
    name="$(basename "$skill")"
    dest="$dest_root/$name"
    local link_target
    link_target="$(relpath "$skill" "$dest_root")"

    if [[ -L "$dest" ]]; then
      current="$(readlink "$dest")"
      if [[ "$current" == "$link_target" ]]; then
        log "ok: $dest -> $current"
      else
        log "skip: $dest already points to $current"
      fi
    elif [[ -e "$dest" ]]; then
      log "skip: $dest already exists and is not a symlink"
    else
      run ln -s "$link_target" "$dest"
      log "link: $dest -> $link_target"
    fi
  done
}

ensure_local_agent_excludes() {
  local project="$1"
  local git_dir
  local exclude_file

  git_dir="$(git -C "$project" rev-parse --absolute-git-dir)"
  exclude_file="$git_dir/info/exclude"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] ensure local agent assets are ignored in $exclude_file"
    return 0
  fi

  mkdir -p "$(dirname "$exclude_file")"
  touch "$exclude_file"

  local pattern
  for pattern in ".agents/" ".claude/"; do
    if ! grep -Fqx "$pattern" "$exclude_file"; then
      printf '%s\n' "$pattern" >> "$exclude_file"
    fi
  done
}

prepend_block_if_missing() {
  local file="$1"
  local block="$2"
  local title="$3"

  if [[ -f "$file" ]] && grep -q '<!-- FLEET-ROOT:START -->' "$file"; then
    log "ok: $file already has Fleet reference"
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] update $file with Fleet reference"
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  {
    if [[ -f "$file" ]]; then
      printf '%s\n\n' "$block"
      cat "$file"
    else
      printf '# %s\n\n%s\n' "$title" "$block"
    fi
  } > "$tmp"
  mv "$tmp" "$file"
  log "update: $file"
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

projects=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skills-only)
      SKILLS_ONLY=1
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

  if [[ ! -d "$project" ]]; then
    log "skip: missing project $project"
    continue
  fi

  log ""
  log "Project: $project"

  ensure_local_agent_excludes "$project"
  link_skill_dir "$FLEET_ROOT/.agents/skills" "$project/.agents/skills"
  link_skill_dir "$FLEET_ROOT/.claude/skills" "$project/.claude/skills"

  if [[ "$SKILLS_ONLY" == "1" ]]; then
    continue
  fi

  rel_fleet_agents="$(relpath "$FLEET_ROOT/AGENTS.md" "$project")"
  rel_fleet_claude="$(relpath "$FLEET_ROOT/CLAUDE.md" "$project")"

  agents_block="<!-- FLEET-ROOT:START -->
Fleet-wide policy lives at \`$rel_fleet_agents\`. Read and follow it first; this file only adds project-specific guidance.
<!-- FLEET-ROOT:END -->"

  claude_block="<!-- FLEET-ROOT:START -->
@$rel_fleet_claude
<!-- FLEET-ROOT:END -->"

  prepend_block_if_missing "$project/AGENTS.md" "$agents_block" "$(basename "$project") Agent Instructions"
  prepend_block_if_missing "$project/CLAUDE.md" "$claude_block" "$(basename "$project") Claude Instructions"
done
