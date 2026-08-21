#!/usr/bin/env bash
# Copy template internals into an existing site/, keeping site.config.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT/foundry/ops/templates/ios-landing"
DEST="${1:-}"

if [[ -z "$DEST" || ! -d "$DEST" ]]; then
  echo "Usage: sync-ios-landing.sh <site-dir>" >&2
  exit 1
fi

rsync -a --delete \
  --exclude site.config.ts \
  "$TEMPLATE/src/" "$DEST/src/"
cp "$TEMPLATE/scripts/check-site.mjs" "$DEST/scripts/check-site.mjs"
cp "$TEMPLATE/astro.config.mjs" "$DEST/astro.config.mjs"
echo "Synced template internals into $DEST (site.config.ts kept)."
