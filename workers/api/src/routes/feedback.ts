import type {
  AnyFeedbackStatus,
  FeedbackPinpoint,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackType,
  SubmitFeedbackRequest,
} from '@saas-maker/contracts';
import { Hono, type Context } from 'hono';
import { getDb } from '../db';
import { apiError } from '../lib/errors';
import { storeScreenshot } from '../lib/screenshots';
import { requireApiKey, requireInboxAuth } from '../middleware/auth';
import type { Bindings, Variables } from '../types';

const feedback = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const VALID_TYPES: FeedbackType[] = ['bug', 'feature', 'feedback'];
const VALID_STATUSES: FeedbackStatus[] = [
  'new',
  'acknowledged',
  'investigating',
  'planned',
  'in_progress',
  'resolved',
  'dismissed',
  'on_roadmap',
];
const PAGE_SIZE = 20;

function isValidStatus(status: string): status is FeedbackStatus {
  return VALID_STATUSES.includes(status as FeedbackStatus);
}

function isValidType(type: string): type is FeedbackType {
  return VALID_TYPES.includes(type as FeedbackType);
}

function queryOptions(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const type = c.req.query('type') as FeedbackType | undefined;
  const status = c.req.query('status') as AnyFeedbackStatus | undefined;
  const since = c.req.query('since') || undefined;
  const until = c.req.query('until') || undefined;
  const cursor = c.req.query('cursor') || undefined;
  const page = Number.parseInt(c.req.query('page') || '1', 10);
  return {
    type,
    status,
    since,
    until,
    cursor,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function parsePinpoint(value: unknown): FeedbackPinpoint | null {
  if (!value || typeof value !== 'object') return null;
  const anchor = value as FeedbackPinpoint;
  if (typeof anchor.selector !== 'string' || !anchor.selector.trim()) return null;
  return {
    selector: anchor.selector.trim(),
    tag: typeof anchor.tag === 'string' ? anchor.tag : null,
    text: typeof anchor.text === 'string' ? anchor.text : '',
    source: typeof anchor.source === 'string' ? anchor.source : null,
    url: typeof anchor.url === 'string' ? anchor.url : '',
  };
}

async function readSubmission(
  c: Context<{ Bindings: Bindings; Variables: Variables }>
): Promise<{ body: SubmitFeedbackRequest; screenshot: File | null } | Response> {
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const raw = form.get('feedback');
    if (typeof raw !== 'string' || !raw.trim()) {
      return apiError(c, 400, 'invalid_request', 'feedback JSON field is required');
    }
    try {
      const body = JSON.parse(raw) as SubmitFeedbackRequest;
      const screenshot = form.get('screenshot');
      return { body, screenshot: screenshot instanceof File ? screenshot : null };
    } catch {
      return apiError(c, 400, 'invalid_request', 'feedback field must be valid JSON');
    }
  }

  try {
    const body = (await c.req.json()) as SubmitFeedbackRequest;
    return { body, screenshot: null };
  } catch {
    return apiError(c, 400, 'invalid_request', 'Request body must be JSON');
  }
}

async function listAuthorizedFeedback(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  projectHint?: string
) {
  const userId = c.get('userId')!;
  const actorKind = c.get('actorKind') || 'owner';
  const { type, status, since, until, cursor, page } = queryOptions(c);
  if (type && !isValidType(type)) return apiError(c, 400, 'invalid_request', 'Invalid type filter');
  if (
    status &&
    !isValidStatus(status) &&
    status !== 'done' &&
    status !== 'shipped' &&
    status !== 'cancelled'
  ) {
    return apiError(c, 400, 'invalid_request', 'Invalid status filter');
  }

  const db = getDb(c.env.DB);
  const requestedProject = projectHint || c.req.query('project') || undefined;

  if (actorKind === 'agent') {
    const agentProjectId = c.get('projectId')!;
    if (requestedProject && requestedProject !== agentProjectId) {
      const named = await db.getProjectBySlug(requestedProject);
      if (!named || named.id !== agentProjectId) {
        return apiError(c, 403, 'forbidden', 'Forbidden');
      }
    }
    const result = await db.listFeedback(
      agentProjectId,
      { type, status, since, until, cursor, sort: 'newest', page, limit: PAGE_SIZE },
      userId
    );
    return c.json({
      data: result.data,
      total: result.total,
      page,
      limit: PAGE_SIZE,
      next_cursor: result.next_cursor,
    });
  }

  if (requestedProject) {
    const project =
      (await db.getProjectById(requestedProject)) ?? (await db.getProjectBySlug(requestedProject));
    if (!project || project.owner_id !== userId) return apiError(c, 403, 'forbidden', 'Forbidden');
    const result = await db.listFeedback(
      project.id,
      { type, status, since, until, cursor, sort: 'newest', page, limit: PAGE_SIZE },
      userId
    );
    return c.json({
      data: result.data,
      total: result.total,
      page,
      limit: PAGE_SIZE,
      next_cursor: result.next_cursor,
    });
  }

  const projects = await db.listProjectsByOwner(userId, 'dashboard');
  const perProject = await Promise.all(
    projects.map((project) =>
      db.listFeedback(
        project.id,
        { type, status, since, until, sort: 'newest', page: 1, limit: PAGE_SIZE * page },
        userId
      )
    )
  );
  const data: Array<FeedbackRecord & { project_name: string; project_slug: string }> = [];
  projects.forEach((project, index) => {
    for (const item of perProject[index].data) {
      data.push({ ...item, project_name: project.name, project_slug: project.slug });
    }
  });
  data.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const offset = (page - 1) * PAGE_SIZE;
  const pageData = data.slice(offset, offset + PAGE_SIZE);
  return c.json({
    data: pageData,
    total: data.length,
    page,
    limit: PAGE_SIZE,
    next_cursor: null,
  });
}

// Public submission endpoint. A project key identifies the destination but
// never authorizes inbox reads.
feedback.post('/', requireApiKey, async (c) => {
  const projectId = c.get('projectId')!;
  const parsed = await readSubmission(c);
  if (parsed instanceof Response) return parsed;
  const { body, screenshot } = parsed;

  if (!body.title?.trim()) return apiError(c, 400, 'invalid_request', 'Title is required');
  if (!body.description?.trim())
    return apiError(c, 400, 'invalid_request', 'Description is required');
  if (!VALID_TYPES.includes(body.type)) return apiError(c, 400, 'invalid_request', 'Invalid type');

  let imageUrl = body.image_url || null;
  if (screenshot) {
    const stored = await storeScreenshot(c, screenshot);
    if (stored instanceof Response) return stored;
    imageUrl = stored;
  }

  const page =
    body.page && typeof body.page.url === 'string'
      ? { url: body.page.url, title: typeof body.page.title === 'string' ? body.page.title : '' }
      : null;

  const record = await getDb(c.env.DB).createFeedback({
    id: crypto.randomUUID(),
    project_id: projectId,
    type: body.type,
    status: 'new',
    title: body.title.trim(),
    description: body.description.trim(),
    image_url: imageUrl,
    submitter_email: body.submitter_email?.trim() || '',
    submitter_name: body.submitter_name?.trim() || null,
    page,
    pinpoint: parsePinpoint(body.anchor),
    client_version: body.client_version?.trim() || null,
    source: body.source?.trim() || 'api',
  });

  return c.json(
    {
      id: record.id,
      project_id: record.project_id,
      type: record.type,
      status: record.status,
      created_at: record.created_at,
    },
    201
  );
});

feedback.get('/inbox/:projectId', requireInboxAuth, async (c) => {
  return listAuthorizedFeedback(c, c.req.param('projectId'));
});

feedback.get('/inbox', requireInboxAuth, async (c) => {
  return listAuthorizedFeedback(c);
});

feedback.get('/', requireInboxAuth, async (c) => {
  return listAuthorizedFeedback(c);
});

feedback.get('/:id', requireInboxAuth, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const record = await db.getFeedbackById(c.req.param('id'));
  if (!record) return apiError(c, 404, 'not_found', 'Feedback not found');
  const project = await db.getProjectById(record.project_id);
  if (!project || project.owner_id !== userId) return apiError(c, 403, 'forbidden', 'Forbidden');
  if (c.get('actorKind') === 'agent' && record.project_id !== c.get('projectId')) {
    return apiError(c, 403, 'forbidden', 'Forbidden');
  }
  const status_events = await db.listFeedbackStatusEvents(record.id);
  return c.json({ ...record, status_events });
});

feedback.patch('/:id', requireInboxAuth, async (c) => {
  if (!c.get('canWrite')) {
    return apiError(c, 403, 'forbidden', 'Agent token is read-only');
  }
  const userId = c.get('userId')!;
  const feedbackId = c.req.param('id');
  let body: { status?: AnyFeedbackStatus };
  try {
    body = (await c.req.json()) as { status?: AnyFeedbackStatus };
  } catch {
    return apiError(c, 400, 'invalid_request', 'Request body must be JSON');
  }
  if (!body.status || !isValidStatus(body.status)) {
    return apiError(c, 400, 'invalid_request', 'Invalid status');
  }

  const db = getDb(c.env.DB);
  const existing = await db.getFeedbackById(feedbackId);
  if (!existing) return apiError(c, 404, 'not_found', 'Feedback not found');
  const project = await db.getProjectById(existing.project_id);
  if (!project || project.owner_id !== userId) return apiError(c, 403, 'forbidden', 'Forbidden');
  if (c.get('actorKind') === 'agent' && existing.project_id !== c.get('projectId')) {
    return apiError(c, 403, 'forbidden', 'Forbidden');
  }

  const updated = await db.updateFeedbackStatus(feedbackId, body.status, {
    actor_id: c.get('agentTokenId') || userId,
    actor_kind: c.get('actorKind') || 'owner',
  });
  return c.json(updated);
});

export { feedback };
