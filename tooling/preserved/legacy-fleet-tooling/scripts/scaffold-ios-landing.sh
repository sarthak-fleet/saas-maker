#!/usr/bin/env bash
# Copy the iOS landing template into a product repo as site/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT/foundry/ops/templates/ios-landing"
DEST="${1:-}"

if [[ -z "$DEST" ]]; then
  echo "Usage: scaffold-ios-landing.sh <product-repo>" >&2
  exit 1
fi

mkdir -p "$DEST"
if [[ -e "$DEST/site" ]]; then
  echo "Refusing to overwrite existing $DEST/site" >&2
  exit 1
fi

cp -R "$TEMPLATE" "$DEST/site"
rm -f "$DEST/site/wrangler.jsonc.example"
echo "Copied iOS landing template to $DEST/site"
echo "Next: edit site/src/site.config.ts and add screenshots under site/public/images/"
