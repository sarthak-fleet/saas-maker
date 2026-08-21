#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT = 1_000;
const TOKEN_PATTERNS = [
  /\bgh[opsu]_[A-Za-z0-9_]+\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\bBearer\s+[^\s]+/gi,
];

function usage() {
  return `Usage:
  node foundry/ops/scripts/github-priority-queue.mjs \\
    --owner OWNER --project NUMBER --author LOGIN [--apply]

Options:
  --owner OWNER     GitHub Project owner login (required)
  --project NUMBER  GitHub Project number (required)
  --author LOGIN    Issue author login (required)
  --limit NUMBER    Maximum authored issues to discover (default: ${DEFAULT_LIMIT})
  --apply           Add missing issues; without this flag the command is read-only
  --help            Show this help
`;
}

export function parseArgs(argv) {
  const options = { apply: false, limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    const key = argument.slice(2);
    if (!['owner', 'project', 'author', 'limit'].includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[key] = value;
    index += 1;
  }

  if (options.help) return options;
  for (const key of ['owner', 'project', 'author']) {
    if (!options[key]) throw new Error(`Missing required argument: --${key}`);
  }
  if (!/^\d+$/.test(String(options.project))) {
    throw new Error('--project must be a positive integer');
  }
  if (!/^\d+$/.test(String(options.limit)) || Number(options.limit) < 1) {
    throw new Error('--limit must be a positive integer');
  }
  options.project = Number(options.project);
  options.limit = Number(options.limit);
  return options;
}

export function buildIssueSearchArgs(author, limit = DEFAULT_LIMIT) {
  return [
    'search',
    'issues',
    '--author',
    author,
    '--state',
    'open',
    '--limit',
    String(limit),
    '--json',
    'url',
  ];
}

export function sanitizeError(value) {
  let safe = String(value ?? '').trim();
  for (const pattern of TOKEN_PATTERNS) safe = safe.replace(pattern, '[redacted]');
  return safe;
}

export function extractIssueUrls(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return [...new Set(rows.map((row) => row?.url).filter(Boolean))];
}

export function extractProjectUrls(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.items ?? [];
  return new Set(
    rows
      .map((row) => row?.content?.url ?? row?.url)
      .filter(Boolean),
  );
}

function projectField(item, name) {
  const normalized = name.toLowerCase();
  return item?.[name] ?? item?.[normalized] ?? item?.[normalized.replaceAll(' ', '_')];
}

export function auditProjectItems(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.items ?? [];
  const findings = {
    missingPriority: [],
    missingReasoningComplexity: [],
    blockedOrDeferredP0: [],
  };

  for (const item of rows) {
    const url = item?.content?.url ?? item?.url;
    if (!url) continue;
    const priority = projectField(item, 'Priority');
    const reasoningComplexity = projectField(item, 'Reasoning complexity');
    const labels = (item?.labels ?? item?.content?.labels ?? []).map((label) =>
      String(label?.name ?? label).toLowerCase(),
    );
    if (!priority) findings.missingPriority.push(url);
    if (!reasoningComplexity) findings.missingReasoningComplexity.push(url);
    if (
      String(priority).startsWith('P0') &&
      (labels.includes('blocked') || labels.includes('deferred'))
    ) {
      findings.blockedOrDeferredP0.push(url);
    }
  }

  return {
    ...findings,
    reviewRequired: new Set([
      ...findings.missingPriority,
      ...findings.missingReasoningComplexity,
    ]).size,
  };
}

export function planQueueSync(discoveredUrls, projectUrls) {
  const discovered = [...new Set(discoveredUrls)];
  const missing = discovered.filter((url) => !projectUrls.has(url));
  return {
    discovered,
    missing,
    unchanged: discovered.length - missing.length,
  };
}

function runGh(run, args) {
  const result = run('gh', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: sanitizeError(result.stderr),
  };
}

function parseJson(result, label) {
  if (!result.ok) throw new Error(`${label}: ${result.stderr || 'GitHub command failed'}`);
  try {
    return JSON.parse(result.stdout || 'null');
  } catch {
    throw new Error(`${label}: GitHub returned invalid JSON`);
  }
}

export function syncPriorityQueue(
  options,
  { run = spawnSync, write = (line) => console.log(line) } = {},
) {
  const identity = runGh(run, ['api', 'user', '--jq', '.login']);
  if (!identity.ok) {
    throw new Error(`GitHub authentication unavailable: ${identity.stderr || 'run gh auth login'}`);
  }

  const project = runGh(run, [
    'project',
    'view',
    String(options.project),
    '--owner',
    options.owner,
    '--format',
    'json',
  ]);
  if (!project.ok) {
    throw new Error(
      `GitHub Project access unavailable. Authorize it with: gh auth refresh -h github.com -s project (${project.stderr || 'project lookup failed'})`,
    );
  }

  const searchResult = runGh(run, buildIssueSearchArgs(options.author, options.limit));
  const discoveredUrls = extractIssueUrls(parseJson(searchResult, 'Issue discovery failed'));

  const itemsResult = runGh(run, [
    'project',
    'item-list',
    String(options.project),
    '--owner',
    options.owner,
    '--limit',
    String(options.limit),
    '--format',
    'json',
  ]);
  const projectItems = parseJson(itemsResult, 'Project item lookup failed');
  const projectUrls = extractProjectUrls(projectItems);
  const audit = auditProjectItems(projectItems);
  const plan = planQueueSync(discoveredUrls, projectUrls);

  let added = 0;
  const failures = [];
  if (options.apply) {
    for (const url of plan.missing) {
      const result = runGh(run, [
        'project',
        'item-add',
        String(options.project),
        '--owner',
        options.owner,
        '--url',
        url,
        '--format',
        'json',
      ]);
      if (result.ok) added += 1;
      else failures.push({ url, error: result.stderr || 'GitHub command failed' });
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    discovered: plan.discovered.length,
    missing: plan.missing.length,
    added,
    unchanged: plan.unchanged,
    failed: failures.length,
    reviewRequired: audit.reviewRequired + (options.apply ? added : plan.missing.length),
    blockedOrDeferredP0: audit.blockedOrDeferredP0.length,
  };
  write(
    `Queue sync: mode=${summary.mode} discovered=${summary.discovered} missing=${summary.missing} added=${summary.added} unchanged=${summary.unchanged} failed=${summary.failed} review_required=${summary.reviewRequired} blocked_or_deferred_p0=${summary.blockedOrDeferredP0}`,
  );
  for (const failure of failures) write(`Failed ${failure.url}: ${failure.error}`);

  return { summary, failures, exitCode: failures.length > 0 ? 1 : 0 };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const result = syncPriorityQueue(options);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(sanitizeError(error?.message ?? error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
