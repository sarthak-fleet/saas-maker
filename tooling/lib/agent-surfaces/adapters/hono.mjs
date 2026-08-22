/**
 * Hono adapter — register agent surfaces BEFORE SPA / static fallback.
 *
 * Usage:
 *   import { createAgentSurfaceManifest, createAgentSurfaceHandler } from '../../index.mjs'
 *   import { agentSurfaceMiddleware } from '../../adapters/hono.mjs'
 *
 *   const manifest = createAgentSurfaceManifest({ ... })
 *   const handler = createAgentSurfaceHandler({ manifest, loadMarkdown })
 *   app.use('*', agentSurfaceMiddleware({ handler }))
 *   // then static / SPA routes
 */

/**
 * @param {{ handler: (request: Request) => Promise<Response | null> }} options
 */
export function agentSurfaceMiddleware(options) {
  if (!options?.handler) {
    throw new TypeError('agentSurfaceMiddleware: options.handler required');
  }
  const { handler } = options;
  return async (c, next) => {
    const response = await handler(c.req.raw);
    if (response) return response;
    return next();
  };
}

/**
 * Mount convenience — same as app.use('*', agentSurfaceMiddleware(...)).
 * @param {any} app Hono app
 * @param {{ handler: (request: Request) => Promise<Response | null> }} options
 */
export function mountAgentSurfaces(app, options) {
  app.use('*', agentSurfaceMiddleware(options));
}
