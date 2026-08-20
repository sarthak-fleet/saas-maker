import publicCatalog from '../../../../catalog/generated/public.json';

export interface ProductLink {
  title: string;
  url: string;
  description?: string;
}

export interface RegistryProduct {
  id: string;
  name: string;
  url: string;
  summary: string;
  stack?: string;
  schemaType?: string;
  sameAs?: string[];
  applicationCategory?: string;
  productLinks?: ProductLink[];
  pillarId: string;
  changelogUrl?: string;
  roadmapUrl?: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  url: string;
  repositoryUrl?: string;
  changelogUrl?: string;
  roadmapUrl?: string;
  category: string;
  pillarId: string;
}

function adapt(product: CatalogProduct): RegistryProduct {
  const links: ProductLink[] = [
    { title: 'Product', url: product.url, description: 'Canonical product surface' },
    ...(product.changelogUrl
      ? [
          {
            title: 'Changelog',
            url: product.changelogUrl,
            description: 'Product-owned release history',
          },
        ]
      : []),
    ...(product.roadmapUrl
      ? [{ title: 'Roadmap', url: product.roadmapUrl, description: 'Open work in GitHub Issues' }]
      : []),
    ...(product.repositoryUrl
      ? [
          {
            title: 'Source',
            url: product.repositoryUrl,
            description: 'Canonical source repository',
          },
        ]
      : []),
  ];
  return {
    id: product.id,
    name: product.name,
    url: product.url,
    summary: product.description,
    stack: product.pillarId,
    schemaType: 'SoftwareApplication',
    sameAs: product.repositoryUrl ? [product.repositoryUrl] : undefined,
    applicationCategory: product.category,
    productLinks: links,
    pillarId: product.pillarId,
    changelogUrl: product.changelogUrl,
    roadmapUrl: product.roadmapUrl,
  };
}

export const REGISTRY_PRODUCTS = (publicCatalog.products as CatalogProduct[])
  .filter((product) => product.id !== 'personal-website')
  .map(adapt);
export const REGISTRY_BY_ID = Object.fromEntries(
  REGISTRY_PRODUCTS.map((product) => [product.id, product])
);
// SaaS Maker is the directory itself. Giving it a second indexable profile at
// `/p/saas-maker` splits exact-brand signals and makes the homepage compete
// with its own catalog entry.
export const PAGED_PRODUCTS = REGISTRY_PRODUCTS.filter((product) => product.id !== 'saas-maker');

export function llmsTxtUrl(product: RegistryProduct): string {
  return `${product.url.replace(/\/$/, '')}/llms.txt`;
}

export function apiAiUrl(product: RegistryProduct): string {
  return `${product.url.replace(/\/$/, '')}/api/ai`;
}

export function indexMdUrl(product: RegistryProduct): string {
  return `${product.url.replace(/\/$/, '')}/index.md`;
}
