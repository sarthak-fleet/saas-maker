import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = {
  getProjectByApiKey: vi.fn(),
  createFeedback: vi.fn(),
  getProjectById: vi.fn(),
  getUserById: vi.fn(),
  listFeedback: vi.fn(),
};

vi.mock('../../workers/api/src/db', () => ({
  getDb: () => mockDb,
  createDatabase: () => mockDb,
}));

vi.mock('../../workers/api/src/email', () => ({
  sendNewFeedbackEmail: vi.fn(),
}));

import { request } from './helpers';

const PROJECT = {
  id: 'proj-1',
  owner_id: 'user-1',
  name: 'Acme',
  slug: 'acme',
  api_key: 'pk_test',
};

function apiKeyHeaders(extra: Record<string, string> = {}) {
  return {
    'X-Project-Key': PROJECT.api_key,
    'Content-Type': 'application/json',
    ...extra,
  };
}

beforeEach(() => {
  Object.values(mockDb).forEach((fn) => fn.mockReset());
  mockDb.getProjectByApiKey.mockResolvedValue(PROJECT);
  mockDb.createFeedback.mockImplementation(async (input) => ({
    ...input,
    submitter_name: input.submitter_name ?? null,
    upvote_count: 0,
    downvote_count: 0,
    created_at: '2026-08-20T00:00:00Z',
  }));
});

describe('Feedback route validation with a mocked DB', () => {
  it('POST /v1/feedback with key but missing title returns 400', async () => {
    const res = await request('/v1/feedback', {
      method: 'POST',
      headers: apiKeyHeaders(),
      body: JSON.stringify({
        description: 'Broken CTA',
        submitter_email: 'me@example.com',
        type: 'bug',
      }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Title is required/i);
    expect(mockDb.createFeedback).not.toHaveBeenCalled();
  });

  it('POST /v1/feedback accepts an anonymous submission', async () => {
    const res = await request('/v1/feedback', {
      method: 'POST',
      headers: apiKeyHeaders(),
      body: JSON.stringify({
        title: 'Bug report',
        description: 'Broken CTA',
        type: 'bug',
      }),
    });

    expect(res.status).toBe(201);
    expect(mockDb.createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ submitter_email: '' })
    );
  });

  it('POST /v1/feedback with key but invalid type returns 400', async () => {
    const res = await request('/v1/feedback', {
      method: 'POST',
      headers: apiKeyHeaders(),
      body: JSON.stringify({
        title: 'Bug report',
        description: 'Broken CTA',
        submitter_email: 'me@example.com',
        type: 'other',
      }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid type/i);
    expect(mockDb.createFeedback).not.toHaveBeenCalled();
  });
});
