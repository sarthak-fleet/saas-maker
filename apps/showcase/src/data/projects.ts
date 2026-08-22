import publicCatalog from '../../../../catalog/generated/public.json';

export interface CoreProject {
  name: string;
  tag: string;
  desc: string;
  href: string;
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

const spotlight = spotlightOrder.map((id) => {
  const product = products.find((candidate) => candidate.id === id);

  if (!product?.spotlight) {
    throw new Error(`Homepage spotlight is missing the public catalog entry for ${id}`);
  }

  return product;
});

export const CORE = spotlight.map(toCore);
