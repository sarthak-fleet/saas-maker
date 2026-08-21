const PROVIDER_TTLS = {
  github: 15 * 60_000,
  cloudflare: 15 * 60_000,
  postiz: 60 * 60_000,
  drank: 24 * 60 * 60_000,
  'psi-swarm': 24 * 60 * 60_000,
  codevetter: 24 * 60 * 60_000,
  'app-health': 15 * 60_000,
};

function compactSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return {};
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 12),
  );
}

export function evidencePointer(
  provider,
  { kind, id, observedAt = new Date().toISOString(), url, summary, confidence = 1, available = true, ttlMs },
) {
  const resolvedTtl = ttlMs ?? PROVIDER_TTLS[provider] ?? 60 * 60_000;
  return {
    provider,
    kind,
    id,
    state: available ? 'verified' : 'unavailable',
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + resolvedTtl).toISOString(),
    ...(url ? { url } : {}),
    summary: available ? compactSummary(summary) : { reason: String(summary?.reason ?? 'provider unavailable') },
    confidence: available ? confidence : 0,
  };
}

export function githubEvidence(input) {
  const allowedKinds = new Set(['commit', 'pull-request', 'release', 'workflow-run']);
  if (!allowedKinds.has(input.kind)) throw new Error(`unsupported GitHub evidence kind: ${input.kind}`);
  return evidencePointer('github', input);
}

export function cloudflareEvidence(input) {
  const allowedKinds = new Set(['deployment', 'domain']);
  if (!allowedKinds.has(input.kind)) throw new Error(`unsupported Cloudflare evidence kind: ${input.kind}`);
  return evidencePointer('cloudflare', input);
}

function postizEvidence(input) {
  return evidencePointer('postiz', input);
}

function drankEvidence(input) {
  return evidencePointer('drank', input);
}

function psiSwarmEvidence(input) {
  return evidencePointer('psi-swarm', input);
}

function codeVetterEvidence(input) {
  return evidencePointer('codevetter', input);
}

function appHealthEvidence(input) {
  return evidencePointer('app-health', input);
}

export async function collectEvidence(adapter, input, { attempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await adapter(input);
    } catch (error) {
      lastError = error;
    }
  }
  return evidencePointer(input.provider, {
    kind: input.kind,
    id: input.id,
    observedAt: input.observedAt,
    available: false,
    summary: { reason: lastError?.message ?? 'provider unavailable' },
  });
}
