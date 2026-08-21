import { buildOwnerNotifications } from './learning.mjs';

const severityMap = {
  attention: 'warning',
  warning: 'warning',
  critical: 'critical',
  info: 'success',
};

export function toFleetNotification(item, { consoleBaseUrl = 'https://fleet.sassmaker.com' } = {}) {
  const path = item.kind === 'owner-decision' ? '/decisions' : item.missionId ? `/missions/${encodeURIComponent(item.missionId)}` : '/';
  const context = [
    item.kind === 'material-risk' ? `${item.risk} risk` : item.kind.replaceAll('-', ' '),
    item.projectId ? `project: ${item.projectId}` : null,
  ].filter(Boolean);
  return {
    severity: severityMap[item.severity] ?? 'warning',
    source: 'founder-control',
    project: item.projectId ?? null,
    title: item.title,
    body: context.join(' · '),
    url: new URL(path, consoleBaseUrl).toString(),
    dedupeKey: item.key,
    forceOwnerChannel: item.kind === 'requested-completion',
  };
}

export async function deliverOwnerNotifications(
  projections,
  {
    emit,
    now = new Date().toISOString(),
    blockerHours = 24,
    consoleBaseUrl = 'https://fleet.sassmaker.com',
  } = {},
) {
  if (typeof emit !== 'function') throw new TypeError('emit is required');
  const notifications = buildOwnerNotifications(projections, { now, blockerHours });
  const results = [];
  for (const item of notifications) {
    const event = toFleetNotification(item, { consoleBaseUrl });
    results.push({ key: item.key, ...(await emit(event)) });
  }
  return {
    considered: notifications.length,
    queued: results.filter((result) => result.queued === true).length,
    duplicates: results.filter((result) => result.duplicate === true).length,
    results,
  };
}
