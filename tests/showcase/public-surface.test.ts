import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readShowcase(relativePath: string) {
  return readFile(new URL(`../../apps/showcase/${relativePath}`, import.meta.url), 'utf8');
}

describe('SaaS Maker public source boundary', () => {
  it('exposes the canonical standalone source without exposing Fleet', async () => {
    const [links, registrySource, projectsSource, routesSource, navSource, redirects, catalog] =
      await Promise.all([
        readShowcase('src/data/links.ts'),
        readShowcase('src/data/registry.ts'),
        readShowcase('src/data/projects.ts'),
        readShowcase('src/data/publicRoutes.ts'),
        readShowcase('src/components/Nav.astro'),
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
    expect(routesSource).toMatch(/filter\(\(product\) => product\.id !== 'saas-maker'\)/);
    expect(navSource).toMatch(/GITHUB_ORG_URL/);
    expect(navSource).toMatch(/Public source index/);
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
});
