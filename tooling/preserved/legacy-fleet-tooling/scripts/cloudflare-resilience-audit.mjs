#!/usr/bin/env node

/**
 * Read-only Cloudflare/fleet resilience audit.
 *
 * Usage:
 *   node foundry/ops/scripts/cloudflare-resilience-audit.mjs
 *   node foundry/ops/scripts/cloudflare-resilience-audit.mjs --json
 *   node foundry/ops/scripts/cloudflare-resilience-audit.mjs --no-live
 *   node foundry/ops/scripts/cloudflare-resilience-audit.mjs --manifest-only
 *
 * This intentionally performs no deploy, delete, DNS, migration, secret, or
 * Cloudflare configuration mutation. It scans tracked repository files only.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = resolve(SCRIPT_DIR, '../../..');
const MANIFEST_PATH = join(FLEET_ROOT, 'foundry/ops/config/projects.json');
const AUTOMATION_REGISTRY_PATH = join(FLEET_ROOT, 'foundry/ops/config/automation-registry.json');

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const liveChecks = !args.has('--no-live');
const manifestOnly = args.has('--manifest-only');
const outputArg = process.argv.find((value, index) => process.argv[index - 1] === '--output');

const OUT_DIR = outputArg ? resolve(outputArg) : join(FLEET_ROOT, '.symphony/cloudflare-resilience');
const IN_SCOPE_TIERS = new Set(['focus', 'active', 'secondary', 'parked']);
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const EXPECTED_DOMAIN_STATUS = new Set([200, 204, 206, 301, 302, 307, 308]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function trackedFiles(repoPath) {
  if (!existsSync(repoPath)) return [];
  try {
    const gitRoot = existsSync(join(repoPath, '.git')) ? repoPath : FLEET_ROOT;
    const scope = gitRoot === FLEET_ROOT ? [relative(FLEET_ROOT, repoPath)] : [];
    return execFileSync('git', ['-C', gitRoot, 'ls-files', '-z', '--', ...scope], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .map((file) => gitRoot === FLEET_ROOT && scope.length ? file.slice(`${scope[0]}/`.length) : file);
  } catch {
    return [];
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function finding(severity, category, surface, evidence, nextAction, extra = {}) {
  return { severity, category, surface, evidence, next_action: nextAction, ...extra };
}

function wranglerJson(command) {
  const result = spawnSync('npx', ['--yes', 'wrangler@latest', ...command, '--json'], {
    cwd: FLEET_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) return { ok: false, error: 'Wrangler inventory command failed.' };
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: 'Wrangler inventory output was not valid JSON.' };
  }
}

function wranglerTable(command) {
  const result = spawnSync('npx', ['--yes', 'wrangler@latest', ...command], {
    cwd: FLEET_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) return { ok: false, error: 'Wrangler inventory command failed.' };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires ESC.
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const rows = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('│') && !/│\s*(id|name)\s*│/i.test(line));
  return { ok: true, row_count: rows.length };
}

function expectedPageNames(projects) {
  return new Set(projects
    .filter((project) => project.deployKind?.includes('pages'))
    .flatMap((project) => {
      if (Array.isArray(project.deployTargets)) {
        return project.deployTargets
          .filter((target) => target.kind === 'pages')
          .map((target) => target.name);
      }
      if (Array.isArray(project.cfPages)) return project.cfPages;
      const value = String(project.cfProject ?? '');
      const names = project.deployKind === 'pages' ? value.split(/\s*,\s*/) : [value.split(/\s*\+\s*/)[0]];
      return names.map((name) => name.trim());
    })
    .filter((name) => name && !/workers$/i.test(name)));
}

function repoPathFor(project) {
  if (!project.repo) return null;
  return resolve(FLEET_ROOT, project.repo);
}

function scanRepository(project, findings, evidence, ignoredRepositories) {
  const repoPath = repoPathFor(project);
  if (!repoPath) return;
  const ignored = ignoredRepositories.get(project.repo);
  if (ignored) {
    evidence.repositories.push({
      id: project.id,
      repo: project.repo,
      excluded: true,
      reason: ignored.reason,
    });
    findings.push(finding(
      'info',
      'manifest-exception',
      project.id,
      `Repository scan intentionally excluded: ${ignored.reason}`,
      'Reactivate the project explicitly before restoring routine repository checks.',
    ));
    return;
  }
  if (!existsSync(repoPath)) {
    findings.push(finding('high', 'manifest', project.id, `Repository not found: ${project.repo}`, 'Restore the checkout or mark the surface undeployed.'));
    return;
  }

  const files = trackedFiles(repoPath);
  const configFiles = files.filter((file) => /(^|\/)wrangler\.(toml|json|jsonc)$/.test(file));
  const workflowFiles = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
  const relevant = [...configFiles, ...workflowFiles];
  const contents = relevant.map((file) => ({ file, text: safeRead(join(repoPath, file)) }));
  const combined = contents.map(({ text }) => text).join('\n');

  evidence.repositories.push({
    id: project.id,
    repo: project.repo,
    tracked_files: files.length,
    wrangler_configs: configFiles,
    workflows: workflowFiles,
  });

  const workerConfigs = contents.filter(({ file, text }) =>
    /(^|\/)wrangler\.(toml|json|jsonc)$/.test(file) && /(^|\n)\s*(main\s*=|"main"\s*:)/.test(text),
  );
  for (const { file, text } of workerConfigs) {
    if (!/observability/.test(text)) {
      findings.push(finding('low', 'observability', `${project.id}:${file}`, 'Worker config has no observability block.', 'Enable Workers Logs with an intentional sampling rate.'));
    }
  }

  const sourceFiles = files.filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !/(?:test|spec|fixture|coverage|\.next|\.open-next|\.wrangler)/i.test(file));
  const sourceText = sourceFiles.map((file) => safeRead(join(repoPath, file))).join('\n');
  const hasSchedule = /\bschedule\s*:/i.test(combined) || /\bcron\s*:/i.test(combined) ||
    /(^|\n)\s*(\[triggers\]|crons\s*=)/m.test(combined) || /scheduled\s*\(/i.test(sourceText);
  const hasAsyncConfig = /(^|[\n\r])\s*(\[?\s*"?(queues|workflows)"?|queues\s*=|workflows\s*=)/i.test(contents.filter(({ file }) => /wrangler\.(toml|json|jsonc)$/.test(file)).map(({ text }) => text).join('\n'));
  const hasAsyncHandler = /queue\s*\(|WorkflowEntrypoint|setAlarm|alarm\s*\(/i.test(sourceText);
  const hasAsync = hasAsyncConfig || hasAsyncHandler;
  if (hasSchedule || hasAsync) {
    const hasTimeout = /timeout-minutes\s*:/i.test(combined) || /max_(?:retries|batch_size|batch_timeout)\s*[:=]/i.test(combined) || /timeout\s*[:=]/i.test(combined);
    const hasConcurrency = /concurrency\s*:/i.test(combined) || /single[-_ ]flight|lease|mutex|lock/i.test(combined);
    const hasIdempotency = !hasAsyncConfig || /idempot|dedup|raw_hash|content_hash|unique index|onConflict|on conflict|stable job|job key/i.test(sourceText);
    evidence.background_jobs.push({
      id: project.id,
      repo: project.repo,
      scheduled: hasSchedule,
      async: hasAsync,
      timeout_or_bound: hasTimeout,
      concurrency_or_lease: hasConcurrency,
      idempotency_or_dedup: hasIdempotency,
    });
    if (hasSchedule && !hasTimeout) {
      findings.push(finding('low', 'background-job', project.id, 'Scheduled work has no visible timeout or batch bound in tracked config/workflows.', 'Add a bounded timeout/input batch and document the maximum work per invocation.'));
    }
    if (hasAsync && !hasIdempotency) {
      findings.push(finding('medium', 'background-job', project.id, 'Queue/workflow path has no visible idempotency/deduplication evidence in tracked source.', 'Add a stable job key or durable deduplication and test replay behavior.'));
    }
    if (hasSchedule && !hasConcurrency && /schedule\s*:/i.test(combined)) {
      findings.push(finding('low', 'background-job', project.id, 'Scheduled GitHub workflow has no visible concurrency group.', 'Add a per-job concurrency group to prevent overlapping manual/scheduled runs.'));
    }
  }

  for (const { file, text } of contents) {
    if (!/^\.github\/workflows\//.test(file)) continue;
    const deploysWorker = /wrangler\s+(?:deploy|versions\s+upload)/i.test(text) || /command:\s*.*wrangler/i.test(text);
    const deploysPages = /wrangler\s+pages\s+deploy|pages deploy/i.test(text);
    if ((deploysWorker || deploysPages) && (project.domains ?? []).length > 0 && !/smoke|curl\s+.*--fail|health/i.test(text)) {
      findings.push(finding('medium', 'deploy', `${project.id}:${file}`, 'Deployment workflow has no visible post-deploy smoke/health check.', 'Add a bounded failing smoke check for the canonical surface before declaring the run green.'));
    }
    if (/wrangler\s+deploy[^\n]*(?:preview|pr[-_]|--name\s+[^\n]*(?:preview|pr[-_]))/i.test(text) &&
        !/wrangler\s+delete|types:\s*\[closed\]|pull_request_target.*closed/i.test(text)) {
      findings.push(finding('high', 'preview-hygiene', `${project.id}:${file}`, 'Workflow appears to create a persistent preview/PR Worker without teardown.', 'Use Pages previews or same-Worker versions upload, or add an explicit closed-PR teardown job.'));
    }
    if (/^\s*schedule\s*:/m.test(text) && !/timeout-minutes\s*:/i.test(text)) {
      findings.push(finding('low', 'deploy', `${project.id}:${file}`, 'Scheduled GitHub workflow has no timeout-minutes.', 'Set a timeout appropriate to the job so a hung run cannot consume an unbounded runner window.'));
    }
  }
}

async function probeDomain(domain, path = '/') {
  const url = new URL(path, `https://${domain}`).toString();
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    return {
      domain,
      url,
      status: response.status,
      location: response.headers.get('location'),
      duration_ms: Date.now() - started,
      ok: EXPECTED_DOMAIN_STATUS.has(response.status),
    };
  } catch (error) {
    return { domain, url, status: null, duration_ms: Date.now() - started, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function markdown(report) {
  const counts = Object.fromEntries(Object.keys(SEVERITY_ORDER).map((key) => [key, report.findings.filter((item) => item.severity === key).length]));
  const lines = [
    '# Cloudflare fleet resilience audit',
    '',
    `Generated: ${report.generated_at}`,
    `Scope: ${report.scope.projects} projects, ${report.scope.domains} canonical domains`,
    `Live checks: ${report.live_checks ? 'enabled' : 'disabled'}`,
    '',
    `Findings: ${counts.high} high · ${counts.medium} medium · ${counts.low} low · ${counts.info} info`,
    '',
    '## Findings',
    '',
  ];
  if (report.findings.length === 0) lines.push('No findings.');
  for (const item of report.findings) {
    lines.push(`- **${item.severity.toUpperCase()} · ${item.category} · ${item.surface}** — ${item.evidence} Next: ${item.next_action}`);
  }
  lines.push('', '## Live domain probes', '');
  for (const probe of report.live.domain_probes ?? []) {
    lines.push(`- ${probe.domain}: ${probe.status ?? 'ERROR'}${probe.location ? ` → ${probe.location}` : ''} (${probe.ok ? 'ok' : 'failed'})`);
  }
  lines.push('', '## Safety', '', 'Read-only audit. No deploy, delete, DNS, migration, secret, or Cloudflare configuration mutation was performed.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const manifest = readJson(MANIFEST_PATH);
  const automationRegistry = readJson(AUTOMATION_REGISTRY_PATH);
  const ignoredRepositories = new Map((automationRegistry.entries ?? [])
    .filter((entry) => entry.attention === 'ignored' && entry.repository)
    .map((entry) => [
      entry.repository,
      {
        id: entry.id,
        reason: entry.exceptions?.find((exception) => exception.contract === 'all')?.reason
          ?? 'Ignored by the canonical automation registry.',
      },
    ]));
  const projects = (manifest.projects ?? []).filter((project) => IN_SCOPE_TIERS.has(project.tier));
  const inventoryProjects = (manifest.projects ?? []).filter((project) => project.status === 'live');
  const findings = [];
  const evidence = { repositories: [], background_jobs: [] };
  const domainOwners = new Map();
  const domainProbePaths = new Map();
  for (const project of projects) {
    for (const domain of project.domains ?? []) {
      const owners = domainOwners.get(domain) ?? [];
      owners.push(project.id);
      domainOwners.set(domain, owners);
      domainProbePaths.set(domain, project.domainProbePaths?.[domain] ?? '/');
    }
    if (project.status === 'live' && project.repo && !repoPathFor(project)) {
      findings.push(finding('high', 'manifest', project.id, 'Live project has no repository mapping.', 'Add the owning repository to projects.json or explicitly mark the surface non-product.'));
    }
    if (!manifestOnly) scanRepository(project, findings, evidence, ignoredRepositories);
  }
  for (const [domain, owners] of domainOwners) {
    if (owners.length > 1) findings.push(finding('high', 'manifest', domain, `Canonical domain is claimed by multiple projects: ${owners.join(', ')}`, 'Choose one owner and remove the redundant mapping.'));
  }

  const live = { domain_probes: [], cloudflare: {} };
  if (liveChecks) {
    const domains = [...domainOwners.keys()].sort();
    live.domain_probes = await Promise.all(domains.map((domain) => probeDomain(domain, domainProbePaths.get(domain))));
    for (const probe of live.domain_probes) {
      if (!probe.ok) findings.push(finding('high', 'live-surface', probe.domain, `Canonical domain probe failed with ${probe.status ?? probe.error}`, 'Restore DNS/deployment or update the manifest only if the surface is intentionally retired.'));
    }

    const pages = wranglerJson(['pages', 'project', 'list']);
    live.cloudflare.pages = pages.ok ? pages.value : { error: pages.error };
    if (pages.ok && Array.isArray(pages.value)) {
      const livePageNames = new Set(pages.value.map((project) => project['Project Name']).filter(Boolean));
      const expectedPages = expectedPageNames(inventoryProjects);
      const knownPages = expectedPageNames(manifest.projects ?? []);
      for (const expected of expectedPages) {
        if (!livePageNames.has(expected)) {
          findings.push(finding('high', 'cloudflare-inventory', expected, 'Manifest Pages project is not present in the live Pages inventory.', 'Restore or explicitly retire the Pages project and update the manifest.'));
        }
      }
      for (const actual of livePageNames) {
        if (!knownPages.has(actual)) {
          findings.push(finding('medium', 'cloudflare-inventory', actual, 'Live Pages project is not represented by the canonical manifest.', 'Claim it in projects.json or remove it after an explicit owner decision.'));
        } else if (!expectedPages.has(actual)) {
          findings.push(finding('info', 'cloudflare-inventory', actual, 'Live Pages project is a known inactive or non-product surface.', 'Keep it out of active automation unless it is explicitly reactivated.'));
        }
      }
    }
    const queues = wranglerTable(['queues', 'list']);
    const workflows = wranglerTable(['workflows', 'list']);
    live.cloudflare.queues = queues.ok ? queues : { error: queues.error };
    live.cloudflare.workflows = workflows.ok ? workflows : { error: workflows.error };
  }

  findings.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.surface.localeCompare(right.surface));
  const report = {
    generated_at: new Date().toISOString(),
    live_checks: liveChecks,
    repository_scan: !manifestOnly,
    scope: { projects: projects.length, domains: domainOwners.size },
    findings,
    evidence,
    live,
    exit: { blocking: findings.some((item) => item.severity === 'high'), actionable: findings.some((item) => item.severity === 'high' || item.severity === 'medium') },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'latest.md'), markdown(report));
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else console.log(markdown(report));
  process.exitCode = report.exit.blocking ? 1 : 0;
}

await main();
