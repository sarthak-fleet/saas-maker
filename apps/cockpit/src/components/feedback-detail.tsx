'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CopyButton } from '@/components/copy-button';
import type { FeedbackRecord, AnyFeedbackStatus, FeedbackStatus } from '@saas-maker/contracts';

const TYPE_STYLES: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  bug: { label: 'Bug', variant: 'destructive' },
  feature: { label: 'Feature', variant: 'default' },
  feedback: { label: 'Feedback', variant: 'secondary' },
};

interface FeedbackDetailProps {
  item: FeedbackRecord | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (item: FeedbackRecord, status: AnyFeedbackStatus) => Promise<void>;
}

export function FeedbackDetail({ item, open, onClose, onStatusChange }: FeedbackDetailProps) {
  const [status, setStatus] = useState<AnyFeedbackStatus>(item?.status ?? 'new');
  const [updating, setUpdating] = useState(false);

  // Sync status when item changes
  if (item && item.status !== status && !open) {
    setStatus(item.status);
  }

  if (!item) return null;
  const currentItem = item;

  const typeStyle = TYPE_STYLES[currentItem.type] ?? {
    label: currentItem.type,
    variant: 'outline' as const,
  };
  const statusOptions: Array<{ value: AnyFeedbackStatus; label: string }> = [
    { value: 'new', label: 'New' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'planned', label: 'Planned' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'on_roadmap', label: 'On Roadmap' },
  ];

  async function handleStatusChange(value: string) {
    const newStatus = value as FeedbackStatus;
    setStatus(newStatus);
    if (onStatusChange) {
      setUpdating(true);
      try {
        await onStatusChange(currentItem, newStatus);
      } finally {
        setUpdating(false);
      }
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge variant={typeStyle.variant}>{typeStyle.label}</Badge>
          </div>
          <SheetTitle className="text-left">{item.title}</SheetTitle>
          <SheetDescription className="text-left">
            Submitted by {item.submitter_name || item.submitter_email || 'Anonymous'}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          {/* Description */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Description</h4>
            <p className="text-sm leading-relaxed">
              {item.description || 'No description provided.'}
            </p>
          </div>

          {item.page?.url ? (
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">Page</h4>
              <p className="text-sm">{item.page.title || 'Untitled page'}</p>
              <a
                href={item.page.url}
                className="break-all text-xs text-muted-foreground underline"
                target="_blank"
                rel="noreferrer"
              >
                {item.page.url}
              </a>
            </div>
          ) : null}

          {item.pinpoint ? (
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">Pinpoint</h4>
              <p className="text-sm">
                {item.pinpoint.tag || 'element'}
                {item.pinpoint.text ? `: ${item.pinpoint.text}` : ''}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {item.pinpoint.selector}
              </p>
              {item.pinpoint.source ? (
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {item.pinpoint.source}
                </p>
              ) : null}
            </div>
          ) : null}

          {item.image_url && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Attachment</h4>
              <img
                src={item.image_url}
                alt="Feedback attachment"
                className="rounded-md border max-h-64 object-contain"
              />
            </div>
          )}

          {/* Submitter info */}
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-muted-foreground">Submitter</h4>
            <p className="text-sm">{item.submitter_email || 'Anonymous'}</p>
            {item.submitter_name && (
              <p className="text-sm text-muted-foreground">{item.submitter_name}</p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-muted-foreground">Submitted</h4>
            <p className="text-sm">
              {new Date(item.created_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
            <Select value={status} onValueChange={handleStatusChange} disabled={updating}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Agent record</h4>
            <CopyButton
              label="Copy JSON"
              value={JSON.stringify(
                {
                  id: item.id,
                  project_id: item.project_id,
                  type: item.type,
                  status: item.status,
                  title: item.title,
                  description: item.description,
                  page: item.page,
                  pinpoint: item.pinpoint,
                  image_url: item.image_url,
                  created_at: item.created_at,
                },
                null,
                2
              )}
            />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
