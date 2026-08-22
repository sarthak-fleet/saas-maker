---
name: analyze-storage
description: Create a read-only local disk-usage report whose scan JSON, classified evidence, and static HTML stay under Fleet Workspace. Use when the operator asks what is consuming storage, says a disk is full, wants storage or cache analysis, asks for cleanup candidates, or wants a storage report. Do not use for RAM or process-memory diagnosis.
---

# Analyze Storage

Generate evidence first; do not clean anything.

## Run

Resolve the directory containing this `SKILL.md`, then run its standard-library
entrypoint:

```bash
python3 <skill-dir>/scripts/analyze_storage.py
```

Useful bounded options:

```bash
python3 <skill-dir>/scripts/analyze_storage.py --scan-root <absolute-path>
python3 <skill-dir>/scripts/analyze_storage.py --min-mb 250
python3 <skill-dir>/scripts/analyze_storage.py --run-id <safe-run-id>
```

The command always writes below:

```text
<fleet-root>/.fleet-local/reports/storage/<run-id>/
├── scan.json
├── report.json
└── report.html
```

It does not accept an output-directory override. Open `report.html` only after
the command succeeds.

## Interpret

- `safe-cache`: recognized cache or reproducible developer cache. This is an
  estimate for review, not permission to remove it.
- `review-required`: downloads, projects, media, or unknown user content.
- `protected`: application state, containers, or system-owned content.
- `unreadable`: missing evidence. Never count it as releasable space.

Lead the response with total estimated safe-cache space and the largest two or
three findings. Mention unreadable paths as an evidence limitation. Give the
workspace-local HTML path, but do not paste the report's absolute-path inventory
into retained skill-run output.

## Safety Boundary

- Treat the scan and report as read-only evidence.
- Never delete, move to Trash, uninstall, change permissions, clear caches, or
  change system settings while using this skill.
- Never add a mutation server, cleanup button, shell cleanup command, or action
  endpoint to the report.
- A later cleanup request is a separate task that must resolve exact targets,
  follow active destructive-action rules, and obtain any required approval.
- Never commit or publish `.fleet-local/` artifacts.

## Attribution

The read-only scan, traffic-light risk model, and HTML-report concepts were
adapted from KKKKhazix's `storage-analyzer`. Fleet rewrote the runtime to remove
outside-workspace artifacts and all deletion behavior. See `LICENSE.upstream`.
