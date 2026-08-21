import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMarketingProgram, validateMarketingProgram } from '../marketing-program.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultMarketingPath = join(moduleDirectory, '..', '..', 'config', 'marketing-program.json');
const defaultAutomationPath = join(moduleDirectory, '..', '..', 'config', 'automation-registry.json');

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
}

export function resolveAiVisibilityPortfolio({
  marketingProgram,
  automationRegistry,
  reactivatedProjectIds = [],
}) {
  const marketing = validateMarketingProgram(marketingProgram);
  const automation = new Map(
    automationRegistry.entries.map((project) => [normalizeIdentity(project.id), project]),
  );
  const reactivated = new Set(reactivatedProjectIds.map(normalizeIdentity));
  const marketingProjects = new Map(marketing.projects.map((project) => [project.slug, project]));
  const eligible = [];
  const excluded = [];

  for (const config of marketing.aiVisibility.projects) {
    const project = marketingProjects.get(config.slug);
    const lifecycle = [config.slug, ...(project?.aliases ?? [])]
      .map((identity) => automation.get(normalizeIdentity(identity)))
      .find(Boolean);
    if (!lifecycle) {
      excluded.push({ projectId: config.slug, reason: 'missing-lifecycle-entry' });
      continue;
    }
    if (lifecycle.attention === 'ignored' && !reactivated.has(config.slug)) {
      excluded.push({ projectId: config.slug, reason: 'ignored' });
      continue;
    }
    eligible.push({
      ...structuredClone(config),
      name: project.name,
      domain: project.domain,
      attention:
        lifecycle.attention === 'my-work'
          ? 'focus'
          : lifecycle.attention === 'toolbox'
            ? 'secondary'
            : lifecycle.attention === 'foundry'
              ? 'active'
              : lifecycle.attention,
      reactivated: lifecycle.attention === 'ignored',
    });
  }

  return {
    version: marketing.aiVisibility.version,
    scheduleIntent: structuredClone(marketing.aiVisibility.scheduleIntent),
    eligible,
    excluded,
  };
}

export function loadAiVisibilityPortfolio({
  marketingPath = defaultMarketingPath,
  automationPath = defaultAutomationPath,
  reactivatedProjectIds = [],
} = {}) {
  return resolveAiVisibilityPortfolio({
    marketingProgram: loadMarketingProgram(marketingPath),
    automationRegistry: JSON.parse(readFileSync(automationPath, 'utf8')),
    reactivatedProjectIds,
  });
}

export function findAiVisibilityProject(portfolio, projectId) {
  const normalized = normalizeIdentity(projectId);
  const project = portfolio.eligible.find(
    (entry) =>
      entry.slug === normalized ||
      entry.aliases.some((alias) => normalizeIdentity(alias) === normalized),
  );
  if (project) return project;
  const exclusion = portfolio.excluded.find((entry) => entry.projectId === normalized);
  if (exclusion?.reason === 'ignored') {
    throw new Error(`AI visibility is disabled for ignored project ${normalized}; explicit reactivation is required`);
  }
  throw new Error(`AI visibility is not configured for project ${normalized}`);
}

export function evaluateAiVisibilityScheduleActivation({
  scheduleIntent,
  designatedHost = false,
  hostVerified = false,
  approvedCanaryRunId = null,
} = {}) {
  const blockers = [];
  if (scheduleIntent?.enabled !== true) blockers.push('schedule-intent-disabled');
  if (scheduleIntent?.activation?.requiresDesignatedHost && !designatedHost) {
    blockers.push('designated-host-required');
  }
  if (scheduleIntent?.activation?.requiresHostVerification && !hostVerified) {
    blockers.push('host-verification-required');
  }
  if (scheduleIntent?.activation?.requiresApprovedCanary && !approvedCanaryRunId) {
    blockers.push('approved-canary-required');
  }
  return {
    allowed: blockers.length === 0,
    enabled: scheduleIntent?.enabled === true,
    blockers,
  };
}

export function assertAiVisibilityScheduleCanRun(input) {
  const result = evaluateAiVisibilityScheduleActivation(input);
  if (!result.allowed) {
    throw new Error(`AI visibility schedule cannot run: ${result.blockers.join(', ')}`);
  }
  return result;
}
