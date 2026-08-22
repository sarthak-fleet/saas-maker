'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyButton } from '@/components/copy-button';
import { apiFetch } from '@/lib/api';

async function getToken(): Promise<string> {
  const response = await fetch('/api/token');
  if (!response.ok) throw new Error('Failed to get auth token');
  return (await response.json()).token;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const project = await apiFetch(
        '/v1/projects',
        { method: 'POST', body: JSON.stringify({ name: name.trim() }) },
        await getToken()
      );
      setApiKey(project.api_key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    const example = `<FeedbackWidget projectKey="${apiKey}" />`;
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle>Project key created</CardTitle>
          <CardDescription>
            Install <code>@saas-maker/feedback</code>, import its stylesheet, and pass this key to
            the widget.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
            <code className="flex-1 break-all text-xs">{example}</code>
            <CopyButton value={example} />
          </div>
          <Button className="w-full" onClick={() => router.refresh()}>
            Open feedback projects
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FolderPlus className="h-5 w-5" aria-hidden="true" />
        </div>
        <CardTitle>Create a feedback project</CardTitle>
        <CardDescription>
          This creates the public key used by the feedback package. It does not register Fleet
          infrastructure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={createProject} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Product name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My product"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create project key'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
