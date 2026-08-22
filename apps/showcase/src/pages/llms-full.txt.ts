import publicCatalog from '../../../../catalog/generated/public.json';
import { LEARNINGS } from '../data/learnings';
export const prerender = true;
export function GET() {
  const projects = publicCatalog.directory.flatMap((project) => {
    return [
      `## ${project.name}`,
      project.description,
      `Group: ${project.group}`,
      `Form: ${project.form}`,
      `Platforms: ${project.platforms.join(', ')}`,
      `Uses: ${project.technologies.join(', ')}`,
      `Deployment: ${project.deployed ? 'deployed' : 'not deployed'}`,
      ...project.domains.map((domain) => `Destination: https://${domain}`),
      ...(project.repositoryUrl ? [`Source: ${project.repositoryUrl}`] : []),
      `First retained commit: ${project.firstCommitAt ?? 'not retained'}`,
      `Latest retained commit: ${project.latestCommitAt ?? 'not retained'}`,
      '',
    ];
  });
  const body = [
    '# SaaS Maker — full product index',
    '',
    'Generated from the checked-in Fleet public projection. Configuration and links do not imply fresh production verification.',
    '',
    '# Learnings',
    '',
    ...LEARNINGS.flatMap((learning) => [
      `## ${learning.title}`,
      learning.description,
      `Article: https://sassmaker.com${learning.href}`,
      `Published: ${learning.publishedAt}`,
      `Author: ${learning.author}`,
      '',
    ]),
    '# Complete project directory',
    '',
    publicCatalog.historySemantics,
    '',
    ...projects,
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
