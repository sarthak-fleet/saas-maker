#!/usr/bin/env bash
# grok-fleet-verify.sh — independent, READ-ONLY cross-model audit of the
# generated docs system in each repo, using the Grok CLI with a structured
# (--json-schema) verdict. Companion to grok-fleet-run.sh / devin-fleet-run.sh.
#
# Grok audits repos it did NOT generate (avoid self-grading). Output per repo:
# <rundir>/<id>.verdict.json ({verdict, score, issues[], strengths[]}).
#
# Usage:
#   ./grok-fleet-verify.sh --dirs-file finished.tsv --prompt-file verify-prompt.md --max 3
set -eo pipefail

MAX=3; MODEL=""; MAX_TURNS=40; DIRS_FILE=""; PROMPT_FILE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do case "$1" in
  --dirs-file) DIRS_FILE="$2"; shift 2;;
  --prompt-file) PROMPT_FILE="$2"; shift 2;;
  --max) MAX="$2"; shift 2;;
  --model) MODEL="$2"; shift 2;;
  --max-turns) MAX_TURNS="$2"; shift 2;;
  *) die "unknown arg: $1";;
esac; done
command -v grok >/dev/null 2>&1 || die "grok CLI not found"
[[ -f "$DIRS_FILE" ]] || die "dirs-file not found: $DIRS_FILE"
[[ -f "$PROMPT_FILE" ]] || die "prompt-file not found: $PROMPT_FILE"

RUNDIR="$FLEET_ROOT/foundry/ops/.devin-runs/verify-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUNDIR"; cp "$PROMPT_FILE" "$RUNDIR/verify-prompt.md"

SCHEMA='{"type":"object","properties":{"verdict":{"type":"string","enum":["pass","warn","fail"]},"score":{"type":"number"},"issues":{"type":"array","items":{"type":"object","properties":{"severity":{"type":"string"},"area":{"type":"string"},"detail":{"type":"string"}},"required":["severity","area","detail"]}},"strengths":{"type":"array","items":{"type":"string"}}},"required":["verdict","score","issues","strengths"]}'

verify_one() {
  local id="$1" dir="$2" raw="$RUNDIR/$id.raw.json" out="$RUNDIR/$id.verdict.json"
  local modelflag=(); [[ -n "$MODEL" ]] && modelflag=(-m "$MODEL")
  # read-only audit: --always-approve lets headless read tools run; the prompt
  # forbids writes and the repo is git-recoverable regardless.
  grok --prompt-file "$RUNDIR/verify-prompt.md" --json-schema "$SCHEMA" \
    --always-approve --max-turns "$MAX_TURNS" "${modelflag[@]}" --cwd "$dir" \
    < /dev/null > "$raw" 2>"$RUNDIR/$id.err" || true
  # Grok's envelope .text holds several stub objects then the real verdict last.
  # Extract the LAST balanced (string-aware) JSON object and use it.
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      function lastObj(s){
        let objs=[],depth=0,start=-1,inStr=false,esc=false;
        for(let i=0;i<s.length;i++){const c=s[i];
          if(inStr){ if(esc)esc=false; else if(c==="\\")esc=true; else if(c==="\"")inStr=false; continue; }
          if(c==="\""){inStr=true;continue;}
          if(c==="{"){ if(depth===0)start=i; depth++; }
          else if(c==="}"){ depth--; if(depth===0&&start>=0){objs.push(s.slice(start,i+1));start=-1;} }
        }
        for(let k=objs.length-1;k>=0;k--){try{const o=JSON.parse(objs[k]); if(o&&o.verdict)return o;}catch(e){}}
        return null;
      }
      let v=null;
      try{const env=JSON.parse(d); const t=typeof env.text==="string"?env.text:JSON.stringify(env.text||env); v=lastObj(t)||lastObj(d);}catch(e){ try{v=lastObj(d);}catch(e2){} }
      process.stdout.write(JSON.stringify(v||{verdict:"error",score:0,issues:[{severity:"high",area:"harness",detail:"unparseable grok output"}],strengths:[]}));
    });' < "$raw" > "$out" 2>/dev/null
  local verdict score; verdict=$(node -pe 'JSON.parse(require("fs").readFileSync(0)).verdict' < "$out" 2>/dev/null)
  score=$(node -pe 'JSON.parse(require("fs").readFileSync(0)).score' < "$out" 2>/dev/null)
  echo "$(date +%H:%M:%S) verified: $id -> ${verdict:-?} (${score:-?})"
}

echo "Grok verify — $(wc -l < "$DIRS_FILE" | tr -d ' ') repos, max $MAX"
echo "rundir: $RUNDIR"
while IFS=$'\t' read -r id dir; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  [[ -d "$dir" ]] || { echo "skip $id: dir missing"; continue; }
  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$MAX" ]]; do sleep 3; done
  verify_one "$id" "$dir" &
  sleep 1
done < "$DIRS_FILE"
wait
echo "Grok verify complete. Verdicts in: $RUNDIR"
