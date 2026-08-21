#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { visibilityProjects } from '../../../lib/visibility-projects.mjs';

const execFileAsync = promisify(execFile);
const fleetRoot = resolve(import.meta.dirname, '../../../../..');
const defaultArtifact = join(
  fleetRoot,
  'foundry/ops/data/seo-audit/latest.json',
);
const auditScript = join(import.meta.dirname, 'seo-audit.sh');

export function parseSeoAuditOutput(output, {
  projectId,
  url,
  auditedAt = new Date().toISOString(),
} = {}) {
  const summary = output.match(
    /(\d+) checks passed,\s*(\d+) failed,\s*(\d+) warnings/u,
  );
  if (!summary) {
    throw new Error(`${projectId ?? url ?? 'SEO audit'}: summary is missing`);
  }
  const failedChecks = [
    ...output.matchAll(/^\s{2}([a-z][a-z0-9:-]*)\s+FAIL\b/gimu),
  ].map((match) => match[1]);
  const warningChecks = [
    ...output.matchAll(/^\s{2}([a-z][a-z0-9:-]*)\s+WARN\b/gimu),
  ].map((match) => match[1]);

  return {
    url,
    pass: Number(summary[1]),
    fail: Number(summary[2]),
    warn: Number(summary[3]),
    reachable: !failedChecks.includes('fetch'),
    failedChecks: [...new Set(failedChecks)],
    warningChecks: [...new Set(warningChecks)],
    date: auditedAt.slice(0, 10),
    auditedAt,
  };
}

async function auditProject(project, auditedAt) {
  const url = `https://${project.domains[0]}/`;
  let output;
  try {
    const result = await execFileAsync('bash', [auditScript, url], {
      cwd: fleetRoot,
      maxBuffer: 2 * 1024 * 1024,
    });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  return [
    project.id,
    parseSeoAuditOutput(output, {
      projectId: project.id,
      url,
      auditedAt,
    }),
  ];
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyId = option(args, '--id');
  const all = args.includes('--all');
  if (!all && !onlyId) {
    process.stderr.write(
      'usage: seo-audit-fleet.mjs --all | --id <project> [--artifact <path>] [--json]\n',
    );
    process.exitCode = 2;
    return;
  }

  const catalog = JSON.parse(
    readFileSync(join(fleetRoot, 'foundry/ops/config/projects.json'), 'utf8'),
  );
  const eligible = visibilityProjects(catalog);
  const selected = onlyId
    ? eligible.filter((project) => project.id === onlyId)
    : eligible;
  if (onlyId && selected.length === 0) {
    throw new Error(`unknown visibility project: ${onlyId}`);
  }

  const auditedAt = new Date().toISOString();
  const entries = await Promise.all(
    selected.map((project) => auditProject(project, auditedAt)),
  );
  const artifactPath = resolve(option(args, '--artifact') ?? defaultArtifact);
  const artifact = onlyId && existsSync(artifactPath)
    ? JSON.parse(readFileSync(artifactPath, 'utf8'))
    : {};
  for (const [projectId, result] of entries) artifact[projectId] = result;

  mkdirSync(dirname(artifactPath), { recursive: true });
  const pendingPath = `${artifactPath}.${process.pid}.tmp`;
  writeFileSync(pendingPath, `${JSON.stringify(artifact, null, 2)}\n`);
  renameSync(pendingPath, artifactPath);

  const failed = entries.filter(([, result]) => result.fail > 0);
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } else {
    process.stdout.write(
      `SEO audit: ${entries.length - failed.length}/${entries.length} homepages pass → ${artifactPath}\n`,
    );
    for (const [projectId, result] of failed) {
      process.stdout.write(
        `- ${projectId}: ${result.reachable ? result.failedChecks.join(', ') : 'fetch failed'}\n`,
      );
    }
  }
  if (failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
