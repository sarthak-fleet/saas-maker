#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

import {
  SkillRunStore,
  defaultSkillRunsRoot,
} from '../../lib/skill-run-store.mjs';
import { parseTeammateScorecard } from '../../lib/skill-run-scorecard.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();

function usage() {
  return `usage: fleet-skill-run <command> [options]

Commands:
  exec --skill <id> --project <id> [--source <source>] [--output-file <path>]
       [--metrics-file <path>] -- <command...>
  record --json
  list [--project <id>] [--skill <id>] [--source <source>] [--json]
  show <run-id> [--json]
  output <run-id> [--stream stdout|stderr|output] [--json]
  metrics --project <id> [--skill <id>] [--metric <name>] [--json]
  status [--json]
  doctor [--json]
  rebuild [--json]
  prune [--before <ISO timestamp>] [--json]
  backfill-teammates --scorecard <path> [--json]
`;
}

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function assertNoArguments(args) {
  if (args.length > 0) throw new Error(`unexpected argument: ${args[0]}`);
}

function writeResult(result, json, human) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${human(result)}\n`);
}

async function readJsonStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('record --json requires a JSON object on stdin');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('record input must be a JSON object');
  }
  return value;
}

async function readMetrics(path) {
  if (!path) return [];
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!Array.isArray(value)) throw new Error('metrics file must contain a JSON array');
  return value;
}

function runChild(commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      resolvePromise({
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        signal: signal ?? null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function newStore() {
  return new SkillRunStore({
    root: process.env.FLEET_SKILL_RUNS_DIR || defaultSkillRunsRoot(),
  });
}

function runSummary(result) {
  const run = result.run ?? result;
  const duplicate = result.duplicate ? ' (duplicate)' : '';
  return `${run.id ?? run.runId ?? 'unknown'} ${run.skillId ?? 'unknown'} ${run.status ?? 'unknown'}${duplicate}`;
}

async function execCommand(store, args) {
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) {
    throw new Error('exec requires -- followed by a command');
  }
  const options = args.slice(0, separator);
  const commandArgs = args.slice(separator + 1);
  const skillId = takeOption(options, '--skill');
  const projectId = takeOption(options, '--project');
  const source = takeOption(options, '--source') ?? 'wrapped';
  const outputFile = takeOption(options, '--output-file');
  const metricsFile = takeOption(options, '--metrics-file');
  assertNoArguments(options);
  if (!skillId || !projectId) throw new Error('exec requires --skill and --project');

  const startedAt = new Date().toISOString();
  const child = await runChild(commandArgs);
  const finishedAt = new Date().toISOString();
  let output;
  let metrics = [];
  let attachmentWarning = null;
  try {
    output = outputFile ? await readFile(resolve(outputFile), 'utf8') : undefined;
    metrics = await readMetrics(metricsFile);
  } catch (error) {
    attachmentWarning = error;
  }

  try {
    if (attachmentWarning) throw attachmentWarning;
    const recorded = await store.record({
      run: {
        skillId,
        projectId,
        projectRoot: process.cwd(),
        actor: 'local',
        host: hostname(),
        source,
        captureCompleteness: 'exact-streams',
        startedAt,
        finishedAt,
        observedAt: finishedAt,
        status: child.exitCode === 0 ? 'succeeded' : 'failed',
        exitCode: child.exitCode,
        idempotencyKey: `wrapped:${randomUUID()}`,
        metadata: {
          command: commandArgs[0],
          ...(child.signal ? { signal: child.signal } : {}),
        },
      },
      stdout: child.stdout,
      stderr: child.stderr,
      ...(output === undefined ? {} : { output }),
      metrics,
    });
    for (const warning of recorded.warnings ?? []) {
      process.stderr.write(`fleet-skill-run warning: ${warning}\n`);
    }
  } catch (error) {
    process.stderr.write(`fleet-skill-run warning: ${error.message}\n`);
  }
  process.exitCode = child.exitCode;
}

async function recordCommand(store, args) {
  const json = takeFlag(args, '--json');
  assertNoArguments(args);
  if (!json) throw new Error('record currently requires --json');
  const result = await store.record(await readJsonStdin());
  writeResult(result, true, runSummary);
}

function queryFilters(args) {
  return {
    projectId: takeOption(args, '--project'),
    skillId: takeOption(args, '--skill'),
    source: takeOption(args, '--source'),
    metricName: takeOption(args, '--metric'),
  };
}

async function listCommand(store, args) {
  const json = takeFlag(args, '--json');
  const filters = queryFilters(args);
  delete filters.metricName;
  assertNoArguments(args);
  const result = await store.list(filters);
  writeResult(result, json, (runs) => (
    runs.length === 0
      ? 'No skill runs recorded.'
      : runs.map((run) => (
        `${run.observedAt ?? run.finishedAt}  ${run.id ?? run.runId}  ${run.projectId}  ${run.skillId}  ${run.status}`
      )).join('\n')
  ));
}

async function showCommand(store, args) {
  const json = takeFlag(args, '--json');
  const runId = args.shift();
  assertNoArguments(args);
  if (!runId) throw new Error('show requires a run id');
  const result = await store.show(runId);
  writeResult(result, json, (value) => JSON.stringify(value, null, 2));
}

async function outputCommand(store, args) {
  const json = takeFlag(args, '--json');
  const stream = takeOption(args, '--stream');
  const runId = args.shift();
  assertNoArguments(args);
  if (!runId) throw new Error('output requires a run id');
  if (stream) {
    const result = await store.output(runId, stream);
    if (json) process.stdout.write(`${JSON.stringify({ runId, stream, output: result }, null, 2)}\n`);
    else process.stdout.write(result);
    return;
  }

  const result = {};
  for (const name of ['stdout', 'stderr', 'output']) {
    try {
      const value = await store.output(runId, name);
      if (value) result[name] = value;
    } catch {
      // A run need not contain every output kind.
    }
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ runId, ...result }, null, 2)}\n`);
  } else {
    for (const [name, value] of Object.entries(result)) {
      process.stdout.write(`== ${name} ==\n${value}`);
      if (!value.endsWith('\n')) process.stdout.write('\n');
    }
  }
}

async function metricsCommand(store, args) {
  const json = takeFlag(args, '--json');
  const filters = queryFilters(args);
  delete filters.source;
  assertNoArguments(args);
  if (!filters.projectId) throw new Error('metrics requires --project');
  const result = await store.metrics(filters);
  writeResult(result, json, (observations) => (
    observations.length === 0
      ? 'No metric observations recorded.'
      : observations.map((metric) => (
        `${metric.observedAt}  ${metric.projectId}  ${metric.skillId}  ${metric.metricName}=${metric.value}${metric.unit ? ` ${metric.unit}` : ''}  ${metric.direction}`
      )).join('\n')
  ));
}

async function statusCommand(store, args) {
  const json = takeFlag(args, '--json');
  assertNoArguments(args);
  const result = await store.status();
  writeResult(result, json, (value) => (
    `${value.runCount ?? 0} runs, ${value.metricCount ?? 0} metrics, ${value.outputBytes ?? 0} output bytes`
  ));
}

async function doctorCommand(store, args) {
  const json = takeFlag(args, '--json');
  assertNoArguments(args);
  const result = await store.doctor();
  writeResult(result, json, (value) => (
    value.healthy ? 'Skill-run store is healthy.' : `Skill-run store needs repair: ${JSON.stringify(value)}`
  ));
  if (!result.healthy) process.exitCode = 1;
}

async function rebuildCommand(store, args) {
  const json = takeFlag(args, '--json');
  assertNoArguments(args);
  const result = await store.rebuild();
  writeResult(result, json, (value) => `Rebuilt indexes for ${value.runCount ?? 0} runs.`);
}

async function pruneCommand(store, args) {
  const json = takeFlag(args, '--json');
  const before = takeOption(args, '--before');
  assertNoArguments(args);
  const runs = await store.list({});
  const candidates = before
    ? runs.filter((run) => Date.parse(run.observedAt) < Date.parse(before))
    : [];
  const result = {
    dryRun: true,
    before: before ?? null,
    candidateCount: candidates.length,
    runIds: candidates.map((run) => run.id ?? run.runId),
    deletedCount: 0,
  };
  writeResult(result, json, (value) => (
    `Dry run only: ${value.candidateCount} runs would be candidates; deleted 0.`
  ));
}

async function backfillCommand(store, args) {
  const json = takeFlag(args, '--json');
  const scorecardPath = takeOption(args, '--scorecard');
  assertNoArguments(args);
  if (!scorecardPath) throw new Error('backfill-teammates requires --scorecard');
  const absolutePath = resolve(scorecardPath);
  const entries = parseTeammateScorecard(await readFile(absolutePath, 'utf8'), {
    source: scorecardPath,
  });
  let created = 0;
  let duplicates = 0;
  const byActor = { codex: 0, devin: 0 };
  for (const entry of entries) {
    const result = await store.record(entry);
    const actor = entry.run.actor.id;
    byActor[actor] += 1;
    if (result.duplicate) duplicates += 1;
    else created += 1;
  }
  const result = {
    source: scorecardPath,
    total: entries.length,
    created,
    duplicates,
    byActor,
    metricsCreated: 0,
  };
  writeResult(result, json, (value) => (
    `Imported ${value.created} of ${value.total} teammate runs (${value.byActor.codex} Codex, ${value.byActor.devin} Devin); ${value.duplicates} duplicates; 0 metrics.`
  ));
}

const COMMANDS = {
  exec: execCommand,
  record: recordCommand,
  list: listCommand,
  show: showCommand,
  output: outputCommand,
  metrics: metricsCommand,
  status: statusCommand,
  doctor: doctorCommand,
  rebuild: rebuildCommand,
  prune: pruneCommand,
  'backfill-teammates': backfillCommand,
};

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) throw new Error(`unknown command: ${command}`);
  await handler(newStore(), argv);
}

main().catch((error) => {
  fail(`fleet-skill-run: ${error.message}`, 1);
});
