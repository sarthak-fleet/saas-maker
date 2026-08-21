/**
 * Fleet agent-surfaces kit — shared contract helpers for GEO / LLM indexing.
 *
 * Spec: foundry/ops/docs/agent-indexing-standard.md
 *
 * Zero runtime deps. Safe to import from Workers, Node, and build scripts.
 */

export {
  isAgentPath,
  markdownPathFor,
  htmlPathFromMarkdown,
  wantsMarkdown,
  isHtmlShell,
} from './http.mjs';

export { buildLlmsTxt } from './llms.mjs';

export { buildApiAiCatalog } from './catalog.mjs';

export { createAgentSurfaceHandler } from './handler.mjs';

export { createAgentSurfaceManifest } from './manifest.mjs';
