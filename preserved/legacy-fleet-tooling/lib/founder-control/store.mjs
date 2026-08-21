import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  FounderControlValidationError,
  normalizeEvent,
  redactForExport,
} from './contracts.mjs';
import { buildProjections } from './projections.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(moduleDirectory, 'migrations', '001-initial.sql');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function backupDigest(events) {
  return createHash('sha256').update(stableJson(events)).digest('hex');
}

function rowToEvent(row) {
  return {
    sequence: row.sequence,
    schemaVersion: row.schema_version,
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actor: JSON.parse(row.actor_json),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.objective_id ? { objectiveId: row.objective_id } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    idempotencyKey: row.idempotency_key,
    visibility: row.visibility,
    payload: JSON.parse(row.payload_json),
    evidence: JSON.parse(row.evidence_json),
  };
}

function sameRequest(existing, input) {
  const comparable = {
    type: input.type,
    actor: input.actor,
    projectId: input.projectId,
    objectiveId: input.objectiveId,
    correlationId: input.correlationId,
    visibility: input.visibility ?? 'private',
    payload: input.payload ?? {},
    evidence: input.evidence ?? [],
  };
  const stored = {
    type: existing.type,
    actor: existing.actor,
    projectId: existing.projectId,
    objectiveId: existing.objectiveId,
    correlationId: existing.correlationId,
    visibility: existing.visibility,
    payload: existing.payload,
    evidence: existing.evidence,
  };
  return stableJson(comparable) === stableJson(stored);
}

export function defaultDatabasePath({ home = process.env.HOME } = {}) {
  if (!home) throw new Error('HOME is required to resolve the Founder control database path');
  return join(home, 'Library', 'Application Support', 'Fleet Ops', 'founder-control', 'foundry.sqlite');
}

export class FounderControlStore {
  constructor({ databasePath = defaultDatabasePath(), projects = [] } = {}) {
    this.databasePath = databasePath;
    this.projects = projects;
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec(readFileSync(migrationPath, 'utf8'));
      this.database
        .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)')
        .run(new Date().toISOString());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }

  getEventByIdempotencyKey(idempotencyKey) {
    const row = this.database.prepare('SELECT * FROM events WHERE idempotency_key = ?').get(idempotencyKey);
    return row ? rowToEvent(row) : null;
  }

  append(input, { now = new Date().toISOString() } = {}) {
    const existing = input?.idempotencyKey
      ? this.getEventByIdempotencyKey(input.idempotencyKey)
      : null;
    if (existing) {
      if (!sameRequest(existing, input)) {
        throw new FounderControlValidationError(
          'IDEMPOTENCY_CONFLICT',
          `idempotency key ${input.idempotencyKey} already belongs to another event`,
        );
      }
      return { event: existing, duplicate: true };
    }

    const event = normalizeEvent(input, { now });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(`
          INSERT INTO events (
            id, schema_version, type, occurred_at, recorded_at, actor_json,
            project_id, objective_id, correlation_id,
            idempotency_key, visibility, payload_json, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.id,
          event.schemaVersion,
          event.type,
          event.occurredAt,
          event.recordedAt,
          JSON.stringify(event.actor),
          event.projectId ?? null,
          event.objectiveId ?? null,
          event.correlationId ?? null,
          event.idempotencyKey,
          event.visibility,
          JSON.stringify(event.payload),
          JSON.stringify(event.evidence),
        );
      this.database
        .prepare('INSERT INTO idempotency_keys(idempotency_key, event_id, recorded_at) VALUES (?, ?, ?)')
        .run(event.idempotencyKey, event.id, event.recordedAt);
      this.database.exec('COMMIT');
      return { event, duplicate: false };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listEvents({ afterSequence = 0, limit = 10_000 } = {}) {
    return this.database
      .prepare('SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT ?')
      .all(afterSequence, limit)
      .map(rowToEvent);
  }

  rebuildProjections({ now = new Date().toISOString() } = {}) {
    const events = this.listEvents();
    const projections = buildProjections(events, { now, projects: this.projects });
    const checkpoint = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events').get();
    this.database
      .prepare(`
        INSERT INTO projection_checkpoints(name, last_sequence, rebuilt_at, projection_version)
        VALUES ('owner', ?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET
          last_sequence = excluded.last_sequence,
          rebuilt_at = excluded.rebuilt_at,
          projection_version = excluded.projection_version
      `)
      .run(checkpoint.sequence, now);
    return projections;
  }

  createBackup({ now = new Date().toISOString() } = {}) {
    const events = redactForExport(this.listEvents());
    return {
      format: 'fleet-founder-control-backup',
      version: 1,
      createdAt: now,
      eventCount: events.length,
      digest: backupDigest(events),
      events,
      backupDestination: 'not-configured',
    };
  }

  restoreBackup(backup) {
    verifyBackup(backup);
    const existingCount = this.database.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    if (existingCount > 0) throw new Error('restore requires an empty event ledger');
    for (const event of backup.events) this.append(event, { now: event.recordedAt });
    return this.rebuildProjections({ now: backup.createdAt });
  }
}

export function verifyBackup(backup) {
  if (!backup || backup.format !== 'fleet-founder-control-backup' || backup.version !== 1) {
    throw new Error('unsupported Founder control backup');
  }
  if (!Array.isArray(backup.events) || backup.eventCount !== backup.events.length) {
    throw new Error('backup event count does not match payload');
  }
  if (backup.digest !== backupDigest(backup.events)) throw new Error('backup digest mismatch');
  for (const event of backup.events) normalizeEvent(event, { now: event.recordedAt });
  return { valid: true, eventCount: backup.eventCount, digest: backup.digest };
}
