import { open, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const CODEX_HOOK_LIMITS = Object.freeze({
  transcriptBytes: 2 * 1024 * 1024,
  transcriptLines: 4_000,
  transcriptLineBytes: 256 * 1024,
  toolInputBytes: 128 * 1024,
  skillsPerTurn: 16,
});

const READ_TOOL_PATTERN = /(?:^|[_-])(?:read|read-file|read-text-file|open-file)(?:$|[_-])/i;
const READ_COMMAND_PATTERN = /(?:^|[\s;&|([{"'`])(?:cat|sed|head|tail|less|more|bat|rg|grep|awk)(?=\s|$)/i;
const NON_READING_RG_PATTERN = /\brg\s+(?:[^;&|\n]*\s)?--files(?:\s|$)/i;
const SKILL_PATH_PATTERN = /(?:^|[^A-Za-z0-9._-])((?:foundry\/)?ops\/(?:teammates\/)?skills\/([A-Za-z0-9][A-Za-z0-9._/-]*)\/SKILL\.md)(?=$|[^A-Za-z0-9._/-])/g;

function scalar(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function firstScalar(...values) {
  for (const value of values) {
    const result = scalar(value);
    if (result) return result;
  }
  return null;
}

function eventBody(entry) {
  return entry?.payload && typeof entry.payload === 'object'
    ? entry.payload
    : entry;
}

function eventTurnId(entry) {
  const body = eventBody(entry);
  return firstScalar(
    entry?.turn_id,
    entry?.turnId,
    entry?.internal_chat_message_metadata_passthrough?.turn_id,
    body?.turn_id,
    body?.turnId,
    body?.internal_chat_message_metadata_passthrough?.turn_id,
  );
}

function isTurnBoundary(entry) {
  const body = eventBody(entry);
  return (
    entry?.type === 'turn_context'
    || ['task_started', 'task_complete'].includes(body?.type)
  );
}

function toolCall(entry) {
  const body = eventBody(entry);
  if (!['custom_tool_call', 'function_call', 'tool_call'].includes(body?.type)) {
    return null;
  }
  return {
    name: firstScalar(body.name, body.tool_name, body.tool) ?? '',
    input: body.input ?? body.arguments ?? body.params ?? body.parameters ?? '',
  };
}

function boundedText(value, maxBytes) {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return Buffer.byteLength(text) <= maxBytes ? text : '';
}

function isLikelyReadCall(call, input) {
  if (READ_TOOL_PATTERN.test(call.name)) return true;
  if (!/(?:exec|shell|bash|command|terminal)/i.test(call.name)) return false;

  const matches = [...input.matchAll(new RegExp(READ_COMMAND_PATTERN.source, 'gi'))]
    .map((match) => match[0].trim().toLowerCase());
  if (matches.length === 0) return false;
  return matches.some((command) => (
    !command.endsWith('rg') || !NON_READING_RG_PATTERN.test(input)
  ));
}

function detectedSkills(call, limits) {
  const input = boundedText(call.input, limits.toolInputBytes);
  if (!input || !isLikelyReadCall(call, input)) return [];

  const normalized = input.replaceAll('\\', '/');
  const skills = [];
  for (const match of normalized.matchAll(SKILL_PATH_PATTERN)) {
    const relativeDirectory = match[2];
    const segments = relativeDirectory.split('/');
    if (
      segments.length > 8
      || segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      continue;
    }
    const path = match[1].startsWith('foundry/')
      ? match[1]
      : `foundry/${match[1]}`;
    skills.push({
      id: segments.at(-1),
      path,
    });
  }
  return skills;
}

function transcriptMetadata(entries, targetTurnId) {
  let activeTurnId = null;
  let sessionId = null;
  let context = null;
  let startedAt = null;
  let finishedAt = null;

  for (const entry of entries) {
    const body = eventBody(entry);
    if (entry?.type === 'session_meta') {
      sessionId = firstScalar(body?.id, body?.session_id, sessionId);
    }

    const explicitTurnId = eventTurnId(entry);
    if (isTurnBoundary(entry) && explicitTurnId) activeTurnId = explicitTurnId;
    const belongsToTurn = explicitTurnId
      ? explicitTurnId === targetTurnId
      : activeTurnId === targetTurnId;
    if (!belongsToTurn) continue;

    if (entry?.type === 'turn_context') {
      context = body;
      startedAt ??= scalar(entry?.timestamp);
    }
    if (body?.type === 'task_started') {
      startedAt = firstScalar(body.started_at, entry?.timestamp, startedAt);
    }
    if (body?.type === 'task_complete') {
      finishedAt = firstScalar(body.completed_at, entry?.timestamp, finishedAt);
    }
  }

  return { context, finishedAt, sessionId, startedAt };
}

function currentTurnId(payload, entries) {
  const fromPayload = firstScalar(
    payload?.turn_id,
    payload?.turnId,
    payload?.internal_chat_message_metadata_passthrough?.turn_id,
  );
  if (fromPayload) return fromPayload;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isTurnBoundary(entries[index])) continue;
    const turnId = eventTurnId(entries[index]);
    if (turnId) return turnId;
  }
  return null;
}

function skillsForTurn(entries, targetTurnId, limits) {
  let activeTurnId = null;
  const detected = new Map();

  for (const entry of entries) {
    const explicitTurnId = eventTurnId(entry);
    if (isTurnBoundary(entry) && explicitTurnId) activeTurnId = explicitTurnId;

    const call = toolCall(entry);
    if (!call) continue;
    const belongsToTurn = explicitTurnId
      ? explicitTurnId === targetTurnId
      : activeTurnId === targetTurnId;
    if (!belongsToTurn) continue;

    for (const skill of detectedSkills(call, limits)) {
      const existing = detected.get(skill.id);
      if (existing && existing.path !== skill.path) return null;
      detected.set(skill.id, skill);
      if (detected.size > limits.skillsPerTurn) return null;
    }
  }

  return [...detected.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function projectIdFor(payload, cwd) {
  const explicit = firstScalar(payload?.project_id, payload?.projectId);
  if (explicit) return explicit;
  if (!cwd) return null;
  const name = basename(resolve(cwd));
  return name && name !== '/' ? name : null;
}

function isoNow(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  return scalar(value) ?? new Date().toISOString();
}

async function readTranscript(path, limits) {
  const info = await stat(path);
  if (!info.isFile()) return [];

  const byteCount = Math.min(info.size, limits.transcriptBytes);
  const start = Math.max(0, info.size - byteCount);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) return [];
      text = text.slice(firstNewline + 1);
    }

    const lines = text.split(/\r?\n/).slice(-limits.transcriptLines);
    const entries = [];
    for (const line of lines) {
      if (
        !line.trim()
        || Buffer.byteLength(line) > limits.transcriptLineBytes
      ) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          entries.push(entry);
        }
      } catch {
        // Transcript lines are advisory and may be partial or from a newer format.
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}

export async function collectCodexSkillRunRequests(payload, options = {}) {
  try {
    const event = firstScalar(payload?.hook_event_name, payload?.event);
    if (event !== 'Stop') return { reason: 'ignored-event', requests: [] };

    const output = nonEmptyText(payload?.last_assistant_message);
    const transcriptPath = scalar(payload?.transcript_path);
    if (!output || !transcriptPath) {
      return { reason: 'incomplete-hook-payload', requests: [] };
    }

    const limits = { ...CODEX_HOOK_LIMITS, ...options.limits };
    const entries = await (options.readTranscript ?? readTranscript)(
      transcriptPath,
      limits,
    );
    const turnId = currentTurnId(payload, entries);
    if (!turnId) return { reason: 'ambiguous-turn', requests: [] };

    const skills = skillsForTurn(entries, turnId, limits);
    if (!skills || skills.length === 0) {
      return { reason: skills ? 'no-skill-read' : 'ambiguous-skills', requests: [] };
    }

    const transcript = transcriptMetadata(entries, turnId);
    const sessionId = firstScalar(payload?.session_id, payload?.sessionId, transcript.sessionId);
    const cwd = firstScalar(payload?.cwd, transcript.context?.cwd);
    const model = firstScalar(payload?.model, transcript.context?.model);
    const projectId = projectIdFor(payload, cwd);
    if (!sessionId || !cwd || !projectId) {
      return { reason: 'incomplete-run-identity', requests: [] };
    }

    const now = isoNow(options.now ?? (() => new Date()));
    const startedAt = firstScalar(payload?.started_at, transcript.startedAt, now);
    const finishedAt = firstScalar(payload?.finished_at, transcript.finishedAt, now);
    const correlationId = `codex:${sessionId}:${turnId}`;
    const requests = skills.map((skill) => ({
      run: {
        skillId: skill.id,
        projectId,
        actor: 'codex',
        source: 'codex-hook',
        captureCompleteness: 'final-response',
        observedAt: finishedAt,
        startedAt,
        finishedAt,
        status: 'succeeded',
        idempotencyKey: `${correlationId}:${skill.id}`,
        correlationId,
        sourceReference: correlationId,
        metadata: {
          sessionId,
          turnId,
          cwd,
          ...(model ? { model } : {}),
          skillPath: skill.path,
        },
      },
      output,
      metrics: [],
    }));
    return { reason: 'ready', requests };
  } catch {
    return { reason: 'hook-error', requests: [] };
  }
}

export async function handleCodexStopHook(payload, options = {}) {
  const collected = await collectCodexSkillRunRequests(payload, options);
  if (collected.requests.length === 0 || typeof options.record !== 'function') {
    return {
      reason: collected.requests.length === 0
        ? collected.reason
        : 'recorder-unavailable',
      attempted: 0,
      recorded: 0,
    };
  }

  const outcomes = await Promise.allSettled(
    collected.requests.map((request) => options.record(request)),
  );
  return {
    reason: outcomes.every((outcome) => outcome.status === 'fulfilled')
      ? 'recorded'
      : 'recording-failed',
    attempted: outcomes.length,
    recorded: outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
  };
}
