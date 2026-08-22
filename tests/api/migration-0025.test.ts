import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toFeedbackRecord } from '../../workers/api/src/db';

describe('0025 feedback agent contract migration', () => {
  const sql = readFileSync(
    new URL('../../workers/api/migrations/0025_feedback_agent_contract.sql', import.meta.url),
    'utf8'
  );

  it('copies existing feedback rows before replacing the table', () => {
    expect(sql).toMatch(/INSERT INTO feedback_new/i);
    expect(sql).toMatch(/SELECT[\s\S]*FROM feedback/i);
    expect(sql).toMatch(/DROP TABLE feedback/i);
    expect(sql.indexOf('INSERT INTO feedback_new')).toBeLessThan(
      sql.indexOf('DROP TABLE feedback')
    );
  });

  it('adds provenance columns, audit, and agent tokens without deleting unrelated tables', () => {
    expect(sql).toMatch(/page_url/);
    expect(sql).toMatch(/pinpoint_json/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS feedback_status_events/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS feedback_agent_tokens/);
    expect(sql).not.toMatch(/DELETE FROM feedback/i);
    expect(sql).not.toMatch(/DROP TABLE projects/i);
  });
});

describe('Preserved feedback rows remain readable without new columns', () => {
  it('maps a legacy row with original identifiers and customer fields', () => {
    const record = toFeedbackRecord({
      id: 'legacy-1',
      project_id: 'proj-1',
      type: 'feedback',
      status: 'done',
      title: 'Old title',
      description: 'Old description',
      image_url: null,
      submitter_email: 'person@example.com',
      submitter_name: 'Person',
      upvote_count: 0,
      downvote_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });

    expect(record.id).toBe('legacy-1');
    expect(record.title).toBe('Old title');
    expect(record.description).toBe('Old description');
    expect(record.submitter_email).toBe('person@example.com');
    expect(record.page).toBeNull();
    expect(record.pinpoint).toBeNull();
  });
});
