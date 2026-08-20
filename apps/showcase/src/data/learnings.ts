import capabilitiesLearningMarkdown from './articles/skills-should-declare-capabilities-not-model-names.md?raw';

export const LEARNINGS = [
  {
    slug: 'skills-should-declare-capabilities-not-model-names',
    title: 'Skills should declare capabilities, not model names',
    description:
      'Why portable agent skills need provider-neutral intelligence and reasoning requirements, and how Fleet is testing the idea.',
    publishedAt: '2026-07-28',
    publishedLabel: 'July 28, 2026',
    readingTime: '7 min read',
    author: 'Sarthak Agrawal',
    href: '/learnings/skills-should-declare-capabilities-not-model-names',
    markdown: capabilitiesLearningMarkdown,
  },
] as const;
