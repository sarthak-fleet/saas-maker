#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { classifyArchetype } from '../lib/content-coverage.mjs';
import {
  appendVisibilityMetric,
  VISIBILITY_METRIC_SCHEMA,
} from '../lib/visibility-metric-store.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const family = option('--family');
const projectId = option('--project');

if (!['agent', 'crawl', 'coverage'].includes(family) || !projectId) {
  process.stderr.write(
    'usage: run-visibility-metric.mjs --family <agent|crawl|coverage> --project <id>\n',
  );
  process.exit(2);
}

const catalog = JSON.parse(
  readFileSync(resolve(FLEET_ROOT, 'foundry/ops/config/projects.json'), 'utf8'),
);
const project = catalog.projects.find((entry) => entry.id === projectId);
if (!project) throw new Error(`unknown Fleet project: ${projectId}`);
const domain = project.domains?.[0] ?? null;
if (!domain) throw new Error(`${project.name ?? project.id} has no canonical domain`);
const origin = `https://${domain}`;
const observedAt = new Date().toISOString();

const observations = ['agent', 'crawl'].includes(family)
  ? runAgentAudit()
  : { coverage: runContentCoverage() };
const recorded = Object.entries(observations).map(([observationFamily, observation]) =>
  appendVisibilityMetric({
    schemaVersion: VISIBILITY_METRIC_SCHEMA,
    projectId,
    family: observationFamily,
    observedAt,
    ...observation,
  }),
);
process.stdout.write(`${JSON.stringify(recorded.find((item) => item.family === family))}\n`);

function runAgentAudit() {
  const result = spawnSync(
    process.execPath,
    [
      resolve(
        FLEET_ROOT,
        'foundry/ops/skills/agent-ready/scripts/agent-index-audit.mjs',
      ),
      origin,
      '--metric-json',
    ],
    { cwd: FLEET_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error) {
    throw new Error(`AI Agent Readiness failed to run: ${result.error.message}`);
  }
  if (result.status === 2) {
    throw new Error(
      `AI Agent Readiness failed: ${result.stderr.trim() || 'unknown error'}`,
    );
  }
  const payload = parseJsonResult(result.stdout, 'AI Agent Readiness');
  const audit = payload.results?.[0];
  if (!audit) throw new Error('AI Agent Readiness returned no result');
  if (audit.error) throw new Error(audit.error);

  const crawlCheckIds = ['robots', 'ai_access', 'sitemap'];
  const crawlChecks = crawlCheckIds.map((id) => audit.checks?.[id]);
  const crawlPassed = crawlChecks.filter((check) => check?.status === 'pass').length;
  const crawlFailed = crawlChecks.length - crawlPassed;
  const crawlScore = Math.round((crawlPassed / crawlChecks.length) * 100);
  const readableRoutes = audit.checks?.route_markdown?.data ?? {};
  const catalogSurfaces = audit.checks?.catalog_integrity?.data ?? {};
  const readable = Number(readableRoutes.readable ?? 0);
  const publicRoutes = Number(readableRoutes.total ?? 0);
  const checkedRoutes = Number(readableRoutes.checked ?? publicRoutes);
  const readableCoverage = Number(readableRoutes.coveragePercent ?? 0);
  const validSurfaces = Number(catalogSurfaces.valid ?? 0);
  const configuredSurfaces = Number(catalogSurfaces.configured ?? 0);
  const surfaceIntegrity = Number(catalogSurfaces.integrityPercent ?? 0);

  return {
    agent: {
      status: audit.fail > 0 ? 'needs-work' : 'ready',
      summary:
        `${audit.tier}-tier · ${audit.pass} passed · ${audit.fail} failed · ` +
        `${readable}/${checkedRoutes} checked routes readable · ` +
        `${publicRoutes} public routes · ` +
        `${validSurfaces}/${configuredSurfaces} catalog surfaces valid`,
      metrics: [
        {
          label: 'Agent readiness',
          value: audit.score,
          unit: 'percent',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent checks passed',
          value: audit.pass,
          unit: 'checks',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent checks failed',
          value: audit.fail,
          unit: 'checks',
          direction: 'lower-is-better',
        },
        {
          label: 'Agent-readable coverage',
          value: readableCoverage,
          unit: 'percent',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent-readable routes',
          value: readable,
          unit: 'routes',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent routes checked',
          value: checkedRoutes,
          unit: 'routes',
          direction: 'neutral',
        },
        {
          label: 'Agent public routes',
          value: publicRoutes,
          unit: 'routes',
          direction: 'neutral',
        },
        {
          label: 'Agent surface integrity',
          value: surfaceIntegrity,
          unit: 'percent',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent catalog surfaces valid',
          value: validSurfaces,
          unit: 'surfaces',
          direction: 'higher-is-better',
        },
        {
          label: 'Agent catalog surfaces',
          value: configuredSurfaces,
          unit: 'surfaces',
          direction: 'neutral',
        },
      ],
    },
    crawl: {
      status: crawlFailed > 0 ? 'needs-work' : 'ready',
      summary: `${crawlPassed}/${crawlChecks.length} crawler checks passed · robots, AI-bot access, sitemap`,
      metrics: [
        {
          label: 'AI crawlability',
          value: crawlScore,
          unit: 'percent',
          direction: 'higher-is-better',
        },
        {
          label: 'AI crawler checks passed',
          value: crawlPassed,
          unit: 'checks',
          direction: 'higher-is-better',
        },
        {
          label: 'AI crawler checks failed',
          value: crawlFailed,
          unit: 'checks',
          direction: 'lower-is-better',
        },
      ],
    },
  };
}

function runContentCoverage() {
  const sourceRoot = contentSourceRoot();
  if (!sourceRoot || !existsSync(sourceRoot)) {
    throw new Error(`${project.name ?? project.id} has no local content source`);
  }
  const files = contentFiles(sourceRoot);
  const archetypes = new Set(
    files.map((file) => classifyArchetype(file.slice(sourceRoot.length + 1))),
  );
  return {
    status: files.length > 0 ? 'recorded' : 'needs-work',
    summary:
      `${files.length} owned content files across ${archetypes.size} archetypes; ` +
      'search-intent evidence remains a separate research step',
    metrics: [
      {
        label: 'Content pages',
        value: files.length,
        unit: 'pages',
        direction: 'higher-is-better',
      },
      {
        label: 'Content archetypes',
        value: archetypes.size,
        unit: 'archetypes',
        direction: 'higher-is-better',
      },
    ],
  };
}

function contentSourceRoot() {
  if (project.id === 'fleet-workspace') {
    return resolve(FLEET_ROOT, 'saas-maker/apps/showcase');
  }
  if (project.sourcePath) return resolve(FLEET_ROOT, project.sourcePath);
  if (project.repo) return resolve(FLEET_ROOT, project.repo);
  return null;
}

function contentFiles(root, output = []) {
  if (output.length >= 5_000) return output;
  const excluded = new Set([
    '.git',
    '.next',
    '.wrangler',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'target',
  ]);
  const contentExtensions = new Set(['.astro', '.html', '.jsx', '.md', '.mdx', '.tsx']);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (output.length >= 5_000) break;
    if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) contentFiles(path, output);
    else if (entry.isFile() && contentExtensions.has(extname(entry.name).toLowerCase())) {
      output.push(path);
    }
  }
  return output;
}

function parseJsonResult(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
