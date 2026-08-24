export type SiteConfig = {
  name: string;
  projectId: string;
  url: string;
  title: string;
  description: string;
  eyebrow: string;
  headline: string;
  lede: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
  artifact: {
    label: string;
    title: string;
    input: string;
    output: string;
    meta: string[];
  };
  capabilities: { label: string; title: string; copy: string }[];
  boundary: { title: string; copy: string };
  footer: { note: string; links: { label: string; href: string }[] };
};

/** Replace every field. This is a compileable scaffold, not product copy. */
export const site: SiteConfig = {
  name: 'Product',
  projectId: 'product',
  url: 'https://product.example.com',
  title: 'Product — one clear job',
  description: 'Describe the real product outcome in one sentence.',
  eyebrow: 'Product category · honest status',
  headline: 'One clear job, shown with the product itself.',
  lede: 'Explain who this is for, what it helps them do, and the important boundary.',
  primary: { label: 'Open the product', href: '/app' },
  secondary: { label: 'Read how it works', href: '#how' },
  artifact: {
    label: 'Illustrative interface',
    title: 'Use a real product state when one is available.',
    input: 'A representative input or question',
    output: 'A representative result that demonstrates the product claim.',
    meta: ['Source or scope', 'Status or timing'],
  },
  capabilities: [
    { label: '01', title: 'First concrete capability', copy: 'Describe the actual behavior.' },
    { label: '02', title: 'Second concrete capability', copy: 'Keep the explanation specific.' },
    { label: '03', title: 'Third concrete capability', copy: 'Name a useful boundary or result.' },
  ],
  boundary: {
    title: 'Say what the product does not do.',
    copy: 'A clear boundary is stronger than another broad marketing claim.',
  },
  footer: {
    note: 'Independent product. Replace this line with accurate ownership and status.',
    links: [{ label: 'Source', href: 'https://github.com/' }],
  },
};
