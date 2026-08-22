import publicCatalog from '../../../../catalog/generated/public.json';
import { PACKAGE_URL } from '../data/links';
import { LEARNINGS } from '../data/learnings';
export const prerender = true;
export function GET() {
  const products = publicCatalog.products.map(
    (product) => `- [${product.name}](${product.url}): ${product.description}`
  );
  const pastProjects = publicCatalog.pastProjects.map(
    (project) => `- [${project.name}](${project.repositoryUrl}): ${project.description}`
  );
  const body = [
    '# SaaS Maker',
    '',
    "> Software as a specialized service: Sarthak Agrawal's living studio of focused, maintained products.",
    '',
    '## Core surfaces',
    '',
    '- [Studio home](https://sassmaker.com)',
    `- [Complete project directory](https://sassmaker.com/projects): ${publicCatalog.directory.length} current, supporting, parked, and past identities`,
    '- [Learnings](https://sassmaker.com/learnings): first-party notes from building products and agent workflows',
    ...LEARNINGS.map(
      (learning) =>
        `- [${learning.title}](https://sassmaker.com${learning.href}): ${learning.description}`
    ),
    `- [Feedback package](${PACKAGE_URL}): callback-only React package`,
    '',
    '## Maintained products',
    '',
    ...products,
    '',
    '## Past public repositories',
    '',
    ...pastProjects,
    '',
    '## Machine surfaces',
    '',
    '- https://sassmaker.com/api/ai',
    '- https://sassmaker.com/projects.json',
    '- https://sassmaker.com/projects.md',
    '- https://sassmaker.com/index.md',
    '- https://sassmaker.com/llms-full.txt',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
