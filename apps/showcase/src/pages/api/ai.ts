import publicCatalog from '../../../../../catalog/generated/public.json';
import tokenWorld from '../../data/tokenWorld.json';
import { PACKAGE_URL } from '../../data/links';
import { LEARNINGS } from '../../data/learnings';
import { markdownPath, PUBLIC_ROUTES, publicRouteUrl } from '../../data/publicRoutes';
export const prerender = true;
export function GET() {
  return new Response(
    JSON.stringify(
      {
        name: 'SaaS Maker',
        schemaVersion: 1,
        version: '1',
        url: 'https://sassmaker.com',
        llms: 'https://sassmaker.com/llms.txt',
        llmsFull: 'https://sassmaker.com/llms-full.txt',
        sitemap: 'https://sassmaker.com/sitemap.xml',
        markdown: { suffix: '.md', negotiation: false },
        canonical: 'https://sassmaker.com',
        sourceOfTruth: 'SaaS Maker privacy-checked public product catalog',
        surfaces: PUBLIC_ROUTES.map((route) => ({
          id: route.id,
          url: publicRouteUrl(route),
          md: `https://sassmaker.com/${markdownPath(route)}.md`,
          kind: route.kind,
          description: route.description,
        })),
        externalResources: [
          {
            id: 'feedback-package',
            url: PACKAGE_URL,
            kind: 'documentation',
            description: 'Published feedback package and hosted submission service',
          },
        ],
        auth: { public: true, notes: 'Private Fleet controls are intentionally excluded.' },
        tokenImpact: {
          name: 'Tokens Spent for the World',
          metric: 'Verified provider-reported model tokens from contributing products',
          ...tokenWorld,
        },
        products: publicCatalog.products,
        directory: publicCatalog.directory,
        historySemantics: publicCatalog.historySemantics,
        pastProjects: publicCatalog.pastProjects,
        learnings: LEARNINGS.map((learning) => ({
          ...learning,
          url: `https://sassmaker.com${learning.href}`,
        })),
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}
