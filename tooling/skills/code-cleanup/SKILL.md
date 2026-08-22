---
name: code-cleanup
description: Run Fleet code cleanup, dependency health checks, and guarded package upgrades in one place. Use for unused code or packages, outdated or vulnerable dependencies, Knip, lint/typecheck/test/format-check orchestration, Bundlephobia evidence, package recommendations, manifest or lockfile edits, and Fleet-wide dependency checks.
---

# Code Cleanup

Use this skill to inspect cleanup opportunities and before changing a dependency
manifest or lockfile. Prefer fewer packages and less dead code, but do not
replace mature security-, protocol-, or parser-sensitive libraries with fragile
local code merely to reduce a count.

## Workflow

1. Read the nearest `AGENTS.md`, project status, package-manager declaration,
   manifest, lockfile, and relevant imports.
2. Search the runtime, standard library, existing direct/transitive packages,
   and repo code for an adequate capability.
3. Classify the proposed change:
   - production or development;
   - browser, server, build, test, native, or tooling;
   - direct package addition, replacement, upgrade, removal, or lockfile-only
     change.
4. Before adding a production dependency, explain:
   - why existing code is insufficient;
   - why this package and version;
   - maintenance, license, security, and transitive-dependency considerations;
   - the smallest viable alternative.
5. Obtain explicit approval before modifying a production dependency.
6. For a browser-shipped npm candidate, run the exact-version Bundlephobia
   lookup. Treat it as advisory; use the application's real build for the final
   bundle delta.
7. Make the smallest approved change with the repository's package manager.
8. Run `outdated` before upgrading. Treat same-major updates as conservative;
   for `0.x`, treat only patch updates as conservative. Review changelogs and
   migration notes before any major.
9. Preview upgrades first. Apply only after the user authorizes mutation:
   - use named packages for targeted work;
   - require `--all --safe` for bulk non-major updates;
   - require named packages plus `--allow-major` for majors;
   - never use upgrade mode to introduce a package that is not already direct.
10. After applying, let the command rerun dependency audit, Knip, native checks,
    and whitespace validation. If anything fails, preserve the diff and report
    the partial result; do not silently roll back over user work.
11. Review findings before deleting code or packages. Static analysis and
    freshness reports are evidence, not authorization for automatic removal.
12. Report the cleanup decision, direct dependency deltas, validations, and
    residual uncertainty.

## Commands

Set the canonical script path:

```bash
CLEANUP=~/Desktop/fleet/saas-maker/tooling/skills/code-cleanup/scripts/code-cleanup.mjs
```

Run the complete read-only cleanup pass for one project:

```bash
node "$CLEANUP" run --repo /path/to/repo
```

This includes outdated-package and vulnerability checks. Skip remote registry
checks only when intentionally working offline:

```bash
node "$CLEANUP" run --repo /path/to/repo --skip-outdated --skip-audit
```

Check direct package freshness without running the rest of cleanup:

```bash
node "$CLEANUP" outdated --repo /path/to/repo
```

Preview all conservative updates without modifying files:

```bash
node "$CLEANUP" upgrade --repo /path/to/repo --all --safe
```

Apply those updates and automatically run post-upgrade cleanup:

```bash
node "$CLEANUP" upgrade --repo /path/to/repo --all --safe --apply
```

Preview or apply selected packages:

```bash
node "$CLEANUP" upgrade --repo /path/to/repo --package react
node "$CLEANUP" upgrade --repo /path/to/repo \
  --package react@20.0.0 --allow-major --apply
```

Include advisory Bundlephobia evidence for explicitly confirmed public browser
packages:

```bash
node "$CLEANUP" run --repo /path/to/repo \
  --bundlephobia react@19.1.1 \
  --bundlephobia zod@4.0.5
```

Check `HEAD` against one working tree:

```bash
node "$CLEANUP" check --repo /path/to/repo
```

Return non-zero when any recognized manifest or lockfile changed:

```bash
node "$CLEANUP" check --repo /path/to/repo --strict
```

Compare revisions for CI or review:

```bash
node "$CLEANUP" check --repo /path/to/repo --base origin/main --head HEAD --json
```

Scan active local Fleet repositories from the canonical registry:

```bash
node "$CLEANUP" fleet
```

Look up an exact browser npm candidate:

```bash
node "$CLEANUP" lookup react@19.1.1
```

`run`, `outdated`, and `upgrade` accept `--timeout-ms`. `run` and `upgrade`
accept repeatable `--bundlephobia` values. Bundlephobia lookup failure does not
alter dependency findings, but a requested lookup failure makes the combined
run non-zero. Never send source, manifests, credentials, inferred names, or
private package names to it; only query exact public npm package specifiers.

## Interpretation

- `NO ACTION` means dependency comparison and all selected checks passed.
- `ACTION REQUIRED` means a dependency needs review or a selected local/remote
  check failed. The runner still emits results for later checks.
- Outdated packages make `run` action-required and make `outdated` exit 1.
  Registry or audit execution errors exit 2.
- `upgrade` is a preview until `--apply` is present. Applying refuses to overlap
  existing manifest or lockfile changes and runs package lifecycle scripts in
  disabled/skip-build mode where supported.
- Bulk `--all --safe` never crosses a major boundary and only applies patches
  within `0.x`. Major upgrades must be named explicitly.
- `unavailable` means the repository has no discoverable native path for that
  coverage. It is not equivalent to a passed analysis.
- `skipped` identifies unsafe or redundant work, such as a write-mode `format`
  script or focused checks already covered by an aggregate `check`.
- Dependency `CLEAN` means no review-requiring dependency delta was found. Parseable
  `package.json` script or metadata-only edits remain clean. This does not prove
  all existing packages are used.
- Dependency `REVIEW REQUIRED` means a direct npm dependency, opaque manifest, or lockfile
  changed, or parsing failed.
- `package.json` findings include exact direct additions, removals, and version
  changes across production, development, peer, and optional groups.
- Other ecosystems are intentionally flagged for native review instead of
  being parsed heuristically.
- A lockfile-only finding is not evidence that no dependency changed.

For existing JS/TS packages, use the Fleet Knip standard as the unused-package
authority. Do not add `depcheck`, a Bundlephobia wrapper, or another overlapping
dependency. Do not automatically delete a Knip finding: inspect exports,
entrypoints, generated code, framework conventions, and dynamic imports first.
