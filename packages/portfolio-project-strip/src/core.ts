import type { PortfolioProject } from './types';

function isProject(value: unknown): value is PortfolioProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<PortfolioProject>;
  try {
    const url = new URL(project.url ?? '');
    return (
      typeof project.id === 'string' &&
      project.id.length > 0 &&
      typeof project.name === 'string' &&
      project.name.length > 0 &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    );
  } catch {
    return false;
  }
}

export function normalizeProjects(value: unknown): PortfolioProject[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(isProject).filter((project) => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

export function withReferralSource(url: string, currentProjectId?: string): string {
  if (!currentProjectId) return url;
  try {
    const destination = new URL(url);
    destination.searchParams.set('ref', currentProjectId);
    return destination.toString();
  } catch {
    return url;
  }
}
