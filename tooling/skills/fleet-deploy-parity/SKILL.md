---
name: fleet-deploy-parity
description: Check whether live Fleet products match origin/main, including SHA-tagged Workers at 100% traffic, and current-main Actions are green.
---

# fleet-deploy-parity — is production in sync with main?

Answers one focused question: **does the live Cloudflare deployment for every
Fleet product match the latest `origin/main`?** This is a read-only fleet-wide
parity check, not a single-project deploy gate (use `fleet-deploy-guard` for
that) and not a full audit (use `fleet-audit` for that).

## When to invoke

- "Is everything deployed to the latest?"
- "Is production in sync with main?"
- "Are all sites live / up to date?"
- "What's not deployed yet?"
- "Did the last commit on each project ship?"
- Before a release pass or after a batch of merges to confirm nothing is left
  behind on `main` but not on Cloudflare.

## What it checks

For each live project in `site-health/apps/backend/config/projects.json` with
`deployKind` of `pages` or `worker`:

1. **Pages** — the latest production deployment's source commit matches
   `origin/main` of the project repo. Reports `OK` when the deployment source
   SHA is a prefix of (or equal to) `origin/main`, `FAIL` when it is not, and
   `WARN` when the commit source is unavailable.
2. **Workers** — the latest deployment is at 100% traffic, then resolves its
   active version through `wrangler versions list` and compares the version's
   `workers/tag` annotation with `origin/main`. Reports `OK` only on an exact
   full-SHA match, `FAIL` on a mismatch, and `WARN` for legacy deployments
   without a full Git SHA tag.
3. **GitHub Actions** — current push workflows at `origin/main` are green.
   Manual deploys and schedules do not override push-CI evidence. Bot-generated
   commits that intentionally suppress another push run inherit the nearest
   ancestor's exact green push evidence.

Local-only and out-of-fleet projects are skipped.

## How to invoke

Run the Fleet-owned deploy health script from the Fleet root:

```bash
cd ~/Desktop/fleet
./saas-maker/tooling/scripts/deploy-health.sh
```

Flags (all optional):

```bash
./saas-maker/tooling/scripts/deploy-health.sh --no-github      # skip Actions parity
./saas-maker/tooling/scripts/deploy-health.sh --no-cloudflare  # skip Cloudflare parity
./saas-maker/tooling/scripts/deploy-health.sh --no-standards   # skip deploy-entrypoint checks
./saas-maker/tooling/scripts/deploy-health.sh --targets path.json
```

The script exits non-zero if any `FAIL` is recorded. Requires `gh` (authed),
`jq`, and `wrangler` (authed) on PATH.

## Output format

The script prints three sections — Project Deploy Standards, GitHub Actions,
Cloudflare Deployments — then a summary:

```
== Cloudflare Deployments ==
OK    rolepatch Pages rolepatch deployed <sha> from main (https://...)
FAIL  karte Pages karte is not at origin/main <sha>; latest deployment source <other-sha> (https://...)
OK    pace Worker pace deployed <sha> from main at 100% (...)
WARN  reader Worker reader is active at 100% but version <id> has no full Git SHA tag; deployed commit unknown
...
== Summary ==
Failures: 1
Warnings: 0
```

### How to interpret

- `OK` — the deployed Pages source or active Worker version SHA exactly matches
  `origin/main`; no action.
- `WARN` — commit identity is unavailable, Worker traffic is split, or current
  push Actions were skipped or are missing. Parity is **not confirmed**;
  investigate before reporting the fleet as current.
- `FAIL` — production is behind `main`, deployment list failed, or Actions is
  red at the current `origin/main` SHA. This is the "not deployed to latest"
  signal the user is asking about.

### Reporting back

Summarize as a fleet-wide parity table:

| Project | Kind | Target | Deployed SHA / traffic | origin/main | Status |
|---|---|---|---|---|---|
| rolepatch | pages | rolepatch | `<sha>` | `<sha>` | OK |
| karte | pages | karte | `<other-sha>` | `<sha>` | BEHIND |
| pace | worker | pace | `<sha>` / 100% | `<sha>` | OK |

Then list the behind/non-100% projects explicitly so the user knows what to
redeploy, and list untagged Workers as **unknown**, never current. Do not
redeploy anything from this skill — it is read-only. If the user wants to
redeploy, hand off to `fleet-deploy-guard` per project.

## Worker deployment contract

Every production Worker upload must attach the full Git SHA:

```bash
wrangler deploy --tag "$(git rev-parse HEAD)"
```

GitHub Actions should use the immutable checked-out SHA:

```yaml
command: deploy --tag ${{ github.sha }}
```

OpenNext passes unknown deploy arguments through to Wrangler:

```bash
opennextjs-cloudflare deploy --tag "$GITHUB_SHA"
```

Do not use branch names, timestamps, abbreviated SHAs, or release labels as the
tag. The parity script accepts exactly 40 hexadecimal characters so it can make
an unambiguous comparison.

## What this skill does NOT cover

- Single-project deploy readiness gate → `fleet-deploy-guard`
- Full fleet audit (git health, PROJECT_STATUS sync, resilience) → `fleet-audit`
- Cloudflare/Turso spend → `cloudflare-spend-guard`
- Public product browser journeys → `public-product-smoke`
- Actually deploying anything → this skill is read-only
