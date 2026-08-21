export type ActorKind = "owner" | "agent" | "automation" | "provider";
export type Visibility = "private" | "aggregate-public";
export type VerificationState = "verified" | "unverified" | "stale" | "unavailable";

export type ActorRef = {
  type: ActorKind;
  id: string;
  label?: string;
};

export type EvidencePointer = {
  provider: string;
  kind: string;
  id: string;
  state: VerificationState;
  observedAt: string;
  freshUntil?: string;
  url?: string;
  summary?: Record<string, string | number | boolean>;
  confidence?: number;
};

export type FoundryEvent = {
  sequence?: number;
  schemaVersion: 1;
  id: string;
  type: string;
  occurredAt: string;
  recordedAt: string;
  actor: ActorRef;
  projectId?: string;
  objectiveId?: string;
  correlationId?: string;
  idempotencyKey: string;
  visibility: Visibility;
  payload: Record<string, unknown>;
  evidence: EvidencePointer[];
};

export type OutcomeVerdict = "supported" | "unsupported" | "mixed" | "not-yet-measurable";

export function normalizeEvent(input: Partial<FoundryEvent>, options?: { now?: string }): FoundryEvent;
export function redactForExport(value: unknown): unknown;
