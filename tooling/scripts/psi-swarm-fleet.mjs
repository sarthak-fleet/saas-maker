#!/usr/bin/env node
// Run a psi-swarm sweep across every surface in a portfolio target list.
//
// Companion to psi-portfolio-delta.mjs: both read the same
// `fleet.psi-portfolio-targets.v1` file, so one input drives the run and the
// ranking. Tag every sweep and the two are comparable month over month.
//
// This repository is public. The target list is an input, never a constant:
// private catalogs stay with Site Health and are passed in per run.
//
//   node psi-swarm-fleet.mjs \
//     --targets ../../../site-health/apps/backend/config/psi-portfolio-targets.json \
//     --tag baseline-2026-09
//
// Then rank the sweep:
//   node psi-portfolio-delta.mjs --history ~/.psi-swarm/history.db \
//     --targets <same file> --tag baseline-2026-09 --json

import { spawnSync } from 'node:child_process';

import { readTargets } from './psi-portfolio-delta.mjs';

function parseArguments(argv) {
  const options = { targets: null, tag: null, runs: '5', presets: 'psi', ahrefs: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--targets') options.targets = argv[index += 1];
    else if (flag === '--tag') options.tag = argv[index += 1];
    else if (flag === '--runs') options.runs = argv[index += 1];
    else if (flag === '--presets') options.presets = argv[index += 1];
    // Ahrefs is a paid connector; off unless the caller has authorised it.
    else if (flag === '--ahrefs') options.ahrefs = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.targets) throw new Error('--targets <targets.json> is required');
  if (!options.tag) throw new Error('--tag <name> is required so the sweep is comparable later');
  return options;
}

const options = parseArguments(process.argv.slice(2));
const targets = readTargets(options.targets);

// Fail fast rather than part-way through a 20-minute sweep.
const version = spawnSync('psi-swarm', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error('psi-swarm is not on PATH. See psi-swarm/SKILL.md for the pinned install.');
  process.exit(1);
}

console.error(`psi-swarm ${version.stdout.trim()} · ${targets.length} surfaces · tag=${options.tag}`);

const results = [];
for (const [index, target] of targets.entries()) {
  const url = `https://${target.domain}/`;
  const argv = [
    'run', url,
    '--runs', options.runs,
    '--presets', options.presets,
    '--tag', options.tag,
    '--no-suggest',
  ];
  if (!options.ahrefs) argv.push('--no-ahrefs');

  console.error(`\n[${index + 1}/${targets.length}] ${target.name} — ${url}`);
  const started = process.hrtime.bigint();
  const run = spawnSync('psi-swarm', argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);

  results.push({ projectId: target.projectId, domain: target.domain, url, exitCode: run.status, elapsedMs });
  if (run.status !== 0) console.error(`  !! ${target.domain} exited ${run.status}`);
}

const failed = results.filter((result) => result.exitCode !== 0);
console.error(`\nSweep complete: ${results.length - failed.length}/${results.length} surfaces succeeded.`);
if (failed.length > 0) console.error(`Failed: ${failed.map((result) => result.domain).join(', ')}`);
console.log(JSON.stringify({
  schema: 'fleet.psi-swarm-fleet-sweep.v1',
  tag: options.tag,
  presets: options.presets,
  runsPerPreset: Number(options.runs),
  surfaces: results,
}, null, 2));

process.exit(failed.length > 0 ? 1 : 0);
