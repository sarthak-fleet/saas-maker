import publicCatalog from '../../../../catalog/generated/public.json';
import tokenWorld from './tokenWorld.json';
import { CHANGELOG } from './changelog';
import { LEARNINGS } from './learnings';
import { CORE } from './projects';
import { PAGED_PRODUCTS, type RegistryProduct } from './registry';

export type PublicRoute = {
  id: string;
  path: string;
  description: string;
  kind: 'article' | 'collection' | 'profile' | 'static';
  markdown: string;
};

const SITE_URL = 'https://sassmaker.com';

function productMarkdown(product: RegistryProduct): string {
  const lines = [
    `# ${product.name}`,
    '',
    product.summary,
    '',
    '## Canonical product',
    '',
    product.url,
    '',
  ];
  const links = product.productLinks ?? [];

  if (links.length > 0) {
    lines.push(
      '## Public evidence',
      '',
      ...links.map((link) => {
        const description = link.description ? ` — ${link.description}` : '';
        return `- [${link.title}](${link.url})${description}`;
      }),
      ''
    );
  }

  lines.push(
    '## Directory boundary',
    '',
    `This SaaS Maker directory page points to ${product.name}'s canonical home. Product behavior and release evidence remain owned by the linked product and repository.`,
    ''
  );
  return lines.join('\n');
}

function homeMarkdown(): string {
  const latestLearning = LEARNINGS[0];
  const featuredProducts = CORE.flatMap((project) => [
    `### ${project.name}`,
    '',
    project.desc,
    '',
    `- SaaS Maker profile: ${SITE_URL}${project.href}`,
    '',
  ]);

  return [
    '# SaaS Maker',
    '',
    'Software as a specialized service: a living studio of focused products, generated from Fleet’s privacy-checked public projection.',
    '',
    '## Tokens Spent for the World',
    '',
    `${tokenWorld.lifetimeTokens.toLocaleString('en-US')} verified model tokens across ${tokenWorld.projectsContributing} contributing project as of ${tokenWorld.snapshotDate}.`,
    '',
    `- Latest seeded day: ${tokenWorld.todayTokens.toLocaleString('en-US')} tokens`,
    `- Last updated at: ${tokenWorld.lastUpdatedAt}`,
    '- Projects used: Worldwide',
    `- Projects contributing: ${tokenWorld.projectsContributing}`,
    `- Coverage: ${tokenWorld.coverage}`,
    '',
    '## Products in focus',
    '',
    ...featuredProducts,
    '## Complete directory',
    '',
    `Current, supporting, parked, and past work is enumerated once at ${SITE_URL}/projects.`,
    '',
    `- Human directory: ${SITE_URL}/projects`,
    `- Agent-readable directory: ${SITE_URL}/projects.md`,
    `- JSON directory: ${SITE_URL}/projects.json`,
    '',
    '## Latest learning',
    '',
    `### ${latestLearning.title}`,
    '',
    latestLearning.description,
    '',
    `- Article: ${SITE_URL}${latestLearning.href}`,
    `- Published: ${latestLearning.publishedAt}`,
    `- Author: ${latestLearning.author}`,
    '',
    '## Public package',
    '',
    '@saas-maker/feedback is a React widget for bugs, feature requests, screenshots, and page-specific feedback.',
    '',
    `- Package overview: ${SITE_URL}/#package`,
  ].join('\n');
}

function directoryMarkdown(): string {
  const groups = [
    ['current', 'Current work'],
    ['supporting', 'Supporting and parked'],
    ['past', 'Past projects'],
  ] as const;
  const entries = groups.flatMap(([group, label]) => [
    `# ${label}`,
    '',
    ...publicCatalog.directory
      .filter((project) => project.group === group)
      .flatMap((project) => [
        `## ${project.name}`,
        '',
        project.description,
        '',
        `- Form: ${project.form}`,
        `- Platforms: ${project.platforms.join(', ')}`,
        `- Uses: ${project.technologies.join(', ')}`,
        `- Deployment: ${project.deployed ? 'deployed' : 'not deployed'}`,
        ...(project.deploymentProviders.length > 0
          ? [`- Providers: ${project.deploymentProviders.join(', ')}`]
          : []),
        ...project.domains.map((domain) => `- Public destination: https://${domain}`),
        ...(project.repositoryUrl ? [`- Public source: ${project.repositoryUrl}`] : []),
        `- First retained commit: ${project.firstCommitAt ?? 'not retained'}`,
        `- Latest retained commit: ${project.latestCommitAt ?? 'not retained'}`,
        '',
      ]),
  ]);

  return [
    '# SaaS Maker complete project directory',
    '',
    `${publicCatalog.directory.length} Fleet identities, including current, supporting, parked, and past work. Inclusion is inventory, not a maintenance or deployment claim.`,
    '',
    publicCatalog.historySemantics,
    '',
    ...entries,
  ].join('\n');
}

const fixedRoutes: PublicRoute[] = [
  {
    id: 'directory',
    path: '/',
    description: 'Software as a specialized service: a living studio of focused products',
    kind: 'collection',
    markdown: homeMarkdown(),
  },
  {
    id: 'projects',
    path: '/projects',
    description: 'Complete public directory of all Fleet project identities',
    kind: 'collection',
    markdown: directoryMarkdown(),
  },
  {
    id: 'privacy',
    path: '/privacy',
    description: 'Privacy policy for the SaaS Maker product directory',
    kind: 'static',
    markdown: `# SaaS Maker privacy policy

Last updated: July 24, 2026

## What this site is

sassmaker.com is a static directory for maintained products. It does not require an account and does not collect form submissions on this domain.

## What we may collect

- Cloudflare may log standard request metadata such as IP address, user agent, and path at the edge.
- Individual products and package documentation have their own policies.

## Contact

- Email: sarthakagrawal927@gmail.com
- Website: https://sarthakagrawal.dev
`,
  },
  {
    id: 'terms',
    path: '/terms',
    description: 'Terms of use for the SaaS Maker product directory',
    kind: 'static',
    markdown: `# SaaS Maker terms of use

Last updated: July 24, 2026

## Use of this site

sassmaker.com describes open-source and personal projects maintained by Sarthak Agrawal. Content is provided as-is for informational purposes. Linked products may have separate terms.

## No warranty

Software and documentation are provided without warranty. You use linked products and repositories at your own risk.

## Contact

- Email: sarthakagrawal927@gmail.com
- Website: https://sarthakagrawal.dev
`,
  },
  {
    id: 'changelog',
    path: '/changelog',
    description: 'Product-owned history of meaningful changes shipped by SaaS Maker',
    kind: 'collection',
    markdown: [
      '# SaaS Maker changelog',
      '',
      'A product-owned history of meaningful changes shipped by SaaS Maker.',
      '',
      ...CHANGELOG.flatMap((entry) => [
        `## ${entry.label} — ${entry.title}`,
        '',
        entry.summary,
        '',
        ...entry.changes.map((change) => `- ${change}`),
        '',
      ]),
    ].join('\n'),
  },
  {
    id: 'learnings',
    path: '/learnings',
    description: 'First-party builder notes and agent-tooling learnings',
    kind: 'collection',
    markdown: [
      '# SaaS Maker learnings',
      '',
      'First-party notes from building products, agent workflows, and the systems around them.',
      '',
      ...LEARNINGS.flatMap((learning) => [
        `## ${learning.title}`,
        '',
        learning.description,
        '',
        `- Published: ${learning.publishedAt}`,
        `- Read: ${SITE_URL}${learning.href}`,
        `- Markdown: ${SITE_URL}${learning.href}.md`,
        '',
      ]),
    ].join('\n'),
  },
];

const learningRoutes: PublicRoute[] = LEARNINGS.map((learning) => ({
  id: `learning-${learning.href.split('/').filter(Boolean).at(-1)}`,
  path: learning.href,
  description: learning.description,
  kind: 'article',
  markdown: learning.markdown,
}));

const productRoutes: PublicRoute[] = PAGED_PRODUCTS.map((product) => ({
  id: `product-${product.id}`,
  path: `/p/${product.id}`,
  description: product.summary,
  kind: 'profile',
  markdown: productMarkdown(product),
}));

export const PUBLIC_ROUTES = [...fixedRoutes, ...learningRoutes, ...productRoutes];

export function publicRouteUrl(route: PublicRoute): string {
  return new URL(route.path, SITE_URL).toString();
}

export function markdownPath(route: PublicRoute): string {
  if (route.path === '/') return 'index';
  return route.path.replace(/^\//, '');
}
