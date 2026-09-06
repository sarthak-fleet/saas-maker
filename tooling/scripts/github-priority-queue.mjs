#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT = 1_000;
const DEFAULT_STATUS_FIELD = 'Status';
const DEFAULT_DONE_VALUE = 'Done';
const DEFAULT_SKIP_REPO_LABELS = ['sarthakagrawal927/portfolio:issues'];
const TOKEN_PATTERNS = [
  /\bgh[opsu]_[A-Za-z0-9_]+\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\bBearer\s+[^\s]+/gi,
];
const VALUED_ARGUMENTS = ['owner', 'project', 'author', 'limit', 'status-field', 'done-value'];
const REPEATABLE_ARGUMENTS = ['skip-repo-label'];

function usage() {
  return `Usage:
  node saas-maker/tooling/scripts/github-priority-queue.mjs \\
    --owner OWNER --project NUMBER --author LOGIN [--apply]

Reconciles a GitHub Project against the author's issues in both directions:
adds open issues that are missing, and moves items whose issue is already
closed to the terminal status. Items that are terminal on the board while
their issue is open are reported for human review and never changed.

Options:
  --owner OWNER          GitHub Project owner login (required)
  --project NUMBER       GitHub Project number (required)
  --author LOGIN         Issue author login (required)
  --limit NUMBER         Maximum issues to discover per state (default: ${DEFAULT_LIMIT})
  --status-field NAME    Single-select status field name (default: ${DEFAULT_STATUS_FIELD})
  --done-value NAME      Terminal option name in that field (default: ${DEFAULT_DONE_VALUE})
  --skip-repo-label R:L  Repo-scoped label that excludes an issue from the queue
                         (repeatable, e.g. owner/repo:label). Issues in that repo
                         carrying that label are never added and never flagged as
                         drift. Defaults to: ${DEFAULT_SKIP_REPO_LABELS.join(', ')}
  --apply                Add missing issues and reconcile status; without this
                         flag the command is read-only
  --help                 Show this help
`;
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    limit: DEFAULT_LIMIT,
    statusField: DEFAULT_STATUS_FIELD,
    doneValue: DEFAULT_DONE_VALUE,
    skipRepoLabels: [...DEFAULT_SKIP_REPO_LABELS],
  };
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
    if (REPEATABLE_ARGUMENTS.includes(key)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`);
      }
      options.skipRepoLabels.push(value);
      index += 1;
      continue;
    }
    if (!VALUED_ARGUMENTS.includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    if (key === 'status-field') options.statusField = value;
    else if (key === 'done-value') options.doneValue = value;
    else options[key] = value;
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

export function buildIssueSearchArgs(author, limit = DEFAULT_LIMIT, state = 'open') {
  if (!['open', 'closed'].includes(state)) {
    throw new Error(`Unsupported issue state: ${state}`);
  }
  return [
    'search',
    'issues',
    '--author',
    author,
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'url,labels,repository',
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

export function parseSkipRepoLabels(entries) {
  const map = new Map();
  for (const entry of entries) {
    const separator = entry.lastIndexOf(':');
    if (separator <= 0) {
      throw new Error(`Invalid --skip-repo-label "${entry}" (expected owner/repo:label)`);
    }
    const repo = entry.slice(0, separator).trim().toLowerCase();
    const label = entry.slice(separator + 1).trim().toLowerCase();
    if (!repo || !repo.includes('/') || !label) {
      throw new Error(`Invalid --skip-repo-label "${entry}" (expected owner/repo:label)`);
    }
    if (!map.has(repo)) map.set(repo, new Set());
    map.get(repo).add(label);
  }
  return map;
}

export function extractIssueRecords(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  const records = [];
  for (const row of rows) {
    const url = row?.url;
    if (!url) continue;
    records.push({
      url,
      repo: String(row?.repository?.nameWithOwner ?? '').toLowerCase(),
      labels: (row?.labels ?? []).map((label) => String(label?.name ?? label).toLowerCase()),
    });
  }
  return records;
}

export function extractSkippedUrls(records, skipRepoLabels) {
  if (!skipRepoLabels || skipRepoLabels.size === 0) return new Set();
  const skipped = new Set();
  for (const { url, repo, labels } of records) {
    const labelSet = skipRepoLabels.get(repo);
    if (!labelSet) continue;
    if (labels.some((label) => labelSet.has(label))) skipped.add(url);
  }
  return skipped;
}

export function extractProjectUrls(payload) {
  return new Set(normalizeProjectItems(payload).map((item) => item.url));
}

function projectField(item, name) {
  const normalized = name.toLowerCase();
  return item?.[name] ?? item?.[normalized] ?? item?.[normalized.replaceAll(' ', '_')];
}

export function normalizeProjectItems(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.items ?? [];
  const items = [];
  for (const row of rows) {
    const url = row?.content?.url ?? row?.url;
    if (!url) continue;
    items.push({
      itemId: row?.id ?? '',
      url,
      status: String(projectField(row, 'Status') ?? ''),
      priority: String(projectField(row, 'Priority') ?? ''),
      reasoningComplexity: String(projectField(row, 'Reasoning complexity') ?? ''),
      size: String(projectField(row, 'Size') ?? ''),
      labels: (row?.labels ?? row?.content?.labels ?? []).map((label) =>
        String(label?.name ?? label).toLowerCase(),
      ),
    });
  }
  return items;
}

export function isTerminalStatus(status, doneValue = DEFAULT_DONE_VALUE) {
  return String(status ?? '').trim().toLowerCase() === String(doneValue).trim().toLowerCase();
}

export function auditProjectItems(payload, { doneValue = DEFAULT_DONE_VALUE } = {}) {
  const findings = {
    missingPriority: [],
    missingReasoningComplexity: [],
    missingSize: [],
    blockedOrDeferredP0: [],
  };

  for (const item of normalizeProjectItems(payload)) {
    if (isTerminalStatus(item.status, doneValue)) continue;
    if (!item.priority) findings.missingPriority.push(item.url);
    if (!item.reasoningComplexity) findings.missingReasoningComplexity.push(item.url);
    if (!item.size) findings.missingSize.push(item.url);
    if (
      item.priority.startsWith('P0') &&
      (item.labels.includes('blocked') || item.labels.includes('deferred'))
    ) {
      findings.blockedOrDeferredP0.push(item.url);
    }
  }

  return {
    ...findings,
    reviewRequired: new Set([
      ...findings.missingPriority,
      ...findings.missingReasoningComplexity,
      ...findings.missingSize,
    ]).size,
  };
}

export function planQueueSync(discoveredUrls, projectUrls, skipUrls = new Set()) {
  const unique = [...new Set(discoveredUrls)];
  const skipped = unique.filter((url) => skipUrls.has(url));
  const discovered = unique.filter((url) => !skipUrls.has(url));
  const missing = discovered.filter((url) => !projectUrls.has(url));
  return {
    discovered,
    missing,
    unchanged: discovered.length - missing.length,
    skipped: skipped.length,
  };
}

export function planStatusReconciliation(
  payload,
  { closedUrls = new Set(), openUrls = new Set(), doneValue = DEFAULT_DONE_VALUE, skipUrls = new Set() } = {},
) {
  const toDone = [];
  const reopened = [];

  for (const item of normalizeProjectItems(payload)) {
    if (skipUrls.has(item.url)) continue;
    const terminal = isTerminalStatus(item.status, doneValue);
    if (closedUrls.has(item.url) && !terminal) {
      toDone.push({ itemId: item.itemId, url: item.url, status: item.status });
      continue;
    }
    if (openUrls.has(item.url) && terminal) {
      reopened.push({ itemId: item.itemId, url: item.url });
    }
  }

  return { toDone, reopened };
}

export function resolveStatusOption(payload, statusField, doneValue) {
  const fields = Array.isArray(payload) ? payload : payload?.fields ?? [];
  const field = fields.find(
    (candidate) =>
      String(candidate?.name ?? '').trim().toLowerCase() ===
      String(statusField).trim().toLowerCase(),
  );
  if (!field) throw new Error(`Project has no field named ${statusField}`);
  if (!Array.isArray(field.options)) {
    throw new Error(`Field ${statusField} is not a single-select field`);
  }
  const option = field.options.find(
    (candidate) =>
      String(candidate?.name ?? '').trim().toLowerCase() ===
      String(doneValue).trim().toLowerCase(),
  );
  if (!option) throw new Error(`Field ${statusField} has no option named ${doneValue}`);
  return { fieldId: field.id, optionId: option.id };
}

function runGh(run, args) {
  const result = run('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
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
  const statusField = options.statusField ?? DEFAULT_STATUS_FIELD;
  const doneValue = options.doneValue ?? DEFAULT_DONE_VALUE;

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
  const projectId = parseJson(project, 'Project lookup failed')?.id;
  if (!projectId) throw new Error('Project lookup failed: no project id returned');

  const openResult = runGh(run, buildIssueSearchArgs(options.author, options.limit, 'open'));
  const openRecords = extractIssueRecords(parseJson(openResult, 'Issue discovery failed'));
  const discoveredUrls = [...new Set(openRecords.map((record) => record.url))];
  const closedResult = runGh(run, buildIssueSearchArgs(options.author, options.limit, 'closed'));
  const closedRecords = extractIssueRecords(parseJson(closedResult, 'Closed issue discovery failed'));
  const closedUrls = new Set(closedRecords.map((record) => record.url));

  const skipRepoLabels = parseSkipRepoLabels(options.skipRepoLabels ?? DEFAULT_SKIP_REPO_LABELS);
  const skippedUrls = new Set([
    ...extractSkippedUrls(openRecords, skipRepoLabels),
    ...extractSkippedUrls(closedRecords, skipRepoLabels),
  ]);

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
  const audit = auditProjectItems(projectItems, { doneValue });
  const plan = planQueueSync(discoveredUrls, projectUrls, skippedUrls);
  const reconciliation = planStatusReconciliation(projectItems, {
    closedUrls,
    openUrls: new Set(plan.discovered),
    doneValue,
    skipUrls: skippedUrls,
  });

  let added = 0;
  let reconciled = 0;
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

    if (reconciliation.toDone.length > 0) {
      let target = null;
      try {
        const fields = parseJson(
          runGh(run, [
            'project',
            'field-list',
            String(options.project),
            '--owner',
            options.owner,
            '--limit',
            String(options.limit),
            '--format',
            'json',
          ]),
          'Project field lookup failed',
        );
        target = resolveStatusOption(fields, statusField, doneValue);
      } catch (error) {
        failures.push({ url: `field:${statusField}`, error: sanitizeError(error?.message ?? error) });
      }

      if (target) {
        for (const item of reconciliation.toDone) {
          if (!item.itemId) {
            failures.push({ url: item.url, error: 'Project item id unavailable' });
            continue;
          }
          const result = runGh(run, [
            'project',
            'item-edit',
            '--id',
            item.itemId,
            '--project-id',
            projectId,
            '--field-id',
            target.fieldId,
            '--single-select-option-id',
            target.optionId,
            '--format',
            'json',
          ]);
          if (result.ok) reconciled += 1;
          else failures.push({ url: item.url, error: result.stderr || 'GitHub command failed' });
        }
      }
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    discovered: plan.discovered.length,
    missing: plan.missing.length,
    added,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    closedPending: reconciliation.toDone.length,
    reconciled,
    reopened: reconciliation.reopened.length,
    failed: failures.length,
    reviewRequired: audit.reviewRequired + (options.apply ? added : plan.missing.length),
    missingSize: audit.missingSize.length,
    blockedOrDeferredP0: audit.blockedOrDeferredP0.length,
  };
  write(
    `Queue sync: mode=${summary.mode} discovered=${summary.discovered} missing=${summary.missing} added=${summary.added} unchanged=${summary.unchanged} skipped=${summary.skipped} closed_pending=${summary.closedPending} reconciled=${summary.reconciled} reopened=${summary.reopened} failed=${summary.failed} review_required=${summary.reviewRequired} missing_size=${summary.missingSize} blocked_or_deferred_p0=${summary.blockedOrDeferredP0}`,
  );
  for (const item of reconciliation.toDone) {
    write(`Closed issue not ${doneValue} on board: ${item.url} (${item.status || 'no status'})`);
  }
  for (const item of reconciliation.reopened) {
    write(`Review ${item.url}: board says ${doneValue} but the issue is open`);
  }
  for (const failure of failures) write(`Failed ${failure.url}: ${failure.error}`);

  return { summary, failures, reconciliation, audit, exitCode: failures.length > 0 ? 1 : 0 };
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
