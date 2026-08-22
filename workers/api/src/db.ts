import type {
  AgentTokenRecord,
  AnyFeedbackStatus,
  FeedbackPageContext,
  FeedbackPinpoint,
  FeedbackRecord,
  FeedbackStatusEvent,
  FeedbackType,
  FeedbackVote,
  ProjectRecord,
  UpvoteRecord,
  UserRecord,
} from '@saas-maker/contracts';

type FeedbackQuery = {
  type?: FeedbackType;
  status?: AnyFeedbackStatus;
  since?: string;
  until?: string;
  sort?: 'newest' | 'upvotes';
  page?: number;
  limit?: number;
  cursor?: string;
};

type ProjectInput = {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  owner_id: string;
  source?: string;
  git_url?: string | null;
};

type FeedbackInput = {
  id: string;
  project_id: string;
  type: FeedbackType;
  status: AnyFeedbackStatus;
  title: string;
  description: string;
  image_url: string | null;
  submitter_email: string;
  submitter_name: string | null;
  page?: FeedbackPageContext | null;
  pinpoint?: FeedbackPinpoint | null;
  client_version?: string | null;
  source?: string | null;
};

export type AgentTokenRow = AgentTokenRecord & { token_hash: string; can_write_flag: number };

export interface FeedbackDatabase {
  upsertUser(input: Omit<UserRecord, 'created_at'>): Promise<UserRecord>;
  getUserById(id: string): Promise<UserRecord | null>;
  createProject(input: ProjectInput): Promise<ProjectRecord>;
  getProjectBySlug(slug: string): Promise<ProjectRecord | null>;
  getProjectByApiKey(apiKey: string): Promise<ProjectRecord | null>;
  getProjectById(id: string): Promise<ProjectRecord | null>;
  listProjectsByOwner(ownerId: string, source?: string): Promise<ProjectRecord[]>;
  updateProject(
    id: string,
    input: { name?: string; readme?: string; git_url?: string | null }
  ): Promise<ProjectRecord | null>;
  deleteProject(id: string): Promise<boolean>;
  createFeedback(input: FeedbackInput): Promise<FeedbackRecord>;
  getFeedbackById(id: string): Promise<FeedbackRecord | null>;
  listFeedback(
    projectId: string,
    query: FeedbackQuery,
    userId?: string
  ): Promise<{ data: FeedbackRecord[]; total: number; next_cursor: string | null }>;
  listFeedbackStatusEvents(feedbackId: string): Promise<FeedbackStatusEvent[]>;
  updateFeedbackStatus(
    id: string,
    status: AnyFeedbackStatus,
    actor: { actor_id: string; actor_kind: 'owner' | 'agent' }
  ): Promise<FeedbackRecord | null>;
  deleteFeedback(id: string): Promise<boolean>;
  setVote(input: {
    id: string;
    feedback_id: string;
    user_id: string;
    vote: 1 | -1;
  }): Promise<UpvoteRecord>;
  removeVote(feedbackId: string, userId: string): Promise<boolean>;
  getUserVote(feedbackId: string, userId: string): Promise<FeedbackVote>;
  createAgentToken(input: {
    id: string;
    project_id: string;
    token_hash: string;
    token_prefix: string;
    name: string;
    can_write: boolean;
  }): Promise<AgentTokenRecord>;
  listAgentTokens(projectId: string): Promise<AgentTokenRecord[]>;
  getAgentTokenByHash(tokenHash: string): Promise<AgentTokenRow | null>;
  touchAgentToken(id: string): Promise<void>;
  deleteAgentToken(id: string, projectId: string): Promise<boolean>;
}

function mapRow<T>(row: Record<string, unknown> | null | undefined): T | null {
  return row ? (row as T) : null;
}

function parseViewerVote(value: unknown): FeedbackVote {
  if (Number(value) === 1) return 'up';
  if (Number(value) === -1) return 'down';
  return null;
}

function parsePinpoint(value: unknown): FeedbackPinpoint | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as FeedbackPinpoint;
    if (!parsed || typeof parsed.selector !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}

export function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const [created_at, id] = atob(cursor).split('|');
    if (!created_at || !id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

function toAgentToken(row: Record<string, unknown>): AgentTokenRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    can_write: Number(row.can_write) === 1,
    token_prefix: String(row.token_prefix),
    created_at: String(row.created_at),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
  };
}

export function toFeedbackRecord(row: Record<string, unknown>): FeedbackRecord {
  const pageUrl = typeof row.page_url === 'string' ? row.page_url : null;
  const pageTitle = typeof row.page_title === 'string' ? row.page_title : null;
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    type: row.type as FeedbackType,
    status: row.status as AnyFeedbackStatus,
    title: String(row.title),
    description: String(row.description),
    image_url: row.image_url ? String(row.image_url) : null,
    submitter_email: row.submitter_email ? String(row.submitter_email) : '',
    submitter_name: row.submitter_name ? String(row.submitter_name) : null,
    upvote_count: Number(row.upvote_count ?? 0),
    downvote_count: Number(row.downvote_count ?? 0),
    viewer_vote: parseViewerVote(row.viewer_vote),
    page: pageUrl || pageTitle ? { url: pageUrl || '', title: pageTitle || '' } : null,
    pinpoint: parsePinpoint(row.pinpoint_json),
    client_version: row.client_version ? String(row.client_version) : null,
    source: row.source ? String(row.source) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    updated_by: row.updated_by ? String(row.updated_by) : null,
    created_at: String(row.created_at),
  };
}

export function getDb(d1: D1Database): FeedbackDatabase {
  return {
    async upsertUser(input) {
      await d1
        .prepare(
          `INSERT INTO users (id, email, name, avatar_url)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url`
        )
        .bind(input.id, input.email, input.name, input.avatar_url)
        .run();
      const row =
        (await d1.prepare('SELECT * FROM users WHERE id = ?').bind(input.id).first()) ??
        (await d1.prepare('SELECT * FROM users WHERE email = ?').bind(input.email).first());
      return mapRow<UserRecord>(row)!;
    },

    async getUserById(id) {
      return mapRow<UserRecord>(
        await d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
      );
    },

    async createProject(input) {
      await d1
        .prepare(
          `INSERT INTO projects (id, name, slug, api_key, owner_id, source, git_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.id,
          input.name,
          input.slug,
          input.api_key,
          input.owner_id,
          input.source || 'dashboard',
          input.git_url ?? null
        )
        .run();
      return mapRow<ProjectRecord>(
        await d1.prepare('SELECT * FROM projects WHERE id = ?').bind(input.id).first()
      )!;
    },

    async getProjectBySlug(slug) {
      return mapRow<ProjectRecord>(
        await d1.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first()
      );
    },

    async getProjectByApiKey(apiKey) {
      return mapRow<ProjectRecord>(
        await d1.prepare('SELECT * FROM projects WHERE api_key = ?').bind(apiKey).first()
      );
    },

    async getProjectById(id) {
      return mapRow<ProjectRecord>(
        await d1.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
      );
    },

    async listProjectsByOwner(ownerId, source = 'dashboard') {
      const statement =
        source === 'all'
          ? d1
              .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC')
              .bind(ownerId)
          : d1
              .prepare(
                'SELECT * FROM projects WHERE owner_id = ? AND source = ? ORDER BY created_at DESC'
              )
              .bind(ownerId, source);
      const { results } = await statement.all();
      return results as unknown as ProjectRecord[];
    },

    async updateProject(id, input) {
      const assignments: string[] = [];
      const values: unknown[] = [];
      if (input.name !== undefined) {
        assignments.push('name = ?');
        values.push(input.name);
      }
      if (input.readme !== undefined) {
        assignments.push('readme = ?');
        values.push(input.readme);
      }
      if (input.git_url !== undefined) {
        assignments.push('git_url = ?');
        values.push(input.git_url);
      }
      if (assignments.length > 0) {
        values.push(id);
        await d1
          .prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`)
          .bind(...values)
          .run();
      }
      return mapRow<ProjectRecord>(
        await d1.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
      );
    },

    async deleteProject(id) {
      const { meta } = await d1.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
      return (meta.changes ?? 0) > 0;
    },

    async createFeedback(input) {
      await d1
        .prepare(
          `INSERT INTO feedback
             (id, project_id, type, status, title, description, image_url, submitter_email, submitter_name,
              page_url, page_title, pinpoint_json, client_version, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.id,
          input.project_id,
          input.type,
          input.status,
          input.title,
          input.description,
          input.image_url,
          input.submitter_email,
          input.submitter_name,
          input.page?.url ?? null,
          input.page?.title ?? null,
          input.pinpoint ? JSON.stringify(input.pinpoint) : null,
          input.client_version ?? null,
          input.source ?? 'api'
        )
        .run();
      const row = await d1
        .prepare('SELECT *, NULL AS viewer_vote FROM feedback WHERE id = ?')
        .bind(input.id)
        .first();
      return toFeedbackRecord(row as Record<string, unknown>);
    },

    async getFeedbackById(id) {
      const row = await d1
        .prepare('SELECT *, NULL AS viewer_vote FROM feedback WHERE id = ?')
        .bind(id)
        .first();
      return row ? toFeedbackRecord(row as Record<string, unknown>) : null;
    },

    async listFeedback(projectId, query, userId) {
      const { type, status, since, until, sort = 'newest', page = 1, limit = 20, cursor } = query;
      const conditions = ['f.project_id = ?'];
      const values: unknown[] = [projectId];
      if (type) {
        conditions.push('f.type = ?');
        values.push(type);
      }
      if (status) {
        conditions.push('f.status = ?');
        values.push(status);
      }
      if (since) {
        conditions.push('f.created_at >= ?');
        values.push(since);
      }
      if (until) {
        conditions.push('f.created_at <= ?');
        values.push(until);
      }
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (decoded) {
        conditions.push('(f.created_at < ? OR (f.created_at = ? AND f.id < ?))');
        values.push(decoded.created_at, decoded.created_at, decoded.id);
      }
      const where = conditions.join(' AND ');
      const orderBy =
        sort === 'upvotes'
          ? 'f.upvote_count DESC, f.created_at DESC'
          : 'f.created_at DESC, f.id DESC';
      const offset = decoded ? 0 : (page - 1) * limit;
      const countStatement = d1
        .prepare(`SELECT COUNT(*) AS total FROM feedback f WHERE ${where}`)
        .bind(...values);
      const dataStatement = userId
        ? d1
            .prepare(
              `SELECT f.*, v.vote AS viewer_vote
               FROM feedback f
               LEFT JOIN feedback_votes v
                 ON v.feedback_id = f.id AND v.user_id = ?
               WHERE ${where}
               ORDER BY ${orderBy}
               LIMIT ? OFFSET ?`
            )
            .bind(userId, ...values, limit, offset)
        : d1
            .prepare(
              `SELECT f.*, NULL AS viewer_vote
               FROM feedback f
               WHERE ${where}
               ORDER BY ${orderBy}
               LIMIT ? OFFSET ?`
            )
            .bind(...values, limit, offset);
      const [countRow, dataResult] = await Promise.all([
        countStatement.first<{ total: number }>(),
        dataStatement.all(),
      ]);
      const data = (dataResult.results as Record<string, unknown>[]).map(toFeedbackRecord);
      const next_cursor =
        data.length === limit
          ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
          : null;
      return {
        data,
        total: Number(countRow?.total ?? 0),
        next_cursor,
      };
    },

    async listFeedbackStatusEvents(feedbackId) {
      const { results } = await d1
        .prepare(
          `SELECT * FROM feedback_status_events
           WHERE feedback_id = ?
           ORDER BY created_at ASC`
        )
        .bind(feedbackId)
        .all();
      return (results as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        feedback_id: String(row.feedback_id),
        from_status: row.from_status ? (row.from_status as AnyFeedbackStatus) : null,
        to_status: row.to_status as AnyFeedbackStatus,
        actor_id: String(row.actor_id),
        actor_kind: row.actor_kind as 'owner' | 'agent',
        created_at: String(row.created_at),
      }));
    },

    async updateFeedbackStatus(id, status, actor) {
      const existing = await d1
        .prepare('SELECT *, NULL AS viewer_vote FROM feedback WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      if (!existing) return null;

      await d1
        .prepare(
          `UPDATE feedback
           SET status = ?, updated_at = datetime('now'), updated_by = ?
           WHERE id = ?`
        )
        .bind(status, actor.actor_id, id)
        .run();
      await d1
        .prepare(
          `INSERT INTO feedback_status_events
             (id, feedback_id, from_status, to_status, actor_id, actor_kind)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          id,
          existing.status ?? null,
          status,
          actor.actor_id,
          actor.actor_kind
        )
        .run();

      const row = await d1
        .prepare('SELECT *, NULL AS viewer_vote FROM feedback WHERE id = ?')
        .bind(id)
        .first();
      return row ? toFeedbackRecord(row as Record<string, unknown>) : null;
    },

    async deleteFeedback(id) {
      const { meta } = await d1.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
      return (meta.changes ?? 0) > 0;
    },

    async setVote(input) {
      const existing = await d1
        .prepare('SELECT * FROM feedback_votes WHERE feedback_id = ? AND user_id = ?')
        .bind(input.feedback_id, input.user_id)
        .first<Record<string, unknown>>();

      if (!existing) {
        await d1
          .prepare(
            'INSERT INTO feedback_votes (id, feedback_id, user_id, vote) VALUES (?, ?, ?, ?)'
          )
          .bind(input.id, input.feedback_id, input.user_id, input.vote)
          .run();
        const counter = input.vote === 1 ? 'upvote_count' : 'downvote_count';
        await d1
          .prepare(`UPDATE feedback SET ${counter} = ${counter} + 1 WHERE id = ?`)
          .bind(input.feedback_id)
          .run();
        return (await d1
          .prepare('SELECT * FROM feedback_votes WHERE id = ?')
          .bind(input.id)
          .first()) as unknown as UpvoteRecord;
      }

      const existingVote = Number(existing.vote) as 1 | -1;
      if (existingVote === input.vote) return existing as unknown as UpvoteRecord;

      await d1
        .prepare('UPDATE feedback_votes SET vote = ? WHERE id = ?')
        .bind(input.vote, existing.id)
        .run();
      const decrement = existingVote === 1 ? 'upvote_count' : 'downvote_count';
      const increment = input.vote === 1 ? 'upvote_count' : 'downvote_count';
      await d1
        .prepare(
          `UPDATE feedback
           SET ${decrement} = MAX(${decrement} - 1, 0),
               ${increment} = ${increment} + 1
           WHERE id = ?`
        )
        .bind(input.feedback_id)
        .run();
      return (await d1
        .prepare('SELECT * FROM feedback_votes WHERE id = ?')
        .bind(existing.id)
        .first()) as unknown as UpvoteRecord;
    },

    async removeVote(feedbackId, userId) {
      const existing = await d1
        .prepare('SELECT * FROM feedback_votes WHERE feedback_id = ? AND user_id = ?')
        .bind(feedbackId, userId)
        .first<Record<string, unknown>>();
      if (!existing) return false;

      await d1.prepare('DELETE FROM feedback_votes WHERE id = ?').bind(existing.id).run();
      const counter = Number(existing.vote) === 1 ? 'upvote_count' : 'downvote_count';
      await d1
        .prepare(`UPDATE feedback SET ${counter} = MAX(${counter} - 1, 0) WHERE id = ?`)
        .bind(feedbackId)
        .run();
      return true;
    },

    async getUserVote(feedbackId, userId) {
      const row = await d1
        .prepare('SELECT vote FROM feedback_votes WHERE feedback_id = ? AND user_id = ?')
        .bind(feedbackId, userId)
        .first();
      return parseViewerVote(row?.vote);
    },

    async createAgentToken(input) {
      await d1
        .prepare(
          `INSERT INTO feedback_agent_tokens
             (id, project_id, token_hash, token_prefix, name, can_write)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.id,
          input.project_id,
          input.token_hash,
          input.token_prefix,
          input.name,
          input.can_write ? 1 : 0
        )
        .run();
      const row = await d1
        .prepare('SELECT * FROM feedback_agent_tokens WHERE id = ?')
        .bind(input.id)
        .first();
      return toAgentToken(row as Record<string, unknown>);
    },

    async listAgentTokens(projectId) {
      const { results } = await d1
        .prepare(
          `SELECT * FROM feedback_agent_tokens
           WHERE project_id = ?
           ORDER BY created_at DESC`
        )
        .bind(projectId)
        .all();
      return (results as Record<string, unknown>[]).map(toAgentToken);
    },

    async getAgentTokenByHash(tokenHash) {
      const row = await d1
        .prepare('SELECT * FROM feedback_agent_tokens WHERE token_hash = ?')
        .bind(tokenHash)
        .first<Record<string, unknown>>();
      if (!row) return null;
      return {
        ...toAgentToken(row),
        token_hash: String(row.token_hash),
        can_write_flag: Number(row.can_write),
      };
    },

    async touchAgentToken(id) {
      await d1
        .prepare(`UPDATE feedback_agent_tokens SET last_used_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run();
    },

    async deleteAgentToken(id, projectId) {
      const { meta } = await d1
        .prepare('DELETE FROM feedback_agent_tokens WHERE id = ? AND project_id = ?')
        .bind(id, projectId)
        .run();
      return (meta.changes ?? 0) > 0;
    },
  };
}

export const createDatabase = getDb;
