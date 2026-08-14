export interface PortfolioProject {
  id: string;
  name: string;
  url: string;
  description?: string;
  tier?: 'focus' | 'active' | 'secondary' | 'parked';
  priority?: 'P1' | 'P2' | 'P3';
  category?: string;
  maturity?: string;
  spotlight?: boolean;
  pillarId?: string;
  domains?: readonly string[];
}

export type PortfolioTheme = 'light' | 'dark' | 'auto';

export interface PortfolioProjectStripProps {
  /** Projects to render. Defaults to the generated Fleet catalog. */
  projects?: readonly PortfolioProject[];
  /** Optional static JSON endpoint for background revalidation. */
  catalogUrl?: string;
  /** Project to hide when this strip is embedded on one of the projects. */
  currentProjectId?: string;
  label?: string;
  theme?: PortfolioTheme;
  className?: string;
  /** Marquee duration in seconds. */
  speed?: number;
}
