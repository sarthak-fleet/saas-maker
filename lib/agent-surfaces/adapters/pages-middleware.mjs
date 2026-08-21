/**
 * Cloudflare Pages Functions middleware adapter.
 *
 * Copy into functions/_middleware.ts (or import if your bundler allows):
 *
 *   import { createPagesAgentMiddleware } from '...'
 *   export const onRequest = createPagesAgentMiddleware({ handler })
 *
 * @param {{ handler: (request: Request) => Promise<Response | null> }} options
 */
export function createPagesAgentMiddleware(options) {
  if (!options?.handler) {
    throw new TypeError('createPagesAgentMiddleware: options.handler required');
  }
  return async function onRequest(context) {
    const agent = await options.handler(context.request);
    if (agent) return agent;
    return context.next();
  };
}
