# agent-surfaces

Shared GEO / LLM indexing helpers for the fleet.

**Standard:** [`docs/agent-indexing-standard.md`](../../docs/agent-indexing-standard.md)

## Surfaces

| Path | Purpose |
|---|---|
| `/llms.txt` | Site map for agents |
| `/llms-full.txt` | Optional expanded index |
| `*.md` / `Accept: text/markdown` | Page content without JS |
| `/api/ai` | JSON discovery catalog |

## Quick start

```js
import {
  createAgentSurfaceManifest,
  createAgentSurfaceHandler,
} from './index.mjs';

const manifest = createAgentSurfaceManifest({
  name: 'Example',
  url: 'https://example.com',
  summary: 'One-line product truth for agents.',
  mode: 'static',
  product: [{ title: 'Home', url: 'https://example.com/', description: 'Landing' }],
  pages: {
    '/': '# Example\n\nLanding copy agents can read.\n',
    '/pricing': '# Pricing\n\n$0 forever.\n',
  },
});

const handler = createAgentSurfaceHandler({ manifest });
// Worker: const res = await handler(request); if (res) return res;
```

## Adapters

| File | Stack |
|---|---|
| `adapters/worker.mjs` | OpenNext / CF Worker (`withAgentSurfaces`) |
| `adapters/hono.mjs` | Hono middleware **before** SPA fallback |
| `adapters/pages-middleware.mjs` | CF Pages Functions |
| `adapters/astro-build.mjs` | Emit files into `public/` / `dist/` |

## Audit

```bash
node foundry/ops/skills/agent-ready/scripts/agent-index-audit.mjs --all
```
