import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmsTxt,
  buildApiAiCatalog,
  createAgentSurfaceManifest,
  createAgentSurfaceHandler,
  wantsMarkdown,
  isAgentPath,
  isHtmlShell,
  markdownPathFor,
  htmlPathFromMarkdown,
} from './index.mjs';
import { emitAgentSurfaces } from './adapters/astro-build.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('http helpers', () => {
  it('maps paths between html and markdown', () => {
    assert.equal(markdownPathFor('/'), '/index.md');
    assert.equal(markdownPathFor('/pricing'), '/pricing.md');
    assert.equal(htmlPathFromMarkdown('/index.md'), '/');
    assert.equal(htmlPathFromMarkdown('/pricing.md'), '/pricing');
  });

  it('detects agent paths', () => {
    assert.equal(isAgentPath('/llms.txt'), true);
    assert.equal(isAgentPath('/api/ai'), true);
    assert.equal(isAgentPath('/pricing.md'), true);
    assert.equal(isAgentPath('/pricing'), false);
  });

  it('detects markdown Accept preference', () => {
    assert.equal(
      wantsMarkdown({
        headers: { get: (k) => (k === 'accept' ? 'text/markdown' : null) },
      }),
      true
    );
    assert.equal(
      wantsMarkdown({
        headers: {
          get: (k) =>
            k === 'accept' ? 'text/markdown, text/html;q=0.9' : null,
        },
      }),
      true
    );
    assert.equal(
      wantsMarkdown({
        headers: {
          get: (k) =>
            k === 'accept' ? 'text/html, text/markdown;q=0.1' : null,
        },
      }),
      false
    );
  });

  it('detects HTML shells', () => {
    assert.equal(isHtmlShell('<!DOCTYPE html><html>', 'text/html'), true);
    assert.equal(isHtmlShell('# Hello', 'text/plain'), false);
  });
});

describe('llms + catalog builders', () => {
  it('builds llms.txt with product links', () => {
    const text = buildLlmsTxt({
      name: 'Demo',
      summary: 'A demo product for agents.',
      url: 'https://demo.example',
      product: [
        { title: 'Home', url: 'https://demo.example/', description: 'Landing' },
      ],
    });
    assert.match(text, /^# Demo/m);
    assert.match(text, /A demo product/);
    assert.match(text, /\/api\/ai/);
    assert.match(text, /Home/);
  });

  it('builds valid /api/ai catalog', () => {
    const cat = buildApiAiCatalog({
      name: 'demo',
      url: 'https://demo.example',
      surfaces: [
        { id: 'home', url: '/', md: '/index.md', kind: 'static' },
      ],
    });
    assert.equal(cat.llms, 'https://demo.example/llms.txt');
    assert.equal(cat.surfaces[0].url, 'https://demo.example/');
    assert.equal(cat.markdown.negotiation, true);
  });
});

describe('handler', () => {
  const manifest = createAgentSurfaceManifest({
    name: 'Demo',
    url: 'https://demo.example',
    summary: 'Demo summary for agents.',
    product: [{ title: 'Home', url: 'https://demo.example/' }],
    pages: {
      '/': '# Demo\n\nHello agents.\n',
      '/pricing': '# Pricing\n\nFree.\n',
    },
  });
  const handler = createAgentSurfaceHandler({ manifest });

  it('serves llms.txt', async () => {
    const res = await handler(new Request('https://demo.example/llms.txt'));
    assert.ok(res);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /^# Demo/);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
  });

  it('serves /api/ai JSON', async () => {
    const res = await handler(new Request('https://demo.example/api/ai'));
    assert.ok(res);
    const data = await res.json();
    assert.equal(data.name, 'Demo');
    assert.ok(Array.isArray(data.surfaces));
    assert.ok(data.surfaces.length >= 1);
  });

  it('serves index.md and negotiates markdown on /', async () => {
    const mdRes = await handler(new Request('https://demo.example/index.md'));
    assert.ok(mdRes);
    assert.match(await mdRes.text(), /Hello agents/);

    const neg = await handler(
      new Request('https://demo.example/', {
        headers: { Accept: 'text/markdown' },
      })
    );
    assert.ok(neg);
    assert.match(neg.headers.get('content-type') || '', /markdown|plain/);
    assert.match(await neg.text(), /Hello agents/);
  });

  it('falls through for normal HTML GET', async () => {
    const res = await handler(
      new Request('https://demo.example/', {
        headers: { Accept: 'text/html' },
      })
    );
    assert.equal(res, null);
  });

  it('serves pricing.md', async () => {
    const res = await handler(new Request('https://demo.example/pricing.md'));
    assert.ok(res);
    assert.match(await res.text(), /Pricing/);
  });
});

describe('astro-build emit', () => {
  it('writes llms.txt and page markdown', async () => {
    const fs = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'agent-surfaces-'));
    try {
      const manifest = createAgentSurfaceManifest({
        name: 'Emit',
        url: 'https://emit.example',
        summary: 'Emit test.',
        pages: { '/': '# Emit\n' },
      });
      const result = emitAgentSurfaces(manifest, dir, fs);
      assert.ok(result.llms.endsWith('llms.txt'));
      const llms = readFileSync(join(dir, 'llms.txt'), 'utf8');
      assert.match(llms, /# Emit/);
      const index = readFileSync(join(dir, 'index.md'), 'utf8');
      assert.match(index, /# Emit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
