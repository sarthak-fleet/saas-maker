#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCodeHealthReport,
  reportExitCode,
  validateCodeHealthPolicy,
} from '../lib/code-health.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), '../../..');

const usage = () => `Usage:
  code-health.mjs [--json] [--strict] [--project ID ...]
    [--workspace-root PATH] [--registry PATH] [--policy PATH] [--today YYYY-MM-DD]
  code-health.mjs --validate [--json] [--registry PATH] [--policy PATH]

The default command performs deterministic, read-only configuration coverage
inventory. A configured path is not reported as executed proof. --strict exits
non-zero when a maintained project has failed or unavailable required coverage.
--validate checks policy and exact maintained-project profile coverage only.`;

export function parseCodeHealthArgs(argv) {
  const options = { projectIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--validate') options.validate = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--project', '--workspace-root', '--registry', '--policy', '--today'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      if (argument === '--project') options.projectIds.push(value);
      else options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

const readJson = async (candidate) => JSON.parse(await readFile(candidate, 'utf8'));

function attentionDetails(project) {
  const findings = project.capabilities
    .filter((capability) => ['fail', 'warning', 'unavailable'].includes(capability.status))
    .map((capability) => `${capability.capability}:${capability.status}`);
  return findings.length > 0 ? findings.join(', ') : project.reason;
}

export function formatCodeHealthReport(report) {
  const { counts } = report.summary;
  const state = report.ok ? 'READY' : 'NON-GREEN';
  const lines = [
    `Fleet code health coverage: ${state} — ${counts.pass} pass, ${counts.warning} warning, ${counts.unavailable} unavailable, ${counts.fail} fail, ${counts.excluded} excluded (${report.summary.maintainedTotal} maintained)`,
    '  Evidence mode: configuration coverage only; configured paths were not executed',
  ];
  const attention = report.projects.filter((project) => (
    ['fail', 'warning', 'unavailable'].includes(project.status)
  ));
  if (attention.length > 0) {
    lines.push('  Needs attention:');
    for (const project of attention) {
      lines.push(`    ${project.status.padEnd(11)} ${project.id} [${project.profile}] — ${attentionDetails(project)}`);
    }
  }
  const passing = report.projects.filter((project) => project.status === 'pass');
  if (passing.length > 0) lines.push(`  Passing coverage: ${passing.map((project) => project.id).join(', ')}`);
  const excluded = report.projects.filter((project) => project.status === 'excluded');
  if (excluded.length > 0) lines.push(`  Excluded: ${excluded.map((project) => project.id).join(', ')}`);
  if (report.adoptionSequence.length > 0) {
    lines.push(`  Sequential adoption: ${report.adoptionSequence.join(' -> ')}`);
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCodeHealthArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  try {
    const registryPath = path.resolve(options.registry ?? path.join(
      sourceRoot,
      'foundry/ops/config/projects.json',
    ));
    const policyPath = path.resolve(options.policy ?? path.join(
      sourceRoot,
      'foundry/ops/config/code-health.json',
    ));
    const workspaceRoot = path.resolve(options.workspaceRoot ?? sourceRoot);
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    const [registry, policy] = await Promise.all([
      readJson(registryPath),
      readJson(policyPath),
    ]);
    const projects = registry.projects;
    if (!Array.isArray(projects)) throw new Error('project registry must contain a projects array');

    if (options.validate) {
      const validation = validateCodeHealthPolicy({ policy, projects, today });
      if (options.json) console.log(JSON.stringify(validation, null, 2));
      else if (validation.ok) console.log(`Fleet code health policy: VALID — ${Object.keys(policy.projects).length} maintained project profiles`);
      else {
        console.error('Fleet code health policy: INVALID');
        for (const error of validation.errors) console.error(`  - ${error}`);
      }
      return validation.ok ? 0 : 2;
    }

    const report = await buildCodeHealthReport({
      policy,
      projects,
      workspaceRoot,
      projectIds: options.projectIds,
      today,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatCodeHealthReport(report));
    return reportExitCode(report, { strict: options.strict });
  } catch (error) {
    const failure = {
      schemaVersion: 'fleet.code-health-error.v1',
      ok: false,
      error: { code: error.code ?? 'ERR_CODE_HEALTH', message: error.message },
    };
    if (options?.json) console.error(JSON.stringify(failure, null, 2));
    else console.error(`Fleet code health failed: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await main();
}
