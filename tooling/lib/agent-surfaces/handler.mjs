import {
  isAgentPath,
  wantsMarkdown,
  markdownPathFor,
  htmlPathFromMarkdown,
  markdownResponse,
  textResponse,
  jsonResponse,
  alternateLinkHeader,
} from './http.mjs';

/**
 * Create a request handler for agent surfaces.
 *
 * Returns a Response if the request is handled, or null to fall through
 * to the app (HTML, API, SPA).
 *
 * @param {{
 *   manifest: ReturnType<import('./manifest.mjs').createAgentSurfaceManifest>,
 *   /** Optional async loader for dynamic pages: (htmlPath) => markdown | null *\/
 *   loadMarkdown?: (htmlPath: string, request: Request) => Promise<string | null> | string | null,
 * }} options
 */
function handleFixedPath(path, manifest, request) {
  if (path === '/llms.txt') {
    return textResponse(manifest.llmsTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/llms-full.txt') {
    if (!manifest.llmsFull) return null;
    return markdownResponse(manifest.llmsFull, request);
  }
  if (path === '/api/ai') {
    return jsonResponse(manifest.catalog);
  }
  return undefined;
}

export function createAgentSurfaceHandler(options) {
  const { manifest, loadMarkdown } = options;
  if (!manifest) throw new TypeError('createAgentSurfaceHandler: manifest required');

  /**
   * @param {Request} request
   * @returns {Promise<Response | null>}
   */
  return async function handleAgentSurface(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;

    const url = new URL(request.url);
    const path = url.pathname === '' ? '/' : url.pathname;

    const fixed = handleFixedPath(path, manifest, request);
    if (fixed !== undefined) return fixed;

    // --- Explicit .md paths ---
    if (path.endsWith('.md') || isAgentPath(path)) {
      if (path.endsWith('.md')) {
        const body = await resolveMarkdown(path, request, manifest, loadMarkdown);
        if (body != null) return markdownResponse(body, request);
        // Known agent path with no body → 404 text, never SPA HTML
        if (isAgentPath(path)) {
          return new Response(`# Not found\n\nNo markdown surface at ${path}\n`, {
            status: 404,
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
          });
        }
      }
    }

    // --- Content negotiation on HTML routes ---
    if (manifest.negotiation && wantsMarkdown(request)) {
      const mdPath = markdownPathFor(path);
      const body = await resolveMarkdown(mdPath, request, manifest, loadMarkdown);
      if (body != null) {
        return markdownResponse(body, request, {
          Link: alternateLinkHeader(mdPath),
        });
      }
    }

    return null;
  };
}

/**
 * @param {string} mdOrHtmlPath
 * @param {Request} request
 * @param {any} manifest
 * @param {any} loadMarkdown
 * @returns {Promise<string | null>}
 */
async function resolveMarkdown(mdOrHtmlPath, request, manifest, loadMarkdown) {
  const pages = manifest.pages || {};

  // Direct key hit
  if (pages[mdOrHtmlPath] != null) return pages[mdOrHtmlPath];

  const htmlPath = mdOrHtmlPath.endsWith('.md')
    ? htmlPathFromMarkdown(mdOrHtmlPath)
    : mdOrHtmlPath;

  if (pages[htmlPath] != null) return pages[htmlPath];
  if (pages[markdownPathFor(htmlPath)] != null) return pages[markdownPathFor(htmlPath)];

  if (loadMarkdown) {
    const loaded = await loadMarkdown(htmlPath, request);
    if (loaded != null) return loaded;
  }

  return null;
}
