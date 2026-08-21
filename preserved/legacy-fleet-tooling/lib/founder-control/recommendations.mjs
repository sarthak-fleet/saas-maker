const attentionWeight = {
  focus: 1,
  active: 0.8,
  secondary: 0.55,
  parked: 0.2,
  'out-of-fleet': 0,
  'non-product': 0.1,
};

function bounded(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export function scoreRecommendation(input, { now = new Date().toISOString() } = {}) {
  const impact = bounded(input.impact);
  const confidence = bounded(input.confidence);
  const effort = bounded(input.effort);
  const reversibility = bounded(input.reversibility);
  const attention = attentionWeight[input.attention] ?? 0.4;
  const observedAt = Date.parse(input.observedAt ?? now);
  const ageDays = Math.max(0, (Date.parse(now) - observedAt) / 86_400_000);
  const freshness = Math.max(0, 1 - ageDays / 30);
  const score =
    impact * 0.3 +
    confidence * 0.22 +
    (1 - effort) * 0.17 +
    reversibility * 0.1 +
    attention * 0.14 +
    freshness * 0.07;
  return Math.round(score * 100);
}

function isRecommendationEligible(input) {
  if (!['ignored', 'out-of-fleet'].includes(input.attention)) return true;
  return ['security', 'cost', 'data-loss', 'reactivation'].includes(input.risk);
}

export function recommendationEvent(input, context = {}) {
  if (!isRecommendationEligible(input)) return null;
  const score = scoreRecommendation(input, context);
  return {
    type: 'recommendation.created',
    actor: input.actor ?? { type: 'automation', id: 'foundry-learning', label: 'Foundry learning' },
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.missionId ? { missionId: input.missionId } : {}),
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.observedAt ?? context.now,
    payload: {
      title: input.title,
      rationale: input.rationale,
      impact: bounded(input.impact),
      confidence: bounded(input.confidence),
      effort: bounded(input.effort),
      reversibility: bounded(input.reversibility),
      attention: input.attention,
      score,
      ...(input.risk ? { risk: input.risk } : {}),
    },
    evidence: input.evidence ?? [],
  };
}

export function attributionReady(evidence = []) {
  const verifiedKinds = new Set(
    evidence.filter((pointer) => pointer.state === 'verified').map((pointer) => `${pointer.provider}:${pointer.kind}`),
  );
  return {
    ready:
      [...verifiedKinds].some((kind) => kind === 'github:commit' || kind === 'github:pull-request') &&
      verifiedKinds.has('github:workflow-run') &&
      verifiedKinds.has('cloudflare:deployment') &&
      [...verifiedKinds].some((kind) => kind.endsWith(':production-smoke')),
    verifiedKinds: [...verifiedKinds].sort(),
  };
}
