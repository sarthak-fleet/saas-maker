#!/usr/bin/env bash
# devin-fleet-worker.sh — runs one Devin session for one project inside a
# Terminal window. Launched by devin-fleet-run.sh; not meant to be called
# directly. On exit it writes a .done marker (the launcher polls these to
# throttle concurrency) and keeps the window open for inspection.
set -uo pipefail

PROJECT="${1:?project id}"
DIR="${2:?repo dir}"
PROMPT_FILE="${3:?prompt file}"
RUNDIR="${4:?run dir}"
MODEL="${5:?model}"
PERMISSION_MODE="${6:?permission mode}"

LOG="$RUNDIR/$PROJECT.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_RUNNER="$SCRIPT_DIR/agent-bin/fleet-skill-run.mjs"

printf '=== devin :: %s ===\n' "$PROJECT"
printf 'dir:        %s\n' "$DIR"
printf 'model:      %s\n' "$MODEL"
printf 'permission: %s\n' "$PERMISSION_MODE"
printf 'log:        %s\n\n' "$LOG"

cd "$DIR" || { echo "cannot cd into $DIR"; echo 1 > "$RUNDIR/$PROJECT.done"; exec "${SHELL:-/bin/bash}"; }

# DEVIN_BIN lets you pin a specific devin binary (or a stand-in for testing);
# defaults to whatever `devin` resolves to on PATH.
node "$SKILL_RUNNER" exec \
  --skill call-devin \
  --project "$PROJECT" \
  --source devin-wrapper \
  -- "${DEVIN_BIN:-devin}" --print \
    --model "$MODEL" \
    --permission-mode "$PERMISSION_MODE" \
    --prompt-file "$PROMPT_FILE" \
  < /dev/null 2>&1 | tee "$LOG"
code=${PIPESTATUS[0]}

# Flag Devin account rate-limit hits so the launcher can back off and retry.
if [ "$code" != "0" ] && grep -qiE 'rate.?limit|message rate' "$LOG" 2>/dev/null; then
  echo rate-limited > "$RUNDIR/$PROJECT.ratelimited"
fi
echo "$code" > "$RUNDIR/$PROJECT.done"
printf '\n=== finished :: %s (exit %s) ===\n' "$PROJECT" "$code"
printf 'This window stays open. Close it when done reviewing.\n'
exec "${SHELL:-/bin/bash}"
