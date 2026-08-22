#!/usr/bin/env bash
# Run one fully autonomous Devin task inside a clean linked Git worktree.
#
# This wrapper deliberately uses Devin's `dangerous` permission mode because
# the current organization policy rejects Devin's autonomous sandbox mode.
# The linked-worktree and clean-tree checks are therefore mandatory.
set -uo pipefail

usage() {
  cat <<'EOF'
Usage: devin-autonomous-run.sh --project ID --prompt-file FILE [options]

Options:
  --dir DIR          Clean linked Git worktree (default: current directory)
  --model MODEL      Devin model (default: glm-5.2)
  --log FILE         Keep the full run log at FILE
  --expect-changes   Fail if Devin exits successfully without changing files
  -h, --help         Show this help
EOF
}

PROJECT=""
PROMPT_FILE=""
WORK_DIR="$PWD"
MODEL="glm-5.2"
LOG=""
EXPECT_CHANGES=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      PROJECT="${2:?--project requires a value}"
      shift 2
      ;;
    --prompt-file)
      PROMPT_FILE="${2:?--prompt-file requires a value}"
      shift 2
      ;;
    --dir)
      WORK_DIR="${2:?--dir requires a value}"
      shift 2
      ;;
    --model)
      MODEL="${2:?--model requires a value}"
      shift 2
      ;;
    --log)
      LOG="${2:?--log requires a value}"
      shift 2
      ;;
    --expect-changes)
      EXPECT_CHANGES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$PROJECT" ] || [ -z "$PROMPT_FILE" ]; then
  usage >&2
  exit 2
fi
if [ ! -r "$PROMPT_FILE" ]; then
  printf 'Prompt file is not readable: %s\n' "$PROMPT_FILE" >&2
  exit 2
fi
PROMPT_FILE="$(cd "$(dirname "$PROMPT_FILE")" && pwd)/$(basename "$PROMPT_FILE")"
if ! cd "$WORK_DIR"; then
  printf 'Cannot enter worktree: %s\n' "$WORK_DIR" >&2
  exit 2
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'Refusing autonomous Devin run outside a Git worktree.\n' >&2
  exit 2
fi

GIT_DIR="$(git rev-parse --path-format=absolute --git-dir)"
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
if [ "$GIT_DIR" = "$COMMON_DIR" ]; then
  printf 'Refusing autonomous Devin run in a primary checkout; use a clean linked worktree.\n' >&2
  exit 2
fi
if [ -n "$(git status --short)" ]; then
  printf 'Refusing autonomous Devin run in a dirty worktree.\n' >&2
  exit 2
fi

START_HEAD="$(git rev-parse HEAD)"
SKILL_RUNNER="$SCRIPT_DIR/agent-bin/fleet-skill-run.mjs"
if [ ! -f "$SKILL_RUNNER" ]; then
  printf 'Fleet skill runner is missing: %s\n' "$SKILL_RUNNER" >&2
  exit 2
fi

TEMP_LOG=""
if [ -z "$LOG" ]; then
  TEMP_LOG="$(mktemp -t devin-autonomous.XXXXXX)"
  LOG="$TEMP_LOG"
else
  LOG="$(cd "$(dirname "$LOG")" && pwd)/$(basename "$LOG")"
fi
cleanup() {
  if [ -n "$TEMP_LOG" ]; then
    rm -f "$TEMP_LOG"
  fi
}
trap cleanup EXIT

printf 'Running autonomous Devin task in %s\n' "$PWD"
printf 'Model: %s | project: %s\n' "$MODEL" "$PROJECT"

node "$SKILL_RUNNER" exec \
  --skill call-devin \
  --project "$PROJECT" \
  --source devin-wrapper \
  -- "${DEVIN_BIN:-devin}" --print \
    --model "$MODEL" \
    --permission-mode dangerous \
    --respect-workspace-trust false \
    --prompt-file "$PROMPT_FILE" \
  < /dev/null 2>&1 | tee "$LOG"
code=${PIPESTATUS[0]}

if grep -qiE "requires confirmation|rejected a tool call that requires confirmation|no session selected|mode 'autonomous' is restricted|workspace trust" "$LOG"; then
  printf 'Devin did not run autonomously; a confirmation or policy gate was detected.\n' >&2
  exit 3
fi
if [ "$code" -ne 0 ]; then
  exit "$code"
fi
if [ "$(git rev-parse HEAD)" != "$START_HEAD" ]; then
  printf 'Devin changed Git history; autonomous teammate runs may not commit. Review this worktree.\n' >&2
  exit 4
fi
if $EXPECT_CHANGES && [ -z "$(git status --short)" ]; then
  printf 'Devin reported success but made no workspace changes.\n' >&2
  exit 5
fi

printf 'Autonomous run completed. Review the diff and verify it independently.\n'
