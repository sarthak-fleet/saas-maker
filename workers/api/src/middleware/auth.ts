import { createMiddleware } from 'hono/factory';
import { getDb } from '../db';
import { sha256Hex } from '../lib/crypto';
import { apiError } from '../lib/errors';
import { Bindings, Variables } from '../types';

const DEFAULT_LOCAL_SESSION_TOKEN = 'local-dev-session';

async function resolveLocalSession(c: { env: Bindings }, token: string): Promise<string | null> {
  const expectedToken = c.env.SAASMAKER_LOCAL_SESSION_TOKEN || DEFAULT_LOCAL_SESSION_TOKEN;
  if (c.env.LOCAL_AUTH_BYPASS !== 'true' || token !== expectedToken) return null;

  const db = getDb(c.env.DB);
  const user = await db.upsertUser({
    id: 'local-dev',
    email: 'local@saasmaker.dev',
    name: 'Local Dev',
    avatar_url: null,
  });
  return user.id;
}

/**
 * Resolve a better-auth opaque session token (issued by the cockpit) against
 * the shared D1 `session` table. Mirrors the user into the API's `users` table
 * so downstream handlers can key off `users.id`.
 *
 * Returns the resolved user id, or null if the token is unknown / expired.
 */
async function resolveBetterAuthSession(
  c: { env: Bindings },
  token: string
): Promise<string | null> {
  const row = await c.env.DB.prepare(
    `SELECT s.userId, s.expiresAt, u.email, u.name, u.image
     FROM session s
     JOIN user u ON u.id = s.userId
     WHERE s.token = ?`
  )
    .bind(token)
    .first<{
      userId: string;
      expiresAt: string | number;
      email: string;
      name: string | null;
      image: string | null;
    }>();
  if (!row) return null;
  // expiresAt is a unix-timestamp (better-auth sqlite mode: 'timestamp' = seconds)
  const expiresMs =
    typeof row.expiresAt === 'number' ? row.expiresAt * 1000 : Date.parse(String(row.expiresAt));
  if (Number.isFinite(expiresMs) && expiresMs < Date.now()) return null;

  const db = getDb(c.env.DB);
  const user = await db.upsertUser({
    id: row.userId,
    email: row.email,
    name: row.name,
    avatar_url: row.image,
  });
  return user.id;
}

/**
 * Resolve a better-auth session token to a user id, or null.
 */
export async function resolveBearerUserId(
  c: { env: Bindings },
  token: string
): Promise<string | null> {
  const localUserId = await resolveLocalSession(c, token);
  if (localUserId) return localUserId;

  return resolveBetterAuthSession(c, token);
}

export const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return apiError(c, 401, 'unauthorized', 'Unauthorized');
    }

    const userId = await resolveBearerUserId(c, authHeader.slice(7));
    if (!userId) return apiError(c, 401, 'unauthorized', 'Unauthorized');

    c.set('userId', userId);
    c.set('actorKind', 'owner');
    c.set('canWrite', true);
    await next();
  }
);

export const requireInboxAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return apiError(c, 401, 'unauthorized', 'Unauthorized');
    }

    const token = authHeader.slice(7);
    if (token.startsWith('smk_')) {
      const db = getDb(c.env.DB);
      const agent = await db.getAgentTokenByHash(await sha256Hex(token));
      if (!agent) return apiError(c, 401, 'unauthorized', 'Unauthorized');
      const project = await db.getProjectById(agent.project_id);
      if (!project) return apiError(c, 401, 'unauthorized', 'Unauthorized');
      await db.touchAgentToken(agent.id);
      c.set('userId', project.owner_id);
      c.set('projectId', project.id);
      c.set('project', project);
      c.set('actorKind', 'agent');
      c.set('canWrite', agent.can_write);
      c.set('agentTokenId', agent.id);
      return next();
    }

    const userId = await resolveBearerUserId(c, token);
    if (!userId) return apiError(c, 401, 'unauthorized', 'Unauthorized');
    c.set('userId', userId);
    c.set('actorKind', 'owner');
    c.set('canWrite', true);
    await next();
  }
);

export const requireApiKeyOrSession = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const apiKey = c.req.header('X-Project-Key');
  if (apiKey) {
    const db = getDb(c.env.DB);
    const project = await db.getProjectByApiKey(apiKey);
    if (!project) return apiError(c, 401, 'unauthorized', 'Invalid API key');
    c.set('projectId', project.id);
    c.set('project', project);
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError(c, 401, 'unauthorized', 'Unauthorized');
  }

  const userId = await resolveBearerUserId(c, authHeader.slice(7));
  if (!userId) return apiError(c, 401, 'unauthorized', 'Unauthorized');

  c.set('userId', userId);
  await next();
});

export const requireApiKey = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const apiKey = c.req.header('X-Project-Key');
    if (!apiKey) return apiError(c, 401, 'unauthorized', 'Missing X-Project-Key header');

    const db = getDb(c.env.DB);
    const project = await db.getProjectByApiKey(apiKey);
    if (!project) return apiError(c, 401, 'unauthorized', 'Invalid API key');

    c.set('projectId', project.id);
    c.set('project', project);
    await next();
  }
);
