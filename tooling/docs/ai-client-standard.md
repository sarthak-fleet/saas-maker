# The canonical model-calling client — ratified

**Status: ratified 2026-08-29 by the owner on issue #61.**
`config/ai-client-standard.json` carries `"status": "ratified"`.

The rule: **every Fleet project that calls a hosted model goes through the
free-ai gateway** (`ai-gateway.sassmaker.com`) via its OpenAI-compatible paths.
In JavaScript and TypeScript the client is the Vercel AI SDK at the pinned
canonical versions. Runtimes without a JavaScript client still target the
gateway; only the client library differs. **Calling a provider API host directly
is non-compliant regardless of which client library is used** — that is the gap
the audit found in ten projects, including all three that were otherwise
"compliant" on packages alone.

Drift is still *reported rather than failed*, deliberately: 19 projects are
hand-rolled today, and reddening `tooling:check` on known debt would train
everyone to ignore it. Blocking findings remain narrow — a credential literal in
tracked source, or a reference to a retired gateway host.

Tracked by [issue #61](https://github.com/sass-maker/saas-maker/issues/61).

## What was measured

`scripts/ai-client-audit.mjs` walked the 56 projects in the supplied project
list, read every package manifest outside build output, and searched source for
gateway hosts, provider API hosts, OpenAI-compatible request paths, and client
imports. It is read-only, needs no credentials, and skips `node_modules`,
`.next`, `dist`, and other generated directories.

| Verdict | Projects |
| --- | --- |
| `compliant` | 3 — `karte`, `reader`, `swe-interview-prep` |
| `drifted` | 1 — `rolepatch` |
| `hand-rolled` | 19 |
| `exception` | 2 — `free-ai`, `posttrainllm` |
| `not-applicable` | 31 |

By calling pattern: 4 projects use the Vercel AI SDK, 2 reach for a provider SDK
directly, 19 build the HTTP request themselves, and 31 never call a hosted model
at all.

The hand-rolled group is `ai-game`, `codevetter`, `drank`, `email-manager`,
`high-signal`, `issue-pages`, `knowledge-base`, `looptv`, `mashup`, `on-record`,
`open-historia`, `pace`, `psi-swarm`, `reel-pipeline`, `research-papers`,
`saas-maker`, `sarthakagrawal-personal`, `starboard`, and `truehire`. Most carry
one to three call sites; `pace` and `codevetter` are the only ones with a
double-digit spread.

Two facts matter more than the totals:

- **Not everything goes through the gateway.** Ten projects reference a
  provider API host in source — eight excluding the two recorded exceptions:
  `codevetter`, `high-signal`, `issue-pages`, `pace`, `psi-swarm`, `reader`,
  `rolepatch`, and `swe-interview-prep`. Whichever option wins, those are the
  call sites carrying provider keys and provider billing, and the last three
  show that adopting the SDK does not by itself move a project onto the
  gateway.
- **Not every project is JavaScript.** `pace` is a Swift app, `codevetter` and
  `reel-pipeline` include Rust, and several projects call models from Python
  scripts. A JavaScript package cannot be the answer for those surfaces.

## The three options

### A. Vercel AI SDK, pinned, pointed at the gateway

`ai` plus `@ai-sdk/openai-compatible` at exact versions, with the base URL taken
from `AI_GATEWAY_BASE_URL`.

- Already the pattern in 4 projects, 3 of them on the same exact pin
  (`ai@6.0.168`, `@ai-sdk/openai-compatible@2.0.41`). It is the only pattern
  with any existing convergence to build on.
- Every one of those 4 projects also ships a Cloudflare Worker, so the "it will
  not run on Workers" objection to a JS SDK is not supported by the evidence.
- Cost: 19 projects gain two dependencies and lose a hand-written fetch helper,
  and the fleet takes on a shared upgrade obligation on a fast-moving package.
  Non-JS surfaces still need a separate answer.

### B. A published in-house Fleet client

A thin package wrapping the gateway, published so consumers can install it.

- Nothing like this exists today. `@sass-maker/ai-gateway` is the `free-ai`
  repository itself: `"private": true`, and not on npm. Choosing B means
  building, publishing, versioning, and maintaining a new package.
- It is the only option that could hide gateway specifics (auth header, base
  URL, model aliases) behind one seam, which is real value if those change.
- Cost: highest. A new release process, plus the same 19 migrations, to wrap
  what is currently a single `fetch` call in most consumers. `free-ai` is
  out of scope for this issue, so the package would need a new home.

### C. Raw `fetch` declared the deliberate standard

- Zero migration. Honest about what 19 projects already do, and the only option
  that applies uniformly to Swift, Rust, Python, and JavaScript.
- Cost: "is the AI client installed everywhere?" becomes permanently
  unanswerable, because there is no client. The audit degrades to "does
  everyone use the gateway host", which eight non-exception projects today do
  not. Retries, streaming, and tool-calling stay copy-pasted per project.

## Recommendation

**Option A, scoped to JavaScript and TypeScript surfaces, with raw `fetch`
(option C) as the recorded standard for runtimes with no JS.**

The reasoning:

1. It is the only option with existing convergence. Three projects are already
   on the same exact pin, so ratifying A makes them compliant on day one and
   turns the question into a migration backlog rather than a greenfield build.
2. The Workers objection does not survive the evidence. The adopters ship
   Workers already.
3. Option B's benefit — hiding the gateway behind a seam — is not currently
   being paid for. The gateway is OpenAI-compatible, which is precisely what
   `@ai-sdk/openai-compatible` consumes. B becomes the right answer only if the
   gateway stops being OpenAI-compatible or starts needing fleet-specific
   behaviour at the call site.
4. Scoping to JS/TS keeps the standard honest. Pretending a JavaScript package
   is the fleet-wide answer would force `pace`, and every Python eval harness,
   into a permanent exception list.

What ratification would *not* buy: the eight non-exception projects that reach
provider hosts directly are a routing and spend problem, not a client-library
problem. Moving them onto the gateway is worth more than the client choice, and
is independent of it.

## If the owner ratifies

1. Set `"status": "ratified"` and `"ratifiedAt"` in
   `config/ai-client-standard.json`. `scripts/validate-tooling.mjs` refuses a
   ratified standard without a date.
2. Decide whether `drifted` should then fail `pnpm tooling:check`. Today it
   never does — the audit fails only on things that are wrong under every
   option: an invalid standard file, a credential literal in tracked source, or
   a reference to a retired gateway host.
3. Work the migration backlog per repository, with build and test evidence in
   each, starting with `rolepatch` (see below).

## Exceptions

Recorded in `config/ai-client-standard.json` with a date, a reason, and a review
date. Two stand today:

- **`free-ai`** — the gateway itself. It must talk to upstream providers
  directly. Another product owns that repository; issue #61 treats it as
  read-only.
- **`posttrainllm`** — the product trains and runs its own in-browser model. Its
  only hosted-model call is a Python evaluation harness, where a JavaScript
  client cannot apply.

## Follow-ups deliberately not done here

- **`rolepatch` pin convergence.** It declares `ai@^6.0.97` and
  `@ai-sdk/openai-compatible@^2.0.41` as ranges rather than exact pins. That is
  a change in another repository, so it stays out of this repo's diff. It is
  unblocked now that the standard is ratified and should be converged in
  `rolepatch` itself.
- **The stale `.next/standalone` copy in `rolepatch`** restates the dependency
  set from a build. The audit skips `.next`, so it never reaches a verdict and
  needs no cleanup to keep the report honest.

## Running the audit

```bash
pnpm tooling:ai-clients                      # writes reports/ai-clients/latest.json
node scripts/ai-client-audit.mjs             # text report for the default project list
node scripts/ai-client-audit.mjs --json      # machine-readable
node scripts/ai-client-audit.mjs --check     # summary only; used by pnpm tooling:check
node scripts/ai-client-audit.mjs --omit-private   # never names a private repository
node scripts/ai-client-audit.mjs <list.json> --fleet-root <dir>
```

The project list defaults to the sibling Site Health catalog and may be any JSON
array of ids, or any object with a `projects` array. When no list is present the
`--check` run validates the standard and reports that there was nothing to scan,
so a clean checkout without sibling repositories still passes.

The project list is private input and this repository is public, so the
committed report is generated with `--omit-private`: projects whose repository
is not public are counted in the summary and in `withheld`, never named. All
seven withheld projects are `not-applicable`, so nothing is hidden that changes
the picture.

Credential findings deliberately carry no file path in the committed report;
rerun locally with `--explain` to see the locations. Literals inside test
blocks, fixtures, and assertion lines are treated as redaction canaries rather
than leaks.
