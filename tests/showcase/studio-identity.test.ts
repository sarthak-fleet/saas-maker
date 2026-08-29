import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GET as getAgentCatalog } from '../../apps/showcase/src/pages/api/ai';
import { GET as getAiCatalog } from '../../apps/showcase/src/pages/.well-known/ai-catalog.json';
import { GET as getHomeMarkdown } from '../../apps/showcase/src/pages/index.md';
import { GET as getLlms } from '../../apps/showcase/src/pages/llms.txt';
import { PUBLIC_ROUTES } from '../../apps/showcase/src/data/publicRoutes';
import { STUDIO_JSON_LD, STUDIO_PROFILE } from '../../apps/showcase/src/data/studio';

async function readShowcase(relativePath: string) {
  return readFile(new URL(`../../apps/showcase/${relativePath}`, import.meta.url), 'utf8');
}

describe('canonical SaaS Maker studio identity', () => {
  it('keeps an honest founder-led thesis with an explicit owner position on AI', () => {
    expect(STUDIO_PROFILE.name).toBe('SaaS Maker');
    expect(STUDIO_PROFILE.owner.name).toBe('Sarthak Agrawal');
    expect(STUDIO_PROFILE.owner.role).toBe('Founder and builder');
    expect(STUDIO_PROFILE.ownerVoice).toMatch(/^I use AI/);
    expect(STUDIO_PROFILE.ownerVoice).toContain('not as the identity of the work');
    expect(STUDIO_PROFILE.principles.map((principle) => principle.title)).toContain(
      'AI is material, not the pitch'
    );
    expect(STUDIO_PROFILE.boundaries).toContain(
      'SaaS Maker is not presented as a large team or institution.'
    );
  });

  it('selects a small, varied proof set from the reviewed public catalog', () => {
    const ids = STUDIO_PROFILE.representativeWork.map((project) => project.id);
    expect(ids).toEqual(['codevetter', 'posttrainllm', 'high-signal', 'anchor']);
    expect(new Set(ids).size).toBe(ids.length);

    for (const project of STUDIO_PROFILE.representativeWork) {
      expect(project.description).toBeTruthy();
      expect(project.makerNote).toMatch(/\b(?:I|me|my)\b/);
      expect(project.profileUrl).toBe(`https://sassmaker.com/p/${project.id}`);
      expect(project.destinationUrl).toMatch(/^https:\/\//);
      expect(project.studioSignal).toBeTruthy();
    }

    expect(
      STUDIO_PROFILE.representativeWork.filter((project) => project.repositoryUrl)
    ).toHaveLength(3);
  });

  it('projects the same studio facts into Markdown, llms.txt, and the agent catalog', async () => {
    const studioRoute = PUBLIC_ROUTES.find((route) => route.path === '/studio');
    const [llms, home, agentCatalog] = await Promise.all([
      getLlms().text(),
      getHomeMarkdown().text(),
      getAgentCatalog().json(),
    ]);

    expect(studioRoute).toBeDefined();
    expect(studioRoute?.markdown).toContain(STUDIO_PROFILE.oneLine);
    expect(studioRoute?.markdown).toContain(STUDIO_PROFILE.ownerVoice);
    expect(llms).toContain(STUDIO_PROFILE.oneLine);
    expect(llms).toContain(STUDIO_PROFILE.ownerVoice);
    expect(home).toContain(STUDIO_PROFILE.thesis);
    expect(agentCatalog.studio.oneLine).toBe(STUDIO_PROFILE.oneLine);
    expect(agentCatalog.studio.ownerVoice).toBe(STUDIO_PROFILE.ownerVoice);
    expect(agentCatalog.studio.markdown).toBe('https://sassmaker.com/studio.md');
    expect(agentCatalog.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'studio', url: 'https://sassmaker.com/studio' }),
      ])
    );
  });

  it('publishes a valid discovery catalog for the public directory and shared tooling', async () => {
    const catalog = await getAiCatalog().json();

    expect(catalog.specVersion).toBe('1.0');
    expect(catalog.host.identifier).toBe('did:web:sassmaker.com');
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'urn:air:sassmaker.com:catalog:public-directory',
          displayName: 'SaaS Maker public directory',
          url: 'https://sassmaker.com/api/ai',
        }),
        expect.objectContaining({
          identifier: 'urn:air:sassmaker.com:tooling:capabilities',
          displayName: 'SaaS Maker reusable tooling catalog',
          url: 'https://sassmaker.com/tools.json',
        }),
      ])
    );
  });

  it('publishes distinct, linked Person, studio, and WebSite entities', () => {
    const graph = STUDIO_JSON_LD['@graph'];
    const person = graph.find((node) => node['@type'] === 'Person');
    const studio = graph.find((node) => node['@type'] === 'Organization');
    const website = graph.find((node) => node['@type'] === 'WebSite');
    const ids = graph.map((node) => node['@id']);

    expect(new Set(ids).size).toBe(3);
    expect(person?.affiliation).toEqual({ '@id': studio?.['@id'] });
    expect(studio?.founder).toEqual({ '@id': person?.['@id'] });
    expect(website?.publisher).toEqual({ '@id': studio?.['@id'] });
    expect(website?.about).toEqual({ '@id': studio?.['@id'] });
  });

  it('keeps the human page and homepage entry point bound to the canonical profile', async () => {
    const [studioPage, hero, layout] = await Promise.all([
      readShowcase('src/pages/studio.astro'),
      readShowcase('src/components/Hero.astro'),
      readShowcase('src/layouts/Layout.astro'),
    ]);

    expect(studioPage).toMatch(/STUDIO_PROFILE\.ownerVoice/);
    expect(studioPage).toMatch(/STUDIO_PROFILE\.representativeWork/);
    expect(studioPage).toMatch(/project\.destinationUrl/);
    expect(studioPage).toMatch(/project\.repositoryUrl/);
    expect(hero).toMatch(/href="\/projects"/);
    expect(hero).toMatch(/STUDIO_PROFILE\.headline/);
    expect(layout).toMatch(/JSON\.stringify\(STUDIO_JSON_LD\)/);
    expect(layout).not.toMatch(/sassmaker\.com\/#app/);
  });
});
