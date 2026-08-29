import publicCatalog from '../../../../catalog/generated/public.json';

export type StudioPrinciple = {
  title: string;
  summary: string;
};

export type StudioProof = {
  id: string;
  name: string;
  description: string;
  makerNote: string;
  profileUrl: string;
  destinationUrl: string | null;
  repositoryUrl: string | null;
  studioSignal: string;
};

export type StudioProfile = {
  name: string;
  url: string;
  owner: {
    name: string;
    role: string;
    url: string;
  };
  eyebrow: string;
  headline: string;
  oneLine: string;
  thesis: string;
  ownerVoice: string;
  aiPosition: string;
  principles: StudioPrinciple[];
  boundaries: string[];
  representativeWork: StudioProof[];
};

type PublicProject = (typeof publicCatalog.directory)[number];

const SITE_URL = 'https://sassmaker.com';
const representativeSignals: Record<string, string> = {
  codevetter: 'AI with rigor: useful model assistance without surrendering a local-first workflow.',
  posttrainllm:
    'Deep technical practice turned into repeatable infrastructure for specialist models.',
  'high-signal':
    'Evidence is the product: scattered inputs become a source-backed daily decision surface.',
  anchor:
    'The studio is broader than AI: personal software can still be ambitious, local, and deeply considered.',
};

function toProof(project: PublicProject): StudioProof {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    makerNote: project.makerNote,
    profileUrl: `${SITE_URL}/p/${project.id}`,
    destinationUrl: project.domains[0] ? `https://${project.domains[0]}` : null,
    repositoryUrl: project.repositoryUrl ?? null,
    studioSignal: representativeSignals[project.id],
  };
}

const representativeWork = Object.keys(representativeSignals).map((id) => {
  const project = publicCatalog.directory.find((candidate) => candidate.id === id);
  if (!project) throw new Error(`Studio proof is missing the public catalog entry for ${id}`);
  return toProof(project);
});

export const STUDIO_PROFILE: StudioProfile = {
  name: 'SaaS Maker',
  url: SITE_URL,
  owner: {
    name: 'Sarthak Agrawal',
    role: 'Founder and builder',
    url: 'https://sarthakagrawal.dev',
  },
  eyebrow: 'Public directory · shared workshop',
  headline: 'The products. And the tools behind them.',
  oneLine:
    'SaaS Maker is the public directory for Fleet products and the reusable packages, skills, templates, and feedback layer that help them ship.',
  thesis:
    'SaaS Maker keeps the public product inventory inspectable and publishes the shared workshop used across it, without becoming the private Fleet control plane.',
  ownerVoice:
    'I use AI as material, infrastructure, and a collaborator—but not as the identity of the work. The studio is about choosing useful problems, building the right product around them, and maintaining what earns its place.',
  aiPosition:
    'AI belongs inside the craft: in the capability, the research, and the way the work gets built. It should make a product more useful or make a difficult workflow possible; it is not a substitute for product judgment.',
  principles: [
    {
      title: 'Problem before category',
      summary:
        'Work begins with a specific friction worth owning, not a fashionable market label or a feature looking for a product.',
    },
    {
      title: 'AI is material, not the pitch',
      summary:
        'Models are used where they create real leverage. The product still needs a reason to exist when the novelty disappears.',
    },
    {
      title: 'Evidence over posture',
      summary:
        'Real destinations, source, changelogs, and honest operating boundaries carry more weight than invented scale or broad claims.',
    },
    {
      title: 'Each product keeps its shape',
      summary:
        'The studio supplies standards and shared craft without flattening every product into one design, stack, or business model.',
    },
  ],
  boundaries: [
    'SaaS Maker is not presented as a large team or institution.',
    'The complete directory is an accountable inventory, not a claim that every experiment is equally active.',
    'Products keep their own identity, destination, support, and operational boundary.',
    'What is public is deliberate and verifiable; what is private stays outside the story.',
  ],
  representativeWork,
};

const personId = 'https://sarthakagrawal.dev/#person';
const studioId = `${SITE_URL}/#studio`;
const websiteId = `${SITE_URL}/#website`;

export const STUDIO_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      '@id': personId,
      name: STUDIO_PROFILE.owner.name,
      jobTitle: 'AI Infrastructure & Product Engineer',
      url: STUDIO_PROFILE.owner.url,
      image: 'https://avatars.githubusercontent.com/u/43884471?v=4',
      sameAs: [
        STUDIO_PROFILE.owner.url,
        'https://www.linkedin.com/in/sarthakagrawal927',
        'https://github.com/sarthakagrawal927',
        'https://x.com/sarthakcodes',
        'https://huggingface.co/sarthakagrawal927',
      ],
      knowsAbout: [
        'AI infrastructure',
        'Local-first software',
        'Post-training language models',
        'AI code review',
        'Product engineering',
      ],
      affiliation: { '@id': studioId },
    },
    {
      '@type': 'Organization',
      '@id': studioId,
      name: STUDIO_PROFILE.name,
      url: STUDIO_PROFILE.url,
      description: STUDIO_PROFILE.oneLine,
      founder: { '@id': personId },
      sameAs: ['https://github.com/sass-maker'],
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      name: STUDIO_PROFILE.name,
      alternateName: ['SassMaker', 'sassmaker.com'],
      url: STUDIO_PROFILE.url,
      description: STUDIO_PROFILE.oneLine,
      publisher: { '@id': studioId },
      about: { '@id': studioId },
    },
  ],
};
