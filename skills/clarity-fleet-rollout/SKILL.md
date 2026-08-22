---
name: clarity-fleet-rollout
description: Create and wire one Microsoft Clarity project per Fleet catalog entry, with a recoverable ID receipt and explicit no-web-surface exceptions.
---

# clarity-fleet-rollout

Use for requests to set up, repair, or audit Microsoft Clarity across Fleet products. Do not use for a one-off snippet on an unrelated site.

## Source of truth

Read `../site-health/apps/backend/config/projects.json` from the Fleet root. Its top-level `projects` array is the complete product inventory; use the stable `id` for code and receipts, and `name` for the Clarity project name. Prefer the first configured custom domain as the website URL. When none exists, use a repository URL only to create the project and mark it **unwired** unless an actual browser-delivered surface is found.

## Safe workflow

1. Inspect the current Clarity project list in the signed-in browser. Reuse an exact intended match; never create a duplicate just because a browser action was interrupted.
2. Create missing projects in small batches. After any timeout, reconnect and audit the visible list before resuming.
3. Capture the 10-character project ID from the Clarity project URL or installation code. Maintain a receipt keyed by catalog `id`; require one unique ID per entry.
4. Locate the owned browser entrypoint before editing. Add the standard Clarity loader with the product-specific ID and `project_id` custom tag. Preserve PostHog and other analytics unchanged.
5. For local-only, deleted, retained-resource, CLI-only, or native-only entries, create the Clarity project if requested but do not invent a web surface. Record the reason as unwired.
6. Verify no placeholder or prior shared ID remains on wired surfaces, then run the smallest repo-local checks. Do not commit, push, deploy, or change credentials unless separately asked.

## Receipt requirements

Report the catalog ID, display name, Clarity ID, project URL, wired file(s), and any no-surface reason. Do not treat a queued browser action or a created project as proof that code is live; deployment evidence is separate.
