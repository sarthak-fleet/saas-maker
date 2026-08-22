function byTime(left, right) {
  if (Number.isInteger(left.sequence) && Number.isInteger(right.sequence)) {
    return left.sequence - right.sequence;
  }
  return left.occurredAt.localeCompare(right.occurredAt)
    || left.recordedAt.localeCompare(right.recordedAt)
    || left.id.localeCompare(right.id);
}

function freshState(pointer, now) {
  if (pointer.state === 'unavailable') return 'unavailable';
  if (pointer.state === 'stale') return 'stale';
  if (pointer.freshUntil && Date.parse(pointer.freshUntil) < Date.parse(now)) return 'stale';
  return pointer.state;
}

function eventSummary(event) {
  return String(
    event.payload.summary
      ?? event.payload.title
      ?? event.payload.name
      ?? event.payload.runId
      ?? event.type,
  );
}

export function buildProjections(inputEvents, { now = new Date().toISOString(), projects = [] } = {}) {
  const events = [...inputEvents].sort(byTime);
  const actors = new Map();
  const schedules = new Map();
  const visibilityRuns = new Map();
  const correctedEvents = new Set(
    events.filter((event) => event.type === 'event.corrected').map((event) => event.payload.eventId),
  );
  const activity = [];

  for (const event of events) {
    if (correctedEvents.has(event.id) && event.type !== 'event.corrected') continue;
    activity.push({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor,
      projectId: event.projectId ?? null,
      summary: eventSummary(event),
      evidence: event.evidence,
    });
    if (event.type === 'actor.status-recorded') {
      actors.set(event.actor.id, {
        id: event.actor.id,
        type: event.actor.type,
        label: event.actor.label ?? event.actor.id,
        state: event.payload.state,
        updatedAt: event.occurredAt,
        freshUntil: event.payload.freshUntil,
        freshness: Date.parse(event.payload.freshUntil) < Date.parse(now) ? 'stale' : 'fresh',
      });
    }
    if (event.type === 'schedule.recorded') {
      schedules.set(String(event.payload.id ?? event.id), {
        id: String(event.payload.id ?? event.id),
        name: event.payload.name,
        enabled: Boolean(event.payload.enabled),
        nextRunAt: event.payload.nextRunAt,
        lastRunAt: event.payload.lastRunAt ?? null,
        lastState: event.payload.lastState ?? 'not-run',
        receipt: event.evidence[0] ?? null,
      });
    }
    if (event.type === 'visibility.run-recorded') {
      const projectRuns = visibilityRuns.get(event.projectId) ?? [];
      const pointer = event.evidence[0] ?? null;
      projectRuns.push({
        runId: event.payload.runId,
        promptSetId: event.payload.promptSetId ?? null,
        evidenceMode: event.payload.evidenceMode ?? null,
        projectId: event.projectId,
        observedAt: event.occurredAt,
        freshUntil: pointer?.freshUntil ?? null,
        freshness: pointer ? freshState(pointer, now) : 'unverified',
        coverage: event.payload.coverage,
        cost: event.payload.cost,
        metrics: event.payload.metrics,
        citations: event.payload.citations,
        attempts: event.payload.attempts,
        comparison: event.payload.comparison ?? null,
        evidence: event.evidence,
      });
      visibilityRuns.set(event.projectId, projectRuns);
    }
  }

  const projectMap = new Map(
    projects.map((project) => [project.id, { ...project }]),
  );
  const orderedActivity = activity.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const aiVisibility = {
    generatedAt: now,
    projects: [...visibilityRuns.entries()]
      .map(([projectId, history]) => {
        const ordered = [...history].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
        return {
          projectId,
          latest: ordered[0],
          previous: ordered[1] ?? null,
          comparison: ordered[0]?.comparison ?? null,
          history: ordered,
        };
      })
      .sort((left, right) => left.projectId.localeCompare(right.projectId)),
  };

  return {
    generatedAt: now,
    home: {
      generatedAt: now,
      whatChanged: orderedActivity.slice(0, 12),
    },
    activity: orderedActivity,
    projects: [...projectMap.values()],
    actors: [...actors.values()],
    schedules: [...schedules.values()],
    aiVisibility,
  };
}
