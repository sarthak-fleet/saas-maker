import publicCatalog from '../../../../catalog/generated/public.json';

interface PublicProject {
  id: string;
  name: string;
  description: string;
  url: string;
  priority: 'P1' | 'P2' | 'P4';
  category: string;
  pillarId: string;
  spotlight: boolean;
  maturity: string;
}

export const portfolioProjects = (publicCatalog.products as PublicProject[]).map(
  ({ id, name, description, url, priority, category, maturity, spotlight, pillarId }) => ({
    id,
    name,
    url,
    description,
    priority,
    category,
    maturity,
    spotlight,
    pillarId,
    domains: [new URL(url).hostname],
  })
);

export const directoryProjects = publicCatalog.directory;
