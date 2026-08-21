#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> validate-setup"
bash "$SCRIPT_DIR/validate-setup.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/candidates.txt" <<'EOF'
google	descriptive
evidcite	compound
herbograph	descriptive
notionsaas	compound
xyzzynotreal12345	abstract
EOF

echo "==> run-pipeline smoke"
bash "$SCRIPT_DIR/run-pipeline.sh" \
  --candidates "$TMP/candidates.txt" \
  --idea "Evidence-graded supplement reference" \
  --vibe "classy premium trustworthy" \
  --category health \
  --avoid "examine" \
  --top 5 \
  --limit 3 \
  | tee "$TMP/final.tsv"

echo "==> assertions"
grep -q "evidcite" "$TMP/final.tsv" || { echo "FAIL: expected evidcite in final" >&2; exit 1; }
grep -q "herbograph" "$TMP/final.tsv" && { echo "FAIL: herbograph should be filtered" >&2; exit 1; } || true
grep -q "google" "$TMP/final.tsv" && { echo "FAIL: google should be taken" >&2; exit 1; } || true

echo "==> all self-tests passed"