CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  project_id TEXT,
  objective_id TEXT,
  correlation_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_project_sequence
  ON events(project_id, sequence);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS projection_checkpoints (
  name TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL,
  rebuilt_at TEXT NOT NULL,
  projection_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_metadata (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
