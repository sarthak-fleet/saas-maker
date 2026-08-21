#!/usr/bin/env bash
# devin-fleet-run.sh — fan out one Devin prompt across fleet projects.
#
# For each selected project it opens a NEW Terminal.app window that cd's into
# that project's repo and runs the SAME prompt via the local `devin` CLI in
# "dangerous" permission mode (auto-approve all tools). Concurrency is throttled;
# launches are staggered by project size; rate-limited sessions are retried with
# a global backoff (Devin has an account-wide message rate limit).
#
# Prompt is REQUIRED (--prompt-file FILE, --prompt "text", or first positional).
# Project set defaults to every project in projects.json that has a local repo,
# minus the AGENTS.md out-of-fleet list. Override with --projects / --tier, or
# bypass projects.json entirely with --dirs-file (lines of "id<TAB>dir").
#
# Usage:
#   ./devin-fleet-run.sh --prompt-file brief.md
#   ./devin-fleet-run.sh --dirs-file set.tsv --prompt-file brief.md --max 2
#   ./devin-fleet-run.sh --dry-run --prompt-file brief.md
#
# Options:
#   --prompt-file FILE   read the prompt from FILE
#   --prompt TEXT        inline prompt
#   --projects a,b,c     explicit project ids from projects.json
#   --tier NAME          restrict to one tier from projects.json
#   --dirs-file FILE     explicit set: TSV lines "id<TAB>absolute-dir" (skips projects.json)
#   --max N              max concurrent windows (default 5)
#   --initial-wait SEC   wait before the first launch (default 0)
#   --rl-cooldown SEC    global backoff after a rate-limit hit (default 1500)
#   --max-attempts N     max attempts per project on rate-limit (default 4)
#   --no-pace            disable size-based launch stagger
#   --model NAME         devin model (default glm-5.2)
#   --permission-mode M  devin permission mode (default dangerous)
#   --include-out-of-fleet  also run the AGENTS.md "Out Of Fleet" projects
#   --dry-run            print the launch plan and exit
# Note: 'u' (nounset) is intentionally omitted — the scheduler relies on empty
# associative arrays (${#RUNNING[@]} etc.), which trip nounset even in bash 5.
set -eo pipefail

# AGENTS.md "Out Of Fleet" — excluded from fleet-wide sweeps unless asked.
OUT_OF_FLEET="open-historia today-little-log truehire companion-robot device-net-test forecast-lab elves-hq saas-maker-ci-fix"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECTS_JSON="$FLEET_ROOT/foundry/ops/config/projects.json"
WORKER="$SCRIPT_DIR/devin-fleet-worker.sh"

MAX_PARALLEL=5
MODEL="glm-5.2"
PERMISSION_MODE="dangerous"
PROMPT_TEXT=""
PROMPT_FILE=""
PROJECTS_ARG=""
TIER=""
DIRS_FILE=""
DRY_RUN=0
INCLUDE_OUT_OF_FLEET=0
INITIAL_WAIT=0
RL_COOLDOWN=1500
MAX_ATTEMPTS=4
PACE=1

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) PROMPT_FILE="${2:?}"; shift 2 ;;
    --prompt)      PROMPT_TEXT="${2:?}"; shift 2 ;;
    --projects)    PROJECTS_ARG="${2:?}"; shift 2 ;;
    --tier)        TIER="${2:?}"; shift 2 ;;
    --dirs-file)   DIRS_FILE="${2:?}"; shift 2 ;;
    --max)         MAX_PARALLEL="${2:?}"; shift 2 ;;
    --initial-wait) INITIAL_WAIT="${2:?}"; shift 2 ;;
    --rl-cooldown) RL_COOLDOWN="${2:?}"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="${2:?}"; shift 2 ;;
    --no-pace)     PACE=0; shift ;;
    --model)       MODEL="${2:?}"; shift 2 ;;
    --permission-mode) PERMISSION_MODE="${2:?}"; shift 2 ;;
    --include-out-of-fleet) INCLUDE_OUT_OF_FLEET=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     sed -n '2,40p' "$0"; exit 0 ;;
    --*)           die "unknown option: $1" ;;
    *)             [[ -z "$PROMPT_TEXT" ]] && PROMPT_TEXT="$1" || die "unexpected arg: $1"; shift ;;
  esac
done

command -v devin >/dev/null 2>&1 || die "devin CLI not found on PATH"
command -v osascript >/dev/null 2>&1 || die "osascript not found (macOS only)"
[[ -x "$WORKER" ]] || chmod +x "$WORKER" 2>/dev/null || true

# --- resolve prompt --------------------------------------------------------
RUNDIR="$FLEET_ROOT/foundry/ops/.devin-runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUNDIR"
RESOLVED_PROMPT_FILE="$RUNDIR/prompt.md"
if [[ -n "$PROMPT_FILE" ]]; then
  [[ -f "$PROMPT_FILE" ]] || die "prompt file not found: $PROMPT_FILE"
  cp "$PROMPT_FILE" "$RESOLVED_PROMPT_FILE"
elif [[ -n "$PROMPT_TEXT" ]]; then
  printf '%s\n' "$PROMPT_TEXT" > "$RESOLVED_PROMPT_FILE"
else
  die "no prompt given — use --prompt-file FILE, --prompt \"text\", or a positional prompt"
fi

# --- resolve project list (id<TAB>dir) -------------------------------------
declare -a PROJECTS
if [[ -n "$DIRS_FILE" ]]; then
  [[ -f "$DIRS_FILE" ]] || die "dirs-file not found: $DIRS_FILE"
  while IFS=$'\t' read -r id dir; do
    [[ -z "$id" || "$id" == \#* ]] && continue
    [[ -d "$dir" ]] || { echo "skip $id: dir missing ($dir)" >&2; continue; }
    PROJECTS+=("$id"$'\t'"$dir")
  done < "$DIRS_FILE"
else
  [[ -f "$PROJECTS_JSON" ]] || die "projects.json not found at $PROJECTS_JSON"
  mapfile -t PROJECTS < <(
    PROJECTS_ARG="$PROJECTS_ARG" TIER="$TIER" FLEET_ROOT="$FLEET_ROOT" \
    EXCLUDE="$([[ $INCLUDE_OUT_OF_FLEET -eq 0 ]] && echo "$OUT_OF_FLEET")" \
    node -e '
      const fs = require("fs");
      const p = require(process.argv[1]);
      const all = Array.isArray(p) ? p : (p.projects || Object.values(p));
      const root = process.env.FLEET_ROOT;
      const only = (process.env.PROJECTS_ARG || "").split(",").map(s=>s.trim()).filter(Boolean);
      const tier = process.env.TIER || "";
      const exclude = (process.env.EXCLUDE || "").split(/\s+/).filter(Boolean);
      for (const x of all) {
        if (!x || !x.repo) continue;
        if (only.length && !only.includes(x.id)) continue;
        if (!only.length && exclude.includes(x.id)) { process.stderr.write(`skip ${x.id}: out-of-fleet\n`); continue; }
        if (tier && x.tier !== tier) continue;
        const dir = `${root}/${x.repo}`;
        if (!fs.existsSync(dir)) { process.stderr.write(`skip ${x.id}: no local repo (${x.repo})\n`); continue; }
        process.stdout.write(`${x.id}\t${dir}\n`);
      }
    ' "$PROJECTS_JSON"
  )
fi
[[ ${#PROJECTS[@]} -gt 0 ]] || die "no matching projects"

# size-based launch stagger (git-tracked file count -> seconds)
size_delay() {
  [[ "$PACE" -eq 0 ]] && { echo 0; return; }
  local dir="$1" n
  n=$(git -C "$dir" ls-files 2>/dev/null | wc -l | tr -d ' '); n=${n:-0}
  if   [[ "$n" -lt 100 ]]; then echo 20
  elif [[ "$n" -lt 300 ]]; then echo 60
  elif [[ "$n" -lt 600 ]]; then echo 120
  else echo 180; fi
}

# --- plan ------------------------------------------------------------------
echo "Devin fleet run"
echo "  projects:    ${#PROJECTS[@]}"
echo "  concurrency: $MAX_PARALLEL   pace: $([[ $PACE -eq 1 ]] && echo on || echo off)"
echo "  model:       $MODEL   permission: $PERMISSION_MODE"
echo "  rate-limit:  backoff ${RL_COOLDOWN}s, max ${MAX_ATTEMPTS} attempts/project, initial wait ${INITIAL_WAIT}s"
echo "  prompt:      $RESOLVED_PROMPT_FILE"
echo "  logs:        $RUNDIR/<project>.log"
echo
for entry in "${PROJECTS[@]}"; do
  d="${entry#*$'\t'}"
  printf '  - %-24s (%s files -> %ss stagger)\n' "${entry%%$'\t'*}" "$(git -C "$d" ls-files 2>/dev/null | wc -l | tr -d ' ')" "$(size_delay "$d")"
done
echo
if [[ "$DRY_RUN" -eq 1 ]]; then echo "(dry run — nothing launched)"; exit 0; fi

# --- launch scheduler ------------------------------------------------------
launch() {
  local id="$1" dir="$2"
  # Forward DEVIN_BIN into the window if set (lets you pin/stub the binary).
  local pre=""; [[ -n "${DEVIN_BIN:-}" ]] && pre="export DEVIN_BIN='$DEVIN_BIN'; "
  local cmd="${pre}bash '$WORKER' '$id' '$dir' '$RESOLVED_PROMPT_FILE' '$RUNDIR' '$MODEL' '$PERMISSION_MODE'"
  local esc="${cmd//\\/\\\\}"; esc="${esc//\"/\\\"}"
  osascript >/dev/null <<EOF
tell application "Terminal"
  do script "$esc"
  activate
end tell
EOF
}

declare -a QUEUE=("${PROJECTS[@]}")
declare -A ATTEMPTS RUNNING DIROF
now() { date +%s; }
START=$(now)
cooldown_until=$((START + INITIAL_WAIT))
next_launch_at=$START
[[ "$INITIAL_WAIT" -gt 0 ]] && echo "initial wait ${INITIAL_WAIT}s before first launch..."

while [[ ${#QUEUE[@]} -gt 0 || ${#RUNNING[@]} -gt 0 ]]; do
  t=$(now)
  # reap finished
  for id in "${!RUNNING[@]}"; do
    [[ -f "$RUNDIR/$id.done" ]] || continue
    unset 'RUNNING[$id]'
    if [[ -f "$RUNDIR/$id.ratelimited" ]]; then
      if [[ "${ATTEMPTS[$id]}" -lt "$MAX_ATTEMPTS" ]]; then
        rm -f "$RUNDIR/$id.done" "$RUNDIR/$id.ratelimited"
        QUEUE+=("$id"$'\t'"${DIROF[$id]}")
        cooldown_until=$(( $(now) + RL_COOLDOWN ))
        echo "$(date +%H:%M:%S) rate-limited: $id -> backoff ${RL_COOLDOWN}s, requeued (attempt ${ATTEMPTS[$id]}/$MAX_ATTEMPTS)"
      else
        echo "$(date +%H:%M:%S) GAVE UP: $id after $MAX_ATTEMPTS rate-limited attempts"
        echo "$id" >> "$RUNDIR/gave-up.txt"
      fi
    else
      echo "$(date +%H:%M:%S) done: $id (exit $(cat "$RUNDIR/$id.done"))"
    fi
  done
  # launch if allowed
  t=$(now)
  gate=$cooldown_until; [[ "$next_launch_at" -gt "$gate" ]] && gate=$next_launch_at
  if [[ ${#QUEUE[@]} -gt 0 && ${#RUNNING[@]} -lt "$MAX_PARALLEL" && "$t" -ge "$gate" ]]; then
    entry="${QUEUE[0]}"; QUEUE=("${QUEUE[@]:1}")
    id="${entry%%$'\t'*}"; dir="${entry#*$'\t'}"
    DIROF[$id]="$dir"
    ATTEMPTS[$id]=$(( ${ATTEMPTS[$id]:-0} + 1 ))
    d=$(size_delay "$dir")
    echo "$(date +%H:%M:%S) launching: $id (attempt ${ATTEMPTS[$id]}, next launch +${d}s) — ${#QUEUE[@]} queued, ${#RUNNING[@]} running"
    launch "$id" "$dir"
    RUNNING[$id]=1
    next_launch_at=$(( $(now) + d ))
  else
    sleep 8
  fi
done

echo
echo "Run complete. Logs + exit codes in: $RUNDIR"
[[ -f "$RUNDIR/gave-up.txt" ]] && echo "Gave up (still rate-limited): $(tr '\n' ' ' < "$RUNDIR/gave-up.txt")"
exit 0
