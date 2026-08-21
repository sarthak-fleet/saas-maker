// Portfolio-identity Toolbox evidence schema + validator.
//
// Sanitized aggregate status contract for the personal website, RolePatch,
// and Karte. Foundry consumes this evidence; it MUST NOT carry resume text,
// job descriptions, private profile fields, contact/chat bodies, credentials,
// or user-identifying payloads.
//
// This module is the canonical validator. It does NOT deploy, emit, or
// publish anything — it only validates that a declared evidence contract
// satisfies the privacy + promotion policy. Foundry ingestion code (out of
// scope for this change) will call `validatePortfolioIdentityEvidence(input)`
// before recording a recommendation.

import { readFileSync } from 'node:fs';

const SURFACE_IDS = new Set(['portfolio', 'rolepatch', 'karte']);
const RUNTIMES = new Set(['astro-static', 'nextjs-opennext', 'hono-worker', 'vite-spa', 'other']);
const DEPLOY_KINDS = new Set(['pages', 'worker', 'worker+pages', 'none', 'unknown']);
const ACTIVATION_KINDS = new Set([
  'outbound_click',
  'first_successful_tailor',
  'first_published_profile_or_generated_mode',
  'other',
]);
const EVIDENCE_SOURCES = new Set(['none', 'other']);

export function loadPortfolioIdentityEvidence(path) {
  return validatePortfolioIdentityEvidence(JSON.parse(readFileSync(path, 'utf8')));
}

export function validatePortfolioIdentityEvidence(input) {
  if (input?.$schema !== 'fleet.portfolio-identity-evidence.v1' || !Number.isInteger(input.version) || input.version < 1) {
    throw new PortfolioIdentityEvidenceError('schema must be fleet.portfolio-identity-evidence.v1 with positive version');
  }
  if (!Array.isArray(input.surfaces) || input.surfaces.length === 0) {
    throw new PortfolioIdentityEvidenceError('surfaces must be a non-empty array');
  }
  if (!Array.isArray(input.forbiddenPayloadFields) || input.forbiddenPayloadFields.length === 0) {
    throw new PortfolioIdentityEvidenceError('forbiddenPayloadFields must be a non-empty array');
  }
  validatePromotionPolicy(input.promotionPolicy);
  const seen = new Set();
  for (const surface of input.surfaces) {
    validateSurface(surface);
    if (seen.has(surface.id)) throw new PortfolioIdentityEvidenceError(`duplicate surface id: ${surface.id}`);
    seen.add(surface.id);
  }
  for (const required of ['portfolio', 'rolepatch', 'karte']) {
    if (!seen.has(required)) throw new PortfolioIdentityEvidenceError(`missing required surface: ${required}`);
  }
  return structuredClone(input);
}

function validateSurface(surface) {
  if (!SURFACE_IDS.has(surface?.id)) {
    throw new PortfolioIdentityEvidenceError(`surface.id must be one of ${[...SURFACE_IDS].join(', ')}`);
  }
  if (!surface.projectSlug || !surface.canonicalUrl || !surface.meaningfulCta) {
    throw new PortfolioIdentityEvidenceError(`${surface?.id ?? 'unknown'}: projectSlug, canonicalUrl, and meaningfulCta are required`);
  }
  let url;
  try { url = new URL(surface.canonicalUrl); } catch { throw new PortfolioIdentityEvidenceError(`${surface.id}.canonicalUrl must be an absolute URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PortfolioIdentityEvidenceError(`${surface.id}.canonicalUrl must use HTTP(S)`);
  if (!RUNTIMES.has(surface.runtime)) throw new PortfolioIdentityEvidenceError(`${surface.id}.runtime must be one of ${[...RUNTIMES].join(', ')}`);
  if (!DEPLOY_KINDS.has(surface.deployKind)) throw new PortfolioIdentityEvidenceError(`${surface.id}.deployKind must be one of ${[...DEPLOY_KINDS].join(', ')}`);
  if (!Array.isArray(surface.indexing)) throw new PortfolioIdentityEvidenceError(`${surface.id}.indexing must be an array`);
  if (typeof surface.errorEvidence !== 'string') throw new PortfolioIdentityEvidenceError(`${surface.id}.errorEvidence must be a string`);
  if (typeof surface.privacy !== 'string') throw new PortfolioIdentityEvidenceError(`${surface.id}.privacy must be a string`);
  validateActivation(surface.id, surface.activation);
}

function validateActivation(surfaceId, activation) {
  if (!activation || typeof activation !== 'object') {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation is required`);
  }
  if (!ACTIVATION_KINDS.has(activation.kind)) {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation.kind must be one of ${[...ACTIVATION_KINDS].join(', ')}`);
  }
  if (!EVIDENCE_SOURCES.has(activation.evidenceSource)) {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation.evidenceSource must be one of ${[...EVIDENCE_SOURCES].join(', ')}`);
  }
  if (activation.evidenceSource !== 'none' && (!Array.isArray(activation.events) || activation.events.length === 0)) {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation.events must be a non-empty array when evidenceSource is not 'none'`);
  }
  if (!Array.isArray(activation.sanitizedFields)) {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation.sanitizedFields must be an array`);
  }
  if (activation.privatePayloadExcluded !== true) {
    throw new PortfolioIdentityEvidenceError(`${surfaceId}.activation.privatePayloadExcluded must be true`);
  }
}

function validatePromotionPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    throw new PortfolioIdentityEvidenceError('promotionPolicy is required');
  }
  if (typeof policy.mayRecommend !== 'boolean') {
    throw new PortfolioIdentityEvidenceError('promotionPolicy.mayRecommend must be a boolean');
  }
  if (!Array.isArray(policy.mayNot) || policy.mayNot.length === 0) {
    throw new PortfolioIdentityEvidenceError('promotionPolicy.mayNot must be a non-empty array');
  }
  if (!policy.recommendationSink || !policy.decisionOwner) {
    throw new PortfolioIdentityEvidenceError('promotionPolicy.recommendationSink and decisionOwner are required');
  }
}

class PortfolioIdentityEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PortfolioIdentityEvidenceError';
  }
}
