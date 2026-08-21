import { createHash } from 'node:crypto';

const TEAMMATES = new Set(['codex', 'devin']);
const VERDICT_STATUS = new Map([
  ['accepted', 'succeeded'],
  ['accepted-with-fixes', 'succeeded'],
  ['rejected', 'failed'],
  ['failed', 'failed'],
  ['blocked', 'blocked'],
]);

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function projectId(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'unknown';
}

export function parseTeammateScorecard(markdown, { source = 'foundry/ops/teammates/SCORECARD.md' } = {}) {
  if (typeof markdown !== 'string') throw new TypeError('scorecard must be a string');

  const entries = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| 20')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length !== 6) continue;

    const [date, teammate, taskType, repoScope, verdict, note] = cells;
    if (!TEAMMATES.has(teammate)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const rowFingerprint = fingerprint(cells.join('\u001f'));
    const observedAt = `${date}T00:00:00.000Z`;
    entries.push({
      run: {
        skillId: `call-${teammate}`,
        projectId: projectId(repoScope),
        actor: { type: 'agent', id: teammate },
        source: 'backfill',
        captureCompleteness: 'summary-only',
        observedAt,
        startedAt: observedAt,
        finishedAt: observedAt,
        status: VERDICT_STATUS.get(verdict) ?? 'unknown',
        idempotencyKey: `scorecard:${teammate}:${rowFingerprint}`,
        sourceReference: {
          kind: 'fleet-teammate-scorecard',
          path: source,
          fingerprint: rowFingerprint,
        },
        reconstructionConfidence: 'curated-summary',
        metadata: { teammate, taskType, repoScope, verdict },
      },
      output: note,
      metrics: [],
    });
  }

  return entries;
}
