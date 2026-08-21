import { createHash } from 'node:crypto';

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function draftMission(
  request,
  { projects = [], actor = { type: 'owner', id: 'founder', label: 'Founder' }, now = new Date().toISOString() } = {},
) {
  if (!request || typeof request !== 'object') throw new Error('mission request is required');
  const title = String(request.title ?? request.request ?? '').trim();
  if (!title) throw new Error('mission title is required');
  const requestedProject = request.projectId ? String(request.projectId) : null;
  const knownProject = requestedProject ? projects.find((project) => project.id === requestedProject) : null;
  const suffix = fingerprint(`${requestedProject ?? 'portfolio'}:${title}:${now.slice(0, 10)}`);
  const missionId = `mission/${slug(title) || 'untitled'}-${suffix}`;

  const event = {
    type: 'mission.drafted',
    actor,
    missionId,
    ...(knownProject ? { projectId: knownProject.id } : {}),
    idempotencyKey: `mission-draft/${suffix}`,
    occurredAt: now,
    payload: {
      title,
      outcome: String(request.outcome ?? `A verified result for: ${title}`),
      completionCriteria:
        Array.isArray(request.completionCriteria) && request.completionCriteria.length > 0
          ? request.completionCriteria.map(String)
          : ['The intended outcome is delivered', 'The result is verified with provider evidence'],
      authority: {
        mode: request.readOnly ? 'read-only' : 'owner-acceptance-required',
        mayMutate: false,
      },
      source: 'deterministic-intake',
      ...(requestedProject && !knownProject ? { unresolvedProject: requestedProject } : {}),
    },
  };

  const decision = requestedProject && !knownProject
    ? {
        type: 'decision.requested',
        actor: { type: 'automation', id: 'foundry-intake', label: 'Foundry intake' },
        missionId,
        idempotencyKey: `mission-draft-project/${suffix}`,
        occurredAt: now,
        payload: {
          question: `Which project should own “${title}”?`,
          why: `The requested project “${requestedProject}” is not in the canonical registry.`,
          allowedResponses: ['clarify', 'defer', 'reject'],
          scope: 'mission-project',
          reversible: true,
          decisionId: `decision/project-${suffix}`,
        },
      }
    : null;

  return { event, decision };
}
