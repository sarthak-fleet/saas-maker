import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateProjectDialog } from '@/components/create-project-dialog';
import { PageHeader } from '@/components/page-header';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { getDashboardSession } from '@/lib/server-session';
import { redirect } from 'next/navigation';
import { apiFetch, getServerToken } from '@/lib/api';
import { visibleDashboardProjects } from '@/lib/dashboard-projects';
import type { ProjectRecord } from '@saas-maker/contracts';
import {
  ArrowRight,
  Boxes,
  CalendarDays,
  Cloud,
  KeyRound,
  NotebookText,
  AlertCircle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default async function ProjectsPage() {
  const session = await getDashboardSession();
  if (!session?.user) redirect('/login');

  const token = await getServerToken();
  let projects: ProjectRecord[] = [];
  let error: string | null = null;

  try {
    const res = await apiFetch('/v1/projects', {}, token);
    projects = visibleDashboardProjects(res.data ?? []);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load projects';
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project keys"
        description="Manage the product identities accepted by the SaaS Maker feedback package."
        action={<CreateProjectDialog />}
      />

      <div className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Feedback projects</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Each project has a key used only to submit and review feedback.
          </p>
        </div>
        {!error && projects.length > 0 && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </Badge>
        )}
      </div>

      {error ? (
        <Card className="border-destructive/50">
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <CardTitle className="text-base text-destructive">Failed to load projects</CardTitle>
              <CardDescription className="mt-1 text-xs font-mono break-all">
                {error}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : projects.length === 0 ? (
        <OnboardingFlow />
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.slug}`} className="group block">
              <Card className="overflow-hidden py-0 transition-all hover:border-primary/40 hover:bg-muted/30 hover:shadow-md">
                <CardHeader className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-sm font-semibold uppercase text-muted-foreground">
                      {project.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <CardTitle className="truncate text-base">{project.name}</CardTitle>
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {project.source}
                        </Badge>
                      </div>
                      <CardDescription className="flex items-center gap-1 font-mono text-xs">
                        <Boxes className="h-3 w-3" />
                        <span className="truncate">{project.slug}</span>
                      </CardDescription>
                      {project.readme && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {project.readme}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <div className="text-xs font-medium">API key</div>
                      <div className="text-[11px] text-muted-foreground">Issued</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                  </div>
                </CardHeader>

                <CardContent className="grid gap-2 border-t bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>Created {formatDate(project.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <NotebookText className="h-3.5 w-3.5" />
                    <span>{project.readme ? 'Readme added' : 'No readme'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />
                      Key issued
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
