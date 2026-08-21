const PRODUCT_FIELDS = new Set([
  'id',
  'name',
  'description',
  'url',
  'tier',
  'category',
  'priority',
  'spotlight',
  'maturity',
  'repositoryUrl',
  'changelogUrl',
  'roadmapUrl',
  'pillarId',
]);

const PAST_PROJECT_FIELDS = new Set([
  'id',
  'name',
  'description',
  'lifecycle',
  'repositoryUrl',
]);

const FORBIDDEN_KEYS = /(?:secret|token|password|credential|private|owner|cfProject|notes|dependencies|evidenceSources|contracts|sourcePath|attention)/i;
const CREDENTIAL_VALUE = /(?:bearer\s+[a-z0-9._-]+|(?:api|access|secret)[_-]?key\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

export function buildPublicProducts(catalog) {
  const products = [];
  const pastProjects = [];

  for (const project of catalog.projects) {
    const metadata = project.public ?? { listing: 'hidden' };
    if (metadata.listing === 'hidden') continue;

    if (metadata.listing === 'maintained') {
      const url = canonicalPublicUrl(project);
      const output = {
        id: metadata.id ?? project.id,
        name: metadata.name ?? project.name,
        description: metadata.description,
        url,
        tier: project.tier === 'focus' ? 'core' : project.tier,
        category: metadata.category,
        priority: project.portfolio.priority,
        spotlight: metadata.spotlight ?? false,
        maturity: metadata.maturity,
        ...(metadata.hasChangelog === false ? {} : { changelogUrl: `${url}/changelog` }),
        ...(metadata.repositoryUrl
          ? {
              repositoryUrl: metadata.repositoryUrl,
              roadmapUrl: `${metadata.repositoryUrl}/issues`,
            }
          : {}),
        pillarId: metadata.pillarId,
      };
      if (metadata.repositoryUrl && project.repositoryVisibility !== 'public') {
        throw new Error(`${project.id}: maintained public repository must have repositoryVisibility public`);
      }
      assertShape(output, PRODUCT_FIELDS, ['id', 'name', 'description', 'url']);
      assertEvidenceLinks(output);
      products.push(output);
      continue;
    }

    if (metadata.listing === 'past') {
      if (project.lifecycle !== 'past') {
        throw new Error(`${project.id}: past public listing requires lifecycle past`);
      }
      if (project.repositoryVisibility !== 'public') {
        throw new Error(`${project.id}: past public listing requires a public repository`);
      }
      const output = {
        id: metadata.id ?? project.id,
        name: metadata.name ?? project.name,
        description: metadata.description,
        lifecycle: 'past',
        repositoryUrl: metadata.repositoryUrl,
      };
      assertShape(output, PAST_PROJECT_FIELDS, ['id', 'name', 'description', 'repositoryUrl']);
      pastProjects.push(output);
      continue;
    }

    throw new Error(`${project.id}: unsupported public listing ${metadata.listing}`);
  }

  assertUnique(products, 'maintained product');
  assertUnique(pastProjects, 'past project');
  const allIds = [...products, ...pastProjects].map((project) => project.id);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error('public ids must be unique across maintained and past projects');
  }

  products.sort((left, right) => Number(right.spotlight) - Number(left.spotlight) || left.name.localeCompare(right.name));
  pastProjects.sort((left, right) => left.name.localeCompare(right.name));

  const projection = {
    schemaVersion: 2,
    generatedFrom: ['foundry/ops/config/projects.json'],
    products,
    pastProjects,
  };
  assertNoPrivateData(projection);
  return projection;
}

export function assertEvidenceLinks(product) {
  const productUrl = new URL(product.url);
  if (product.changelogUrl) {
    const changelogUrl = new URL(product.changelogUrl);
    if (changelogUrl.origin !== productUrl.origin || changelogUrl.pathname !== '/changelog') {
      throw new Error(`${product.id}: changelogUrl must be the canonical product origin /changelog`);
    }
  }

  if (!product.repositoryUrl) {
    if (product.roadmapUrl) {
      throw new Error(`${product.id}: roadmapUrl requires a public repositoryUrl`);
    }
    return;
  }

  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(product.repositoryUrl)) {
    throw new Error(`${product.id}: repositoryUrl must be a canonical GitHub repository root`);
  }
  if (product.roadmapUrl !== `${product.repositoryUrl}/issues`) {
    throw new Error(`${product.id}: roadmapUrl must be the canonical GitHub Issues page`);
  }
}

export function assertNoPrivateData(value, trail = 'projection') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateData(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`${trail}.${key}: forbidden private field`);
      assertNoPrivateData(entry, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && CREDENTIAL_VALUE.test(value)) {
    throw new Error(`${trail}: credential-shaped value`);
  }
}

function canonicalPublicUrl(project) {
  const domain = project.domains?.[0];
  if (!domain) throw new Error(`${project.id}: maintained public listing requires a canonical domain`);
  return `https://${domain}`;
}

function assertShape(value, allowed, required) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${value.id}: unsupported public field ${key}`);
  }
  for (const key of required) {
    if (!value[key]) throw new Error(`${value.id}: missing ${key}`);
  }
}

function assertUnique(values, label) {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ids must be unique`);
}
