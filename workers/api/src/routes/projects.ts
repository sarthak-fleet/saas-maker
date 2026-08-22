import type { ProjectRecord } from '@saas-maker/contracts';
import { Hono } from 'hono';
import { getDb } from '../db';
import { buildCacheKey, tryCacheMatch, withCachePut } from '../edge-cache';
import { randomToken, sha256Hex } from '../lib/crypto';
import { apiError } from '../lib/errors';
import { capture, trace } from '../lib/telemetry';
import { requireSession } from '../middleware/auth';
import { Bindings, type AppContext, Variables } from '../types';

const projects = new Hono<{ Bindings: Bindings; Variables: Variables }>();
projects.use('*', requireSession);

function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    'pk_' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type ProjectRow = ProjectRecord & {
  embedding_model?: string | null;
  ai_base_url?: string | null;
  ai_api_key?: string | null;
  ai_model?: string | null;
};

function toPublicProject(project: ProjectRow) {
  const {
    ai_api_key: _apiKey,
    ai_base_url: _baseUrl,
    ai_model: _model,
    embedding_model: _embeddingModel,
    ...safeProject
  } = project;
  return safeProject;
}

projects.get('/', async (c) => {
  const userId = c.get('userId')!;
  const source = c.req.query('source') || 'dashboard';
  const cacheKey = buildCacheKey('projects/list', `${userId}:${source}:v1`);

  const hit = await tryCacheMatch(cacheKey);
  if (hit) return hit;

  const db = getDb(c.env.DB);
  const data = await trace<ProjectRow[]>(
    'db:listProjects',
    () => db.listProjectsByOwner(userId, source) as Promise<ProjectRow[]>,
    { projectId: 'saasmaker-api' }
  );
  const response = c.json({ data: data.map((project) => toPublicProject(project)) });
  return withCachePut(c, cacheKey, response, 60);
});

const VALID_SOURCES = ['dashboard', 'linkchat'];

projects.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = (await c.req.json()) as { name: string; source?: string; git_url?: string };
  if (!body.name?.trim()) return apiError(c, 400, 'invalid_request', 'Project name is required');

  const source = body.source || 'dashboard';
  if (!VALID_SOURCES.includes(source)) {
    return apiError(
      c,
      400,
      'invalid_request',
      `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    );
  }

  const gitUrl = body.git_url?.trim() || null;

  const db = getDb(c.env.DB);
  const project = await db.createProject({
    id: crypto.randomUUID(),
    name: body.name.trim(),
    slug: `${slugify(body.name)}-${Date.now().toString(36)}`,
    api_key: generateApiKey(),
    owner_id: userId,
    source,
    git_url: gitUrl,
  });

  capture({
    distinctId: userId,
    event: 'project_created',
    properties: { project_id: project.id, project_name: project.name, source },
  });

  return c.json(toPublicProject(project), 201);
});

projects.get('/by-slug/:slug', async (c) => {
  const userId = c.get('userId')!;
  const slug = c.req.param('slug');
  const db = getDb(c.env.DB);
  const project = await db.getProjectBySlug(slug);
  if (!project || project.owner_id !== userId) return apiError(c, 404, 'not_found', 'Not found');
  return c.json(toPublicProject(project));
});

projects.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const projectId = c.req.param('id');
  const body = (await c.req.json()) as {
    name?: string;
    readme?: string;
    git_url?: string | null;
  };

  const db = getDb(c.env.DB);

  // Verify ownership
  const existing = await db.getProjectById(projectId);
  if (!existing) return apiError(c, 404, 'not_found', 'Project not found');
  if (existing.owner_id !== userId) return apiError(c, 403, 'forbidden', 'Forbidden');

  const gitUrl = body.git_url === undefined ? undefined : body.git_url?.trim?.() || null;

  const updated = await db.updateProject(projectId, {
    name: body.name,
    readme: body.readme,
    git_url: gitUrl,
  });
  if (!updated) return apiError(c, 404, 'not_found', 'Project not found');
  capture({ distinctId: userId, event: 'project_updated', properties: { project_id: projectId } });
  return c.json(toPublicProject(updated));
});

projects.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const projectId = c.req.param('id');

  const db = getDb(c.env.DB);

  // Verify ownership
  const existing = await db.getProjectById(projectId);
  if (!existing) return apiError(c, 404, 'not_found', 'Project not found');
  if (existing.owner_id !== userId) return apiError(c, 403, 'forbidden', 'Forbidden');

  await db.deleteProject(projectId);
  capture({
    distinctId: userId,
    event: 'project_deleted',
    properties: { project_id: projectId, project_name: existing.name },
  });
  return c.json({ ok: true });
});

async function ownedProject(c: AppContext, projectId: string) {
  const db = getDb(c.env.DB);
  const project = await db.getProjectById(projectId);
  if (!project) return { error: apiError(c, 404, 'not_found', 'Project not found') };
  if (project.owner_id !== c.get('userId'))
    return { error: apiError(c, 403, 'forbidden', 'Forbidden') };
  return { project, db };
}

projects.get('/:id/agent-tokens', async (c) => {
  const owned = await ownedProject(c, c.req.param('id'));
  if ('error' in owned) return owned.error;
  return c.json({ data: await owned.db.listAgentTokens(owned.project.id) });
});

projects.post('/:id/agent-tokens', async (c) => {
  const owned = await ownedProject(c, c.req.param('id'));
  if ('error' in owned) return owned.error;
  let body: { name?: string; can_write?: boolean };
  try {
    body = (await c.req.json()) as { name?: string; can_write?: boolean };
  } catch {
    return apiError(c, 400, 'invalid_request', 'Request body must be JSON');
  }
  const name = body.name?.trim();
  if (!name) return apiError(c, 400, 'invalid_request', 'Token name is required');

  const plaintext = randomToken('smk_');
  const token = await owned.db.createAgentToken({
    id: crypto.randomUUID(),
    project_id: owned.project.id,
    token_hash: await sha256Hex(plaintext),
    token_prefix: plaintext.slice(0, 8),
    name,
    can_write: body.can_write === true,
  });
  return c.json({ ...token, token: plaintext }, 201);
});

projects.delete('/:id/agent-tokens/:tokenId', async (c) => {
  const owned = await ownedProject(c, c.req.param('id'));
  if ('error' in owned) return owned.error;
  const deleted = await owned.db.deleteAgentToken(c.req.param('tokenId'), owned.project.id);
  if (!deleted) return apiError(c, 404, 'not_found', 'Token not found');
  return c.json({ ok: true });
});

export { projects };
