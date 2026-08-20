export interface ChangelogEntry {
  date: string;
  label: string;
  title: string;
  summary: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-10',
    label: 'August 10, 2026',
    title: 'Tokens spent for the world became a public ledger',
    summary:
      'SaaS Maker now publishes verified aggregate model usage from its products as a cumulative studio measure.',
    changes: [
      'Seeded the ledger with CodeVetter’s authoritative lifetime and latest-day token records.',
      'Added a procedural Three.js globe, exact UTC recency, and privacy-safe regional pulse support.',
      'Kept the verified metrics readable with reduced motion, no script, or unavailable WebGL.',
    ],
  },
  {
    date: '2026-07-29',
    label: 'July 29, 2026',
    title: 'Product history moved onto the products',
    summary:
      'SaaS Maker now treats each maintained product website as the owner of its public release history.',
    changes: [
      'Added this product-owned changelog to SaaS Maker.',
      'Changed directory changelog links to open the product website instead of raw commit history.',
      'Changed roadmap links to open GitHub Issues for public repositories.',
    ],
  },
  {
    date: '2026-07-29',
    label: 'July 29, 2026',
    title: 'The directory became a workshop',
    summary:
      'The public directory and product detail pages moved into one architectural workshop system.',
    changes: [
      'Rebuilt product discovery as a responsive steel-and-glass product wall.',
      'Brought internal product detail pages into the same visual language.',
      'Expanded the maintained public directory while keeping private Fleet controls out.',
    ],
  },
  {
    date: '2026-07-24',
    label: 'July 24, 2026',
    title: 'SaaS Maker became a focused public directory',
    summary:
      'The separate SaaS Maker runtime was retired in favor of a smaller static public product surface.',
    changes: [
      'Removed the abandoned dashboard, API, authentication, and internal control-panel features.',
      'Kept the public directory on sassmaker.com and the private Fleet console separate.',
      'Removed services and storage SaaS Maker no longer needed without changing product domains.',
    ],
  },
  {
    date: '2026-07-23',
    label: 'July 23, 2026',
    title: 'Feedback became a backend-free package',
    summary:
      'The maintained feedback capability was narrowed to a small React package that products control.',
    changes: [
      'Removed SaaS Maker-owned submission, inbox, authentication, and storage services.',
      'Let each integrating product decide how feedback is submitted and stored.',
    ],
  },
];
