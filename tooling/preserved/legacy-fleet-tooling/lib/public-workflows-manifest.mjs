import { assertNoPrivateData } from './public-products.mjs';

const ALLOWED_SITE_KEYS = new Set(['id', 'url', 'probePath']);

export function buildPublicWorkflowsManifest(projection) {
  assertNoPrivateData(projection);
  if (!projection || !Array.isArray(projection.products)) {
    throw new Error('Fleet public projection must contain products.');
  }

  const sites = projection.products
    .filter((product) => typeof product.url === 'string' && product.url.startsWith('https://'))
    .map((product) => ({
      id: product.id,
      url: new URL(product.url).origin,
      probePath: '/',
    }));

  const ids = new Set();
  const targets = new Set();
  for (const site of sites) {
    const keys = Object.keys(site);
    if (keys.some((key) => !ALLOWED_SITE_KEYS.has(key)) || keys.length !== ALLOWED_SITE_KEYS.size) {
      throw new Error(`Public workflow site ${site.id} contains a non-allowlisted field.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.id)) {
      throw new Error(`Public workflow site id is invalid: ${site.id}`);
    }
    if (ids.has(site.id)) throw new Error(`Duplicate public workflow site id: ${site.id}`);
    ids.add(site.id);
    const target = new URL(site.probePath, site.url).href;
    if (targets.has(target)) throw new Error(`Duplicate public workflow target: ${target}`);
    targets.add(target);
  }

  return { schemaVersion: 1, sites };
}
