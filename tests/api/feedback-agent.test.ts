import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = {
  getProjectByApiKey: vi.fn(),
  getProjectById: vi.fn(),
  getProjectBySlug: vi.fn(),
  getFeedbackById: vi.fn(),
  listFeedback: vi.fn(),
  listFeedbackStatusEvents: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  getAgentTokenByHash: vi.fn(),
  touchAgentToken: vi.fn(),
  listProjectsByOwner: vi.fn(),
  upsertUser: vi.fn(),
};

vi.mock('../../workers/api/src/db', () => ({
  getDb: () => mockDb,
  createDatabase: () => mockDb,
}));

import { request } from './helpers';

const PROJECT = {
  id: 'proj-1',
  owner_id: 'user-1',
  name: 'Acme',
  slug: 'acme',
  api_key: 'pk_test',
};

const RECORD = {
  id: 'fb-1',
  project_id: 'proj-1',
  type: 'bug',
  status: 'new',
  title: 'Broken CTA',
  description: 'Cannot click save',
  image_url: null,
  submitter_email: '',
  submitter_name: null,
  upvote_count: 0,
  downvote_count: 0,
  page: { url: 'https://product.example/settings', title: 'Settings' },
  pinpoint: null,
  client_version: '0.4.0',
  source: 'widget',
  updated_at: null,
  updated_by: null,
  created_at: '2026-08-20T00:00:00Z',
};

beforeEach(() => {
  Object.values(mockDb).forEach((fn) => fn.mockReset());
  mockDb.getProjectById.mockResolvedValue(PROJECT);
  mockDb.listFeedback.mockResolvedValue({ data: [RECORD], total: 1, next_cursor: null });
  mockDb.getFeedbackById.mockResolvedValue(RECORD);
  mockDb.listFeedbackStatusEvents.mockResolvedValue([]);
  mockDb.updateFeedbackStatus.mockImplementation(async (_id, status) => ({ ...RECORD, status }));
  mockDb.touchAgentToken.mockResolvedValue(undefined);
});

describe('Read-only agent tokens', () => {
  it('GET /v1/feedback returns structured records for a read-only agent', async () => {
    mockDb.getAgentTokenByHash.mockResolvedValue({
      id: 'tok-1',
      project_id: 'proj-1',
      name: 'reader',
      can_write: false,
      token_prefix: 'smk_abcd',
      created_at: '2026-08-20T00:00:00Z',
      last_used_at: null,
    });

    const res = await request('/v1/feedback?status=new', {
      headers: { Authorization: 'Bearer smk_readonly_example_token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe('fb-1');
    expect(body.data[0].page.url).toBe('https://product.example/settings');
    expect(mockDb.listFeedback).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ status: 'new' }),
      'user-1'
    );
  });

  it('PATCH /v1/feedback/:id is rejected for a read-only agent', async () => {
    mockDb.getAgentTokenByHash.mockResolvedValue({
      id: 'tok-1',
      project_id: 'proj-1',
      name: 'reader',
      can_write: false,
      token_prefix: 'smk_abcd',
      created_at: '2026-08-20T00:00:00Z',
      last_used_at: null,
    });

    const res = await request('/v1/feedback/fb-1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer smk_readonly_example_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'reviewing' }),
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
    expect(mockDb.updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it('PATCH /v1/feedback/:id records actor identity for a write-enabled agent', async () => {
    mockDb.getAgentTokenByHash.mockResolvedValue({
      id: 'tok-write',
      project_id: 'proj-1',
      name: 'writer',
      can_write: true,
      token_prefix: 'smk_efgh',
      created_at: '2026-08-20T00:00:00Z',
      last_used_at: null,
    });

    const res = await request('/v1/feedback/fb-1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer smk_write_example_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'acknowledged' }),
    });

    expect(res.status).toBe(200);
    expect(mockDb.updateFeedbackStatus).toHaveBeenCalledWith('fb-1', 'acknowledged', {
      actor_id: 'tok-write',
      actor_kind: 'agent',
    });
  });
});
