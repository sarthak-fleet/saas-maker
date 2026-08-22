import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { visibilityProjects } from './visibility-projects.mjs';

const ATTENTION = new Set(['my-work', 'toolbox', 'foundry', 'ignored']);
const LIFECYCLE = new Set(['maintained', 'local-only', 'past', 'non-product']);
const VISIBILITY = new Set(['public', 'private', 'unknown']);
const PUBLIC_LISTING = new Set(['maintained', 'past', 'hidden']);
const GEO_SOURCE_STATE = new Set(['public', 'internal']);
const GEO_DOCS_STATE = new Set(['public', 'repository-readme', 'landing-only']);
const GEO_PRIMARY_AVAILABILITY = new Set(['web', 'api', 'direct-download', 'internal-only']);
const GEO_APP_STORE_STATE = new Set(['not-applicable', 'listed']);
const GEO_PRICING_STATE = new Set(['free', 'published', 'not-declared', 'not-applicable']);
const RESERVED_OVERLAY_IDS = new Set(['wifi-watch']);
const PORTFOLIO_KINDS = new Set(['product', 'platform', 'experiment']);
const PORTFOLIO_PRIORITIES = ['P1', 'P2', 'P4'];
const CONTINUOUS_P1_PROJECTS = ['agent-office', 'codevetter', 'pace', 'posttrainllm'];
const PORTFOLIO_STATUSES = new Set(['active', 'archived']);
const CLOUDFLARE_COVERAGE_KINDS = new Set([
  'pages', 'worker', 'd1', 'r2', 'kv', 'vectorize', 'queue', 'workflow',
  'tunnel', 'container', 'turnstile', 'hyperdrive', 'pipeline', 'ai-search',
  'vpc', 'dispatch-namespace', 'artifacts', 'durable-object',
  'analytics-engine', 'workers-ai', 'browser-rendering', 'service-binding',
  'access-application', 'zone', 'email-routing',
]);
const STANDALONE_PRODUCT_REPOS = new Map([
  ['india-standards', 'india-standards'],
  ['setline', 'setline'],
]);

export function validateProjectCatalog(catalog, {
  fleetRoot,
  automationRegistry,
  marketingProgram,
  siteRegistry,
  toolboxRegistry,
  agentRegistry,
  reconcile = true,
  enforceOwnerPriorityPolicy = true,
} = {}) {
  const errors = [];
  const ids = new Set();
  const identities = new Map();
  const repositoryPaths = new Map();

  for (const project of catalog.projects ?? []) {
    if (!project.id) {
      errors.push('project missing id');
      continue;
    }
    if (ids.has(project.id)) errors.push(`${project.id}: duplicate catalog id`);
    ids.add(project.id);
    for (const identity of [project.id, ...(project.aliases ?? [])]) {
      const normalized = normalize(identity);
      if (identities.has(normalized)) {
        errors.push(`${project.id}: identity ${identity} also belongs to ${identities.get(normalized)}`);
      } else {
        identities.set(normalized, project.id);
      }
    }

    for (const [field, allowed] of [
      ['attention', ATTENTION],
      ['lifecycle', LIFECYCLE],
      ['repositoryVisibility', VISIBILITY],
    ]) {
      if (!allowed.has(project[field])) errors.push(`${project.id}: invalid ${field} ${project[field]}`);
    }
    validatePortfolioClassification(project, errors);
    if (!project.name) errors.push(`${project.id}: missing name`);
    const standaloneRepo = STANDALONE_PRODUCT_REPOS.get(project.id);
    if (standaloneRepo && normalizePath(project.repo) !== standaloneRepo) {
      errors.push(`${project.id}: independent product repository must be ${standaloneRepo}`);
    }
    if (!PUBLIC_LISTING.has(project.public?.listing)) {
      errors.push(`${project.id}: invalid public listing ${project.public?.listing}`);
    }
    if (
      project.public?.hasChangelog !== undefined
      && typeof project.public.hasChangelog !== 'boolean'
    ) {
      errors.push(`${project.id}: public hasChangelog must be boolean when declared`);
    }
    if (project.public?.listing === 'past' && project.lifecycle !== 'past') {
      errors.push(`${project.id}: past public listing requires lifecycle past`);
    }
    if (project.public?.listing === 'past' && project.repositoryVisibility !== 'public') {
      errors.push(`${project.id}: past public listing requires a public repository`);
    }
    if (project.public?.repositoryUrl && project.repositoryVisibility !== 'public') {
      errors.push(`${project.id}: public repositoryUrl requires repositoryVisibility public`);
    }
    if (
      project.lifecycle === 'maintained'
      && project.public?.repositoryUrl?.startsWith('https://github.com/sarthakagrawal927/')
      && project.id !== 'sarthakagrawal-personal'
    ) {
      errors.push(`${project.id}: maintained repository must use an organization owner`);
    }
    if (project.public?.listing === 'past' && !project.public.repositoryUrl) {
      errors.push(`${project.id}: public past project requires repositoryUrl`);
    }
    for (const field of ['repo', 'sourcePath']) {
      if (!project[field]) continue;
      const normalized = normalizePath(project[field]);
      const existing = repositoryPaths.get(normalized);
      if (existing && existing !== project.id) {
        errors.push(`${project.id}: ${field} ${project[field]} also belongs to ${existing}`);
      } else {
        repositoryPaths.set(normalized, project.id);
      }
    }
  }

  validateOverlay('automation-registry', automationRegistry?.entries, (entry) => entry.id, identities, errors);
  validateOverlay('marketing-program', marketingProgram?.projects, (entry) => entry.slug, identities, errors);
  validateOverlay('project-sites', Object.keys(siteRegistry?.projects ?? {}), (entry) => entry, identities, errors);
  validateOverlay('significant-hobbies-toolbox', toolboxRegistry?.products, (entry) => entry.id, identities, errors);
  validateGeoIdentityContract(catalog, agentRegistry, errors);
  if (catalog._meta?.priorities !== undefined) {
    errors.push('legacy _meta.priorities is not allowed; use each project portfolio.priority');
  }
  if (enforceOwnerPriorityPolicy) validateOwnerPriorityPolicy(catalog, errors);
  validateInfrastructureInventory(catalog, ids, errors);

  if (reconcile && fleetRoot) {
    const active = discoverGitDirectories(fleetRoot);
    const inactiveRoot = path.resolve(fleetRoot, '../fleet-inactive-projects');
    const inactive = existsSync(inactiveRoot) ? discoverGitDirectories(inactiveRoot) : [];
    const activePaths = new Set(
      catalog.projects
        .map((project) => project.repo)
        .filter((value) => value && !value.includes('/'))
        .map(normalizePath),
    );
    for (const [checkout, identity] of Object.entries(catalog._meta?.absorbedCheckouts ?? {})) {
      if (!identities.has(normalize(identity))) {
        errors.push(`absorbed checkout ${checkout}: unknown catalog identity ${identity}`);
        continue;
      }
      activePaths.add(normalizePath(checkout));
    }
    const inactivePaths = new Set(
      catalog.projects
        .map((project) => project.sourcePath)
        .filter(Boolean)
        .map((value) => normalizePath(path.relative(fleetRoot, path.resolve(fleetRoot, value)))),
    );

    for (const name of active) {
      if (!activePaths.has(normalizePath(name))) errors.push(`active checkout ${name}: missing from project catalog`);
    }
    for (const name of inactive) {
      const relative = normalizePath(path.relative(fleetRoot, path.join(inactiveRoot, name)));
      if (!inactivePaths.has(relative)) errors.push(`inactive checkout ${name}: missing from project catalog`);
    }
  }

  if (errors.length) {
    throw new Error(`Project catalog invalid:\n- ${errors.join('\n- ')}`);
  }
  return { projectCount: ids.size };
}

export function validateGeoIdentityContract(catalog, agentRegistry, inheritedErrors = null) {
  const errors = inheritedErrors ?? [];
  const maintained = visibilityProjects(catalog);
  const projectsById = new Map(maintained.map((project) => [project.id, project]));
  const identities = catalog.geoIdentities ?? [];
  const identitiesById = indexGeoIdentities(identities, errors);

  const missing = maintained
    .filter((project) => !identitiesById.has(project.id))
    .map((project) => project.id);
  const extra = [...identitiesById.keys()].filter((id) => !projectsById.has(id));
  if (missing.length) errors.push(`geo identities missing: ${missing.join(', ')}`);
  if (extra.length) errors.push(`geo identities extra: ${extra.join(', ')}`);

  const agentById = new Map((agentRegistry?.products ?? []).map((product) => [product.id, product]));
  for (const [id, identity] of identitiesById) {
    const project = projectsById.get(id);
    if (!project) continue;
    validateGeoIdentity(id, identity, project, errors);
    if (agentRegistry) validateAgentGeoIdentity(id, identity, agentById.get(id), errors);
  }

  if (inheritedErrors == null && errors.length) {
    throw new Error(`GEO identity contract invalid:\n- ${errors.join('\n- ')}`);
  }
  return { projectCount: maintained.length };
}

function indexGeoIdentities(identities, errors) {
  const identitiesById = new Map();
  for (const identity of identities) {
    if (!identity?.id) {
      errors.push('geo identity missing id');
    } else if (identitiesById.has(identity.id)) {
      errors.push(`${identity.id}: duplicate geo identity`);
    } else {
      identitiesById.set(identity.id, identity);
    }
  }
  return identitiesById;
}

function validateGeoIdentity(id, identity, project, errors) {
  const expectedName = project.public?.name ?? project.name;
  const expectedOrigin = `https://${project.domains[0]}`;
  if (identity.name !== expectedName) {
    errors.push(`${id}: geo name ${identity.name ?? 'missing'} != ${expectedName}`);
  }
  if (normalizeUrl(identity.origin) !== normalizeUrl(expectedOrigin)) {
    errors.push(`${id}: geo origin ${identity.origin ?? 'missing'} != ${expectedOrigin}`);
  }
  validateAliases(id, identity, errors);
  validateGeoSource(id, identity.source, project, errors);
  validateGeoDocs(id, identity.docs, errors);
  validateHttpsList(id, 'officialProfiles', identity.officialProfiles, errors);
  validateGeoAvailability(id, identity.availability, errors);
  validateGeoPricing(id, identity.pricing, errors);
}

function validateGeoAvailability(id, availability, errors) {
  if (!GEO_PRIMARY_AVAILABILITY.has(availability?.primary)) {
    errors.push(`${id}: invalid primary availability ${availability?.primary}`);
  }
  if (!GEO_APP_STORE_STATE.has(availability?.appStore)) {
    errors.push(`${id}: invalid App Store state ${availability?.appStore}`);
  }
  if (availability?.appStore === 'listed' && !isHttpsUrl(availability?.appStoreUrl)) {
    errors.push(`${id}: listed App Store availability requires appStoreUrl`);
  }
}

function validateGeoPricing(id, pricing, errors) {
  if (!GEO_PRICING_STATE.has(pricing?.state)) {
    errors.push(`${id}: invalid pricing state ${pricing?.state}`);
  }
  if (['free', 'published'].includes(pricing?.state) && !isHttpsUrl(pricing?.url)) {
    errors.push(`${id}: ${pricing?.state} pricing requires a public URL`);
  }
}

function validateAgentGeoIdentity(id, identity, agent, errors) {
  if (!agent) return;
  if (agent.name !== identity.name) {
    errors.push(`${id}: agent name ${agent.name ?? 'missing'} != canonical ${identity.name}`);
  }
  if (normalizeUrl(agent.url) !== normalizeUrl(identity.origin)) {
    errors.push(`${id}: agent URL ${agent.url ?? 'missing'} != canonical ${identity.origin}`);
  }
  if (!sameStringList(agent.sameAs ?? [], identity.officialProfiles ?? [])) {
    errors.push(`${id}: agent sameAs does not match canonical officialProfiles`);
  }
}

function validateAliases(id, identity, errors) {
  if (!Array.isArray(identity.aliases)) {
    errors.push(`${id}: geo aliases must be an array`);
    return;
  }
  const normalized = identity.aliases.map(normalize);
  if (normalized.some((alias) => !alias)) errors.push(`${id}: geo aliases cannot be empty`);
  if (new Set(normalized).size !== normalized.length) errors.push(`${id}: duplicate geo alias`);
  if (normalized.includes(normalize(identity.name))) errors.push(`${id}: canonical name repeated as alias`);
}

function validateGeoSource(id, source, project, errors) {
  if (!GEO_SOURCE_STATE.has(source?.state)) {
    errors.push(`${id}: invalid geo source state ${source?.state}`);
    return;
  }
  if (source.state === 'public') {
    if (!isCanonicalGithubRepository(source.url)) {
      errors.push(`${id}: public geo source requires a canonical GitHub repository URL`);
    }
    if (project.repositoryVisibility !== 'public') {
      errors.push(`${id}: public geo source requires repositoryVisibility public`);
    }
    if (source.url !== project.public?.repositoryUrl) {
      errors.push(`${id}: geo source ${source.url ?? 'missing'} != public repository ${project.public?.repositoryUrl ?? 'missing'}`);
    }
    if (source.path) errors.push(`${id}: public geo source must not expose an internal path`);
    return;
  }
  if (!source.path || normalizePath(source.path) !== normalizePath(project.repo)) {
    errors.push(`${id}: internal geo source path ${source.path ?? 'missing'} != ${project.repo ?? 'missing'}`);
  }
  if (source.url) errors.push(`${id}: internal geo source must not declare a public URL`);
}

function validateGeoDocs(id, docs, errors) {
  if (!GEO_DOCS_STATE.has(docs?.state)) {
    errors.push(`${id}: invalid geo docs state ${docs?.state}`);
    return;
  }
  if (!isHttpsUrl(docs.url)) errors.push(`${id}: geo docs require a public HTTPS URL`);
}

function validateHttpsList(id, field, values, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${id}: ${field} must contain at least one URL`);
    return;
  }
  if (values.some((value) => !isHttpsUrl(value))) errors.push(`${id}: ${field} must contain only HTTPS URLs`);
  if (new Set(values).size !== values.length) errors.push(`${id}: ${field} contains duplicates`);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isCanonicalGithubRepository(value) {
  return /^https:\/\/github\.com\/[^/]+\/[^/#]+$/.test(String(value ?? ''));
}

function normalizeUrl(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildAutomationProjection(catalog, registry) {
  const resolver = createResolver(catalog);
  const existingByProject = new Map();
  for (const entry of registry.entries) {
    const id = resolver(entry.id);
    if (id) existingByProject.set(id, entry);
  }

  const entries = catalog.projects.flatMap((project) => {
    if (project.tier === 'non-product') return [];
    const existing = existingByProject.get(project.id);
    const repository = project.repo ?? (
      project.attention === 'ignored' && project.sourcePath
        ? path.basename(project.sourcePath)
        : project.sourcePath ?? null
    );
    const base = existing ?? defaultAutomationEntry(project, repository);
    return [{
      ...base,
      id: existing?.id ?? project.id,
      name: project.name,
      attention: project.attention,
      family: project.family,
      owner: existing?.owner ?? (project.attention === 'foundry' ? 'foundry' : project.attention === 'ignored' ? 'none' : 'sarthak'),
      repository,
      ...(project.attention === 'ignored' ? {
        runtimes: [],
        surfaces: [],
        dependencies: [],
        evidenceSources: [],
        contracts: [],
        actionPolicy: 'excluded',
        alertPolicy: 'none',
        exceptions: base.exceptions?.length > 0
          ? base.exceptions
          : [{ contract: 'all', reason: 'Inactive; explicit reactivation required' }],
      } : {}),
    }];
  });
  const attentionCounts = Object.fromEntries(
    ['my-work', 'toolbox', 'foundry', 'ignored'].map((attention) => [
      attention,
      entries.filter((entry) => entry.attention === attention).length,
    ]),
  );
  return {
    ...registry,
    updatedAt: catalog._meta.updated,
    attentionCounts,
    entries,
  };
}

export function buildMarketingProjection(catalog, program) {
  const resolver = createResolver(catalog);
  const existingByProject = new Map();
  const reserved = [];
  for (const entry of program.projects) {
    const id = resolver(entry.slug);
    if (id) existingByProject.set(id, entry);
    else reserved.push(entry);
  }
  const projects = catalog.projects
    .filter((project) => project.attention !== 'ignored' && project.tier !== 'non-product')
    .map((project) => {
      const existing = existingByProject.get(project.id);
      const isPublic = project.public?.listing === 'maintained';
      return {
        ...(existing ?? defaultMarketingEntry(project, isPublic)),
        slug: existing?.slug ?? project.id,
        name: project.public?.name ?? project.name,
        domain: isPublic ? `https://${project.domains[0]}` : (existing?.domain ?? null),
        publicMarketing: isPublic,
      };
    });
  return { ...program, projects: [...projects, ...reserved] };
}

export function renderInternalCatalog(catalog) {
  const kinds = [
    ['product', 'Products'],
    ['platform', 'Platforms'],
    ['experiment', 'Experiments'],
  ];
  const lines = [
    '# Fleet project catalog',
    '',
    '> Generated from `foundry/ops/config/projects.json`. Edit the catalog, then run `npm run generate:projects`.',
    '> Maintenance contract: `foundry/ops/config/README.md`.',
    '',
    `Generated from ${catalog.projects.length} internal project identities.`,
    '',
    '## Operating model',
    '',
    'Priority is an owner decision, not a completion percentage or task tracker. GitHub Issues remains the only operational queue.',
    '',
    '| Signal | Meaning | Next action |',
    '| --- | --- | --- |',
    '| P1 | Continuously improved owner-built core | Preserve owner direction; maintain deploy, quality, and visibility evidence. |',
    '| P2 | Eligible active agent-work pool | Select open GitHub Issues in work cycles spanning at most five P2 projects. |',
    '| P4 + active | Owner-finished but still operating | Keep healthy and consider evergreen distribution; avoid speculative feature work. |',
    '| P4 + archived | Historical or retired | Preserve history and review retained deployments/resources; do not publish as active. |',
    '| Ready to share: yes | Dated evidence supports an active public surface | Include in the product-specific SEO/GEO and distribution plan. |',
    '| Ready to share: no | The dated reason names the current blocker | Resolve that blocker before publication or authenticated browser work. |',
    '',
    '## Cloudflare account coverage',
    '',
    `Provider inventory checked ${catalog.infrastructure._meta.verifiedAt}. A resource is not considered accounted for unless it is assigned to a project or listed under unowned resources.`,
    '`provider-complete` rows come from account enumeration. `known-name-probed`, `config-derived`, and similar rows cover recorded names or bindings but do not prove that no unknown provider object exists.',
    '',
    '| Kind | Coverage | Provider observed | Tracked | Evidence |',
    '| --- | --- | ---: | ---: | --- |',
    ...catalog.infrastructure._meta.cloudflareCoverage.map((row) =>
      `| ${row.kind} | ${row.state} | ${row.observed ?? '—'} | ${row.tracked ?? '—'} | ${row.evidence} |`),
    '',
  ];
  for (const priority of PORTFOLIO_PRIORITIES) {
    lines.push(...renderPriorityProjects(catalog, priority, kinds));
  }
  if ((catalog.infrastructure.unownedResources ?? []).length > 0) {
    lines.push('## Unowned provider resources', '');
    lines.push('These resources exist in provider inventory but do not yet have a proven Fleet owner.');
    lines.push('They must remain explicit until ownership or retirement is verified.', '');
    lines.push('| Provider | Kind | Name | State | Updated |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const resource of catalog.infrastructure.unownedResources) {
      lines.push(`| ${resource.provider} | ${resource.kind} | \`${resource.name}\` | ${resource.state} | ${resource.updatedAt} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderPriorityProjects(catalog, priority, kinds) {
  const priorityProjects = catalog.projects.filter(
    (project) => project.portfolio.priority === priority,
  );
  const lines = [`## ${priority} — ${priorityProjects.length}`, ''];
  if (priorityProjects.length === 0) return [...lines, 'No projects assigned.', ''];
  const statusGroups = priority === 'P4'
    ? [
        ['active', 'Finished (active)'],
        ['archived', 'Archived'],
      ]
    : [[null, null]];
  for (const [status, statusTitle] of statusGroups) {
    const statusProjects = status
      ? priorityProjects.filter((project) => project.portfolio.status === status)
      : priorityProjects;
    if (statusProjects.length === 0) continue;
    if (statusTitle) lines.push(`### ${statusTitle} — ${statusProjects.length}`, '');
    for (const [kind, title] of kinds) {
      const projects = statusProjects.filter((project) => project.portfolio.kind === kind);
      if (projects.length === 0) continue;
      lines.push(`${statusTitle ? '####' : '###'} ${title} — ${projects.length}`, '');
      lines.push('| Project | Status | Deployed | Ready to share | Readiness evidence | Repository | Deployment | Cloud resources | Updated |');
      lines.push('| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |');
      for (const project of projects) lines.push(renderProjectCatalogRow(catalog, project));
      lines.push('');
    }
  }
  return lines;
}

function renderProjectCatalogRow(catalog, project) {
  const repository = project.sourcePath ?? project.repo ?? '—';
  const infrastructure = catalog.infrastructure.projects[project.id];
  return `| ${[
    project.name,
    project.portfolio.status,
    renderBoolean(project.portfolio.deployed),
    renderBoolean(project.portfolio.readyToBeShared),
    renderSharingReadiness(project.portfolio.sharingReadiness),
    `\`${repository}\``,
    renderDeployments(infrastructure.deployments),
    renderResources(infrastructure.resources),
    infrastructure.updatedAt,
  ].join(' | ')} |`;
}

function validatePortfolioClassification(project, errors) {
  const portfolio = project.portfolio;
  if (!portfolio || typeof portfolio !== 'object' || Array.isArray(portfolio)) {
    errors.push(`${project.id}: missing portfolio classification`);
    return;
  }
  if (!PORTFOLIO_KINDS.has(portfolio.kind)) {
    errors.push(`${project.id}: invalid portfolio kind ${portfolio.kind}`);
  }
  if (!PORTFOLIO_PRIORITIES.includes(portfolio.priority)) {
    errors.push(`${project.id}: invalid portfolio priority ${portfolio.priority}`);
  }
  if (!PORTFOLIO_STATUSES.has(portfolio.status)) {
    errors.push(`${project.id}: invalid portfolio status ${portfolio.status}`);
  }
  for (const field of ['deployed', 'readyToBeShared']) {
    if (typeof portfolio[field] !== 'boolean') {
      errors.push(`${project.id}: portfolio ${field} must be boolean`);
    }
  }
  if (!portfolio.sharingReadiness || typeof portfolio.sharingReadiness !== 'object') {
    errors.push(`${project.id}: missing portfolio sharingReadiness evidence`);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(portfolio.sharingReadiness.verifiedAt ?? '')) {
      errors.push(`${project.id}: sharingReadiness verifiedAt must be YYYY-MM-DD`);
    }
    if (typeof portfolio.sharingReadiness.reason !== 'string'
      || portfolio.sharingReadiness.reason.trim().length === 0) {
      errors.push(`${project.id}: sharingReadiness reason must be non-empty`);
    }
  }
  const expectedStatus = project.lifecycle === 'past' ? 'archived' : 'active';
  if (portfolio.status !== expectedStatus) {
    errors.push(`${project.id}: portfolio status ${portfolio.status} != lifecycle posture ${expectedStatus}`);
  }
  if (portfolio.readyToBeShared && (portfolio.status !== 'active' || !portfolio.deployed)) {
    errors.push(`${project.id}: readyToBeShared requires active and deployed`);
  }
  if (
    portfolio.readyToBeShared
    && (project.public?.listing !== 'maintained' || project.domains?.length === 0 || project.status !== 'live')
  ) {
    errors.push(`${project.id}: readyToBeShared requires a verified maintained public surface`);
  }
}

function validateOwnerPriorityPolicy(catalog, errors) {
  const actualP1 = (catalog.projects ?? [])
    .filter((project) => project.portfolio?.priority === 'P1')
    .map((project) => project.id)
    .sort();
  if (!sameStringList(actualP1, CONTINUOUS_P1_PROJECTS)) {
    errors.push(
      `P1 must contain exactly ${CONTINUOUS_P1_PROJECTS.join(', ')}; found ${actualP1.join(', ') || 'none'}`,
    );
  }
  for (const project of catalog.projects ?? []) {
    if (project.portfolio?.status === 'archived' && project.portfolio.priority !== 'P4') {
      errors.push(`${project.id}: archived projects must use priority P4`);
    }
  }
}

function validateInfrastructureInventory(catalog, projectIds, errors) {
  const inventory = catalog.infrastructure;
  if (!inventory || typeof inventory !== 'object') {
    errors.push('missing infrastructure inventory');
    return;
  }
  const entries = inventory.projects ?? {};
  for (const id of projectIds) {
    const entry = entries[id];
    if (!entry) {
      errors.push(`${id}: missing infrastructure inventory`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.updatedAt ?? '')) {
      errors.push(`${id}: infrastructure updatedAt must be YYYY-MM-DD`);
    }
    for (const field of ['deployments', 'resources']) {
      if (!Array.isArray(entry[field])) errors.push(`${id}: infrastructure ${field} must be an array`);
    }
    validateInfrastructureRows(id, 'deployment', entry.deployments, errors);
    validateInfrastructureRows(id, 'resource', entry.resources, errors);
    const project = catalog.projects.find((candidate) => candidate.id === id);
    const hasUsableDeployment = entry.deployments?.some(
      (deployment) => deployment.state.startsWith('live') || deployment.state.includes('retained'),
    ) ?? false;
    if (project?.portfolio?.deployed !== hasUsableDeployment) {
      errors.push(`${id}: portfolio deployed ${project?.portfolio?.deployed} != infrastructure evidence ${hasUsableDeployment}`);
    }
    if (project?.status === 'live' && project.deployKind !== 'none' && entry.deployments?.length === 0) {
      errors.push(`${id}: live project must declare at least one deployment`);
    }
  }
  for (const id of Object.keys(entries)) {
    if (!projectIds.has(id)) errors.push(`infrastructure inventory: unknown project ${id}`);
  }
  validateInfrastructureRows('unownedResources', 'resource', inventory.unownedResources ?? [], errors);
  validateCloudflareCoverage(inventory._meta?.cloudflareCoverage, inventory, errors);
}

function validateCloudflareCoverage(rows, inventory, errors) {
  if (!Array.isArray(rows)) {
    errors.push('infrastructure cloudflareCoverage must be an array');
    return;
  }
  const seen = new Set();
  for (const row of rows) {
    for (const field of ['kind', 'state', 'evidence']) {
      if (!String(row?.[field] ?? '').trim()) errors.push(`cloudflareCoverage ${row?.kind ?? 'row'} missing ${field}`);
    }
    if (seen.has(row.kind)) errors.push(`duplicate cloudflareCoverage kind ${row.kind}`);
    seen.add(row.kind);
  }
  for (const kind of CLOUDFLARE_COVERAGE_KINDS) {
    if (!seen.has(kind)) errors.push(`cloudflareCoverage missing ${kind}`);
  }
  const trackedCounts = new Map();
  for (const entry of Object.values(inventory.projects ?? {})) {
    for (const deployment of entry.deployments ?? []) {
      if (deployment.provider !== 'cloudflare') continue;
      const kind = deployment.kind === 'email-worker' ? 'worker' : deployment.kind;
      if (kind === 'pages' || kind === 'worker') {
        trackedCounts.set(kind, (trackedCounts.get(kind) ?? 0) + 1);
      }
    }
    for (const resource of entry.resources ?? []) {
      if (resource.provider !== 'cloudflare') continue;
      trackedCounts.set(resource.kind, (trackedCounts.get(resource.kind) ?? 0) + 1);
    }
  }
  for (const resource of inventory.unownedResources ?? []) {
    if (resource.provider !== 'cloudflare') continue;
    trackedCounts.set(resource.kind, (trackedCounts.get(resource.kind) ?? 0) + 1);
  }
  for (const row of rows) {
    if (typeof row.tracked !== 'number') continue;
    const actual = trackedCounts.get(row.kind) ?? 0;
    if (row.tracked !== actual) {
      errors.push(`cloudflareCoverage ${row.kind} tracked ${row.tracked} != inventory ${actual}`);
    }
  }
}

function validateInfrastructureRows(id, kind, rows, errors) {
  if (!Array.isArray(rows)) return;
  const seen = new Set();
  for (const row of rows) {
    for (const field of kind === 'deployment'
      ? ['provider', 'kind', 'name', 'method', 'state']
      : ['provider', 'kind', 'name', 'state']) {
      if (!String(row?.[field] ?? '').trim()) errors.push(`${id}: ${kind} missing ${field}`);
    }
    const key = `${row?.provider}:${row?.kind}:${row?.name}`;
    if (seen.has(key)) errors.push(`${id}: duplicate ${kind} ${key}`);
    seen.add(key);
  }
}

function renderDeployments(deployments) {
  if (deployments.length === 0) return '—';
  return deployments
    .map((deployment) => `${deployment.provider} ${deployment.kind} \`${deployment.name}\` (${deployment.method}; ${deployment.state})`)
    .join('<br>');
}

function renderBoolean(value) {
  return value ? 'yes' : 'no';
}

function renderSharingReadiness(readiness) {
  return `${readiness.reason} (verified ${readiness.verifiedAt})`;
}

function renderResources(resources) {
  if (resources.length === 0) return '—';
  return resources
    .map((resource) => `${resource.provider} ${resource.kind} \`${resource.name}\` (${resource.state})`)
    .join('<br>');
}

export function renderReadmePortfolio(catalog) {
  const lines = [
    '<!-- project-catalog:start -->',
    '## Portfolio classification',
    '',
    'This is a generated summary of the private Fleet project catalog. The complete',
    'machine-readable source is `foundry/ops/config/projects.json`; the generated',
    'human view is [`foundry/ops/docs/project-catalog.md`](foundry/ops/docs/project-catalog.md).',
    'Maintenance rules live in [`foundry/ops/config/README.md`](foundry/ops/config/README.md).',
    '',
  ];
  for (const priority of PORTFOLIO_PRIORITIES) {
    const projects = catalog.projects.filter((project) => project.portfolio.priority === priority);
    lines.push(`### ${priority} — ${projects.length}`, '');
    if (projects.length === 0) {
      lines.push('No projects assigned.', '');
      continue;
    }
    for (const kind of PORTFOLIO_KINDS) {
      const names = projects
        .filter((project) => project.portfolio.kind === kind)
        .map((project) => project.name);
      if (names.length > 0) lines.push(`- ${kind}: ${names.join(', ')}`);
    }
    lines.push('');
  }
  lines.push(
    'Priority, kind, status, deployment, and sharing readiness are independent.',
    'Past projects remain preserved without becoming maintenance obligations.',
    '<!-- project-catalog:end -->',
  );
  return lines.join('\n');
}

export function replaceGeneratedSection(markdown, rendered) {
  const pattern = /<!-- project-catalog:start -->[\s\S]*?<!-- project-catalog:end -->/;
  if (!pattern.test(markdown)) throw new Error('README is missing project-catalog generated markers');
  return markdown.replace(pattern, rendered);
}

function validateOverlay(name, values, identityFor, identities, errors) {
  for (const value of values ?? []) {
    const identity = identityFor(value);
    if (RESERVED_OVERLAY_IDS.has(identity)) continue;
    if (!identities.has(normalize(identity))) errors.push(`${name}: unknown project ${identity}`);
  }
}

function discoverGitDirectories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const gitPath = path.join(root, entry.name, '.git');
      return existsSync(gitPath) && statSync(gitPath).isDirectory();
    })
    .map((entry) => entry.name)
    .sort();
}

function createResolver(catalog) {
  const identities = new Map();
  for (const project of catalog.projects) {
    for (const identity of [project.id, ...(project.aliases ?? [])]) {
      identities.set(normalize(identity), project.id);
    }
  }
  return (identity) => identities.get(normalize(identity));
}

function defaultAutomationEntry(project, repository) {
  const live = project.status === 'live' && project.deployKind !== 'none';
  const ignored = project.attention === 'ignored';
  return {
    id: project.id,
    name: project.name,
    attention: project.attention,
    family: project.family,
    owner: project.attention === 'foundry' ? 'foundry' : project.attention === 'ignored' ? 'none' : 'sarthak',
    repository,
    runtimes: ignored ? [] : project.deployKind === 'none' ? ['local-tool'] : ['public-web'],
    surfaces: live ? project.domains.map((domain) => `https://${domain}`) : [],
    dependencies: ignored ? [] : live ? ['GitHub Actions', project.deployKind.includes('worker') ? 'Cloudflare Workers' : 'Cloudflare Pages'] : ['local toolchain'],
    evidenceSources: ignored ? [] : live ? ['github-actions', 'fleet-deploy', 'live-smoke', 'indexing', 'errors'] : ['github-actions', 'local-checks'],
    contracts: ignored ? [] : live ? ['build', 'live', 'indexing', 'errors'] : ['build', 'errors'],
    actionPolicy: ignored ? 'excluded' : 'quiet-maintenance',
    alertPolicy: ignored ? 'none' : 'digest validation findings',
    exceptions: ignored
      ? [{ contract: 'all', reason: 'Inactive; explicit reactivation required' }]
      : [],
  };
}

function defaultMarketingEntry(project, isPublic) {
  return {
    slug: project.id,
    name: project.name,
    aliases: project.aliases ?? [],
    mode: project.attention === 'my-work' ? 'focus' : isPublic ? 'evergreen' : 'private',
    domain: isPublic ? `https://${project.domains[0]}` : null,
    domainPosture: isPublic ? 'product-subdomain' : 'local-only',
    publicMarketing: isPublic,
    cta: isPublic ? 'Open the product' : 'Use the project privately',
    cadence: isPublic ? 'quarterly' : 'none',
    contentBase: null,
    channels: [],
  };
}

function normalize(value) {
  return String(value).toLowerCase().replaceAll('_', '-');
}

function normalizePath(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}
