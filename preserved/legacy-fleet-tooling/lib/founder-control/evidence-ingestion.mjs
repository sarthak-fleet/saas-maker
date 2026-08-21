const SAFE_RECEIPT_FIELDS = new Set([
  'missionId',
  'projectId',
  'stage',
  'provider',
  'kind',
  'id',
  'state',
  'observedAt',
  'freshUntil',
  'url',
  'summary',
  'confidence',
]);

const MARKETING_STAGES = new Set([
  'source-package',
  'approval',
  'render',
  'postiz',
  'publication',
  'measurement',
]);

function assertSafeReceiptShape(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('evidence receipt must be an object');
  }
  const unsupported = Object.keys(receipt).filter((field) => !SAFE_RECEIPT_FIELDS.has(field));
  if (unsupported.length > 0) {
    throw new Error(`evidence receipt contains unsupported fields: ${unsupported.join(', ')}`);
  }
  for (const field of ['missionId', 'projectId', 'provider', 'kind', 'id', 'state', 'observedAt']) {
    if (!receipt[field]) throw new Error(`evidence receipt requires ${field}`);
  }
}

function evidencePointer(receipt) {
  return {
    provider: receipt.provider,
    kind: receipt.kind,
    id: receipt.id,
    state: receipt.state,
    observedAt: receipt.observedAt,
    ...(receipt.freshUntil ? { freshUntil: receipt.freshUntil } : {}),
    ...(receipt.url ? { url: receipt.url } : {}),
    ...(receipt.summary ? { summary: receipt.summary } : {}),
    ...(receipt.confidence !== undefined ? { confidence: receipt.confidence } : {}),
  };
}

function appendCurrentEvidence(store, receipt, { actorId = 'current-evidence-backfill' } = {}) {
  assertSafeReceiptShape(receipt);
  if (!store.getMissionState(receipt.missionId)) {
    throw new Error(`cannot attach evidence to unknown mission ${receipt.missionId}`);
  }
  return store.append(
    {
      type: 'evidence.recorded',
      actor: { type: 'automation', id: actorId, label: 'Current evidence backfill' },
      missionId: receipt.missionId,
      projectId: receipt.projectId,
      idempotencyKey: `current-evidence/${receipt.missionId}/${receipt.provider}/${receipt.kind}/${receipt.id}`,
      occurredAt: receipt.observedAt,
      payload: {
        summary: `Current ${receipt.provider} ${receipt.kind} evidence`,
        backfill: true,
      },
      evidence: [evidencePointer(receipt)],
    },
    { now: receipt.observedAt },
  );
}

export function appendCurrentEvidenceBatch(store, document) {
  if (!document || document.version !== 1 || !Array.isArray(document.receipts)) {
    throw new Error('current evidence document requires version 1 and receipts');
  }
  const results = document.receipts.map((receipt) => appendCurrentEvidence(store, receipt));
  return {
    received: results.length,
    appended: results.filter((result) => !result.duplicate).length,
    duplicates: results.filter((result) => result.duplicate).length,
  };
}

export function appendMarketingReceipt(store, receipt) {
  assertSafeReceiptShape(receipt);
  if (!MARKETING_STAGES.has(receipt.stage)) {
    throw new Error(`unsupported marketing receipt stage: ${receipt.stage}`);
  }
  if (!store.getMissionState(receipt.missionId)) {
    throw new Error(`cannot attach marketing receipt to unknown mission ${receipt.missionId}`);
  }
  return store.append(
    {
      type: 'evidence.recorded',
      actor: { type: 'provider', id: receipt.provider, label: receipt.provider },
      missionId: receipt.missionId,
      projectId: receipt.projectId,
      idempotencyKey: `marketing-receipt/${receipt.missionId}/${receipt.stage}/${receipt.provider}/${receipt.id}`,
      occurredAt: receipt.observedAt,
      payload: {
        summary: `Marketing ${receipt.stage} receipt`,
        stage: receipt.stage,
      },
      evidence: [evidencePointer(receipt)],
    },
    { now: receipt.observedAt },
  );
}

export const marketingReceiptStages = Object.freeze([...MARKETING_STAGES]);
