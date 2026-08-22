#!/usr/bin/env bash
# run-pipeline.sh — orchestrate taste → collision → availability (no backend)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export NAME_DOMAINS_SKILL_ROOT="$SKILL_ROOT"

CANDIDATES=""
IDEA=""
VIBE=""
COMPETITORS=""
CATEGORY="general"
AVOID=""
EXISTING=""
TLDS_PRIMARY="com"
TLDS_SECONDARY="io,co"
TOP_N=20
FINAL_LIMIT=25
TOP_PREFILTER=60

usage() {
  cat <<EOF
Usage: run-pipeline.sh --candidates FILE --idea TEXT [options]

Required:
  --candidates FILE     One SLD per line (optional TAB style: sld<TAB>compound)
  --idea TEXT

Options:
  --vibe TEXT
  --competitors CSV
  --category health|saas|devtools|consumer|ai|general
  --avoid CSV
  --existing SLD        Check existing domain first
  --tlds-primary com    Pass A TLD (default: com)
  --tlds-secondary io,co Pass B TLDs
  --top N               Pre-rank pool (default: 20)
  --limit N             Final shortlist cap (default: 25)

Outputs under \$TMPDIR/name-domains-<pid>/:
  00-existing.tsv  01-taste.tsv  02-collision.tsv
  03-pass-a.tsv  04-pass-b.tsv  05-final.tsv
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidates) CANDIDATES="$2"; shift 2 ;;
    --idea) IDEA="$2"; shift 2 ;;
    --vibe) VIBE="$2"; shift 2 ;;
    --competitors) COMPETITORS="$2"; shift 2 ;;
    --category) CATEGORY="$2"; shift 2 ;;
    --avoid) AVOID="$2"; shift 2 ;;
    --existing) EXISTING="$2"; shift 2 ;;
    --tlds-primary) TLDS_PRIMARY="$2"; shift 2 ;;
    --tlds-secondary) TLDS_SECONDARY="$2"; shift 2 ;;
    --top) TOP_N="$2"; shift 2 ;;
    --limit) FINAL_LIMIT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$CANDIDATES" && -f "$CANDIDATES" ]] || { echo "Missing --candidates FILE" >&2; exit 1; }
[[ -n "$IDEA" ]] || { echo "Missing --idea" >&2; exit 1; }

bash "$SCRIPT_DIR/validate-setup.sh" >/dev/null

WORKDIR="${TMPDIR:-/tmp}/name-domains-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

AVOID_ARGS=()
[[ -n "$AVOID" ]] && AVOID_ARGS=(--avoid "$AVOID")

echo "==> Skill root: $SKILL_ROOT" >&2
echo "==> Workdir: $WORKDIR" >&2

if [[ -n "$EXISTING" ]]; then
  echo "==> Checking existing: $EXISTING" >&2
  bash "$SCRIPT_DIR/check-domains.sh" --header "$EXISTING" --tlds "${TLDS_PRIMARY},${TLDS_SECONDARY// /,}" \
    > "$WORKDIR/00-existing.tsv"
  cat "$WORKDIR/00-existing.tsv" >&2
fi

echo "==> Taste scoring" >&2
python3 "$SCRIPT_DIR/score-taste.py" --header --idea "$IDEA" --vibe "$VIBE" \
  "${AVOID_ARGS[@]}" < "$CANDIDATES" \
  | awk -F'\t' 'NR==1{next} $3 ~ /^[0-9]+$/' \
  | sort -t$'\t' -k3 -nr \
  | head -n "$TOP_PREFILTER" > "$WORKDIR/01-taste-all.tsv"

head -n "$TOP_N" "$WORKDIR/01-taste-all.tsv" | cut -f1 > "$WORKDIR/top-slds.txt"

echo "==> Collision scan" >&2
COLL_ARGS=(--header --category "$CATEGORY")
[[ -n "$COMPETITORS" ]] && COLL_ARGS+=(--competitors "$COMPETITORS")
python3 "$SCRIPT_DIR/score-collision.py" "${COLL_ARGS[@]}" \
  $(cat "$WORKDIR/top-slds.txt") > "$WORKDIR/02-collision.tsv"

# Drop high collision (keep medium/low)
awk -F'\t' '$2 != "high" {print $1}' "$WORKDIR/02-collision.tsv" > "$WORKDIR/top-slds-filtered.txt"
[[ -s "$WORKDIR/top-slds-filtered.txt" ]] || cp "$WORKDIR/top-slds.txt" "$WORKDIR/top-slds-filtered.txt"

echo "==> Pass A ($TLDS_PRIMARY)" >&2
bash "$SCRIPT_DIR/check-domains.sh" --header \
  $(cat "$WORKDIR/top-slds-filtered.txt") --tlds "$TLDS_PRIMARY" \
  > "$WORKDIR/03-pass-a.tsv"

awk -F'\t' '$2 == "likely_available" || $2 == "unknown" {split($1,a,"."); print a[1]}' \
  "$WORKDIR/03-pass-a.tsv" | sort -u | head -n 15 > "$WORKDIR/pass-a-survivors.txt"

if [[ -s "$WORKDIR/pass-a-survivors.txt" ]]; then
  echo "==> Pass B ($TLDS_SECONDARY)" >&2
  bash "$SCRIPT_DIR/check-domains.sh" --header \
    $(cat "$WORKDIR/pass-a-survivors.txt") --tlds "$TLDS_SECONDARY" \
    > "$WORKDIR/04-pass-b.tsv"
else
  echo "==> Pass B skipped (no Pass A survivors)" >&2
  : > "$WORKDIR/04-pass-b.tsv"
fi

echo "==> Merging final ranks" >&2
export WORKDIR IDEA VIBE FINAL_LIMIT TLDS_PRIMARY
python3 "$SCRIPT_DIR/merge-rank.py" > "$WORKDIR/05-final.tsv"

{
  printf '%s\n' "sld	style	taste_base	taste_final	collision	best_domain	availability	note"
  cat "$WORKDIR/05-final.tsv"
}
echo "==> Done." >&2
echo "" >&2
echo "Work artifacts: $WORKDIR" >&2