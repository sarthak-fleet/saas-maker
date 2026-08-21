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

## Preserved, noncanonical scripts

Other files below `scripts/` and their supporting `lib/` modules are retained
because the owner explicitly chose not to delete scripts or skills during the
workspace split. They include historical Founder Control, growth, marketing,
analytics, distribution, catalog, and host-automation implementations.

These files are not advertised as active capabilities and must not be treated
as current product ownership. In particular, the following retained
entrypoints have canonical implementations in Site Health:

- `ai-visibility-canary.mjs`;
- `ai-visibility-provider-observations.mjs`;
- `run-performance-portfolio.mjs`; and
- `search-console-collect.mjs`.

Site Health owns their live implementation, private catalog, evidence config,
and data. A future compatibility wrapper may delegate to Site Health, but the
preserved copies here must not be edited as an alternative source of truth.

SaaS Maker and Reel Pipeline cleanup is intentionally outside this boundary.
