import { PageHeader } from '@/components/page-header';
import { ProjectCredentials } from '@/components/project-credentials';
import { getAuthenticatedProject } from './get-project';
import { InboxContent } from './inbox-content';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ProjectStatusPage({ params }: Props) {
  const { slug } = await params;
  const { project } = await getAuthenticatedProject(slug);

  return (
    <div className="space-y-6">
      <PageHeader title={project.name} description={`Feedback for ${project.slug}`} />
      <ProjectCredentials projectId={project.id} projectKey={project.api_key} />
      <InboxContent projectId={project.id} />
    </div>
  );
}
