#!/usr/bin/env bash
#
# Weekly fleet perf sweep + regression check.
#
# Runs the PSI swarm sweep against all production URLs, saves a dated
# scoreboard, then compares against the previous run for regressions.
#
# Usage:
#   bash scripts/fleet-perf-weekly.sh [--runs 3] [--concurrency 2]
#
# Requires: psi-swarm CLI built at psi-swarm/cli/dist/cli.js

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$SCRIPT_DIR/../docs"

# Pass through args
ARGS="$*"

echo "=== Fleet Perf Weekly Sweep ==="
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Run the sweep (merge with prior results so we keep full coverage)
node "$SCRIPT_DIR/fleet-perf-sweep.mjs" $ARGS

echo ""
echo "=== Regression Check ==="

# Compare the two newest scoreboards
node "$SCRIPT_DIR/fleet-perf-regression-check.mjs"

echo ""
echo "=== Done ==="
