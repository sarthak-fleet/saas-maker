import { readFileSync } from 'node:fs';

import { evaluateCampaignItem } from './campaign-manifest.mjs';

const MODES = new Set(['focus', 'evergreen', 'infrastructure', 'private']);
const CHANNELS = new Set(['instagram_reels', 'youtube_shorts', 'tiktok']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROMPT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadMarketingProgram(path) {
  return validateMarketingProgram(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateMarketingProgram(input, options = {}) {
  if (input?.$schema !== 'fleet.marketing-program.v1' || !Number.isInteger(input.version) || input.version < 1) {
    throw new MarketingProgramError('registry schema and positive version are required');
  }
  if (!Array.isArray(input.projects) || input.projects.length === 0 || !Array.isArray(input.focusSet)) {
    throw new MarketingProgramError('projects and focusSet are required');
  }
  const owners = new Map();
  for (const project of input.projects) {
    validateProject(project);
    for (const identity of [project.slug, ...project.aliases]) {
      const key = normalizeIdentity(identity);
      const previous = owners.get(key);
      if (previous && previous !== project.slug) throw new MarketingProgramError(`identity ${identity} belongs to both ${previous} and ${project.slug}`);
      owners.set(key, project.slug);
    }
  }
  const exclusions = new Set();
  for (const exclusion of input.catalogExclusions ?? []) {
    if (!SLUG.test(exclusion?.slug ?? '') || !exclusion.reason?.trim()) {
      throw new MarketingProgramError('catalogExclusions require a valid slug and reason');
    }
    const key = normalizeIdentity(exclusion.slug);
    if (exclusions.has(key)) throw new MarketingProgramError(`duplicate catalog exclusion: ${exclusion.slug}`);
    if (owners.has(key)) throw new MarketingProgramError(`catalog exclusion is also a project identity: ${exclusion.slug}`);
    exclusions.add(key);
  }
  const focusModes = input.projects.filter((project) => project.mode === 'focus').map((project) => project.slug).sort();
  const focusSet = [...new Set(input.focusSet)].sort();
  if (focusSet.length !== input.focusSet.length || JSON.stringify(focusSet) !== JSON.stringify(focusModes)) {
    throw new MarketingProgramError('focusSet must contain every and only focus-mode project exactly once');
  }
  for (const slug of options.catalogSlugs ?? options.activeSlugs ?? []) {
    if (exclusions.has(normalizeIdentity(slug))) continue;
    if (!owners.has(normalizeIdentity(slug))) throw new MarketingProgramError(`active Fleet project is missing from registry: ${slug}`);
  }
  const defaults = input.defaults ?? {};
  for (const field of ['globalReviewDebtCeiling', 'focusReviewDebtCeiling', 'freshnessHours']) {
    if (!Number.isSafeInteger(defaults[field]) || defaults[field] < 1) throw new MarketingProgramError(`defaults.${field} must be a positive integer`);
  }
  validateAiVisibility(input.aiVisibility, new Set(input.projects.map((project) => project.slug)));
  return structuredClone(input);
}

export function createProjectResolver(registry) {
  const aliases = new Map();
  for (const project of registry.projects) {
    for (const identity of [project.slug, ...project.aliases]) aliases.set(normalizeIdentity(identity), project.slug);
  }
  return (value) => aliases.get(normalizeIdentity(value)) ?? normalizeIdentity(value);
}

export function evaluateMarketingCampaignAction({
  registry,
  manifest,
  approval,
  itemKey,
  receipts = [],
}) {
  const validatedRegistry = validateMarketingProgram(registry);
  const resolveProject = createProjectResolver(validatedRegistry);
  const projectId = resolveProject(manifest?.campaign?.projectId);
  const project = validatedRegistry.projects.find((entry) => entry.slug === projectId);
  if (!project || project.publicMarketing !== true || project.mode === 'private') {
    return {
      authorized: false,
      status: 'blocked',
      reasons: ['project is not eligible for public marketing execution'],
      manifestHash: null,
      itemIdentity: null,
      item: null,
      receipt: null,
    };
  }
  return evaluateCampaignItem(manifest, approval, itemKey, receipts);
}

function validateProject(project) {
  if (!SLUG.test(project?.slug ?? '') || !project.name || !Array.isArray(project.aliases) || !MODES.has(project.mode) ||
      !project.domainPosture || typeof project.publicMarketing !== 'boolean' || !project.cta || !project.cadence || !Array.isArray(project.channels)) {
    throw new MarketingProgramError(`invalid project entry: ${project?.slug ?? 'unknown'}`);
  }
  if (project.domain !== null) {
    let url;
    try { url = new URL(project.domain); } catch { throw new MarketingProgramError(`${project.slug}.domain must be an absolute URL or null`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new MarketingProgramError(`${project.slug}.domain must use HTTP(S)`);
  }
  if (project.contentBase && (!project.contentBase.adapter || !project.contentBase.path)) {
    throw new MarketingProgramError(`${project.slug}.contentBase requires adapter and path`);
  }
  if (project.channels.length > 0 && !project.contentBase) throw new MarketingProgramError(`${project.slug} channel program requires a content base`);
  const channelNames = new Set();
  for (const mapping of project.channels) {
    if (!CHANNELS.has(mapping?.channel) || !mapping.accountSlug || channelNames.has(mapping.channel)) {
      throw new MarketingProgramError(`${project.slug} has an invalid or duplicate channel mapping`);
    }
    channelNames.add(mapping.channel);
  }
}

function validateAiVisibility(config, marketingSlugs) {
  if (!config || config.version !== 1 || !Array.isArray(config.projects)) {
    throw new MarketingProgramError('aiVisibility version 1 and projects are required');
  }
  const schedule = config.scheduleIntent;
  if (
    config.ownershipPolicy != null &&
    config.ownershipPolicy.categoryOwner !== 'canonical-origin'
  ) {
    throw new MarketingProgramError(
      'aiVisibility.ownershipPolicy.categoryOwner must be canonical-origin',
    );
  }
  if (
    !schedule ||
    typeof schedule.enabled !== 'boolean' ||
    !schedule.cadence ||
    schedule.activation?.requiresDesignatedHost !== true ||
    schedule.activation?.requiresHostVerification !== true ||
    schedule.activation?.requiresApprovedCanary !== true
  ) {
    throw new MarketingProgramError('aiVisibility schedule intent requires all activation gates');
  }

  const configured = new Set();
  for (const project of config.projects) {
    if (!SLUG.test(project?.slug ?? '') || configured.has(project.slug) || !marketingSlugs.has(project.slug)) {
      throw new MarketingProgramError(`invalid or duplicate aiVisibility project: ${project?.slug ?? 'unknown'}`);
    }
    configured.add(project.slug);
    for (const field of ['aliases', 'competitors', 'promptSets', 'personas']) {
      if (!Array.isArray(project[field]) || project[field].length === 0) {
        throw new MarketingProgramError(`${project.slug}.aiVisibility.${field} must be a non-empty array`);
      }
    }
    if (project.aliases.some((alias) => typeof alias !== 'string' || !alias.trim())) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility.aliases are invalid`);
    }
    if (project.competitors.some((competitor) => !competitor?.name?.trim() || !absoluteHttpUrl(competitor.url))) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility.competitors are invalid`);
    }
    const promptIds = new Set();
    for (const set of project.promptSets) {
      if (!PROMPT_ID.test(set?.id ?? '') || !Array.isArray(set.prompts) || set.prompts.length === 0) {
        throw new MarketingProgramError(`${project.slug}.aiVisibility.promptSets are invalid`);
      }
      for (const prompt of set.prompts) {
        if (!PROMPT_ID.test(prompt?.id ?? '') || !prompt.text?.trim() || promptIds.has(`${set.id}/${prompt.id}`)) {
          throw new MarketingProgramError(`${project.slug}.aiVisibility prompt is invalid or duplicated`);
        }
        promptIds.add(`${set.id}/${prompt.id}`);
        validateOwnedPage(prompt.ownedPage, `${project.slug}.${set.id}/${prompt.id}`);
      }
    }
    const personaIds = new Set();
    for (const persona of project.personas) {
      if (!PROMPT_ID.test(persona?.id ?? '') || !persona.label?.trim() || personaIds.has(persona.id)) {
        throw new MarketingProgramError(`${project.slug}.aiVisibility persona is invalid or duplicated`);
      }
      personaIds.add(persona.id);
    }
    const policy = project.providerPolicy;
    if (
      !policy ||
      !Array.isArray(policy.allowedProviderIds) ||
      policy.allowedProviderIds.length === 0 ||
      policy.allowedProviderIds.some((provider) => !PROMPT_ID.test(provider)) ||
      policy.freeFirst !== true ||
      policy.liveProvidersAllowed !== false
    ) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility.providerPolicy must be fixture-only and free-first`);
    }
    if (!Number.isSafeInteger(project.cacheWindowHours) || project.cacheWindowHours < 1) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility.cacheWindowHours must be a positive integer`);
    }
    const budget = project.runBudget ?? {};
    for (const field of ['maxCalls', 'maxConcurrency', 'timeoutMs', 'retryAttempts', 'maxResponseCharacters']) {
      if (!Number.isSafeInteger(budget[field]) || budget[field] < 1) {
        throw new MarketingProgramError(`${project.slug}.aiVisibility.runBudget.${field} must be a positive integer`);
      }
    }
    if (!Number.isFinite(budget.maxEstimatedCostUsd) || budget.maxEstimatedCostUsd < 0) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility.runBudget.maxEstimatedCostUsd must be non-negative`);
    }
    const largestSet = Math.max(...project.promptSets.map((set) => set.prompts.length));
    if (largestSet * project.personas.length * policy.allowedProviderIds.length > budget.maxCalls) {
      throw new MarketingProgramError(`${project.slug}.aiVisibility matrix exceeds its run budget`);
    }
  }
}

function validateOwnedPage(ownedPage, label) {
  if (ownedPage == null) return;
  if (!['published', 'approval-pending', 'missing'].includes(ownedPage.state)) {
    throw new MarketingProgramError(`${label}.ownedPage.state is invalid`);
  }
  if (ownedPage.state === 'published' && !absoluteHttpUrl(ownedPage.url)) {
    throw new MarketingProgramError(`${label}.ownedPage.url must be an absolute HTTP(S) URL`);
  }
  if (
    ownedPage.state === 'approval-pending' &&
    !/^[a-f0-9]{64}$/u.test(ownedPage.manifestHash ?? '')
  ) {
    throw new MarketingProgramError(`${label}.ownedPage.manifestHash is invalid`);
  }
  if (ownedPage.state === 'missing' && ownedPage.url != null) {
    throw new MarketingProgramError(`${label}.ownedPage cannot declare a URL while missing`);
  }
}

function absoluteHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
}

class MarketingProgramError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarketingProgramError';
  }
}
