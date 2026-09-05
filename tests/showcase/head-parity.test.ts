import { describe, expect, it } from 'vitest';
import { onRequest } from '../../apps/showcase/functions/_middleware';

const SITE = 'https://sassmaker.com';

// Routes the static build emits. Everything else is a genuine 404.
const PAGES = ['/', '/learnings', '/projects', '/studio', '/tools', '/ideas', '/changelog'];

function pageHtml(pathname: string): string {
  return `<!doctype html><html lang="en"><head><link rel="canonical" href="${SITE}${pathname}" /></head><body>page</body></html>`;
}

/**
 * Stands in for the Cloudflare Pages asset server, including the detail that
 * caused issue #93: a HEAD request is answered with a null body. The
 * middleware used to read that empty body, find no canonical URL in it, and
 * classify every interior page as a soft-404.
 */
function assetServer(request: Request): Response {
  const { pathname } = new URL(request.url);
  const found = PAGES.includes(pathname);
  const body = found ? pageHtml(pathname) : '<!doctype html><html><body>404</body></html>';
  return new Response(request.method === 'HEAD' ? null : body, {
    status: found ? 200 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

type MiddlewareContext = Parameters<typeof onRequest>[0];

function contextFor(request: Request): MiddlewareContext {
  return {
    request,
    next: (input?: Request) =>
      Promise.resolve(assetServer(input instanceof Request ? input : request)),
    env: {
      ASSETS: { fetch: (input: Request) => Promise.resolve(assetServer(input)) },
    },
  } as unknown as MiddlewareContext;
}

function respond(path: string, method: 'GET' | 'HEAD'): Promise<Response> {
  return Promise.resolve(onRequest(contextFor(new Request(`${SITE}${path}`, { method }))));
}

describe('showcase middleware verb parity', () => {
  it('answers HEAD with the same status as GET on every public route', async () => {
    for (const path of [...PAGES, '/p/anchor-does-not-exist', '/nope']) {
      const [head, get] = await Promise.all([respond(path, 'HEAD'), respond(path, 'GET')]);
      expect(`${path} HEAD=${head.status}`).toBe(`${path} HEAD=${get.status}`);
    }
  });

  it('serves interior routes to HEAD instead of soft-404ing them', async () => {
    const head = await respond('/learnings', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get('vary')).toMatch(/Accept/);
  });

  it('still 404s unknown routes for both verbs', async () => {
    expect((await respond('/nope', 'HEAD')).status).toBe(404);
    expect((await respond('/nope', 'GET')).status).toBe(404);
  });

  it('keeps the file build format that maps slashless URLs onto .html assets', async () => {
    const config = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../apps/showcase/astro.config.mjs', import.meta.url), 'utf8')
    );
    expect(config).toMatch(/trailingSlash: 'never'/);
    expect(config).toMatch(/format: 'file'/);
  });
});
