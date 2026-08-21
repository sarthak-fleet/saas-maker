const REQUIRED_KINDS = Object.freeze(['brand', 'exact-domain', 'category', 'problem']);
const QUERY_STATUSES = new Set(['active', 'historical']);
const COLLISION_STATES = new Set(['clear', 'ambiguous']);

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hostname(value) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

function validateRootSearchQueries(entry, rootDomain, queryIds) {
  const queries = [];
  const localTexts = new Set();
  for (const query of entry.queries ?? []) {
    const id = normalizedText(query?.id);
    const kind = normalizedText(query?.kind);
    const text = normalizedText(query?.text);
    const status = normalizedText(query?.status);
    if (!id || !REQUIRED_KINDS.includes(kind) || !text || !QUERY_STATUSES.has(status)) {
      throw new Error(`invalid root search query for ${rootDomain}: ${id || '(empty)'}`);
    }
    if (queryIds.has(id)) throw new Error(`duplicate root search query id: ${id}`);
    queryIds.add(id);
    const textKey = text.toLocaleLowerCase('en-US');
    if (localTexts.has(textKey)) throw new Error(`duplicate root search query text for ${rootDomain}: ${text}`);
    localTexts.add(textKey);
    queries.push({
      id,
      kind,
      text,
      status,
      ...(status === 'historical' ? { supersededBy: normalizedText(query.supersededBy) } : {}),
    });
  }

  const activeByKind = new Map();
  for (const query of queries.filter((query) => query.status === 'active')) {
    if (activeByKind.has(query.kind)) {
      throw new Error(`duplicate active ${query.kind} query for ${rootDomain}`);
    }
    activeByKind.set(query.kind, query);
  }
  const missingKinds = REQUIRED_KINDS.filter((kind) => !activeByKind.has(kind));
  if (missingKinds.length > 0) {
    throw new Error(`missing active root search queries for ${rootDomain}: ${missingKinds.join(', ')}`);
  }
  for (const query of queries.filter((query) => query.status === 'historical')) {
    if (!query.supersededBy || !queries.some((candidate) => candidate.id === query.supersededBy && candidate.status === 'active')) {
      throw new Error(`historical root search query requires an active replacement: ${query.id}`);
    }
  }
  return { queries, activeByKind };
}

function assertProjectDomain(projectId, rootDomain, projectsById) {
  if (projectsById.size === 0) return;
  const project = projectsById.get(projectId);
  if (!project) throw new Error(`unknown root search project: ${projectId || '(empty)'}`);
  if (!(project.domains ?? []).includes(rootDomain)) {
    throw new Error(`root search project domain mismatch: ${projectId} does not own ${rootDomain}`);
  }
}

export function validateRootSearchQueryContract(contract, brandMap, projects = []) {
  if (!contract || contract.version !== 1 || contract.cadence !== 'weekly' || !Array.isArray(contract.roots)) {
    throw new Error('root search query contract must contain version 1, weekly cadence, and a roots array');
  }

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const roots = new Map();
  const queryIds = new Set();
  for (const entry of contract.roots) {
    const rootDomain = normalizedText(entry?.rootDomain).toLowerCase();
    const projectId = normalizedText(entry?.projectId);
    if (!brandMap.has(rootDomain)) throw new Error(`unknown root search domain: ${rootDomain || '(empty)'}`);
    if (roots.has(rootDomain)) throw new Error(`duplicate root search domain: ${rootDomain}`);
    assertProjectDomain(projectId, rootDomain, projectsById);

    const collisionState = normalizedText(entry?.collision?.state);
    const collisionNote = normalizedText(entry?.collision?.note);
    if (!COLLISION_STATES.has(collisionState) || collisionNote.length < 20) {
      throw new Error(`invalid root search collision metadata: ${rootDomain}`);
    }

    const { queries, activeByKind } = validateRootSearchQueries(entry, rootDomain, queryIds);

    roots.set(rootDomain, {
      rootDomain,
      projectId,
      collision: { state: collisionState, note: collisionNote },
      queries,
      activeQueries: REQUIRED_KINDS.map((kind) => activeByKind.get(kind)),
    });
  }

  const missingRoots = [...brandMap.keys()].filter((root) => !roots.has(root));
  const extraRoots = [...roots.keys()].filter((root) => !brandMap.has(root));
  if (missingRoots.length > 0 || extraRoots.length > 0) {
    throw new Error(`root search coverage mismatch: missing=${missingRoots.join(',') || 'none'} extra=${extraRoots.join(',') || 'none'}`);
  }
  return roots;
}

export function mergeRootSearchQueriesIntoObservatory(observatory, rootsByDomain) {
  const products = (observatory?.products ?? []).map((product) => ({
    ...product,
    queries: [...(product.queries ?? [])],
  }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  for (const root of rootsByDomain.values()) {
    const product = productsById.get(root.projectId) ?? {
      id: root.projectId,
      origin: `https://${root.rootDomain}`,
      queries: [],
    };
    if (hostname(product.origin) !== root.rootDomain) {
      throw new Error(`root query origin conflicts with GEO config: ${root.projectId}`);
    }
    if (!productsById.has(root.projectId)) {
      products.push(product);
      productsById.set(root.projectId, product);
    }
    const existing = new Map(product.queries.map((query) => [query.qid, query]));
    for (const query of root.queries) {
      const configured = existing.get(query.id);
      if (configured && normalizedText(configured.q) !== query.text) {
        throw new Error(`root query text conflicts with GEO config: ${query.id}`);
      }
      existing.set(query.id, {
        ...(configured ?? {}),
        qid: query.id,
        kind: query.kind,
        q: query.text,
        status: query.status,
        ...(query.supersededBy ? { supersededBy: query.supersededBy } : {}),
        rootDomain: root.rootDomain,
        collision: root.collision,
      });
    }
    product.queries = [...existing.values()];
  }
  return { ...observatory, products };
}

export function activeObservatoryQueries(product) {
  return (product?.queries ?? []).filter((query) => query.status !== 'historical');
}

export const ROOT_SEARCH_QUERY_KINDS = REQUIRED_KINDS;
