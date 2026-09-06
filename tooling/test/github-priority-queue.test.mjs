import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditProjectItems,
  buildIssueSearchArgs,
  extractIssueRecords,
  extractSkippedUrls,
  isTerminalStatus,
  normalizeProjectItems,
  parseArgs,
  parseSkipRepoLabels,
  planQueueSync,
  planStatusReconciliation,
  resolveStatusOption,
  sanitizeError,
  syncPriorityQueue,
} from '../scripts/github-priority-queue.mjs';

const OPEN_URL = 'https://github.com/owner/repo/issues/1';
const CLOSED_URL = 'https://github.com/owner/repo/issues/2';
const MISSING_URL = 'https://github.com/owner/repo/issues/3';

const ITEMS = {
  items: [
    {
      id: 'ITEM_open',
      status: 'Todo',
      priority: 'P1 — Next',
      'reasoning complexity': 'R2 — Judgment',
      size: 'M — 1–2 days',
      content: { url: OPEN_URL },
    },
    {
      id: 'ITEM_closed',
      status: 'In Progress',
      priority: 'P2 — Soon',
      'reasoning complexity': 'R1 — Routine',
      size: 'XS — under 1 hr',
      content: { url: CLOSED_URL },
    },
  ],
};

const FIELDS = {
  fields: [
    { id: 'PVTF_title', name: 'Title', type: 'ProjectV2Field' },
    {
      id: 'PVTSSF_status',
      name: 'Status',
      options: [
        { id: 'opt_todo', name: 'Todo' },
        { id: 'opt_done', name: 'Done' },
      ],
    },
  ],
};

test('parseArgs accepts the status reconciliation flags and defaults them', () => {
  const defaults = parseArgs(['--owner', 'o', '--project', '3', '--author', 'a']);
  assert.equal(defaults.statusField, 'Status');
  assert.equal(defaults.doneValue, 'Done');
  assert.equal(defaults.apply, false);
  assert.deepEqual(defaults.skipRepoLabels, ['sarthakagrawal927/portfolio:issues']);

  const custom = parseArgs([
    '--owner', 'o', '--project', '3', '--author', 'a',
    '--status-field', 'State', '--done-value', 'Shipped', '--apply',
    '--skip-repo-label', 'org/repo:do-not-queue',
    '--skip-repo-label', 'org/other:skip',
  ]);
  assert.equal(custom.statusField, 'State');
  assert.equal(custom.doneValue, 'Shipped');
  assert.equal(custom.apply, true);
  assert.deepEqual(custom.skipRepoLabels, [
    'sarthakagrawal927/portfolio:issues',
    'org/repo:do-not-queue',
    'org/other:skip',
  ]);

  assert.throws(() => parseArgs(['--owner', 'o', '--project', '3', '--author', 'a', '--nope', 'x']),
    /Unknown argument/);
});

test('buildIssueSearchArgs searches one state at a time', () => {
  assert.deepEqual(buildIssueSearchArgs('a', 5, 'closed').join(' '),
    'search issues --author a --state closed --limit 5 --json url,labels,repository');
  assert.equal(buildIssueSearchArgs('a').includes('open'), true);
  assert.throws(() => buildIssueSearchArgs('a', 5, 'all'), /Unsupported issue state/);
});

test('normalizeProjectItems reads item ids and single-select values', () => {
  const [first] = normalizeProjectItems(ITEMS);
  assert.equal(first.itemId, 'ITEM_open');
  assert.equal(first.url, OPEN_URL);
  assert.equal(first.reasoningComplexity, 'R2 — Judgment');
  assert.deepEqual(normalizeProjectItems({ items: [{ id: 'x' }] }), []);
});

test('isTerminalStatus compares case and whitespace insensitively', () => {
  assert.equal(isTerminalStatus(' done ', 'Done'), true);
  assert.equal(isTerminalStatus('Todo', 'Done'), false);
  assert.equal(isTerminalStatus('', 'Done'), false);
});

test('planStatusReconciliation flags closed issues and never auto-reopens', () => {
  const plan = planStatusReconciliation(ITEMS, {
    closedUrls: new Set([CLOSED_URL]),
    openUrls: new Set([OPEN_URL]),
  });
  assert.deepEqual(plan.toDone, [
    { itemId: 'ITEM_closed', url: CLOSED_URL, status: 'In Progress' },
  ]);
  assert.deepEqual(plan.reopened, []);

  const inverted = planStatusReconciliation(
    { items: [{ id: 'ITEM_done', status: 'Done', content: { url: OPEN_URL } }] },
    { closedUrls: new Set(), openUrls: new Set([OPEN_URL]) },
  );
  assert.deepEqual(inverted.toDone, []);
  assert.deepEqual(inverted.reopened, [{ itemId: 'ITEM_done', url: OPEN_URL }]);
});

test('auditProjectItems ignores terminal items and reports missing size', () => {
  const audit = auditProjectItems({
    items: [
      { id: 'a', status: 'Done', content: { url: CLOSED_URL } },
      { id: 'b', status: 'Todo', content: { url: OPEN_URL } },
    ],
  });
  assert.deepEqual(audit.missingPriority, [OPEN_URL]);
  assert.deepEqual(audit.missingSize, [OPEN_URL]);
  assert.equal(audit.reviewRequired, 1);
});

test('auditProjectItems still flags blocked or deferred P0 work', () => {
  const audit = auditProjectItems({
    items: [
      {
        id: 'a',
        status: 'Todo',
        priority: 'P0 — Now',
        'reasoning complexity': 'R1 — Routine',
        size: 'S — half day',
        labels: [{ name: 'Blocked' }],
        content: { url: OPEN_URL },
      },
    ],
  });
  assert.deepEqual(audit.blockedOrDeferredP0, [OPEN_URL]);
  assert.equal(audit.reviewRequired, 0);
});

test('planQueueSync only reports issues absent from the project', () => {
  const plan = planQueueSync([OPEN_URL, MISSING_URL], new Set([OPEN_URL]));
  assert.deepEqual(plan.missing, [MISSING_URL]);
  assert.equal(plan.unchanged, 1);
});

test('resolveStatusOption locates the field and terminal option', () => {
  assert.deepEqual(resolveStatusOption(FIELDS, 'status', 'done'), {
    fieldId: 'PVTSSF_status',
    optionId: 'opt_done',
  });
  assert.throws(() => resolveStatusOption(FIELDS, 'Missing', 'Done'), /no field named Missing/);
  assert.throws(() => resolveStatusOption(FIELDS, 'Title', 'Done'), /not a single-select/);
  assert.throws(() => resolveStatusOption(FIELDS, 'Status', 'Shipped'), /no option named Shipped/);
});

test('sanitizeError redacts credentials', () => {
  assert.equal(sanitizeError('failed ghp_abc123 here'), 'failed [redacted] here');
  assert.equal(sanitizeError('auth Bearer xyz'), 'auth [redacted]');
});

function createRunner() {
  const calls = [];
  const run = (command, args) => {
    calls.push(args.join(' '));
    const joined = args.join(' ');
    if (joined.startsWith('api user')) return { status: 0, stdout: 'sarthak' };
    if (joined.startsWith('project view')) return { status: 0, stdout: '{"id":"PVT_1"}' };
    if (joined.includes('--state open')) {
      return { status: 0, stdout: JSON.stringify([{ url: OPEN_URL }, { url: MISSING_URL }]) };
    }
    if (joined.includes('--state closed')) {
      return { status: 0, stdout: JSON.stringify([{ url: CLOSED_URL }]) };
    }
    if (joined.startsWith('project item-list')) {
      return { status: 0, stdout: JSON.stringify(ITEMS) };
    }
    if (joined.startsWith('project field-list')) {
      return { status: 0, stdout: JSON.stringify(FIELDS) };
    }
    if (joined.startsWith('project item-add')) return { status: 0, stdout: '{}' };
    if (joined.startsWith('project item-edit')) return { status: 0, stdout: '{}' };
    return { status: 1, stdout: '', stderr: `unexpected: ${joined}` };
  };
  return { calls, run };
}

const OPTIONS = { owner: 'o', project: 3, author: 'a', limit: 100 };

test('dry run reports both directions without mutating the project', () => {
  const { calls, run } = createRunner();
  const lines = [];
  const result = syncPriorityQueue({ ...OPTIONS, apply: false }, { run, write: (l) => lines.push(l) });

  assert.equal(result.summary.mode, 'dry-run');
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.added, 0);
  assert.equal(result.summary.closedPending, 1);
  assert.equal(result.summary.reconciled, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.some((call) => call.startsWith('project item-add')), false);
  assert.equal(calls.some((call) => call.startsWith('project item-edit')), false);
  assert.match(lines.join('\n'), /Closed issue not Done on board/);
});

test('apply adds missing issues and moves closed issues to Done', () => {
  const { calls, run } = createRunner();
  const result = syncPriorityQueue({ ...OPTIONS, apply: true }, { run, write: () => {} });

  assert.equal(result.summary.added, 1);
  assert.equal(result.summary.reconciled, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.filter((call) => call.startsWith('project item-add')).length, 1);
  const edit = calls.find((call) => call.startsWith('project item-edit'));
  assert.match(edit, /--id ITEM_closed/);
  assert.match(edit, /--project-id PVT_1/);
  assert.match(edit, /--field-id PVTSSF_status/);
  assert.match(edit, /--single-select-option-id opt_done/);
});

test('apply skips the field lookup when nothing is stale', () => {
  const { calls, run } = createRunner();
  const noStale = { items: [ITEMS.items[0]] };
  const patched = (command, args) => {
    if (args.join(' ').startsWith('project item-list')) {
      return { status: 0, stdout: JSON.stringify(noStale) };
    }
    return run(command, args);
  };
  const result = syncPriorityQueue({ ...OPTIONS, apply: true }, { run: patched, write: () => {} });

  assert.equal(result.summary.closedPending, 0);
  assert.equal(result.summary.reconciled, 0);
  assert.equal(calls.some((call) => call.startsWith('project field-list')), false);
});

test('a failed status edit is reported and sets a nonzero exit code', () => {
  const { run } = createRunner();
  const patched = (command, args) => {
    if (args.join(' ').startsWith('project item-edit')) {
      return { status: 1, stdout: '', stderr: 'denied ghp_secret' };
    }
    return run(command, args);
  };
  const lines = [];
  const result = syncPriorityQueue({ ...OPTIONS, apply: true }, { run: patched, write: (l) => lines.push(l) });

  assert.equal(result.summary.reconciled, 0);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.exitCode, 1);
  assert.match(lines.join('\n'), /Failed .*issues\/2: denied \[redacted\]/);
});

const PORTFOLIO_URL = 'https://github.com/sarthakagrawal927/portfolio/issues/28';

test('parseSkipRepoLabels builds a repo-scoped label map and rejects bad entries', () => {
  const map = parseSkipRepoLabels(['Owner/Repo:Issues', 'org/other:skip']);
  assert.deepEqual([...map.get('owner/repo')], ['issues']);
  assert.deepEqual([...map.get('org/other')], ['skip']);
  assert.equal(map.size, 2);

  assert.throws(() => parseSkipRepoLabels(['no-slash:label']), /Invalid --skip-repo-label/);
  assert.throws(() => parseSkipRepoLabels(['org/repo:']), /Invalid --skip-repo-label/);
  assert.throws(() => parseSkipRepoLabels(['just-a-string']), /Invalid --skip-repo-label/);
});

test('extractIssueRecords reads repo and labels from search rows', () => {
  const [first, second] = extractIssueRecords([
    { url: OPEN_URL, repository: { nameWithOwner: 'Owner/Repo' }, labels: [{ name: 'Issues' }] },
    { url: CLOSED_URL },
  ]);
  assert.equal(first.url, OPEN_URL);
  assert.equal(first.repo, 'owner/repo');
  assert.deepEqual(first.labels, ['issues']);
  assert.equal(second.repo, '');
  assert.deepEqual(second.labels, []);
});

test('extractSkippedUrls matches repo and label case-insensitively', () => {
  const records = [
    { url: OPEN_URL, repo: 'owner/repo', labels: ['issues'] },
    { url: PORTFOLIO_URL, repo: 'sarthakagrawal927/portfolio', labels: ['issues'] },
    { url: MISSING_URL, repo: 'sarthakagrawal927/portfolio', labels: ['other'] },
  ];
  const skipped = extractSkippedUrls(records, parseSkipRepoLabels(['sarthakagrawal927/portfolio:issues']));
  assert.deepEqual([...skipped], [PORTFOLIO_URL]);
  assert.equal(extractSkippedUrls(records, new Map()).size, 0);
});

test('planQueueSync excludes skipped urls and reports the skipped count', () => {
  const plan = planQueueSync(
    [OPEN_URL, PORTFOLIO_URL, MISSING_URL],
    new Set([OPEN_URL]),
    new Set([PORTFOLIO_URL]),
  );
  assert.deepEqual(plan.discovered, [OPEN_URL, MISSING_URL]);
  assert.deepEqual(plan.missing, [MISSING_URL]);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.skipped, 1);
});

test('planStatusReconciliation ignores skipped urls in both directions', () => {
  const payload = {
    items: [
      { id: 'ITEM_done', status: 'Done', content: { url: PORTFOLIO_URL } },
      { id: 'ITEM_closed', status: 'In Progress', content: { url: CLOSED_URL } },
    ],
  };
  const plan = planStatusReconciliation(payload, {
    closedUrls: new Set([PORTFOLIO_URL, CLOSED_URL]),
    openUrls: new Set([PORTFOLIO_URL]),
    skipUrls: new Set([PORTFOLIO_URL]),
  });
  assert.deepEqual(plan.toDone, [{ itemId: 'ITEM_closed', url: CLOSED_URL, status: 'In Progress' }]);
  assert.deepEqual(plan.reopened, []);
});

function createSkipRunner() {
  const calls = [];
  const run = (command, args) => {
    calls.push(args.join(' '));
    const joined = args.join(' ');
    if (joined.startsWith('api user')) return { status: 0, stdout: 'sarthak' };
    if (joined.startsWith('project view')) return { status: 0, stdout: '{"id":"PVT_1"}' };
    if (joined.includes('--state open')) {
      return {
        status: 0,
        stdout: JSON.stringify([
          { url: OPEN_URL, repository: { nameWithOwner: 'owner/repo' }, labels: [] },
          {
            url: PORTFOLIO_URL,
            repository: { nameWithOwner: 'sarthakagrawal927/portfolio' },
            labels: [{ name: 'issues' }],
          },
        ]),
      };
    }
    if (joined.includes('--state closed')) {
      return { status: 0, stdout: JSON.stringify([]) };
    }
    if (joined.startsWith('project item-list')) {
      return { status: 0, stdout: JSON.stringify({ items: [] }) };
    }
    if (joined.startsWith('project field-list')) return { status: 0, stdout: JSON.stringify(FIELDS) };
    if (joined.startsWith('project item-add')) return { status: 0, stdout: '{}' };
    if (joined.startsWith('project item-edit')) return { status: 0, stdout: '{}' };
    return { status: 1, stdout: '', stderr: `unexpected: ${joined}` };
  };
  return { calls, run };
}

test('apply skips repo-scoped label issues: never adds them and never flags drift', () => {
  const { calls, run } = createSkipRunner();
  const lines = [];
  const result = syncPriorityQueue(
    { ...OPTIONS, apply: true, skipRepoLabels: ['sarthakagrawal927/portfolio:issues'] },
    { run, write: (l) => lines.push(l) },
  );

  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.discovered, 1);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.added, 1);
  assert.equal(result.summary.reopened, 0);
  assert.equal(result.summary.closedPending, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.some((call) => call.includes('portfolio/issues/28')), false);
  assert.equal(
    calls.filter((call) => call.startsWith('project item-add')).length,
    1,
  );
  assert.match(lines.join('\n'), /skipped=1/);
});

test('dry run reports skipped portfolio notes without attempting to add them', () => {
  const { calls, run } = createSkipRunner();
  const lines = [];
  const result = syncPriorityQueue(
    { ...OPTIONS, apply: false },
    { run, write: (l) => lines.push(l) },
  );

  assert.equal(result.summary.mode, 'dry-run');
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.added, 0);
  assert.equal(calls.some((call) => call.startsWith('project item-add')), false);
});
