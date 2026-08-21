import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRegistryPath = join(moduleDirectory, '..', '..', 'config', 'projects.json');
const currentFoundryRepository = 'https://github.com/sass-maker/fleet-workspace';
const canonicalNames = {
  'app-health': 'App Health',
  codevetter: 'CodeVetter',
  'fleet-workspace': 'Foundry',
  'free-ai': 'Free AI',
  'high-signal': 'High Signal',
  pace: 'HeyPace',
  posttrainllm: 'Post-train LLM',
  'psi-swarm': 'PSI Swarm',
};

function displayName(project) {
  if (project.name) return project.name;
  if (canonicalNames[project.id]) return canonicalNames[project.id];
  return project.id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function loadFounderProjects(registryPath = defaultRegistryPath) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const familyNames = new Map(
    registry.projects.map((project) => [project.id, displayName(project)]),
  );
  return registry.projects
    .filter((project) => project.status !== 'orphan')
    .map((project) => {
      const domain = project.domains?.[0] ?? null;
      const historicalRepositoryUrl =
        project.repositoryUrl ?? project.public?.repositoryUrl ?? null;
      const repositoryUrl =
        project.lifecycle === 'maintained' || project.lifecycle === 'local-only'
          ? currentFoundryRepository
          : historicalRepositoryUrl;
      return {
        id: project.id,
        name: displayName(project),
        description: project.public?.description ?? null,
        category: project.public?.category ?? null,
        family: project.family,
        familyName: familyNames.get(project.family) ?? displayName({ id: project.family }),
        attention: project.attention ?? project.tier,
        lifecycle: project.lifecycle ?? 'maintained',
        publicListing: project.public?.listing ?? null,
        metricEligibility: {
          publicSite: project.metrics?.publicSite === true,
          domainCoverage: project.metrics?.domainCoverage === true,
        },
        priority: project.portfolio?.priority ?? null,
        status: project.status,
        repo: project.repo,
        sourcePath: project.sourcePath ?? null,
        repositoryVisibility: project.repositoryVisibility ?? 'unknown',
        repositoryUrl,
        domains: project.domains ?? [],
        websiteUrl: domain ? `https://${domain}` : null,
        changelogUrl: domain ? `https://${domain}/changelog` : null,
        deployKind: project.deployKind,
      };
    });
}
