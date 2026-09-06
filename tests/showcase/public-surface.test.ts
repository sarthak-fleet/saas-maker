import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GET as getAIChatFooterScript } from '../../apps/showcase/src/pages/ai-chat-footer.js';

async function readShowcase(relativePath: string) {
  return readFile(new URL(`../../apps/showcase/${relativePath}`, import.meta.url), 'utf8');
}

describe('SaaS Maker public source boundary', () => {
  it('serves the backend-free AI footer loader cross-origin', async () => {
    const response = getAIChatFooterScript();
    const source = await response.text();

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(source).toMatch(/customElements\.define\('ai-chat-footer'/);
    expect(source).toMatch(/Explore .+ with AI/);
    expect(source).toMatch(/createProviderLogo/);
    expect(source).toMatch(/dataset\.aiProvider/);
    expect(source).toMatch(/link\.title = providerName/);
    expect(source).not.toMatch(/createTextNode\(providerName\)/);
    expect(source.match(/data:image\/jpeg;base64,/g)).toHaveLength(5);
    expect(source).toMatch(/document\.createElement\('img'\)/);
    expect(source).not.toMatch(/createProviderIcon|CHATGPT_SEGMENT|provider-color/);
    expect(source).toMatch(/More from the studio/);
    expect(source).toMatch(/customElements\.define\('fleet-footer-extension'/);
    expect(source).toMatch(/strip\.setAttribute\('integrated'/);
    expect(source).toMatch(/footer\.slot = 'ai'/);
    expect(source).toMatch(/strip\.slot = 'projects'/);
    expect(source).not.toMatch(/strip\.remove\(\)/);
    expect(source).not.toMatch(/analytics|localStorage|credential/i);
    expect(() => new Function(source)).not.toThrow();
  });

  it('exposes the canonical standalone source without exposing Fleet', async () => {
    const [
      links,
      registrySource,
      projectsSource,
      routesSource,
      navSource,
      iconSource,
      redirects,
      catalog,
    ] = await Promise.all([
      readShowcase('src/data/links.ts'),
      readShowcase('src/data/registry.ts'),
      readShowcase('src/data/projects.ts'),
      readShowcase('src/data/publicRoutes.ts'),
      readShowcase('src/components/Nav.astro'),
      readShowcase('src/components/GitHubIcon.astro'),
      readShowcase('public/_redirects'),
      readFile(new URL('../../catalog/generated/public.json', import.meta.url), 'utf8'),
    ]);

    const saasMaker = JSON.parse(catalog).products.find(
      (product: { id: string }) => product.id === 'saas-maker'
    );
    expect(links).toMatch(/https:\/\/github\.com\/sarthakagrawal927['"]/);
    expect(links).toMatch(/https:\/\/github\.com\/sass-maker['"]/);
    expect(saasMaker.repositoryUrl).toBe('https://github.com/sass-maker/saas-maker');
    expect(saasMaker.roadmapUrl).toBe('https://github.com/sass-maker/saas-maker/issues');
    expect([links, registrySource, projectsSource, routesSource, navSource].join('\n')).not.toMatch(
      /github\.com\/sass-maker\/fleet-workspace/
    );
    expect(registrySource).toMatch(
      /PAGED_PRODUCTS = REGISTRY_PRODUCTS\.filter\(\(product\) => product\.id !== 'saas-maker'\)/
    );
    expect(projectsSource).toMatch(/\['personal-website', 'saas-maker'\]\.includes\(product\.id\)/);
    expect(routesSource).toMatch(/CORE\.flatMap/);
    expect(routesSource).toMatch(/DIRECTORY_PROJECTS\.filter/);
    expect(routesSource).toMatch(/product\.makerNote/);
    expect(navSource).toMatch(/GITHUB_REPO_URL/);
    expect(navSource).toMatch(/aria-label="GitHub repository"/);
    expect(navSource).toMatch(/<GitHubIcon/);
    expect(navSource).not.toMatch(/>GitHub ↗<\/a>/);
    expect(iconSource).toMatch(/viewBox="0 0 16 16"/);
    expect(iconSource).toMatch(/width="20"/);
    expect(iconSource).toMatch(/height="20"/);
    expect(iconSource).toMatch(/fill="currentColor"/);
    expect(iconSource).toMatch(/aria-hidden="true"/);
    expect(iconSource).toMatch(/M8 0C3\.58/);
    expect(navSource).not.toMatch(/\/#package|Public source index/);
    expect(redirects).toMatch(/^\/p\/saas-maker \/ 301$/m);
    expect(redirects).toMatch(/^\/p\/saas-maker\.md \/index\.md 301$/m);
  });

  it('exposes the complete learning article to agents', async () => {
    const [routesSource, articleMarkdown] = await Promise.all([
      readShowcase('src/data/publicRoutes.ts'),
      readShowcase('src/data/articles/skills-should-declare-capabilities-not-model-names.md'),
    ]);

    expect(routesSource).toMatch(/markdown: learning\.markdown/);
    expect(articleMarkdown).toMatch(/## What is the methodology\?/);
    expect(articleMarkdown).toMatch(/## Where does it fall short\?/);
    expect(articleMarkdown).toMatch(/## Sources and implementation/);
    expect(articleMarkdown.split(/\s+/u).length).toBeGreaterThan(700);
    expect(articleMarkdown).not.toMatch(/full article is available at/i);
  });

  it('publishes the canonical reusable tooling directory', async () => {
    const [page, data, nav, agentCatalog, llms] = await Promise.all([
      readShowcase('src/pages/tools.astro'),
      readShowcase('src/data/tooling.ts'),
      readShowcase('src/components/Nav.astro'),
      readShowcase('src/pages/api/ai.ts'),
      readShowcase('src/pages/llms.txt.ts'),
    ]);

    expect(page).toMatch(/Tools that survived reuse/);
    expect(page).toMatch(/TOOLING_GROUPS/);
    expect(data).toMatch(/\.\.\/\.\.\/\.\.\/\.\.\/tooling/);
    expect(nav).toMatch(/href="\/tools"/);
    expect(agentCatalog).toMatch(/TOOLING_CAPABILITIES/);
    expect(agentCatalog).toMatch(/sass-maker\/saas-maker\/tooling/);
    expect(llms).toMatch(/Reusable tooling/);
  });

  it('keeps the homepage curated and reserves full enumeration for /projects', async () => {
    const [home, fleet, layout, routes, projects] = await Promise.all([
      readShowcase('src/pages/index.astro'),
      readShowcase('src/components/Fleet.astro'),
      readShowcase('src/layouts/Layout.astro'),
      readShowcase('src/data/publicRoutes.ts'),
      readShowcase('src/data/projects.ts'),
    ]);

    expect(home).toMatch(/<Hero \/>/);
    expect(home).toMatch(/SaaS Maker — Fleet products and shared tooling/);
    expect(fleet).toMatch(/DIRECTORY_COUNT/);
    expect(fleet).toMatch(/Open the complete directory/);
    expect(fleet).toMatch(/<h2 id="learning-title"/);
    expect(fleet).not.toMatch(/ACTIVE_GROUPS|PAST_PROJECTS|catalog-row|archive-wall/);
    expect(fleet).not.toMatch(/project identities|accounted for once/);
    expect(layout).toMatch(/src="\/project-strip\.js"/);
    expect(layout).toMatch(/data-project="saas-maker"/);
    expect(layout).toMatch(/src="\/ai-chat-footer\.js"/);
    expect(routes).toMatch(/# Products in focus/);
    expect(routes).toMatch(/# Complete directory/);
    expect(routes).toMatch(/CORE\.flatMap/);
    expect(routes).not.toMatch(/publicCatalog\.pastProjects\.flatMap/);
    expect(projects).toMatch(/throw new Error\(`Homepage spotlight is missing/);
    expect(projects).not.toMatch(/ACTIVE_GROUPS|PAST_PROJECTS/);
  });

  it('publishes one expanded profile and Markdown route for every non-directory identity', async () => {
    const [detailPage, routesSource, catalogSource] = await Promise.all([
      readShowcase('src/pages/p/[id].astro'),
      readShowcase('src/data/publicRoutes.ts'),
      readFile(new URL('../../catalog/generated/public.json', import.meta.url), 'utf8'),
    ]);
    const catalog = JSON.parse(catalogSource);

    expect(catalog.directory).toHaveLength(56);
    expect(detailPage).toMatch(/DIRECTORY_PROJECTS\.filter/);
    expect(detailPage).toMatch(/Why I made this\./);
    expect(detailPage).toMatch(/Public anatomy/);
    expect(detailPage).toMatch(/product\.makerNote/);
    expect(detailPage).toMatch(/product\.purposeContract/);
    expect(routesSource).toMatch(/Product contract/);
    expect(routesSource).toMatch(/path: `\/p\/\$\{product\.id\}`/);
    expect(routesSource).toMatch(/This profile is generated from reviewed public facts/);
  });
});
