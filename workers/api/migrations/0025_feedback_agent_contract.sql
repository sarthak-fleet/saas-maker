-- Forward-only Feedback contract: page/pinpoint provenance, status audit, and
-- project-scoped agent tokens. Existing feedback rows are copied, not rewritten.

PRAGMA foreign_keys = OFF;

CREATE TABLE feedback_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug','feature','feedback')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','acknowledged','investigating','planned','in_progress','resolved','dismissed','on_roadmap',
    'done','shipped','cancelled','reviewing','closed'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  submitter_email TEXT NOT NULL,
  submitter_name TEXT,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  downvote_count INTEGER NOT NULL DEFAULT 0,
  page_url TEXT,
  page_title TEXT,
  pinpoint_json TEXT,
  client_version TEXT,
  source TEXT,
  updated_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO feedback_new (
  id, project_id, type, status, title, description, image_url,
  submitter_email, submitter_name, upvote_count, downvote_count, created_at
)
SELECT
  id, project_id, type, status, title, description, image_url,
  submitter_email, submitter_name, upvote_count, downvote_count, created_at
FROM feedback;

DROP TABLE feedback;
ALTER TABLE feedback_new RENAME TO feedback;

CREATE INDEX idx_feedback_project ON feedback(project_id);
CREATE INDEX idx_feedback_project_status ON feedback(project_id, status);
CREATE INDEX idx_feedback_project_upvotes ON feedback(project_id, upvote_count DESC);
CREATE INDEX idx_feedback_project_type_status ON feedback(project_id, type, status);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS feedback_status_events (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner','agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_status_events_feedback
  ON feedback_status_events(feedback_id, created_at);

CREATE TABLE IF NOT EXISTS feedback_agent_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent_tokens_project
  ON feedback_agent_tokens(project_id, created_at DESC);

PRAGMA foreign_keys = ON;
