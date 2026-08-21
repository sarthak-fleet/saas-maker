import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DIRECTORY_SUBMISSIONS_DIR } from './channel-registry.mjs';

export const AUDIENCE_FIT_SCHEMA = 'fleet.product-platform-audience-fit.v1';
export const AUDIENCE_FIT_PATH = resolve(DIRECTORY_SUBMISSIONS_DIR, 'audience-fit.json');

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateMapping(mapping, label, audiences, knownIds, issues) {
  if (!isRecord(mapping)) {
    issues.push(`${label} must be an object`);
    return;
  }
  for (const [id, tags] of Object.entries(mapping)) {
    if (knownIds && !knownIds.has(id)) issues.push(`${label}.${id} is not a known ID`);
    if (!Array.isArray(tags) || tags.length === 0) {
      issues.push(`${label}.${id} must be a non-empty tag array`);
      continue;
    }
    const seen = new Set();
    for (const tag of tags) {
      if (typeof tag !== 'string' || !audiences.has(tag)) {
        issues.push(`${label}.${id} contains unknown audience tag: ${String(tag)}`);
      }
      if (seen.has(tag)) issues.push(`${label}.${id} contains duplicate tag: ${tag}`);
      seen.add(tag);
    }
  }
}

export function validateAudienceFit(input, { projectIds = null, platformIds = null } = {}) {
  const issues = [];
  if (!isRecord(input)) return { ok: false, issues: ['audience fit must be an object'] };
  if (input.$schema !== AUDIENCE_FIT_SCHEMA) {
    issues.push(`$schema must be ${AUDIENCE_FIT_SCHEMA}`);
  }
  if (input.version !== 1) issues.push('version must be 1');
  if (!Array.isArray(input.audiences) || input.audiences.length === 0) {
    issues.push('audiences must be a non-empty array');
  }
  const audienceList = Array.isArray(input.audiences) ? input.audiences : [];
  const audiences = new Set(audienceList);
  if (audiences.size !== audienceList.length) issues.push('audiences must not contain duplicates');
  if (audienceList.some((tag) => typeof tag !== 'string' || tag.length === 0)) {
    issues.push('audiences must contain non-empty strings');
  }
  validateMapping(input.products, 'products', audiences, projectIds, issues);
  validateMapping(input.platforms, 'platforms', audiences, platformIds, issues);
  return { ok: issues.length === 0, issues };
}

export function readAudienceFit(path = AUDIENCE_FIT_PATH, knownIds = {}) {
  const resolved = resolve(path);
  const input = JSON.parse(readFileSync(resolved, 'utf8'));
  const validation = validateAudienceFit(input, knownIds);
  if (!validation.ok) {
    throw new Error(`invalid audience fit at ${resolved}:\n- ${validation.issues.join('\n- ')}`);
  }
  return input;
}

export function audienceFitFor(audienceFit, productId, platformId) {
  const productTags = audienceFit?.products?.[productId] ?? [];
  const platformTags = audienceFit?.platforms?.[platformId] ?? [];
  const platformTagSet = new Set(platformTags);
  const matchedAudienceTags = productTags.filter((tag) => platformTagSet.has(tag)).sort();
  let fitReason = null;
  if (productTags.length === 0) fitReason = 'product-audience-missing';
  else if (platformTags.length === 0) fitReason = 'platform-audience-missing';
  else if (matchedAudienceTags.length === 0) fitReason = 'no-audience-overlap';
  return {
    productAudienceTags: [...productTags],
    platformAudienceTags: [...platformTags],
    matchedAudienceTags,
    fitScore: matchedAudienceTags.length,
    fitReason,
  };
}
