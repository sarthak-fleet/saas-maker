import type {
  AnyFeedbackStatus,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackType,
  SubmitFeedbackRequest,
} from '@saas-maker/contracts';
import { Hono, type Context } from 'hono';
import { getDb } from '../db';
import { requireApiKey, requireSession } from '../middleware/auth';
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

function queryOptions(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const type = c.req.query('type') as FeedbackType | undefined;
  const status = c.req.query('status') as AnyFeedbackStatus | undefined;
  const page = Number.parseInt(c.req.query('page') || '1', 10);
  return { type, status, page: Number.isFinite(page) && page > 0 ? page : 1 };
}

// Public submission endpoint. A project key identifies the destination but
// never authorizes inbox reads.
feedback.post('/', requireApiKey, async (c) => {
  const projectId = c.get('projectId')!;
  const body = (await c.req.json()) as SubmitFeedbackRequest;

  if (!body.title?.trim()) return c.json({ error: 'Title is required' }, 400);
  if (!body.description?.trim()) return c.json({ error: 'Description is required' }, 400);
  if (!VALID_TYPES.includes(body.type)) return c.json({ error: 'Invalid type' }, 400);

  const record = await getDb(c.env.DB).createFeedback({
    id: crypto.randomUUID(),
    project_id: projectId,
    type: body.type,
    status: 'new',
    title: body.title.trim(),
    description: body.description.trim(),
    image_url: body.image_url || null,
    submitter_email: body.submitter_email?.trim() || '',
    submitter_name: body.submitter_name?.trim() || null,
  });

  return c.json(record, 201);
});

// Private project inbox for the dashboard and authenticated agents.
feedback.get('/inbox/:projectId', requireSession, async (c) => {
  const userId = c.get('userId')!;
  const projectId = c.req.param('projectId');
  const { type, status, page } = queryOptions(c);
  if (type && !VALID_TYPES.includes(type)) return c.json({ error: 'Invalid type filter' }, 400);
  if (status && !isValidStatus(status)) return c.json({ error: 'Invalid status filter' }, 400);

  const db = getDb(c.env.DB);
  const project = await db.getProjectById(projectId);
  if (!project || project.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403);
  const result = await db.listFeedback(
    projectId,
    { type, status, sort: 'newest', page, limit: PAGE_SIZE },
    userId
  );
  return c.json({ data: result.data, total: result.total, page, limit: PAGE_SIZE });
});

// Cross-project private inbox. This is deliberately a flat newest-first list,
// not a public feature board or voting system.
feedback.get('/inbox', requireSession, async (c) => {
  const userId = c.get('userId')!;
  const { type, status, page } = queryOptions(c);
  if (type && !VALID_TYPES.includes(type)) return c.json({ error: 'Invalid type filter' }, 400);
  if (status && !isValidStatus(status)) return c.json({ error: 'Invalid status filter' }, 400);

  const db = getDb(c.env.DB);
  const projects = await db.listProjectsByOwner(userId, 'dashboard');
  const perProject = await Promise.all(
    projects.map((project) =>
      db.listFeedback(
        project.id,
        { type, status, sort: 'newest', page: 1, limit: PAGE_SIZE * page },
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
  return c.json({
    data: data.slice(offset, offset + PAGE_SIZE),
    total: data.length,
    page,
    limit: PAGE_SIZE,
  });
});

feedback.get('/:id', requireSession, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const record = await db.getFeedbackById(c.req.param('id'));
  if (!record) return c.json({ error: 'Feedback not found' }, 404);
  const project = await db.getProjectById(record.project_id);
  if (!project || project.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403);
  return c.json(record);
});

feedback.patch('/:id', requireSession, async (c) => {
  const userId = c.get('userId')!;
  const feedbackId = c.req.param('id');
  const body = (await c.req.json()) as { status: AnyFeedbackStatus };
  if (!body.status || !isValidStatus(body.status)) return c.json({ error: 'Invalid status' }, 400);

  const db = getDb(c.env.DB);
  const existing = await db.getFeedbackById(feedbackId);
  if (!existing) return c.json({ error: 'Feedback not found' }, 404);
  const project = await db.getProjectById(existing.project_id);
  if (!project || project.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403);

  const updated = await db.updateFeedbackStatus(feedbackId, body.status);
  return c.json(updated);
});

export { feedback };
