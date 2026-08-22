# Preserved tooling boundary

The repository contains two intentionally different classes of tooling.

## Active standalone entrypoints

The capability catalog exposes only scripts that operate from the standalone
Workflows & Skills checkout without requiring the retired `foundry/ops`
layout:

- agent and skill linking;
- public availability checks;
- Git repository health;
- GitHub Actions policy checks;
- capability discovery and validation;
- GitHub priority-queue synchronization; and
- repository tooling validation.

Run `node scripts/fleet-capabilities.mjs doctor --json` for the exact current
catalog. Tests fail if an old Console, marketing, analytics, or Site Health
entrypoint becomes active accidentally.

Canonical-root site audit (`scripts/ahrefs-site-audit-health.mjs`) reads Site
Health's brand catalog, crawls those roots, and emits source actions. Ahrefs
Health Scores are optional. It is not advertised as a credential-free catalog
entrypoint. The preserved copy under `preserved/legacy-fleet-tooling/` remains
historical.

## Preserved, noncanonical scripts

Historical product and control-plane entrypoints are physically isolated under
`preserved/legacy-fleet-tooling/` because the owner explicitly chose not to
delete scripts or skills during the workspace split. The retained tree includes
former Founder Control, Console, analytics, catalog, and Site Health
implementations, plus reusable workflows for extracted products.

These files are not advertised as active capabilities or registered as GitHub
Actions workflows. They are source-history evidence, not runnable compatibility
contracts. In particular, the following retained entrypoints have canonical
implementations in Site Health:

- `ai-visibility-canary.mjs`;
- `ai-visibility-provider-observations.mjs`;
- `run-performance-portfolio.mjs`; and
- `search-console-collect.mjs`.

Site Health owns their live implementation, private catalog, evidence config,
and data. The preserved copies must not be edited as an alternative source of
truth.

SaaS Maker and Reel Pipeline cleanup is intentionally outside this boundary.
