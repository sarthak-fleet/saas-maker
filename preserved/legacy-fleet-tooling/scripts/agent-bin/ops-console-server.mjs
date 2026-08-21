import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { consoleRequestAuthorized } from '../../lib/founder-control/access.mjs';
import { loadFounderProjects } from '../../lib/founder-control/registry.mjs';
import { createFounderControlHandler } from '../../lib/founder-control/service.mjs';
import { FounderControlStore, defaultDatabasePath } from '../../lib/founder-control/store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT || 4329);
const trustAccessHeaders = process.env.FOUNDER_CONTROL_TRUST_ACCESS === '1';
const ownerEmail = process.env.FOUNDER_CONTROL_OWNER_EMAIL;
const founderStore = new FounderControlStore({
  databasePath: process.env.FOUNDER_CONTROL_DB || defaultDatabasePath(),
  projects: loadFounderProjects(join(root, 'config', 'projects.json')),
});
const founderHandler = createFounderControlHandler({
  store: founderStore,
  ownerToken: process.env.FOUNDER_CONTROL_OWNER_TOKEN,
  trustAccessHeaders,
  ownerEmail,
});

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const clean = normalize(decoded).replace(/^[/\\]+/, '').replace(/^(\.\.[/\\])+/, '');
  const candidate = join(dist, clean);
  return candidate.startsWith(dist) ? candidate : null;
}

function assetFor(pathname) {
  const candidate = safePath(pathname);
  if (!candidate) return null;
  const choices = [candidate, join(candidate, 'index.html'), `${candidate}.html`];
  return choices.find((choice) => choice.startsWith(dist) && existsSync(choice) && statSync(choice).isFile()) ?? null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }
  if (!consoleRequestAuthorized(request, { trustAccessHeaders, ownerEmail })) {
    response.writeHead(401, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Cloudflare Access authentication required');
    return;
  }
  if (url.pathname.startsWith('/api/founder')) {
    request.url = `${url.pathname.slice('/api/founder'.length) || '/'}${url.search}`;
    await founderHandler(request, response);
    return;
  }
  if (url.pathname === '/api/runtime') {
    try {
      const heartbeat = readFileSync(join(root, 'runtime.json'), 'utf8');
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(heartbeat);
    } catch {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'heartbeat unavailable' }));
    }
    return;
  }

  const file = assetFor(url.pathname);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  response.end(readFileSync(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Foundry listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => founderStore.close());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
