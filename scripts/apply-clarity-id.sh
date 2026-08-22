#!/usr/bin/env bash
# apply-clarity-id.sh — replace CLARITY_PROJECT_ID placeholder with the real
# Clarity Project ID across all fleet projects that have the snippet installed.
#
# Usage:
#   ./apply-clarity-id.sh <10-char-clarity-project-id>
#
# Run from the fleet root (/Users/sarthak/Desktop/fleet).
# Safe to re-run — only touches files that still contain the placeholder.

set -euo pipefail

ID="${1:?Usage: apply-clarity-id.sh <clarity-project-id>}"

if [[ ! "$ID" =~ ^[a-z0-9]{10}$ ]]; then
  echo "ERROR: Clarity Project ID must be a 10-char lowercase alphanumeric string." >&2
  echo "  Get it from clarity.microsoft.com → Settings → Setup → Install tracking code" >&2
  exit 1
fi

FILES=(
  "workflows-and-skills/templates/clarity-snippet.html"
  "codevetter/apps/landing-page-astro/src/layouts/Layout.astro"
  "induldge/src/layouts/SiteLayout.astro"
  "posttrainllm/browser/src/layouts/Default.astro"
  "reddit-insights/scripts/build-pages.mjs"
  "significanthobbies/src/app/layout.tsx"
  "drank/app/layout.tsx"
  "rolepatch/src/app/layout.tsx"
  "high-signal/apps/web/src/app/layout.tsx"
  "starboard/src/app/layout.tsx"
  "india-standards/app/layout.tsx"
  "saas-maker/apps/cockpit/src/app/layout.tsx"
  "reader/app.html"
  "anime-list/index.html"
  "email-manager/index.html"
  "swe-interview-prep/index.html"
)

replaced=0
skipped=0

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "WARN: $f not found — skipping"
    skipped=$((skipped + 1))
    continue
  fi
  if grep -q "CLARITY_PROJECT_ID" "$f"; then
    sed -i '' "s/CLARITY_PROJECT_ID/$ID/g" "$f"
    echo "  replaced: $f"
    replaced=$((replaced + 1))
  else
    echo "  already done: $f"
    skipped=$((skipped + 1))
  fi
done

echo ""
echo "Done. Replaced $replaced file(s), skipped $skipped."
echo "Verify: grep -rl CLARITY_PROJECT_ID . --include='*.{tsx,astro,html,mjs}'"
echo "  (should return zero results)"
