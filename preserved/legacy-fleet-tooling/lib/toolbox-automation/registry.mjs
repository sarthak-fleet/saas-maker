/**
 * Significant Hobbies Toolbox family registry validation.
 *
 * Validated policy overlay for the seven-product family contract defined in
 * foundry/ops/config/significant-hobbies-toolbox.json. Consumed by the
 * toolbox-family-evidence CLI and by tests.
 *
 * The validator enforces the spec requirements:
 *   - Complete family mapping (each domain maps to exactly one owner)
 *   - Per-child usability evidence (each product declares the required
 *     evidence sources and an activation definition or explicit N/A)
 *   - Private personal data protection (each product declares the
 *     private categories excluded from fleet evidence)
 *   - Background freshness by declared cadence (each job declares a
 *     cadence and a freshness window)
 *   - Independent failure and digest policy (family-level digest config
 *     preserves per-child status)
 *   - Quiet experiment boundaries (experiments require approval, expiry,
 *     and explicit stop rules)
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// lib/toolbox-automation → lib → ops → foundry → fleet root
const FLEET_ROOT = resolve(__dirname, '../../../..');
const REGISTRY_PATH = join(
  FLEET_ROOT,
  'foundry/ops/config/significant-hobbies-toolbox.json'
);

const SCHEMA = 'fleet.significant-hobbies-toolbox.v1';
const RUNTIMES = new Set([
  'opennext-worker',
  'spa-hono-worker',
  'spa-hono-pages',
  'spa-pages-functions',
  'next-static-pages',
  'spa-static-pages',
]);
const DEPLOY_KINDS = new Set(['pages', 'worker', 'worker+pages', 'none']);
export const CADENCES = new Set([
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'on-demand',
]);
const REQUIRED_EVIDENCE_SOURCES = [
  'build',
  'live',
  'indexing',
  'errors',
  'revision',
];
export const REQUIRED_EXPERIMENT_FIELDS = [
  'hypothesis',
  'approvedAsset',
  'attributionKey',
  'start',
  'expiry',
  'budget',
  'successMetric',
  'stopRule',
  'owner',
];

export class ToolboxRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolboxRegistryError';
  }
}

/**
 * Load and validate the family registry.
 * @param {string} [registryPath]
 * @returns {object} validated registry (deep clone)
 */
export function loadToolboxRegistry(registryPath = REGISTRY_PATH) {
  return validateToolboxRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
}

/**
 * Validate a parsed registry object. Throws ToolboxRegistryError on any
 * contract violation. Returns a deep clone of the input on success.
 * @param {object} input
 * @returns {object}
 */
export function validateToolboxRegistry(input) {
  if (!input || input.$schema !== SCHEMA) {
    throw new ToolboxRegistryError(`registry $schema must be ${SCHEMA}`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ToolboxRegistryError('registry version must be a positive integer');
  }
  if (!input.family || !input.family.id || !input.family.name) {
    throw new ToolboxRegistryError('family.id and family.name are required');
  }
  if (!Array.isArray(input.products) || input.products.length === 0) {
    throw new ToolboxRegistryError('products must be a non-empty array');
  }
  if (!input.experiments || !input.digest) {
    throw new ToolboxRegistryError('experiments and digest blocks are required');
  }

  const productIds = new Set();
  const domains = new Map(); // domain -> productId
  const owners = new Map(); // owner -> productId
  const repos = new Map(); // repo -> productId

  for (const product of input.products) {
    validateProduct(product);

    if (productIds.has(product.id)) {
      throw new ToolboxRegistryError(`duplicate product id: ${product.id}`);
    }
    productIds.add(product.id);

    const domainKey = normalizeDomain(product.domain);
    const prevDomain = domains.get(domainKey);
    if (prevDomain) {
      throw new ToolboxRegistryError(
        `domain ${product.domain} belongs to both ${prevDomain} and ${product.id}`
      );
    }
    domains.set(domainKey, product.id);

    const prevOwner = owners.get(product.owner);
    if (prevOwner && prevOwner !== product.id) {
      throw new ToolboxRegistryError(
        `owner ${product.owner} belongs to both ${prevOwner} and ${product.id}`
      );
    }
    owners.set(product.owner, product.id);

    const prevRepo = repos.get(product.repo);
    if (prevRepo && prevRepo !== product.id) {
      throw new ToolboxRegistryError(
        `repo ${product.repo} belongs to both ${prevRepo} and ${product.id}`
      );
    }
    repos.set(product.repo, product.id);
  }

  validateExperiments(input.experiments);
  validateDigest(input.digest);

  return structuredClone(input);
}

function validateProduct(product) {
  if (!product || !product.id || !product.name) {
    throw new ToolboxRegistryError('product.id and product.name are required');
  }
  if (!RUNTIMES.has(product.runtime)) {
    throw new ToolboxRegistryError(
      `product ${product.id} has unknown runtime: ${product.runtime}`
    );
  }
  if (!DEPLOY_KINDS.has(product.deployKind)) {
    throw new ToolboxRegistryError(
      `product ${product.id} has unknown deployKind: ${product.deployKind}`
    );
  }
  if (!product.repo || !product.owner || !product.domain) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires repo, owner, and domain`
    );
  }
  let domainUrl;
  try {
    domainUrl = new URL(product.domain);
  } catch {
    throw new ToolboxRegistryError(
      `product ${product.id} domain must be an absolute URL: ${product.domain}`
    );
  }
  if (!['http:', 'https:'].includes(domainUrl.protocol)) {
    throw new ToolboxRegistryError(
      `product ${product.id} domain must use HTTP(S): ${product.domain}`
    );
  }
  if (!product.cfProject) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires cfProject`
    );
  }

  if (!product.activation || typeof product.activation.notApplicable !== 'boolean') {
    throw new ToolboxRegistryError(
      `product ${product.id} requires activation.notApplicable (boolean)`
    );
  }
  if (!product.activation.notApplicable && !product.activation.definition) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires activation.definition unless explicitly not-applicable`
    );
  }
  if (!product.activation.type) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires activation.type`
    );
  }

  if (!product.privacy || !Array.isArray(product.privacy.excludedCategories) ||
      product.privacy.excludedCategories.length === 0) {
    throw new ToolboxRegistryError(
      `product ${product.id} must declare at least one privacy.excludedCategories entry`
    );
  }

  if (!product.evidenceSources) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires evidenceSources`
    );
  }
  for (const key of REQUIRED_EVIDENCE_SOURCES) {
    if (!product.evidenceSources[key]) {
      throw new ToolboxRegistryError(
        `product ${product.id} missing evidenceSources.${key}`
      );
    }
  }

  if (!Array.isArray(product.backgroundJobs)) {
    throw new ToolboxRegistryError(
      `product ${product.id} backgroundJobs must be an array (may be empty)`
    );
  }
  for (const job of product.backgroundJobs) {
    validateBackgroundJob(product.id, job);
  }

  if (!product.experimentMode) {
    throw new ToolboxRegistryError(
      `product ${product.id} requires experimentMode`
    );
  }
}

function validateBackgroundJob(productId, job) {
  if (!job || !job.id || !job.workflow) {
    throw new ToolboxRegistryError(
      `product ${productId} backgroundJob requires id and workflow`
    );
  }
  if (!CADENCES.has(job.cadence)) {
    throw new ToolboxRegistryError(
      `product ${productId} job ${job.id} has unknown cadence: ${job.cadence}`
    );
  }
  if (!job.bounds) {
    throw new ToolboxRegistryError(
      `product ${productId} job ${job.id} requires bounds`
    );
  }
  if (!Number.isSafeInteger(job.declaredFreshnessDays) || job.declaredFreshnessDays < 1) {
    throw new ToolboxRegistryError(
      `product ${productId} job ${job.id} declaredFreshnessDays must be a positive integer`
    );
  }
  if (!job.owner) {
    throw new ToolboxRegistryError(
      `product ${productId} job ${job.id} requires owner`
    );
  }
}

function validateExperiments(experiments) {
  if (typeof experiments.requireApproval !== 'boolean' ||
      typeof experiments.autoExpiry !== 'boolean' ||
      typeof experiments.noAutomaticReplacement !== 'boolean' ||
      typeof experiments.noAutomaticPromotion !== 'boolean' ||
      typeof experiments.noPaidMarketing !== 'boolean') {
    throw new ToolboxRegistryError(
      'experiments policy booleans (requireApproval, autoExpiry, noAutomaticReplacement, noAutomaticPromotion, noPaidMarketing) are required'
    );
  }
  if (!Array.isArray(experiments.requiredFields) ||
      experiments.requiredFields.length === 0) {
    throw new ToolboxRegistryError(
      'experiments.requiredFields must be a non-empty array'
    );
  }
  for (const field of REQUIRED_EXPERIMENT_FIELDS) {
    if (!experiments.requiredFields.includes(field)) {
      throw new ToolboxRegistryError(
        `experiments.requiredFields missing required field: ${field}`
      );
    }
  }
  if (!Array.isArray(experiments.inconclusiveConditions) ||
      experiments.inconclusiveConditions.length === 0) {
    throw new ToolboxRegistryError(
      'experiments.inconclusiveConditions must be a non-empty array'
    );
  }
}

function validateDigest(digest) {
  if (typeof digest.oneChildFailureDoesNotMarkFamilyFailed !== 'boolean') {
    throw new ToolboxRegistryError(
      'digest.oneChildFailureDoesNotMarkFamilyFailed boolean is required'
    );
  }
  if (!digest.policy) {
    throw new ToolboxRegistryError('digest.policy is required');
  }
  if (!Array.isArray(digest.pageOnlyOn)) {
    throw new ToolboxRegistryError('digest.pageOnlyOn must be an array');
  }
}

/**
 * Resolve a domain string to its owning product id, or null when no product
 * in the registry maps to it. Used by the spec scenario "Child domain lacks
 * owner" — a missing owner is a validation failure, not a silent skip.
 * @param {object} registry validated registry
 * @param {string} domain
 * @returns {string|null}
 */
export function productForDomain(registry, domain) {
  const key = normalizeDomain(domain);
  for (const product of registry.products) {
    if (normalizeDomain(product.domain) === key) return product.id;
  }
  return null;
}

function normalizeDomain(domain) {
  return String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/$/, '');
}
