#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/sarthak/Desktop/fleet"
STAGGER_SECONDS="${STAGGER_SECONDS:-8}"

# Read project list dynamically from the fleet README.
# Extracts slugs from both top-level and indented (sub-product) markdown links.
mapfile -t projects < <(
  grep -E '^(  )?- \[' "$ROOT/README.md" \
    | sed -E 's/^(  )?- \[([^]]+)\].*/\1/' \
    | sort -u
)

CODE_COUNT="${CODE_COUNT:-${#projects[@]}}"

prompt_file="$(mktemp -t fleet-bench-prompt)"
cat >"$prompt_file" <<'EOF'
Review this repo for one real, high-confidence bug.

Constraints:
- Use the cheapest/lowest model available.
- Keep reasoning short.
- Do not run broad searches, full test suites, or expensive builds.
- Read only the nearest AGENTS.md, package/config files, and the smallest relevant source files.
- If you find a bug, make the smallest safe fix and run only the smallest relevant check.
- If you do not find a bug quickly, report exactly what you checked and stop.

Output:
- Suspected issue
- Evidence
- Why it matters
- Minimal fix
- Check run
EOF

cleanup() {
  rm -f "$prompt_file"
}
trap cleanup EXIT

open_code_window() {
  local repo="$1"
  code -n "$ROOT/$repo" >/dev/null 2>&1 &
}

start_codex_agent() {
  pbcopy <"$prompt_file"
  osascript <<'OSA' >/dev/null
tell application "Visual Studio Code" to activate
delay 1
tell application "System Events"
  tell process "Code"
    set frontmost to true
    keystroke "p" using {command down, shift down}
    delay 0.2
    keystroke "Codex: New Codex Agent"
    delay 0.8
    key code 36
    delay 1.2
    keystroke "v" using command down
    delay 0.2
    key code 36
  end tell
end tell
OSA
}

for i in $(seq 1 "$CODE_COUNT"); do
  repo="${projects[$(( (i - 1) % ${#projects[@]} ))]}"
  printf '[%s/%s] Opening %s...\n' "$i" "$CODE_COUNT" "$repo"
  open_code_window "$repo"
  sleep "$STAGGER_SECONDS"
  open -a "Visual Studio Code" >/dev/null 2>&1 || true
  start_codex_agent
done

printf 'Opened %s VS Code windows and submitted one Codex agent prompt per window.\n' "$CODE_COUNT"
