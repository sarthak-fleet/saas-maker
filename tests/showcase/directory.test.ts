import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DIRECTORY_PROJECTS, directoryFormFamilies } from '../../apps/showcase/src/data/directory';

async function readRepository(relativePath: string) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('complete public Fleet directory', () => {
  it('projects all 58 identities exactly once with privacy-safe anatomy', async () => {
    const catalog = JSON.parse(await readRepository('catalog/generated/public.json'));
    const ids = catalog.directory.map((project: { id: string }) => project.id);
    const counts = (catalog.directory as Array<{ group: string }>).reduce<Record<string, number>>(
      (result, project) => {
        result[project.group] = (result[project.group] ?? 0) + 1;
        return result;
      },
      {}
    );

    expect(catalog.schemaVersion).toBe(3);
    expect(catalog.directory).toHaveLength(58);
    expect(new Set(ids).size).toBe(58);
    expect(counts.current).toBe(32);
    expect(counts.supporting).toBe(11);
    expect(counts.past).toBe(15);

    for (const project of catalog.directory) {
      expect(project.name).toBeTruthy();
      expect(project.description).toBeTruthy();
      expect(project.form).toBeTruthy();
      expect(project.platforms.length).toBeGreaterThan(0);
      expect(project.technologies.length).toBeGreaterThan(0);
      expect(JSON.stringify(project)).not.toMatch(
        /(?:sourcePath|cfProject|credential|password|private repository|\/Users\/)/i
      );
    }
  });

  it('renders a server-first directory with accessible filters and evidence links', async () => {
    const [page, data, nav, routes, jsonRoute] = await Promise.all([
      readRepository('apps/showcase/src/pages/projects.astro'),
      readRepository('apps/showcase/src/data/directory.ts'),
      readRepository('apps/showcase/src/components/Nav.astro'),
      readRepository('apps/showcase/src/data/publicRoutes.ts'),
      readRepository('apps/showcase/src/pages/projects.json.ts'),
    ]);

    expect(page).toMatch(/data-directory-row/);
    expect(page).toMatch(/Search name, purpose, stack, or domain/);
    expect(page).toMatch(/First retained commit/);
    expect(page).toMatch(/Latest retained commit/);
    expect(page).toMatch(/data-directory-filter-return/);
    expect(page).toMatch(/Inventory is not promotion/);
    expect(data).toMatch(/publicCatalog\.directory/);
    expect(nav).toMatch(/href="\/projects"/);
    expect(routes).toMatch(/path: '\/projects'/);
    expect(jsonRoute).toMatch(/JSON\.stringify\(directoryProjects\)/);
  });

  it('keeps established web identities discoverable through the public form families', () => {
    for (const projectId of [
      'significanthobbies',
      'veg-protein-food',
      'truehire',
      'today-little-log',
    ]) {
      const project = DIRECTORY_PROJECTS.find((candidate) => candidate.id === projectId);
      expect(project).toBeDefined();
      expect(directoryFormFamilies(project!)).toContain('Web');
    }
  });
});
