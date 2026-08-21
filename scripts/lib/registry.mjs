/**
 * Shared fleet registry helpers — canonical project inventory plus
 * agent-surface metadata and the product origin preference chain.
 *
 * Consumed by indexnow-submit.mjs, agent-index-audit.mjs, and (for JSON-LD
 * emission) apply-agent-surfaces.mjs. Keep behavior-stable; callers verify
 * their --dry-run / --all output is unchanged after edits here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibilityProjects } from '../../lib/visibility-projects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// lib → scripts → ops → foundry → fleet root
const FLEET_ROOT = resolve(__dirname, '../../../..');
export const REGISTRY_PATH = join(
  FLEET_ROOT,
  'foundry/ops/config/agent-surfaces-registry.json'
);
export const PROJECTS_PATH = join(
  FLEET_ROOT,
  'foundry/ops/config/projects.json'
);

/**
 * Load and parse the agent-surfaces registry.
 * @param {string} [registryPath]
 * Product membership and primary domains come from projects.json. The
 * agent-surfaces registry is metadata only and must cover that inventory
 * exactly.
 *
 * @param {string} [projectsPath]
 * @returns {{ version: number, products: any[] }}
 */
export function loadRegistry(
  registryPath = REGISTRY_PATH,
  projectsPath = PROJECTS_PATH
) {
  if (!existsSync(registryPath)) {
    throw new Error(`Missing agent-surfaces registry at ${registryPath}`);
  }
  if (!existsSync(projectsPath)) {
    throw new Error(`Missing canonical project catalog at ${projectsPath}`);
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const catalog = JSON.parse(readFileSync(projectsPath, 'utf8'));
  const maintained = visibilityProjects(catalog);
  const metadataById = new Map(
    (registry.products || []).map((product) => [product.id, product])
  );
  const canonicalIds = new Set(maintained.map((project) => project.id));
  const missing = maintained
    .filter((project) => !metadataById.has(project.id))
    .map((project) => project.id);
  const extra = [...metadataById.keys()].filter((id) => !canonicalIds.has(id));
  const duplicateIds = (registry.products || [])
    .map((product) => product.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);

  const mismatchedUrls = maintained.flatMap((project) => {
    const product = metadataById.get(project.id);
    const domain = project.domains?.[0];
    if (!product || !domain) return [];
    const expected = `https://${domain}`;
    return normalizeUrl(product.url) === normalizeUrl(expected)
      ? []
      : [`${project.id} (${product.url ?? 'missing'} != ${expected})`];
  });

  const errors = [
    missing.length ? `missing: ${missing.join(', ')}` : null,
    extra.length ? `extra: ${extra.join(', ')}` : null,
    duplicateIds.length ? `duplicates: ${[...new Set(duplicateIds)].join(', ')}` : null,
    mismatchedUrls.length ? `URL mismatch: ${mismatchedUrls.join(', ')}` : null,
  ].filter(Boolean);
  if (errors.length) {
    throw new Error(`Agent surface metadata does not match projects.json:\n- ${errors.join('\n- ')}`);
  }

  return {
    ...registry,
    products: maintained.map((project) => ({
      ...metadataById.get(project.id),
      id: project.id,
      name:
        metadataById.get(project.id)?.name ??
        project.public?.name ??
        project.name ??
        project.id,
      url: `https://${project.domains[0]}`,
    })),
  };
}

function normalizeUrl(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

/**
 * Product origin preference chain:
 * indexNowOrigin → marketingOrigin → canonicalOrigin → url.
 *
 * Returns the URL with any trailing slash removed, or null when no URL is
 * declared. Callers that treat a missing origin as a hard error should use
 * productOriginRequired instead.
 *
 * @param {{ id: string, indexNowOrigin?: string, marketingOrigin?: string, canonicalOrigin?: string, url?: string }} product
 * @returns {string | null}
 */
export function productOrigin(product) {
  const url =
    product.indexNowOrigin ||
    product.marketingOrigin ||
    product.canonicalOrigin ||
    product.url;
  return url ? String(url).replace(/\/$/, '') : null;
}

/**
 * Same as productOrigin but throws when the product has no URL — for callers
 * that cannot proceed without an origin (e.g. IndexNow submit).
 * @param {{ id: string }} product
 * @returns {string}
 */
export function productOriginRequired(product) {
  const origin = productOrigin(product);
  if (origin == null) {
    throw new Error(`Product ${product.id} has no url`);
  }
  return origin;
}
