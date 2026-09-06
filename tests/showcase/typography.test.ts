import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function showcase(relativePath: string) {
  return new URL(`../../apps/showcase/${relativePath}`, import.meta.url);
}

async function readShowcase(relativePath: string) {
  return readFile(showcase(relativePath), 'utf8');
}

describe('showcase typography', () => {
  it('never puts a third-party font origin on the critical path', async () => {
    const [layout, css] = await Promise.all([
      readShowcase('src/layouts/Layout.astro'),
      readShowcase('src/styles/globals.css'),
    ]);

    for (const source of [layout, css]) {
      expect(source).not.toMatch(/fonts\.googleapis\.com/);
      expect(source).not.toMatch(/fonts\.gstatic\.com/);
    }
  });

  it('self-hosts Schibsted Grotesk and preloads it', async () => {
    const [layout, css] = await Promise.all([
      readShowcase('src/layouts/Layout.astro'),
      readShowcase('src/styles/globals.css'),
    ]);

    const font = await stat(showcase('public/fonts/schibsted-grotesk-v7-latin.woff2'));
    expect(font.size).toBeGreaterThan(0);
    // Parity with the single variable file Google served; a full static set
    // would be several times this.
    expect(font.size).toBeLessThan(60_000);

    expect(css).toMatch(
      /src: url\("\/fonts\/schibsted-grotesk-v7-latin\.woff2"\) format\("woff2"\)/
    );
    expect(layout).toMatch(/rel="preload"[\s\S]*schibsted-grotesk-v7-latin\.woff2/);
    expect(layout).toMatch(/as="font"/);
    expect(layout).toMatch(/crossorigin/);
  });

  it('cannot reflow on font arrival', async () => {
    const css = await readShowcase('src/styles/globals.css');

    // `optional` is what makes the swap unobservable: the browser either has
    // the font inside its block period or never applies it on this view.
    expect(css).toMatch(/font-display: optional;/);
    // And the face that renders instead has to occupy the same space.
    expect(css).toMatch(/font-family: "Schibsted Grotesk Fallback";/);
    expect(css).toMatch(/size-adjust: 105\.3%;/);
    expect(css).toMatch(/ascent-override: 92\.74%;/);
    expect(css).toMatch(/descent-override: 24\.48%;/);
    expect(css).toMatch(/line-gap-override: 0%;/);
    expect(css).toMatch(/--sans: "Schibsted Grotesk", "Schibsted Grotesk Fallback", system-ui/);
  });

  it('serves the font immutably', async () => {
    const headers = await readShowcase('public/_headers');
    expect(headers).toMatch(/^\/fonts\/\*$/m);
    expect(headers).toMatch(/\/fonts\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  });
});
