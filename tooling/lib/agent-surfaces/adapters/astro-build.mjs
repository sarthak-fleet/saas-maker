/**
 * Astro / static build helper — write agent surface files into an out dir.
 *
 * Usage (Node ESM build script):
 *
 *   import fs from 'node:fs'
 *   import { emitAgentSurfaces } from '.../adapters/astro-build.mjs'
 *   emitAgentSurfaces(manifest, './public', fs)
 *
 * @param {ReturnType<import('../manifest.mjs').createAgentSurfaceManifest>} manifest
 * @param {string} outDir path to public/ or dist/
 * @param {{ writeFileSync: Function, mkdirSync: Function }} fs Node fs (required)
 */
export function emitAgentSurfaces(manifest, outDir, fs) {
  if (!manifest || !outDir) {
    throw new TypeError('emitAgentSurfaces(manifest, outDir, fs) required');
  }
  if (!fs?.writeFileSync || !fs?.mkdirSync) {
    throw new TypeError('emitAgentSurfaces: pass node:fs as third argument');
  }

  const { writeFileSync, mkdirSync } = fs;
  const join = (...parts) =>
    parts
      .join('/')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/');

  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'llms.txt'), manifest.llmsTxt, 'utf8');
  // Static hosts often cannot map /api/ai without a worker — also emit a file
  // agents can fetch when wired via _redirects or worker.
  writeFileSync(
    join(outDir, 'api-ai.json'),
    `${JSON.stringify(manifest.catalog, null, 2)}\n`,
    'utf8'
  );

  if (manifest.llmsFull) {
    writeFileSync(join(outDir, 'llms-full.txt'), manifest.llmsFull, 'utf8');
  }

  for (const [key, body] of Object.entries(manifest.pages || {})) {
    if (body == null) continue;
    let rel = key;
    if (rel === '/') rel = '/index.md';
    else if (!rel.endsWith('.md')) rel = `${rel.replace(/\/$/, '')}.md`;
    if (!rel.startsWith('/')) rel = `/${rel}`;

    const filePath = join(outDir, rel.slice(1));
    const dir = filePath.includes('/')
      ? filePath.slice(0, filePath.lastIndexOf('/'))
      : outDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, body, 'utf8');
  }

  return {
    llms: join(outDir, 'llms.txt'),
    pages: Object.keys(manifest.pages || {}).length,
  };
}
