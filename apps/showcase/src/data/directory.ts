import publicCatalog from '../../../../catalog/generated/public.json';

export type DirectoryGroupId = 'current' | 'supporting' | 'past';

export interface DirectoryProject {
  id: string;
  name: string;
  description: string;
  makerNote: string;
  kind: 'product' | 'platform' | 'experiment';
  form: string;
  platforms: string[];
  technologies: string[];
  group: DirectoryGroupId;
  lifecycle: string;
  deployed: boolean;
  deploymentProviders: string[];
  domains: string[];
  url?: string;
  repositoryUrl?: string;
  changelogUrl?: string;
  roadmapUrl?: string;
  firstCommitAt: string | null;
  latestCommitAt: string | null;
}

export const DIRECTORY_PROJECTS = publicCatalog.directory as DirectoryProject[];

const GROUP_COPY: Record<DirectoryGroupId, { label: string; description: string }> = {
  current: {
    label: 'Current work',
    description: 'Products and platforms inside the current Fleet working set.',
  },
  supporting: {
    label: 'Supporting and parked',
    description: 'Useful tools, local surfaces, and retained work outside the current focus set.',
  },
  past: {
    label: 'Past projects',
    description:
      'Archived experiments and source history, kept visible without implying maintenance.',
  },
};

export const DIRECTORY_GROUPS = (['current', 'supporting', 'past'] as const).map((id) => ({
  id,
  ...GROUP_COPY[id],
  projects: DIRECTORY_PROJECTS.filter((project) => project.group === id),
}));

export const DIRECTORY_FORMS = [
  'Web',
  'Apple native',
  'Desktop and local',
  'API and backend',
  'Package and library',
  'Research and data',
  'Media and game',
] as const;

export function directoryFormFamilies(project: DirectoryProject) {
  const form = project.form.toLocaleLowerCase();
  const families = new Set<(typeof DIRECTORY_FORMS)[number]>();

  if (form.includes('web') || project.platforms.includes('Web')) families.add('Web');
  if (project.platforms.some((platform) => platform === 'iOS' || platform === 'watchOS')) {
    families.add('Apple native');
  }
  if (
    form.match(/desktop|local|tool|platform|cli/) ||
    project.platforms.some((platform) =>
      ['macOS', 'Windows', 'Linux', 'Local', 'CLI'].includes(platform)
    )
  ) {
    families.add('Desktop and local');
  }
  if (form.match(/api|backend|service|worker/) || project.platforms.includes('API')) {
    families.add('API and backend');
  }
  if (form.match(/package|library|connector/)) families.add('Package and library');
  if (form.match(/research|dataset|benchmark|observatory/)) families.add('Research and data');
  if (form.match(/video|game|media|animation/)) families.add('Media and game');
  if (families.size === 0) families.add('Desktop and local');

  return [...families];
}

export const DIRECTORY_PLATFORMS = [
  ...new Set(DIRECTORY_PROJECTS.flatMap((project) => project.platforms)),
].sort((left, right) => left.localeCompare(right));

export const DIRECTORY_COUNT = DIRECTORY_PROJECTS.length;
export const HISTORY_SEMANTICS = publicCatalog.historySemantics;
