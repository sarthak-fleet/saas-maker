/**
 * OpenNext / Cloudflare Worker adapter.
 *
 * Prepend before openNext.fetch / app fetch:
 *
 *   import { handleAgentSurfaceRequest } from '.../adapters/worker.mjs'
 *
 *   export default {
 *     async fetch(request, env, ctx) {
 *       const agent = await handleAgentSurfaceRequest(request, { handler })
 *       if (agent) return agent
 *       return openNext.fetch(request, env, ctx)
 *     }
 *   }
 *
 * @param {Request} request
 * @param {{ handler: (request: Request) => Promise<Response | null> }} options
 * @returns {Promise<Response | null>}
 */
export async function handleAgentSurfaceRequest(request, options) {
  if (!options?.handler) {
    throw new TypeError('handleAgentSurfaceRequest: options.handler required');
  }
  return options.handler(request);
}

/**
 * Compose agent handler with an existing fetch handler.
 *
 * @param {(request: Request, env: any, ctx: any) => Promise<Response>} appFetch
 * @param {{ handler: (request: Request) => Promise<Response | null> }} options
 */
export function withAgentSurfaces(appFetch, options) {
  return async function fetch(request, env, ctx) {
    const agent = await handleAgentSurfaceRequest(request, options);
    if (agent) return agent;
    return appFetch(request, env, ctx);
  };
}
