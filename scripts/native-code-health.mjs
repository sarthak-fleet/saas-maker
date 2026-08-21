#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const opsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fleetRoot = resolve(opsRoot, '../..');
const productionPaths = ['lib', 'scripts', 'host', 'automation', 'skills', 'teammates'];
const ignoredGlobs = [
  '*/node_modules/*',
  '*/dist/*',
  '*/coverage/*',
  '*/fixtures/*',
  '*/archive/*',
  '*/vendor/*',
];

const baselines = {
  complexity: {
    warnings: 101,
    maxNloc: 2427,
    maxCcn: 63,
    maxTokens: 4014,
    maxParams: 13,
    maxLength: 2429,
  },
  duplication: {
    duplicatedLines: 326,
    percentage: 0.7775975574849727,
    clones: 26,
  },
  unused: {
    files: 0,
    exports: 1,
    types: 0,
    dependencies: 0,
    unlisted: 0,
    binaries: 0,
    vulture: 0,
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? opsRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function commandWithUvx(command, uvxArgs) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? { command, prefix: [] } : { command: 'uvx', prefix: uvxArgs };
}

function jsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    process.stderr.write(result.stderr);
    throw new Error(`${label} did not return valid JSON`);
  }
}

function knipOutput(extraArgs = [], label = 'Knip') {
  return jsonOutput(
    run(
      'pnpm',
      [
        'exec',
        'knip',
        ...extraArgs,
        '--reporter',
        'json',
        '--no-exit-code',
        '--no-progress',
      ],
      { allowFailure: true },
    ),
    label,
  );
}

function gitBase() {
  if (process.env.CODE_HEALTH_BASE) return process.env.CODE_HEALTH_BASE;
  const mergeBase = run('git', ['merge-base', 'HEAD', 'origin/main'], {
    cwd: fleetRoot,
    allowFailure: true,
  }).stdout.trim();
  if (mergeBase) return mergeBase;
  return run('git', ['rev-parse', 'HEAD^'], { cwd: fleetRoot }).stdout.trim();
}

function changedFiles() {
  const result = run(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      gitBase(),
      '--',
      'package.json',
      '.github/workflows/fleet-ci.yml',
      'foundry/ops',
    ],
    { cwd: fleetRoot },
  );
  return result.stdout.trim().split('\n').filter(Boolean);
}

function checkFormat() {
  run(
    'git',
    [
      'diff',
      '--check',
      gitBase(),
      '--',
      'package.json',
      '.github/workflows/fleet-ci.yml',
      'foundry/ops',
    ],
    { cwd: fleetRoot },
  );
  const files = changedFiles().filter((file) => /\.(?:js|mjs|json|md|ya?ml)$/u.test(file));
  const malformed = [];
  for (const file of files) {
    const content = readFileSync(resolve(fleetRoot, file), 'utf8');
    if (!content.endsWith('\n')) malformed.push(`${file}: missing final newline`);
    if (content.includes('\r')) malformed.push(`${file}: contains CRLF line endings`);
  }
  if (malformed.length > 0) throw new Error(malformed.join('\n'));
  console.log(
    `Format: diff whitespace plus ${files.length} changed text-file boundaries passed.`,
  );
}

function checkLint() {
  const files = changedFiles();
  const javascript = files.filter((file) => /\.(?:js|mjs)$/u.test(file));
  const python = files.filter((file) => file.endsWith('.py'));
  const json = files.filter((file) => file.endsWith('.json'));
  for (const file of javascript) run('node', ['--check', file], { cwd: fleetRoot });
  for (const file of json) JSON.parse(readFileSync(resolve(fleetRoot, file), 'utf8'));
  if (python.length > 0) {
    const ruff = commandWithUvx('ruff', ['--from', 'ruff==0.16.2', 'ruff']);
    run(
      ruff.command,
      [
        ...ruff.prefix,
        'check',
        '--isolated',
        '--select',
        'E4,E7,E9,F,I',
        ...python,
      ],
      { cwd: fleetRoot },
    );
  }
  console.log(
    `Lint: ${javascript.length} changed JavaScript, ${python.length} Python, and ${json.length} JSON files passed.`,
  );
}

function issueCount(issues, key) {
  return issues.reduce((sum, issue) => sum + (issue[key]?.length ?? 0), 0);
}

function checkUnused() {
  const knip = knipOutput();
  const issues = knip.issues ?? [];
  const observed = {
    files: issueCount(issues, 'files'),
    exports: issueCount(issues, 'exports'),
    types: issueCount(issues, 'types'),
    dependencies: issueCount(issues, 'dependencies'),
    unlisted: issueCount(issues, 'unlisted'),
    binaries: issueCount(issues, 'binaries'),
  };
  const vulture = commandWithUvx('vulture', ['--from', 'vulture==2.16', 'vulture']);
  const vultureResult = run(
    vulture.command,
    [...vulture.prefix, ...productionPaths, '--min-confidence', '80'],
    { allowFailure: true },
  );
  observed.vulture = vultureResult.stdout.trim().split('\n').filter(Boolean).length;
  console.log(
    `Unused: Knip files=${observed.files}, exports=${observed.exports}, types=${observed.types}, ` +
      `dependencies=${observed.dependencies}, unlisted=${observed.unlisted}, binaries=${observed.binaries}; ` +
      `Vulture=${observed.vulture}.`,
  );
  failRegressions('Unused', observed, baselines.unused);
}

function checkComplexity() {
  const lizard = commandWithUvx('lizard', ['--from', 'lizard==1.23.0', 'lizard']);
  const result = run(lizard.command, [
    ...lizard.prefix,
    ...productionPaths,
    ...ignoredGlobs.flatMap((glob) => ['-x', glob]),
    '--csv',
  ]);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => line.match(/^(\d+),(\d+),(\d+),(\d+),(\d+),/u))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number));
  const observed = {
    functions: rows.length,
    nloc: rows.reduce((sum, row) => sum + row[0], 0),
    warnings: rows.filter((row) => row[1] > 15 || row[4] > 100 || row[3] > 7).length,
    maxNloc: Math.max(...rows.map((row) => row[0])),
    maxCcn: Math.max(...rows.map((row) => row[1])),
    maxTokens: Math.max(...rows.map((row) => row[2])),
    maxParams: Math.max(...rows.map((row) => row[3])),
    maxLength: Math.max(...rows.map((row) => row[4])),
  };
  console.log(
    `Complexity: ${observed.functions} functions, ${observed.nloc} NLOC, ${observed.warnings} violations; ` +
      `max CCN ${observed.maxCcn}, max length ${observed.maxLength}.`,
  );
  const worstRows = result.stdout
    .trim()
    .split('\n')
    .map((line) => ({ line, ccn: Number(line.match(/^\d+,(\d+),/u)?.[1] ?? 0) }))
    .filter((row) => row.ccn > 15)
    .sort((left, right) => right.ccn - left.ccn)
    .slice(0, 40)
    .map((row) => row.line);
  if (worstRows.length > 0) {
    console.log(`Highest-complexity functions:\n${worstRows.join('\n')}`);
  }
  failRegressions('Complexity', observed, baselines.complexity);
}

function checkDuplication() {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'fleet-ops-jscpd-'));
  run('pnpm', [
    'exec',
    'jscpd',
    ...productionPaths,
    '--format',
    'javascript,typescript,python',
    '--min-lines',
    '8',
    '--min-tokens',
    '60',
    '--mode',
    'strict',
    '--ignore',
    '**/node_modules/**,**/dist/**,**/coverage/**,**/fixtures/**,**/archive/**,**/vendor/**,**/*.min.js',
    '--reporters',
    'json',
    '--output',
    outputDirectory,
    '--silent',
    '--no-tips',
  ]);
  const observed = JSON.parse(readFileSync(join(outputDirectory, 'jscpd-report.json'), 'utf8'))
    .statistics.total;
  console.log(
    `Duplication: ${observed.duplicatedLines}/${observed.lines} lines (${observed.percentage.toFixed(4)}%), ` +
      `${observed.clones} groups across ${observed.sources} files.`,
  );
  failRegressions('Duplication', observed, baselines.duplication);
}

function checkCycles() {
  const knip = knipOutput(['--cycles'], 'Knip cycle analysis');
  const cycles = (knip.issues ?? []).flatMap((issue) => issue.cycles ?? []);
  if (cycles.length > 0) throw new Error(`JavaScript dependency cycles detected: ${cycles.length}`);
  const pycycle = commandWithUvx('pycycle', ['pycycle==0.0.8']);
  const python = run(pycycle.command, [...pycycle.prefix, '--here'], { allowFailure: true });
  if (!python.stdout.includes('No worries, no cycles here!')) {
    process.stdout.write(python.stdout);
    throw new Error('Python cycle analysis did not produce a clean result');
  }
  console.log('Cycles: JavaScript and Python import graphs are acyclic.');
}

function checkDependencies() {
  const report = jsonOutput(run('pnpm', ['audit', '--json'], { allowFailure: true }), 'pnpm audit');
  const advisories = Object.values(report.advisories ?? {});
  const critical = advisories.filter((advisory) => advisory.severity === 'critical').length;
  const high = advisories.filter((advisory) => advisory.severity === 'high').length;
  console.log(`Dependencies: ${critical} critical and ${high} high advisories.`);
  if (critical > 0 || high > 0) throw new Error('Critical or high dependency advisories detected');
}

function failRegressions(label, observed, baseline) {
  const regressions = Object.entries(baseline).filter(([key, maximum]) => observed[key] > maximum);
  if (regressions.length > 0) {
    for (const [key, maximum] of regressions) {
      console.error(`${label} ${key} regressed: ${observed[key]} > ${maximum}.`);
    }
    process.exit(1);
  }
  if (Object.entries(baseline).some(([key, maximum]) => observed[key] < maximum)) {
    console.log(`${label} improved; lower the checked-in baseline in the next intentional update.`);
  }
}

const commands = {
  format: checkFormat,
  lint: checkLint,
  unused: checkUnused,
  complexity: checkComplexity,
  duplication: checkDuplication,
  cycles: checkCycles,
  dependencies: checkDependencies,
};

const selected = process.argv[2];
if (!Object.hasOwn(commands, selected)) {
  console.error(`Usage: native-code-health.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}

try {
  commands[selected]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
