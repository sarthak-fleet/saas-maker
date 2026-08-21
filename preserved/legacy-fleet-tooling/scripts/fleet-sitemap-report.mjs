#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { visibilityProjects } from '../lib/visibility-projects.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const CATALOG_PATH = resolve(FLEET_ROOT, 'foundry/ops/config/projects.json');
const OUTPUT_PATH = resolve(FLEET_ROOT, 'foundry/ops/docs/sitemap-submission-latest.md');
const MAX_SITEMAPS_PER_DOMAIN = 50;
const TIMEOUT_MS = 15_000;

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const targets = visibilityProjects(catalog)
  .flatMap((project) =>
    (project.domains ?? []).map((domain, index) => ({
      projectId: project.id,
      projectName: project.public?.name ?? project.name ?? project.id,
      domain,
      primary: index === 0,
    })),
  );

const results = await Promise.all(targets.map(auditTarget));
const generatedAt = new Date().toISOString();
const primary = results.filter((result) => result.primary);
const ready = primary.filter((result) => result.state === 'ready');
const blocked = primary.filter((result) => result.state !== 'ready');

const markdown = `# Google sitemap submission

Generated ${generatedAt} from the visibility inventory in
\`foundry/ops/config/projects.json\`.

Verify the eight apex domains as Google Search Console **Domain properties**,
then submit every **primary** host's sitemap under its matching apex property.
Domain properties cover their subdomains, so subdomains do not need separate
properties. Secondary private, search, or ingestion hosts are reported for
completeness and should not be submitted as separate public websites.

**Primary sitemap readiness: ${ready.length}/${primary.length}.**

| Project | Domain | Role | Same-host URLs | State | Sitemap |
| --- | --- | --- | ---: | --- | --- |
${results.map(renderRow).join('\n')}

## Not submit-ready

${blocked.length ? blocked.map(renderProblem).join('\n') : '_All primary sitemaps are ready._'}

## Notes

- “Same-host URLs” counts \`<url><loc>\` entries on the declared hostname,
  including entries reached through sitemap indexes.
- A 200 response containing the application HTML shell is not a sitemap.
- An XML sitemap whose URLs point at another hostname is reported as a
  wrong-host sitemap.
`;

writeFileSync(OUTPUT_PATH, markdown, 'utf8');

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ generatedAt, results }, null, 2)}\n`);
} else {
  process.stdout.write(
    `Sitemap report: ${ready.length}/${primary.length} primary domains ready → ${OUTPUT_PATH}\n`,
  );
}

if (ready.length !== primary.length) process.exitCode = 1;

async function auditTarget(target) {
  const origin = `https://${target.domain}`;
  const candidates = new Set([
    `${origin}/sitemap.xml`,
    ...(await discoverRobotSitemaps(origin)),
    `${origin}/sitemap-index.xml`,
  ]);
  let fallback = null;
  for (const sitemapUrl of candidates) {
    const result = await auditSitemap(target, sitemapUrl);
    if (!fallback) fallback = result;
    if (result.state === 'ready') return result;
  }
  return fallback;
}

async function discoverRobotSitemaps(origin) {
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'fleet-sitemap-report/1.0 (+https://sassmaker.com)' },
    });
    if (!response.ok) return [];
    const body = await response.text();
    return [...body.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map((match) => match[1]);
  } catch {
    return [];
  }
}

async function auditSitemap(target, sitemapUrl) {
  const visited = new Set();
  const sameHostUrls = new Set();
  const offHostUrls = new Set();
  let rootStatus = null;
  let rootContentType = null;
  let rootLooksHtml = false;

  try {
    await visitSitemap(sitemapUrl, true);
  } catch (error) {
    return {
      ...target,
      sitemapUrl,
      state: 'error',
      urlCount: sameHostUrls.size,
      detail: String(error?.message ?? error),
    };
  }

  let state = 'ready';
  let detail = `${sameHostUrls.size} same-host URL${sameHostUrls.size === 1 ? '' : 's'}`;
  if (rootStatus !== 200) {
    state = `http-${rootStatus ?? 'error'}`;
    detail = `HTTP ${rootStatus ?? 'error'}`;
  } else if (rootLooksHtml || !isXml(rootContentType)) {
    state = 'not-xml';
    detail = 'application HTML or non-XML response';
  } else if (sameHostUrls.size === 0 && offHostUrls.size > 0) {
    state = 'wrong-host';
    detail = `${offHostUrls.size} URL${offHostUrls.size === 1 ? '' : 's'} point elsewhere`;
  } else if (sameHostUrls.size === 0) {
    state = 'empty';
    detail = 'no same-host URLs';
  }

  return {
    ...target,
    sitemapUrl,
    state,
    urlCount: sameHostUrls.size,
    detail,
  };

  async function visitSitemap(url, root = false) {
    if (visited.has(url)) return;
    if (visited.size >= MAX_SITEMAPS_PER_DOMAIN) {
      throw new Error(`more than ${MAX_SITEMAPS_PER_DOMAIN} sitemap documents`);
    }
    visited.add(url);

    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'fleet-sitemap-report/1.0 (+https://sassmaker.com)' },
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (root) {
      rootStatus = response.status;
      rootContentType = contentType;
      rootLooksHtml = /<!doctype html|<html[\s>]/i.test(body.slice(0, 1_000));
    }
    if (!response.ok || !isXml(contentType) || /<!doctype html|<html[\s>]/i.test(body.slice(0, 1_000))) {
      return;
    }

    const locations = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
      .map((match) => decodeXml(match[1].trim()));
    if (/<sitemapindex[\s>]/i.test(body)) {
      for (const location of locations) await visitSitemap(location);
      return;
    }
    for (const location of locations) {
      try {
        const hostname = new URL(location).hostname.replace(/^www\./, '');
        if (hostname === target.domain.replace(/^www\./, '')) sameHostUrls.add(location);
        else offHostUrls.add(location);
      } catch {
        offHostUrls.add(location);
      }
    }
  }
}

function isXml(contentType) {
  return /(?:application|text)\/(?:[a-z0-9.+-]*\+)?xml/i.test(contentType);
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function renderRow(result) {
  const role = result.primary ? 'Submit' : 'Secondary';
  const sitemap = `[${result.sitemapUrl}](${result.sitemapUrl})`;
  return `| ${escapeCell(result.projectName)} | \`${result.domain}\` | ${role} | ${result.urlCount} | ${result.state} | ${sitemap} |`;
}

function renderProblem(result) {
  return `- **${result.domain}** — ${result.state}: ${result.detail}`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|');
}
