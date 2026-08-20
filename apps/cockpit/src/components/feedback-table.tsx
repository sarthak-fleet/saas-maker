'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FeedbackDetail } from '@/components/feedback-detail';
import type { FeedbackRecord, AnyFeedbackStatus } from '@saas-maker/contracts';

const TYPE_STYLES: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  bug: { label: 'Bug', variant: 'destructive' },
  feature: { label: 'Feature', variant: 'default' },
  feedback: { label: 'Feedback', variant: 'secondary' },
};

const STATUS_STYLES: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  new: { label: 'New', variant: 'default' },
  dismissed: { label: 'Dismissed', variant: 'outline' },
  on_roadmap: { label: 'On Roadmap', variant: 'secondary' },
};

interface FeedbackTableProps {
  feedback: FeedbackRecord[];
  onStatusChange?: (item: FeedbackRecord, status: AnyFeedbackStatus) => Promise<void>;
}

export function FeedbackTable({ feedback, onStatusChange }: FeedbackTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = feedback.find((f) => f.id === selectedId) ?? null;

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="hidden sm:table-cell">Submitter</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="hidden md:table-cell w-[120px]">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feedback.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No feedback items found.
                </TableCell>
              </TableRow>
            ) : (
              feedback.map((item) => {
                const typeStyle = TYPE_STYLES[item.type] ?? {
                  label: item.type,
                  variant: 'outline' as const,
                };
                const statusStyle = STATUS_STYLES[item.status] ?? {
                  label: item.status,
                  variant: 'outline' as const,
                };

                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <TableCell>
                      <Badge variant={typeStyle.variant}>{typeStyle.label}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {item.submitter_name || item.submitter_email || 'Anonymous'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusStyle.variant}>{statusStyle.label}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <FeedbackDetail
        item={selected}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        onStatusChange={onStatusChange}
      />
    </>
  );
}
