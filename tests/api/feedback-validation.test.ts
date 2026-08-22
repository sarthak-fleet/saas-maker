import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = {
  getProjectByApiKey: vi.fn(),
  createFeedback: vi.fn(),
  getProjectById: vi.fn(),
  getUserById: vi.fn(),
  listFeedback: vi.fn(),
  listFeedbackStatusEvents: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  getFeedbackById: vi.fn(),
  getAgentTokenByHash: vi.fn(),
  touchAgentToken: vi.fn(),
  listProjectsByOwner: vi.fn(),
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
    expect((await res.json()).error.message).toMatch(/Title is required/i);
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

  it('POST /v1/feedback stores page and pinpoint context', async () => {
    const res = await request('/v1/feedback', {
      method: 'POST',
      headers: apiKeyHeaders(),
      body: JSON.stringify({
        title: 'Broken CTA',
        description: 'Cannot click save',
        type: 'bug',
        page: { url: 'https://product.example/settings', title: 'Settings' },
        anchor: {
          selector: '#save',
          tag: 'button',
          text: 'Save',
          source: null,
          url: '/settings',
        },
        client_version: '0.4.0',
        source: 'widget',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('new');
    expect(body.title).toBeUndefined();
    expect(mockDb.createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        page: { url: 'https://product.example/settings', title: 'Settings' },
        pinpoint: expect.objectContaining({ selector: '#save', tag: 'button' }),
        source: 'widget',
      })
    );
  });

  it('POST /v1/feedback accepts multipart screenshot submissions', async () => {
    const form = new FormData();
    form.append(
      'feedback',
      JSON.stringify({
        title: 'Screenshot bug',
        description: 'See image',
        type: 'bug',
      })
    );
    form.append('screenshot', new File(['image-bytes'], 'screen.png', { type: 'image/png' }));

    const res = await request('/v1/feedback', {
      method: 'POST',
      headers: { 'X-Project-Key': PROJECT.api_key },
      body: form,
    });

    expect(res.status).toBe(201);
    expect(mockDb.createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url: expect.stringMatching(/^https:\/\/images\.sassmaker\.com\/feedback\//),
      })
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
    expect((await res.json()).error.message).toMatch(/Invalid type/i);
    expect(mockDb.createFeedback).not.toHaveBeenCalled();
  });
});
