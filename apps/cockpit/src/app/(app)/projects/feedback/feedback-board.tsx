'use client';

import type { AnyFeedbackStatus, FeedbackRecord, FeedbackType } from '@saas-maker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { FeedbackTable } from '@/components/feedback-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetchClient, getClientToken } from '@/lib/api-client';

type InboxRecord = FeedbackRecord & { project_name: string; project_slug: string };

export function FeedbackBoard() {
  const [feedback, setFeedback] = useState<InboxRecord[]>([]);
  const [type, setType] = useState<FeedbackType | 'all'>('all');
  const [status, setStatus] = useState<AnyFeedbackStatus | 'all'>('all');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (activeToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (type !== 'all') query.set('type', type);
        if (status !== 'all') query.set('status', status);
        const result = await apiFetchClient<{ data: InboxRecord[] }>(
          `/v1/feedback/inbox?${query.toString()}`,
          activeToken
        );
        setFeedback(result.data ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load feedback');
      } finally {
        setLoading(false);
      }
    },
    [status, type]
  );

  useEffect(() => {
    let cancelled = false;
    getClientToken()
      .then((activeToken) => {
        if (cancelled) return;
        setToken(activeToken);
        return load(activeToken);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to authenticate. Please sign in again.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function updateStatus(item: FeedbackRecord, nextStatus: AnyFeedbackStatus) {
    if (!token) return;
    const updated = await apiFetchClient<FeedbackRecord>(`/v1/feedback/${item.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    setFeedback((items) =>
      items.map((candidate) =>
        candidate.id === updated.id ? { ...candidate, status: updated.status } : candidate
      )
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={type} onValueChange={(value) => setType(value as FeedbackType | 'all')}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="bug">Bugs</SelectItem>
            <SelectItem value="feature">Features</SelectItem>
            <SelectItem value="feedback">Feedback</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as AnyFeedbackStatus | 'all')}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={!token || loading}
          onClick={() => token && load(token)}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading feedback…</p>
      ) : (
        <FeedbackTable feedback={feedback} onStatusChange={updateStatus} />
      )}
    </div>
  );
}
