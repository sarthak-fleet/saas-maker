// Bounded quiet experiment validator for the portfolio-identity Toolbox.
//
// Every experiment MUST declare: approved asset/source, destination,
// attribution, start/expiry, budget, metric, and stop rule. Nothing here
// launches anything — `launchApproved: false` is enforced. On expiry,
// distribution stops and no replacement campaign is created.
//
// This module only validates the declared experiment definitions. It does
// NOT schedule, distribute, or emit anything.

import { readFileSync } from 'node:fs';

const SURFACE_IDS = new Set(['portfolio', 'rolepatch', 'karte']);
const APPROVAL_STATES = new Set(['draft', 'review', 'approved', 'expired', 'stopped']);
const BUDGET_UNITS = new Set(['posts', 'impressions', 'clicks', 'spend_usd']);

export function loadQuietExperiments(path) {
  return validateQuietExperiments(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateQuietExperiments(input) {
  if (input?.$schema !== 'fleet.portfolio-identity-quiet-experiments.v1' || !Number.isInteger(input.version) || input.version < 1) {
    throw new QuietExperimentError('schema must be fleet.portfolio-identity-quiet-experiments.v1 with positive version');
  }
  if (!Array.isArray(input.experiments)) {
    throw new QuietExperimentError('experiments must be an array');
  }
  const defaults = input.defaults ?? {};
  if (defaults.autoExpire !== true) throw new QuietExperimentError('defaults.autoExpire must be true');
  if (defaults.noReplacementCampaign !== true) throw new QuietExperimentError('defaults.noReplacementCampaign must be true');
  if (defaults.reviewControlled !== true) throw new QuietExperimentError('defaults.reviewControlled must be true');
  const seen = new Set();
  for (const exp of input.experiments) {
    validateExperiment(exp);
    if (seen.has(exp.id)) throw new QuietExperimentError(`duplicate experiment id: ${exp.id}`);
    seen.add(exp.id);
  }
  return structuredClone(input);
}

function validateExperiment(exp) {
  const id = exp?.id ?? '<unknown>';
  if (typeof exp?.id !== 'string' || !exp.id) throw new QuietExperimentError('experiment.id is required');
  if (!SURFACE_IDS.has(exp.surface)) throw new QuietExperimentError(`${id}: surface must be one of ${[...SURFACE_IDS].join(', ')}`);
  if (!exp.brandSlug) throw new QuietExperimentError(`${id}: brandSlug is required`);
  if (!exp.approvedAssetSource) throw new QuietExperimentError(`${id}: approvedAssetSource is required`);
  if (!exp.destinationUrl) throw new QuietExperimentError(`${id}: destinationUrl is required`);
  try { new URL(exp.destinationUrl); } catch { throw new QuietExperimentError(`${id}: destinationUrl must be an absolute URL`); }
  if (!exp.attribution || !exp.attribution.includes('utm_')) throw new QuietExperimentError(`${id}: attribution must include UTM parameters`);
  if (!exp.startAt || !exp.expiryAt) throw new QuietExperimentError(`${id}: startAt and expiryAt are required`);
  const start = Date.parse(exp.startAt);
  const expiry = Date.parse(exp.expiryAt);
  if (!Number.isFinite(start) || !Number.isFinite(expiry)) throw new QuietExperimentError(`${id}: startAt and expiryAt must be ISO-8601 dates`);
  if (expiry <= start) throw new QuietExperimentError(`${id}: expiryAt must be after startAt`);
  validateBudget(id, exp.budget);
  validateMetric(id, exp.metric);
  if (typeof exp.stopRule !== 'string' || !exp.stopRule) throw new QuietExperimentError(`${id}: stopRule is required`);
  if (!APPROVAL_STATES.has(exp.approvalState ?? '')) {
    throw new QuietExperimentError(`${id}: approvalState must be one of ${[...APPROVAL_STATES].join(', ')}`);
  }
  if (exp.launchApproved !== false) {
    throw new QuietExperimentError(`${id}: launchApproved must be false — no automatic launch`);
  }
}

function validateBudget(id, budget) {
  if (!budget || typeof budget !== 'object') throw new QuietExperimentError(`${id}: budget is required`);
  if (!BUDGET_UNITS.has(budget.units)) throw new QuietExperimentError(`${id}: budget.units must be one of ${[...BUDGET_UNITS].join(', ')}`);
  if (!Number.isSafeInteger(budget.max) || budget.max < 1) throw new QuietExperimentError(`${id}: budget.max must be a positive integer`);
}

function validateMetric(id, metric) {
  if (!metric || typeof metric !== 'object') throw new QuietExperimentError(`${id}: metric is required`);
  if (typeof metric.name !== 'string' || !metric.name) throw new QuietExperimentError(`${id}: metric.name is required`);
  if (!Number.isSafeInteger(metric.threshold) || metric.threshold < 1) {
    throw new QuietExperimentError(`${id}: metric.threshold must be a positive integer`);
  }
}

class QuietExperimentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuietExperimentError';
  }
}
