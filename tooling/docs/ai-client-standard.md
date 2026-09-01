# Fleet AI client standard

**Status: ratified 2026-08-30 on issue #61.**

Fleet does not use a shared AI gateway. Each product owns its direct free-tier
provider or local-inference endpoint, credential, quota policy, and fallback.
Shared tooling owns only the credential-free audit and exact client pins.

## Runtime contract

JavaScript and TypeScript model callers use:

- `ai@6.0.168`;
- `@ai-sdk/openai-compatible@2.0.41` when a maintained provider-specific adapter
  does not fit;
- `@ai-sdk/react@3.0.86` only for React surfaces that need it.

Versions are exact. Review one converging upgrade monthly; do not let every
repository drift independently.

The endpoint comes from project-owned runtime configuration (`AI_BASE_URL` is
the neutral default name) and the credential from a project-owned secret
(`AI_API_KEY` is the neutral default name). Values never belong in source,
examples, audit reports, or shared configuration.

Swift, Rust, Python, and other runtimes where the Vercel AI SDK cannot run use
the smallest maintained native client. The audit records those as dated
exceptions or native paths; it does not force a JavaScript dependency into an
incompatible runtime.

## Routing rules

- Prefer a local model when it satisfies the product requirement.
- Otherwise choose a deliberate free-tier provider path owned by the product.
- Do not add paid-provider spend or a shared credential during migration.
- `ai-gateway.sassmaker.com` is retired.
- Gateway-only variables such as `AI_GATEWAY_BASE_URL` and
  `FREE_AI_GATEWAY_URL` are retired in active source.
- A direct provider host is evidence of the chosen route, not a policy breach.
- Hand-written JS/TS HTTP remains migration debt even when it points at an
  acceptable direct provider; the pinned SDK is the maintained seam.

## What the audit proves

`scripts/ai-client-audit.mjs` reads package manifests and tracked source across
the supplied project list. It reports exact SDK pins, ranged/off-pin packages,
provider SDK and raw HTTP paths, retired gateway references, and
credential-shaped literals. High-confidence provider calls stay separate from
mentions, examples, tests, and endpoint pickers.

The detector fails on a credential literal, the retired gateway host, or a
gateway-only variable. It reports SDK drift and hand-written calls as migration
work so existing debt remains visible without making shared tooling permanently
red.

Direct provider paths are not compared with the old gateway path list. A
provider-specific moderation, messages, embeddings, image, speech, or model
endpoint can be valid when the owning product deliberately chose it.

## Exceptions

Exceptions live in `config/ai-client-standard.json` with a recorded date,
written reason, and review date when appropriate. They are for runtime or
product boundaries, not convenience.

The current exceptions are `free-ai`, temporarily while its retiring upstream
clients remain, and `posttrainllm`, where local training/inference and native
evaluation paths are the product.

## Running the audit

```bash
pnpm tooling:ai-clients
node scripts/ai-client-audit.mjs
node scripts/ai-client-audit.mjs --json
node scripts/ai-client-audit.mjs --check
node scripts/ai-client-audit.mjs --omit-private
```

The default project list is Site Health's private catalog. Committed reports
use `--omit-private`, which counts private repositories without naming them.
Build output and dependency directories are excluded. Use `--explain` only
locally when a credential finding needs a file path.

Production deploys, credential changes, provider-resource deletion, DNS
changes, and gateway decommissioning remain separate operational actions.
The non-executing, approval-gated decommission runbook belongs to the retiring
Free AI product at
[`docs/operations/decommission.md`](https://github.com/sass-maker/free-ai/blob/main/docs/operations/decommission.md).
