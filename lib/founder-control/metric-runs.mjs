import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { domainStrengthRoots, publicMetricTargets } from './domain-scope.mjs';

const FAMILIES = new Set([
  'agent',
  'crawl',
  'coverage',
  'psi',
  'drank',
  'search',
  'cloudflare',
  'ai',
  'design',
]);

const PORTFOLIO_ONLY_FAMILIES = Object.freeze({
  search: 'Google Search',
  cloudflare: 'Cloudflare',
});
const MAX_CAPTURE_CHARACTERS = 12_000;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function projectRoot(fleetRoot, project) {
  if (project.id === 'fleet-workspace') {
    return resolve(fleetRoot, 'foundry/apps/dashboard/fleet-console');
  }
  return project.repo ? resolve(fleetRoot, project.repo) : null;
}

function commandFor({ family, project, fleetRoot }) {
  if (PORTFOLIO_ONLY_FAMILIES[family]) {
    fail('METRIC_SCOPE_INVALID', `${PORTFOLIO_ONLY_FAMILIES[family]} updates are portfolio-only`);
  }
  const domain = project.domains?.[0] ?? null;
  if (['agent', 'crawl', 'coverage', 'psi', 'drank'].includes(family) && !domain) {
    fail('METRIC_DOMAIN_MISSING', `${project.name} has no canonical domain`);
  }
  if (['agent', 'crawl', 'coverage'].includes(family)) {
    const labels = {
      agent: 'AI Agent Readiness',
      crawl: 'AI Crawlability',
      coverage: 'Content Coverage',
    };
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'foundry/ops/scripts/run-visibility-metric.mjs'),
        '--family',
        family,
        '--project',
        project.id,
      ],
      label: labels[family],
    };
  }
  if (family === 'psi') {
    const cli = resolve(fleetRoot, 'psi-swarm/cli/dist/cli.js');
    if (!existsSync(cli)) {
      fail('METRIC_RUNNER_UNAVAILABLE', 'PSI Swarm CLI is not built');
    }
    return {
      command: process.execPath,
      args: [
        cli,
        'run',
        `https://${domain}`,
        '--runs',
        '2',
        '--presets',
        'desktop',
        '--tag',
        'console-manual',
        '--no-suggest',
        '--no-crux',
        '--no-ahrefs',
        '--no-diagnose',
        '--no-insight',
      ],
      label: 'PSI Swarm',
    };
  }
  if (family === 'drank') {
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'drank/scripts/update-global-dr.mjs'),
        '--sites',
        'data/fleet-sites.json',
        '--data',
        'data/fleet-dr.json',
        '--label',
        'fleet',
        '--only',
        domain,
      ],
      label: 'D-Rank',
    };
  }
  if (family === 'ai') {
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'foundry/ops/scripts/ai-visibility-canary.mjs'),
        '--project',
        project.id,
        '--fixture',
        resolve(fleetRoot, 'foundry/ops/test/fixtures/ai-visibility/providers-v1.json'),
      ],
      label: 'AI Visibility fixture canary',
    };
  }
  const root = projectRoot(fleetRoot, project);
  if (!root || !existsSync(resolve(root, '.fleet/design-review.json'))) {
    fail('DESIGN_REVIEW_MISSING', `${project.name} has no design-review receipt`);
  }
  return {
    command: process.execPath,
    args: [
      resolve(fleetRoot, 'foundry/ops/scripts/design-workflow.mjs'),
      'check',
      '--project',
      root,
      '--json',
    ],
    label: 'Design review validation',
  };
}

function portfolioCommandFor({ family, fleetRoot, projects }) {
  if (family === 'drank') {
    const targets = domainStrengthRoots(projects);
    if (targets.length === 0) {
      fail('METRIC_DOMAIN_MISSING', 'No domain-strength targets are configured');
    }
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'drank/scripts/update-global-dr.mjs'),
        '--sites',
        'data/fleet-sites.json',
        '--data',
        'data/fleet-dr.json',
        '--label',
        'fleet',
        ...targets.flatMap((domain) => ['--target', domain]),
      ],
      label: 'Portfolio D-Rank',
    };
  }
  if (family === 'psi') {
    const targets = publicMetricTargets(projects);
    if (targets.length === 0) {
      fail('METRIC_DOMAIN_MISSING', 'No public performance targets are configured');
    }
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'foundry/ops/scripts/run-performance-portfolio.mjs'),
        ...targets.flatMap(({ projectId, domain }) => [
          '--target',
          `${projectId}=https://${domain}`,
        ]),
      ],
      label: 'Portfolio PSI',
    };
  }
  if (family === 'search') {
    return {
      command: process.execPath,
      args: [
        resolve(fleetRoot, 'foundry/ops/scripts/search-console-collect.mjs'),
        '--discovery-cycle',
      ],
      label: 'Portfolio search discovery',
    };
  }
  if (family === 'cloudflare') {
    return {
      command: process.execPath,
      args: [resolve(fleetRoot, 'foundry/ops/scripts/cloudflare-outcomes-collect.mjs')],
      label: 'Portfolio Cloudflare outcomes',
    };
  }
  fail('METRIC_SCOPE_INVALID', 'Unsupported portfolio metric family');
}

function boundedStatusText(value) {
  return String(value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(?:\/Users|\/home|\/private|\/tmp)\/[^\s"'`<>]+/g, '[private path]')
    .slice(-MAX_CAPTURE_CHARACTERS);
}

function publicRun(run, { duplicate = false } = {}) {
  return {
    runId: run.runId,
    family: run.family,
    projectId: run.projectId,
    scope: run.scope,
    label: run.label,
    state: run.state,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exitCode: run.exitCode,
    summary: run.summary,
    duplicate,
  };
}

export function createMetricRunController({
  projects,
  fleetRoot = resolve(import.meta.dirname, '../../../..'),
  spawnProcess = spawn,
  now = () => new Date().toISOString(),
} = {}) {
  const projectsById = new Map((projects ?? []).map((project) => [project.id, project]));
  const runs = new Map();
  const active = new Map();

  return {
    start({ family, projectId, scope = 'project' } = {}) {
      if (!FAMILIES.has(family)) fail('METRIC_FAMILY_INVALID', 'Unsupported metric family');
      if (!['project', 'portfolio'].includes(scope)) {
        fail('METRIC_SCOPE_INVALID', 'Unsupported metric scope');
      }
      const project = scope === 'project' ? projectsById.get(projectId) : null;
      if (scope === 'project' && !project) fail('METRIC_PROJECT_INVALID', 'Unknown Fleet project');
      const key = `${family}:${scope === 'portfolio' ? 'portfolio' : projectId}`;
      const existingId = active.get(key);
      if (existingId) return publicRun(runs.get(existingId), { duplicate: true });

      const plan = scope === 'portfolio'
        ? portfolioCommandFor({ family, fleetRoot, projects: [...projectsById.values()] })
        : commandFor({ family, project, fleetRoot });
      const run = {
        runId: `metric_${randomUUID().replaceAll('-', '')}`,
        family,
        projectId: scope === 'project' ? projectId : null,
        scope,
        label: plan.label,
        state: 'running',
        startedAt: now(),
        finishedAt: null,
        exitCode: null,
        summary: `${plan.label} is running.`,
        capture: '',
      };
      runs.set(run.runId, run);
      active.set(key, run.runId);

      const child = spawnProcess(plan.command, plan.args, {
        cwd: fleetRoot,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const capture = (chunk) => {
        run.capture = boundedStatusText(`${run.capture}${chunk}`);
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      child.once('error', (error) => {
        if (run.state !== 'running') return;
        run.state = 'failed';
        run.finishedAt = now();
        run.summary = boundedStatusText(error.message) || `${plan.label} failed to start.`;
        active.delete(key);
      });
      child.once('close', (code) => {
        if (run.state !== 'running') return;
        run.exitCode = Number.isInteger(code) ? code : null;
        run.state = code === 0 ? 'succeeded' : 'failed';
        run.finishedAt = now();
        run.summary = code === 0
          ? `${plan.label} completed.`
          : boundedStatusText(run.capture).split(/\r?\n/).filter(Boolean).at(-1)
            ?? `${plan.label} failed.`;
        run.capture = '';
        active.delete(key);
      });
      return publicRun(run);
    },

    get(runId) {
      const run = runs.get(runId);
      return run ? publicRun(run) : null;
    },
  };
}
