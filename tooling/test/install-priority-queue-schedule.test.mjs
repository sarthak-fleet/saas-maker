import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommand,
  buildPlist,
  escapeXml,
  installSchedule,
  parseArgs,
  planLaunchctl,
} from '../scripts/install-priority-queue-schedule.mjs';

const REQUIRED = ['--owner', 'o', '--project', '3', '--author', 'a'];

test('parseArgs defaults to a daily morning run', () => {
  const options = parseArgs(REQUIRED);
  assert.equal(options.hour, 9);
  assert.equal(options.minute, 20);
  assert.equal(options.label, 'com.sarthak.priority-queue-sync');
  assert.equal(options.uninstall, false);
  assert.equal(options.dryRun, false);
});

test('parseArgs rejects out-of-range times and unsafe labels', () => {
  assert.throws(() => parseArgs([...REQUIRED, '--hour', '24']), /--hour must be/);
  assert.throws(() => parseArgs([...REQUIRED, '--minute', '60']), /--minute must be/);
  assert.throws(() => parseArgs([...REQUIRED, '--label', 'a b/c']), /plain launchd label/);
  assert.throws(() => parseArgs([...REQUIRED, '--nope', 'x']), /Unknown argument/);
});

test('parseArgs does not require project identity to uninstall', () => {
  const options = parseArgs(['--uninstall']);
  assert.equal(options.uninstall, true);
  assert.equal(options.owner, undefined);
});

test('escapeXml neutralizes plist markup', () => {
  assert.equal(escapeXml('a & b <c>'), 'a &amp; b &lt;c&gt;');
});

test('buildCommand quotes every operator-supplied value', () => {
  const command = buildCommand({
    syncScript: '/tmp/dir with space/sync.mjs',
    owner: 'o',
    project: 3,
    author: 'a',
    logPath: '/tmp/log with space.log',
  });
  assert.match(command, /^exec node "\/tmp\/dir with space\/sync\.mjs"/);
  assert.match(command, /--apply >> "\/tmp\/log with space\.log" 2>&1$/);
});

test('buildPlist emits a calendar interval and no credentials', () => {
  const plist = buildPlist({
    label: 'com.example.job',
    command: 'exec node "/tmp/sync.mjs" --apply',
    hour: 7,
    minute: 5,
    path: '/opt/homebrew/bin:/usr/bin',
    home: '/Users/example',
    logPath: '/Users/example/Library/Logs/com.example.job.log',
  });
  assert.match(plist, /<key>Label<\/key>\n  <string>com\.example\.job<\/string>/);
  assert.match(plist, /<key>Hour<\/key>\n    <integer>7<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\n    <integer>5<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n  <false\/>/);
  assert.doesNotMatch(plist, /token|secret|password|Bearer/i);
});

test('planLaunchctl targets the per-user gui domain', () => {
  const plan = planLaunchctl('com.example.job', '/tmp/com.example.job.plist', 501);
  assert.deepEqual(plan.bootout, ['bootout', 'gui/501/com.example.job']);
  assert.deepEqual(plan.bootstrap, ['bootstrap', 'gui/501', '/tmp/com.example.job.plist']);
});

function harness(overrides = {}) {
  const calls = [];
  const written = [];
  const removed = [];
  const lines = [];
  return {
    calls,
    written,
    removed,
    lines,
    deps: {
      run: (command, args) => {
        calls.push(`${command} ${args.join(' ')}`);
        return { status: 0, stdout: '', stderr: '' };
      },
      write: (line) => lines.push(line),
      writeFile: (path, contents) => written.push({ path, contents }),
      remove: (path) => removed.push(path),
      makeDirectory: () => {},
      home: '/Users/example',
      uid: 501,
      scriptDirectory: '/repo/tooling/scripts',
      ...overrides,
    },
  };
}

test('dry run writes nothing and bootstraps nothing', () => {
  const { calls, written, lines, deps } = harness();
  const result = installSchedule({ ...parseArgs(REQUIRED), dryRun: true }, deps);

  assert.equal(result.installed, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(written, []);
  assert.match(lines.join('\n'), /Would write \/Users\/example\/Library\/LaunchAgents/);
});

test('install writes the plist then reloads the agent', () => {
  const { calls, written, deps } = harness();
  const result = installSchedule(parseArgs(REQUIRED), deps);

  assert.equal(result.installed, true);
  assert.equal(written.length, 1);
  assert.equal(
    written[0].path,
    '/Users/example/Library/LaunchAgents/com.sarthak.priority-queue-sync.plist',
  );
  assert.match(written[0].contents, /github-priority-queue\.mjs/);
  assert.deepEqual(calls, [
    'launchctl bootout gui/501/com.sarthak.priority-queue-sync',
    'launchctl bootstrap gui/501 /Users/example/Library/LaunchAgents/com.sarthak.priority-queue-sync.plist',
  ]);
});

test('a failed bootstrap is surfaced, not silently ignored', () => {
  const { deps } = harness({
    run: (_command, args) =>
      args[0] === 'bootstrap'
        ? { status: 5, stdout: '', stderr: 'Load failed' }
        : { status: 0, stdout: '', stderr: '' },
  });
  assert.throws(() => installSchedule(parseArgs(REQUIRED), deps), /bootstrap failed: Load failed/);
});

test('uninstall boots out the agent and removes the plist', () => {
  const { calls, removed, deps } = harness();
  const result = installSchedule(parseArgs(['--uninstall']), deps);

  assert.equal(result.uninstalled, true);
  assert.deepEqual(calls, ['launchctl bootout gui/501/com.sarthak.priority-queue-sync']);
  assert.deepEqual(removed, [
    '/Users/example/Library/LaunchAgents/com.sarthak.priority-queue-sync.plist',
  ]);
});
