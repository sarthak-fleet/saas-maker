#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }
}

need curl
need python3
need bash

for f in check-domains.sh score-taste.py score-collision.py merge-rank.py; do
  [[ -e "$SCRIPT_DIR/$f" ]] || { echo "Missing script: $f" >&2; exit 1; }
done

for f in blocked-slds.txt misleading-patterns.txt competitor-seeds-general.txt; do
  [[ -e "$SKILL_ROOT/references/$f" ]] || { echo "Missing reference: $f" >&2; exit 1; }
done

echo "ok skill_root=$SKILL_ROOT"