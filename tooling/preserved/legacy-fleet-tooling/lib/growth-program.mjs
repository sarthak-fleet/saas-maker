import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { visibilityProjects } from './visibility-projects.mjs';

const GROWTH_PROGRAM_SCHEMA = 'fleet.growth-program.v1';
const GROWTH_MODES = Object.freeze(['focus', 'maintain', 'observe']);

const REQUIRED_MODE_MAPPINGS = Object.freeze([
  'focus',
  'evergreen',
  'infrastructure',
  'private',
]);

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid growth program: ${message}`);
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(typeof value === 'string' && value.length > 0, `${label} contains an empty id`);
    assert(!seen.has(value), `${label} duplicates ${value}`);
    seen.add(value);
  }
  return seen;
}

function canonicalOrigin(project) {
  const domain = project.domains?.[0];
  return domain ? new URL(`https://${domain}`).origin : null;
}

function activeQueries(rootSearchQueries) {
  const queries = new Map();
  const roots = rootSearchQueries instanceof Map
    ? [...rootSearchQueries.values()]
    : rootSearchQueries?.roots ?? [];
  for (const root of roots) {
    for (const query of root.queries ?? []) {
      if (query.status !== 'active') continue;
      assert(!queries.has(query.id), `root query id ${query.id} is duplicated`);
      queries.set(query.id, { ...query, projectId: root.projectId, rootDomain: root.rootDomain });
    }
  }
  return queries;
}

export function directoryAttemptEvidence(status, projectIds) {
  const validProjects = new Set(projectIds);
  const attempts = new Map([...validProjects].map((projectId) => [projectId, []]));
  for (const [directoryId, projects] of Object.entries(status?.confirmed_full_set ?? {})) {
    for (const projectId of projects ?? []) {
      if (!validProjects.has(projectId)) continue;
      attempts.get(projectId).push(directoryId);
    }
  }
  return new Map([...attempts].map(([projectId, directoryIds]) => [projectId, {
    acknowledgedSubmissions: directoryIds.length,
    directoryIds: [...directoryIds].sort(),
    observedAt: status?.date ? `${status.date}T00:00:00.000Z` : null,
    evidenceClass: directoryIds.length > 0 ? 'submission-acknowledgement' : 'not-recorded',
  }]));
}

function validateFocusTarget(target, projectById, marketingById, queryById) {
  const project = projectById.get(target.projectId);
  assert(project, `focus project ${target.projectId} is not maintained`);
  assert(marketingById.get(target.projectId)?.mode === 'focus', `${target.projectId} is not a focus Marketing project`);
  const query = queryById.get(target.targetQueryId);
  assert(query, `${target.projectId} target query ${target.targetQueryId} is not active`);
  assert(query.projectId === target.projectId, `${target.targetQueryId} belongs to ${query.projectId}`);
  let destination;
  try {
    destination = new URL(target.destination);
  } catch {
    assert(false, `${target.projectId} destination is not a URL`);
  }
  assert(destination.protocol === 'https:', `${target.projectId} destination must use https`);
  assert(destination.origin === canonicalOrigin(project), `${target.projectId} destination is off-origin`);
  return {
    projectId: target.projectId,
    queryId: query.id,
    query: query.text,
    destination: destination.href,
  };
}

function validateVerifiedLink(link, projectById) {
  const project = projectById.get(link.projectId);
  assert(project, `verified link references unknown project ${link.projectId}`);
  let sourceUrl;
  let destinationUrl;
  try {
    sourceUrl = new URL(link.sourceUrl);
    destinationUrl = new URL(link.destinationUrl);
  } catch {
    assert(false, `verified link for ${link.projectId} contains an invalid URL`);
  }
  assert(sourceUrl.protocol === 'https:', `verified link source for ${link.projectId} must use https`);
  assert(destinationUrl.origin === canonicalOrigin(project), `verified link destination for ${link.projectId} is off-origin`);
  assert(sourceUrl.origin !== destinationUrl.origin, `verified link source for ${link.projectId} must be external`);
  assert(Number.isFinite(Date.parse(link.observedAt)), `verified link for ${link.projectId} needs observedAt`);
  return {
    projectId: link.projectId,
    sourceUrl: sourceUrl.href,
    destinationUrl: destinationUrl.href,
    observedAt: link.observedAt,
    kind: link.kind ?? 'editorial',
  };
}

export function validateGrowthProgram({
  program,
  projectCatalog,
  marketingProgram,
  rootSearchQueries,
  directoryStatus = {},
}) {
  assert(program?.$schema === GROWTH_PROGRAM_SCHEMA, `schema must be ${GROWTH_PROGRAM_SCHEMA}`);
  assert(program?.version === 1, 'version must be 1');

  const projects = visibilityProjects(projectCatalog);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  assert(projectById.size === projects.length, 'maintained project ids must be unique');

  const marketingById = new Map();
  for (const project of marketingProgram?.projects ?? []) {
    assert(!marketingById.has(project.slug), `Marketing program duplicates ${project.slug}`);
    marketingById.set(project.slug, project);
  }
  for (const project of projects) {
    assert(marketingById.has(project.id), `Marketing program is missing ${project.id}`);
  }

  const mappingKeys = Object.keys(program.modeMapping ?? {}).sort();
  assert(
    JSON.stringify(mappingKeys) === JSON.stringify([...REQUIRED_MODE_MAPPINGS].sort()),
    `modeMapping must contain exactly ${REQUIRED_MODE_MAPPINGS.join(', ')}`,
  );
  for (const [sourceMode, growthMode] of Object.entries(program.modeMapping)) {
    assert(GROWTH_MODES.includes(growthMode), `${sourceMode} maps to unknown mode ${growthMode}`);
  }

  const marketingFocus = unique(marketingProgram?.focusSet ?? [], 'Marketing focusSet');
  const targetProjects = unique(
    (program.focusProjects ?? []).map((target) => target.projectId),
    'focusProjects',
  );
  assert(
    [...marketingFocus].sort().join('\n') === [...targetProjects].sort().join('\n'),
    'focusProjects must exactly match the Marketing focusSet',
  );

  const queryById = activeQueries(rootSearchQueries);
  const focusTargets = new Map();
  for (const target of program.focusProjects ?? []) {
    focusTargets.set(target.projectId, validateFocusTarget(target, projectById, marketingById, queryById));
  }

  const verifiedLinks = (program.verifiedLinks ?? []).map((link) => validateVerifiedLink(link, projectById));

  const attemptsByProject = directoryAttemptEvidence(directoryStatus, projectById.keys());
  const allocations = projects.map((project) => {
    const marketingProject = marketingById.get(project.id);
    const mode = program.modeMapping[marketingProject.mode];
    assert(mode, `${project.id} has unmapped Marketing mode ${marketingProject.mode}`);
    const links = verifiedLinks.filter((link) => link.projectId === project.id);
    return {
      projectId: project.id,
      mode,
      target: focusTargets.get(project.id) ?? null,
      directoryAttempts: attemptsByProject.get(project.id),
      verifiedLinks: links,
    };
  });
  assert(allocations.filter((allocation) => allocation.mode === 'focus').length === marketingFocus.size, 'focus allocation count drifted');

  return {
    schema: GROWTH_PROGRAM_SCHEMA,
    version: program.version,
    allocations,
    attribution: {
      search: program.attribution?.search ?? null,
      traffic: program.attribution?.traffic ?? null,
      conversions: program.attribution?.conversions ?? null,
      revenue: program.attribution?.revenue ?? null,
      causality: program.attribution?.causality ?? null,
    },
  };
}

export function loadGrowthProgram({
  fleetRoot,
  projectCatalog,
  marketingProgram,
  rootSearchQueries,
}) {
  const readJson = (path, fallback = {}) => {
    try {
      return JSON.parse(readFileSync(resolve(fleetRoot, path), 'utf8'));
    } catch {
      return fallback;
    }
  };
  const program = readJson('foundry/ops/config/growth-program.json', null);
  if (!program && visibilityProjects(projectCatalog).length === 0) {
    return {
      schema: GROWTH_PROGRAM_SCHEMA,
      version: 1,
      allocations: [],
      attribution: {
        search: null,
        traffic: null,
        conversions: null,
        revenue: null,
        causality: null,
      },
    };
  }
  return validateGrowthProgram({
    program,
    projectCatalog,
    marketingProgram,
    rootSearchQueries,
    directoryStatus: readJson('foundry/ops/config/directory-submissions/status.json'),
  });
}
