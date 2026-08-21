export function evaluateOutcomeWindow({
  baseline,
  measured,
  direction = 'increase',
  minimumChange = 0,
  windowEnded = true,
  caveats = [],
}) {
  if (!windowEnded || !Number.isFinite(baseline) || !Number.isFinite(measured)) {
    return {
      verdict: 'not-yet-measurable',
      summary: 'The outcome window does not yet contain comparable measurements.',
      baseline: Number.isFinite(baseline) ? baseline : null,
      measured: Number.isFinite(measured) ? measured : null,
      caveats,
    };
  }
  const change = measured - baseline;
  const supported = direction === 'decrease' ? change <= -minimumChange : change >= minimumChange;
  const contradicted = direction === 'decrease' ? change > 0 : change < 0;
  const verdict = supported ? (caveats.length > 0 ? 'mixed' : 'supported') : contradicted ? 'unsupported' : 'mixed';
  return {
    verdict,
    summary:
      verdict === 'supported'
        ? 'The measured outcome supports the intended direction.'
        : verdict === 'unsupported'
          ? 'The measured outcome moved against the intended direction.'
          : 'The measurement is conclusive enough to review but does not cleanly support or reject the outcome.',
    baseline,
    measured,
    change,
    caveats,
  };
}

export function buildOwnerNotifications(projections, { now = new Date().toISOString(), blockerHours = 24 } = {}) {
  const items = [];
  for (const decision of projections.decisions) {
    if (!['open', 'stale'].includes(decision.state)) continue;
    items.push({
      key: `decision/${decision.id}/${decision.updatedAt}`,
      kind: 'owner-decision',
      severity: decision.state === 'stale' ? 'warning' : 'attention',
      title: decision.question,
      missionId: decision.missionId,
      projectId: decision.projectId,
    });
  }
  for (const mission of projections.missions) {
    if (mission.state === 'blocked') {
      const blockedAt = [...mission.timeline].reverse().find((event) => event.type === 'mission.blocked')?.occurredAt;
      if (blockedAt && Date.parse(now) - Date.parse(blockedAt) >= blockerHours * 3_600_000) {
        items.push({
          key: `blocked/${mission.id}/${blockedAt}`,
          kind: 'prolonged-blocker',
          severity: 'warning',
          title: `${mission.title} remains blocked`,
          missionId: mission.id,
          projectId: mission.projectId,
        });
      }
    }
    if (mission.state === 'completed' && mission.authority?.notifyOnCompletion === true) {
      items.push({
        key: `completed/${mission.id}/${mission.updatedAt}`,
        kind: 'requested-completion',
        severity: 'info',
        title: `${mission.title} completed`,
        missionId: mission.id,
        projectId: mission.projectId,
      });
    }
  }
  for (const schedule of projections.schedules) {
    if (schedule.lastState !== 'failed') continue;
    items.push({
      key: `schedule/${schedule.id}/${schedule.lastRunAt ?? schedule.nextRunAt}`,
      kind: 'critical-work-failed',
      severity: 'critical',
      title: `${schedule.name} failed`,
      scheduleId: schedule.id,
    });
  }
  for (const recommendation of projections.recommendations ?? []) {
    if (
      recommendation.state !== 'open'
      || !['security', 'cost', 'data-loss'].includes(recommendation.risk)
    ) {
      continue;
    }
    items.push({
      key: `risk/${recommendation.id}/${recommendation.updatedAt}`,
      kind: 'material-risk',
      severity: 'critical',
      title: recommendation.title,
      missionId: recommendation.missionId,
      projectId: recommendation.projectId,
      risk: recommendation.risk,
    });
  }
  return [...new Map(items.map((item) => [item.key, item])).values()];
}
