#!/usr/bin/env bash
# grok-fleet-run.sh — fan out one prompt across repos using the Grok CLI,
# headless and worktree-isolated. Companion to devin-fleet-run.sh; used to
# parallelize a fan-out across a second provider (Grok doesn't share Devin's
# account rate limit).
#
# Each project runs in its OWN git worktree (created here, NOT via grok's
# buggy --worktree), with --always-approve (mandatory for headless autonomy).
# Output branch: grok/<branch>. Results: <rundir>/<id>.log (grok JSON) +
# <id>.done (exit code). A stopReason != EndTurn is flagged in <id>.status.
#
# Usage:
#   ./grok-fleet-run.sh --dirs-file set.tsv --prompt-file brief.md --max 3
set -eo pipefail

MAX=3
BRANCH="docs-knowledge-system"
MODEL=""
MAX_TURNS=50
DIRS_FILE=""; PROMPT_FILE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WT_ROOT="$FLEET_ROOT/foundry/ops/.grok-wt"

die() { echo "error: $*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do case "$1" in
  --dirs-file) DIRS_FILE="$2"; shift 2;;
  --prompt-file) PROMPT_FILE="$2"; shift 2;;
  --max) MAX="$2"; shift 2;;
  --branch) BRANCH="$2"; shift 2;;
  --model) MODEL="$2"; shift 2;;
  --max-turns) MAX_TURNS="$2"; shift 2;;
  *) die "unknown arg: $1";;
esac; done

command -v grok >/dev/null 2>&1 || die "grok CLI not found"
[[ -f "$DIRS_FILE" ]] || die "dirs-file not found: $DIRS_FILE"
[[ -f "$PROMPT_FILE" ]] || die "prompt-file not found: $PROMPT_FILE"

RUNDIR="$FLEET_ROOT/foundry/ops/.devin-runs/grok-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUNDIR" "$WT_ROOT"
cp "$PROMPT_FILE" "$RUNDIR/prompt.md"

run_one() {
  local id="$1" dir="$2"
  local wt="$WT_ROOT/$id" log="$RUNDIR/$id.log"
  # fresh worktree off HEAD on a grok/ branch (clean isolation from dirty tree)
  git -C "$dir" worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$wt"
  if ! git -C "$dir" worktree add "$wt" -b "grok/$BRANCH" >>"$log" 2>&1; then
    git -C "$dir" worktree add "$wt" -b "grok/$BRANCH-$(date +%H%M%S)" >>"$log" 2>&1 \
      || { echo 90 > "$RUNDIR/$id.done"; echo "worktree-failed" > "$RUNDIR/$id.status"; return; }
  fi
  local modelflag=(); [[ -n "$MODEL" ]] && modelflag=(-m "$MODEL")
  grok --prompt-file "$RUNDIR/prompt.md" --output-format json --always-approve \
    --max-turns "$MAX_TURNS" "${modelflag[@]}" --cwd "$wt" < /dev/null > "$log" 2>&1
  local code=$?
  # record stopReason if the JSON is parseable
  local stop; stop=$(node -e 'try{let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/\{[\s\S]*\}/);console.log(m?(JSON.parse(m[0]).stopReason||"?"):"unparsed")})}catch(e){console.log("err")}' < "$log" 2>/dev/null)
  echo "${stop:-unknown}" > "$RUNDIR/$id.status"
  echo "$code" > "$RUNDIR/$id.done"
  echo "$(date +%H:%M:%S) grok done: $id (exit $code, stopReason ${stop:-?})"
}

echo "Grok fleet run — $(wc -l < "$DIRS_FILE" | tr -d ' ') projects, max $MAX, branch grok/$BRANCH"
echo "rundir: $RUNDIR"

# simple concurrency pool
while IFS=$'\t' read -r id dir; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  [[ -d "$dir" ]] || { echo "skip $id: dir missing"; continue; }
  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$MAX" ]]; do sleep 3; done
  echo "$(date +%H:%M:%S) launching grok: $id"
  run_one "$id" "$dir" &
  sleep 1
done < "$DIRS_FILE"
wait
echo "Grok fleet run complete. Results in: $RUNDIR"
