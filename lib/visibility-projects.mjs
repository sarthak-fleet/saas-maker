export function isVisibilityProject(project) {
  const hasCanonicalDomain =
    Array.isArray(project?.domains) && project.domains.length > 0;
  const publicMetricSurface =
    project?.public?.listing === 'maintained' ||
    project?.metrics?.publicSite === true;

  return (
    project?.lifecycle === 'maintained' &&
    project?.tier !== 'non-product' &&
    hasCanonicalDomain &&
    publicMetricSurface
  );
}

export function visibilityProjects(catalog) {
  return (catalog?.projects ?? []).filter(isVisibilityProject);
}

function normalizedDomain(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

export function searchConsoleProjects(catalog, rootsByDomain = new Map()) {
  const catalogProjects = catalog?.projects ?? [];
  const catalogById = new Map(catalogProjects.map((project) => [project.id, project]));
  const selected = visibilityProjects(catalog);
  const selectedById = new Map(selected.map((project) => [project.id, project]));

  for (const root of rootsByDomain.values()) {
    const rootDomain = normalizedDomain(root?.rootDomain);
    const projectId = String(root?.projectId ?? '').trim();
    const project = catalogById.get(projectId);
    if (!project) throw new Error(`Unknown Search Console root project: ${projectId || '(empty)'}`);

    const ownedDomains = (project.domains ?? []).map(normalizedDomain);
    if (!rootDomain || !ownedDomains.includes(rootDomain)) {
      throw new Error(`Search Console root project domain mismatch: ${projectId} does not own ${rootDomain || '(empty)'}`);
    }

    const existing = selectedById.get(projectId);
    if (existing) {
      const primaryDomain = normalizedDomain(existing.domains?.[0]);
      if (primaryDomain !== rootDomain) {
        throw new Error(
          `Search Console root conflicts with the public metric target: ${projectId} measures ${primaryDomain || '(empty)'}, not ${rootDomain}`,
        );
      }
      continue;
    }

    const target = { ...project, domains: [rootDomain] };
    selected.push(target);
    selectedById.set(projectId, target);
  }

  return selected;
}
