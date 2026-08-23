import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readRepository(relativePath: string) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('integrated ideas catalog', () => {
  it('preserves the complete scored dataset inside SaaS Maker', async () => {
    const ideas = JSON.parse(await readRepository('apps/showcase/src/data/ideas.json'));

    expect(ideas).toHaveLength(140);
    expect(ideas.filter((idea: { best_bet: boolean }) => idea.best_bet)).toHaveLength(71);
    expect(
      ideas.every((idea: Record<string, unknown>) =>
        ['idea', 'money', 'fun', 'f_feas', 'customer', 'source', 'best_bet'].every(
          (field) => field in idea
        )
      )
    ).toBe(true);
  });

  it('publishes human, JSON, Markdown, navigation, and agent discovery surfaces', async () => {
    const [page, jsonRoute, nav, routes, llms] = await Promise.all([
      readRepository('apps/showcase/src/pages/ideas.astro'),
      readRepository('apps/showcase/src/pages/ideas.json.ts'),
      readRepository('apps/showcase/src/components/Nav.astro'),
      readRepository('apps/showcase/src/data/publicRoutes.ts'),
      readRepository('apps/showcase/src/pages/llms.txt.ts'),
    ]);

    expect(page).toMatch(/data-idea-query/);
    expect(page).toMatch(/data-idea-source/);
    expect(page).toMatch(/data-idea-customer/);
    expect(page).toMatch(/data-idea-money/);
    expect(page).toMatch(/data-idea-fun/);
    expect(page).toMatch(/data-idea-best/);
    expect(page).toMatch(/data-sort=/);
    expect(page).toMatch(/source !== 'starterstory'/);
    expect(jsonRoute).toMatch(/JSON\.stringify\(ideas\)/);
    expect(nav).toMatch(/href="\/ideas"/);
    expect(routes).toMatch(/path: '\/ideas'/);
    expect(llms).toMatch(/https:\/\/sassmaker\.com\/ideas/);
  });
});
