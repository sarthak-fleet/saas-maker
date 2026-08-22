// The canonical tooling catalog is built from checked-in, public source at
// build time. It never reads Fleet-private state.
import { buildCatalog, listCapabilities } from '../../../../tooling/lib/capability-catalog.mjs';

export type ToolingCapability = {
  id: string;
  type: 'skill' | 'script' | 'template' | 'doc';
  name: string;
  summary: string;
  path: string;
  executionProfile?: {
    recommended: { intelligence: string; reasoning: string };
    minimum: { intelligence: string; reasoning: string };
    degradation: string;
  } | null;
};

const catalog = buildCatalog(new URL('../../../../tooling', import.meta.url).pathname);

if (catalog.issues.some((issue: { level: string }) => issue.level === 'error')) {
  throw new Error('SaaS Maker tooling catalog is invalid; run pnpm tooling:check.');
}

export const TOOLING_CAPABILITIES = listCapabilities(catalog) as ToolingCapability[];
export const TOOLING_GROUPS = (['skill', 'script', 'template', 'doc'] as const).map((type) => ({
  type,
  label: {
    skill: 'Agent skills',
    script: 'Operator scripts',
    template: 'Templates',
    doc: 'Guides',
  }[type],
  items: TOOLING_CAPABILITIES.filter((item) => item.type === type),
}));
