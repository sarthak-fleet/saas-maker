import publicCatalog from '../../../../catalog/generated/public.json';

export interface CoreProject {
  name: string;
  tag: string;
  desc: string;
  href: string;
}

export interface ActiveProject {
  name: string;
  desc: string;
  href: string;
}

export interface ActiveProjectGroup {
  id: string;
  label: string;
  products: ActiveProject[];
}

export interface PastProject {
  name: string;
  desc: string;
  repositoryUrl: string;
}

interface PublicProduct {
  id: string;
  name: string;
  description: string;
  url: string;
  tier: string;
  category: string;
  priority: string;
  spotlight: boolean;
  maturity: string;
  pillarId: string;
}

const products = (publicCatalog.products as PublicProduct[]).filter(
  (product) => !['personal-website', 'saas-maker'].includes(product.id)
);
const spotlightOrder = ['codevetter', 'posttrainllm', 'pace', 'high-signal'];

function toCore(product: PublicProduct): CoreProject {
  return {
    name: product.name,
    tag: new URL(product.url).hostname.replace(/^www\./, ''),
    desc: product.description,
    href: `/p/${product.id}`,
  };
}

const spotlight = spotlightOrder
  .map((id) => products.find((product) => product.id === id))
  .filter((product): product is PublicProduct => Boolean(product?.spotlight));

export const CORE = spotlight.map(toCore);

const GROUP_LABELS: Record<string, string> = {
  product: 'Products & research',
  helper: 'Maker tools',
  personal: 'Personal utilities',
};

export const ACTIVE_GROUPS: ActiveProjectGroup[] = ['product', 'helper', 'personal']
  .map((category) => ({
    id: category,
    label: GROUP_LABELS[category],
    products: products
      .filter((product) => !product.spotlight && product.category === category)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((product) => ({
        name: product.name,
        desc: product.description,
        href: `/p/${product.id}`,
      })),
  }))
  .filter((group) => group.products.length > 0);
export const PROJECT_COUNT = products.length;
export const PAST_PROJECTS: PastProject[] = publicCatalog.pastProjects.map((project) => ({
  name: project.name,
  desc: project.description,
  repositoryUrl: project.repositoryUrl,
}));
