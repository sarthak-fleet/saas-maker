/** Paths that must never fall through to an SPA HTML shell. */
const AGENT_PATHS = new Set([
  '/llms.txt',
  '/llms-full.txt',
  '/api/ai',
  '/skill.md',
  '/agents.md',
  '/humans.txt',
  '/.well-known/skills/index.json',
  '/.well-known/agent.json',
  '/.well-known/mcp.json',
]);

/**
 * @param {string} pathname
 * @returns {boolean}
 */
export function isAgentPath(pathname) {
  if (!pathname) return false;
  const path = normalizePath(pathname);
  if (AGENT_PATHS.has(path)) return true;
  if (path.endsWith('.md')) return true;
  if (path.startsWith('/.well-known/skills/')) return true;
  return false;
}

/**
 * @param {string} htmlPath e.g. "/" or "/pricing"
 * @returns {string} e.g. "/index.md" or "/pricing.md"
 */
export function markdownPathFor(htmlPath) {
  const path = normalizePath(htmlPath);
  if (path === '/') return '/index.md';
  if (path.endsWith('.md')) return path;
  return `${path.replace(/\/$/, '')}.md`;
}

/**
 * @param {string} mdPath e.g. "/index.md" or "/pricing.md"
 * @returns {string}
 */
export function htmlPathFromMarkdown(mdPath) {
  const path = normalizePath(mdPath);
  if (path === '/index.md') return '/';
  if (path.endsWith('.md')) return path.slice(0, -3);
  return path;
}

/**
 * Prefer markdown when Accept ranks text/markdown over text/html
 * (or when only markdown/plain is offered).
 *
 * @param {Request | { headers?: Headers | Record<string, string> }} request
 * @returns {boolean}
 */
export function wantsMarkdown(request) {
  const headers = request?.headers;
  const accept =
    typeof headers?.get === 'function'
      ? headers.get('accept') || ''
      : headers?.accept || headers?.Accept || '';
  if (!accept) return false;
  const lower = accept.toLowerCase();
  if (!lower.includes('text/markdown') && !lower.includes('text/x-markdown')) {
    return false;
  }
  // Explicit markdown preference without html, or markdown listed first.
  if (!lower.includes('text/html')) return true;
  const mdIdx = indexOfMedia(lower, 'text/markdown');
  const htmlIdx = indexOfMedia(lower, 'text/html');
  if (mdIdx === -1) return false;
  if (htmlIdx === -1) return true;
  return mdIdx < htmlIdx;
}

/**
 * Detect SPA / HTML shell responses that fake agent endpoints.
 * @param {string | ArrayBuffer | Uint8Array} body
 * @param {string} [contentType]
 */
export function isHtmlShell(body, contentType = '') {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  const text = bodyToPreview(body);
  if (!text) return false;
  const head = text.slice(0, 200).toLowerCase();
  return (
    head.includes('<!doctype') ||
    head.includes('<html') ||
    head.includes('<div id="root"') ||
    head.includes('<div id="app"')
  );
}

/**
 * @param {string} body
 * @param {string} contentType
 * @param {Record<string, string>} [extraHeaders]
 */
export function textResponse(body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      ...extraHeaders,
    },
  });
}

/**
 * @param {unknown} data
 * @param {Record<string, string>} [extraHeaders]
 */
export function jsonResponse(data, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...extraHeaders,
    },
  });
}

/**
 * @param {string} body
 * @param {Request | { headers?: Headers }} [request] for Accept negotiation
 * @param {Record<string, string>} [extraHeaders]
 */
export function markdownResponse(body, request, extraHeaders = {}) {
  const preferMd = request ? wantsMarkdown(request) : true;
  const type = preferMd ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
  return textResponse(body, type, { Vary: 'Accept', ...extraHeaders });
}

/**
 * @param {string} mdPath absolute path starting with /
 */
export function alternateLinkHeader(mdPath) {
  const path = normalizePath(mdPath);
  return `<${path}>; rel="alternate"; type="text/markdown"`;
}

function normalizePath(pathname) {
  if (!pathname) return '/';
  try {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    /* keep raw */
  }
  let path = pathname.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

function indexOfMedia(acceptLower, media) {
  const parts = acceptLower.split(',').map((p) => p.trim());
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(media)) return i;
  }
  return -1;
}

function bodyToPreview(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body.slice(0, 256));
  }
  return '';
}
