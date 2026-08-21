const COMPOUND_PUBLIC_SUFFIXES = new Set([
  'co.in',
  'co.jp',
  'co.uk',
  'com.au',
  'com.br',
]);

const EXCLUDED_PUBLIC_METRIC_LIFECYCLES = new Set(['past', 'non-product']);

export function normalizedDomain(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`)
      .hostname
      .replace(/^www\./, '');
  } catch {
    return value.replace(/^www\./, '').split('/')[0] || null;
  }
}

export function registrableDomain(domain) {
  const labels = String(domain ?? '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const suffix = labels.slice(-2).join('.');
  return COMPOUND_PUBLIC_SUFFIXES.has(suffix)
    ? labels.slice(-3).join('.')
    : labels.slice(-2).join('.');
}

export function isPublicMetricProject(project) {
  const listing = project.publicListing ?? project.public?.listing ?? null;
  const publicSiteOverride =
    project.metricEligibility?.publicSite === true || project.metrics?.publicSite === true;
  return (
    (listing === 'maintained' || publicSiteOverride) &&
    !EXCLUDED_PUBLIC_METRIC_LIFECYCLES.has(project.lifecycle) &&
    project.tier !== 'non-product' &&
    (project.domains?.length ?? 0) > 0
  );
}

export function isDomainStrengthProject(project) {
  const domainCoverageOverride =
    project.metricEligibility?.domainCoverage === true ||
    project.metrics?.domainCoverage === true;
  return (
    (isPublicMetricProject(project) || domainCoverageOverride) &&
    (project.domains?.length ?? 0) > 0
  );
}

export function domainStrengthRoots(projects) {
  return [...new Set(
    projects
      .filter(isDomainStrengthProject)
      .flatMap((project) => project.domains ?? [])
      .map(normalizedDomain)
      .filter(Boolean)
      .map(registrableDomain),
  )].sort((left, right) => left.localeCompare(right));
}

export function publicMetricTargets(projects) {
  return projects
    .filter(isPublicMetricProject)
    .flatMap((project) => {
      const domain = normalizedDomain(project.domains?.[0]);
      return domain ? [{ projectId: project.id, domain }] : [];
    })
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}
