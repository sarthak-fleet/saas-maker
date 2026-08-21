const OWNERSHIP_STATES = new Set(['published', 'approval-pending', 'missing']);

export function buildPromptOwnershipReport({ marketingProgram, identities, agentRegistry }) {
  const identityById = new Map((identities ?? []).map((identity) => [identity.id, identity]));
  const surfacesById = new Map((agentRegistry?.products ?? []).map((product) => [product.id, product]));
  const rows = [];

  for (const project of marketingProgram?.aiVisibility?.projects ?? []) {
    const identity = identityById.get(project.slug);
    const surfaces = surfacesById.get(project.slug);
    if (!identity) throw new Error(`${project.slug}: canonical GEO identity is missing`);
    if (!surfaces) throw new Error(`${project.slug}: agent surface inventory is missing`);

    const declaredPages = uniqueUrls([
      identity.origin,
      ...(surfaces.productLinks ?? []).map((link) => link.url),
    ]);
    for (const promptSet of project.promptSets) {
      for (const prompt of promptSet.prompts) {
        const key = `${promptSet.id}/${prompt.id}`;
        const policyOwner =
          prompt.id === 'category' &&
          marketingProgram.aiVisibility.ownershipPolicy?.categoryOwner === 'canonical-origin'
            ? {
                state: 'published',
                url: identity.origin,
                evidence: 'policy:canonical-category-owner',
              }
            : null;
        const ownership = normalizeOwnership(prompt.ownedPage ?? policyOwner, {
          projectId: project.slug,
          promptKey: key,
          origin: identity.origin,
          declaredPages,
        });
        rows.push({
          projectId: project.slug,
          productName: identity.name,
          promptKey: key,
          prompt: prompt.text,
          competitors: project.competitors.map((competitor) => ({ ...competitor })),
          declaredPageCount: declaredPages.length,
          ...ownership,
        });
      }
    }
  }

  const counts = Object.fromEntries(
    [...OWNERSHIP_STATES].map((state) => [
      state,
      rows.filter((row) => row.state === state).length,
    ]),
  );
  return {
    schema: 'fleet.prompt-ownership-report.v1',
    projectCount: new Set(rows.map((row) => row.projectId)).size,
    promptCount: rows.length,
    counts,
    rows,
  };
}

function normalizeOwnership(input, { projectId, promptKey, origin, declaredPages }) {
  if (input == null) {
    return {
      state: 'missing',
      url: null,
      evidence: null,
      implementationAction:
        'Inspect an existing owned page and declare its exact URL, or prepare an approval-gated content_coverage manifest.',
    };
  }
  if (!OWNERSHIP_STATES.has(input.state)) {
    throw new Error(`${projectId} ${promptKey}: ownedPage.state is invalid`);
  }
  if (input.state === 'missing') {
    if (input.url != null) throw new Error(`${projectId} ${promptKey}: missing ownership cannot declare a URL`);
    return {
      state: 'missing',
      url: null,
      evidence: input.evidence ?? null,
      implementationAction: input.implementationAction ??
        'Prepare an approval-gated content_coverage manifest for this exact prompt.',
    };
  }
  if (input.state === 'approval-pending') {
    if (!/^[a-f0-9]{64}$/u.test(input.manifestHash ?? '')) {
      throw new Error(`${projectId} ${promptKey}: approval-pending ownership requires manifestHash`);
    }
    return {
      state: 'approval-pending',
      url: input.url ?? null,
      evidence: `manifest:${input.manifestHash}`,
      implementationAction: 'Obtain owner approval for the exact manifest hash before any repository write.',
    };
  }

  const url = absoluteHttpUrl(input.url, `${projectId} ${promptKey}: published ownership requires an HTTP(S) URL`);
  if (new URL(url).origin !== new URL(origin).origin) {
    throw new Error(`${projectId} ${promptKey}: published owned page must use the canonical origin`);
  }
  if (!declaredPages.includes(normalizeUrl(url))) {
    throw new Error(`${projectId} ${promptKey}: published owned page is absent from the declared surface inventory`);
  }
  return {
    state: 'published',
    url,
    evidence: input.evidence ?? url,
    implementationAction: 'Remeasure the exact prompt and retain provider/model/citation provenance.',
  };
}

function uniqueUrls(values) {
  return [...new Set(values.map(normalizeUrl))].sort();
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/u, '');
}

function absoluteHttpUrl(value, message) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(message);
    return url.toString();
  } catch {
    throw new Error(message);
  }
}
