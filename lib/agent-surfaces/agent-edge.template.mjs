/**
 * Portable agent-edge handler — copy or generate into each product.
 * Spec: foundry/ops/docs/agent-indexing-standard.md
 *
 * Usage in worker.mjs (before openNext.fetch):
 *   import { handleAgentEdge } from './agent-edge.mjs'
 *   const agent = handleAgentEdge(request)
 *   if (agent) return agent
 */

/** @type {{ name: string, url: string, llmsTxt: string, llmsFullTxt?: string, indexMd: string, catalog: object }} */
// biome-ignore format: generated payload from apply-agent-surfaces (JSON keys/quotes)
export const AGENT_SURFACE = __AGENT_SURFACE_JSON__;

/**
 * @param {Request} request
 * @returns {Response | null}
 */
export function handleAgentEdge(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname === '' ? '/' : url.pathname;

  if (path === '/llms.txt') {
    return text(AGENT_SURFACE.llmsTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/llms-full.txt' && AGENT_SURFACE.llmsFullTxt) {
    return text(AGENT_SURFACE.llmsFullTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/index.md') {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8');
  }
  if (path === '/api/ai') {
    // Re-bind origin so preview/custom domains stay correct
    const catalog = {
      ...AGENT_SURFACE.catalog,
      url: url.origin,
      llms: `${url.origin}/llms.txt`,
      llmsFull: `${url.origin}/llms-full.txt`,
      sitemap: AGENT_SURFACE.catalog.sitemap
        ? String(AGENT_SURFACE.catalog.sitemap).replace(AGENT_SURFACE.url, url.origin)
        : `${url.origin}/sitemap.xml`,
      surfaces: (AGENT_SURFACE.catalog.surfaces || []).map((s) => ({
        ...s,
        url: s.url ? String(s.url).replace(AGENT_SURFACE.url, url.origin) : s.url,
        md: s.md ? String(s.md).replace(AGENT_SURFACE.url, url.origin) : s.md,
      })),
    };
    return json(catalog);
  }

  // Homepage markdown negotiation
  if ((path === '/' || path === '') && wantsMarkdown(request)) {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8', {
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
      Vary: 'Accept',
    });
  }

  return null;
}

function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
}

function text(body, type, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300',
      ...extra,
    },
  });
}

function json(data) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
