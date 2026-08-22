#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  accreditationQueueFilename,
  renderAccreditationQueue,
} from '../../lib/accreditation-queue.mjs';
import { ACCREDITATION_STATE_PATH, readAccreditationState } from '../../lib/accreditation-state.mjs';
import { AUDIENCE_FIT_PATH, readAudienceFit } from '../../lib/audience-fit.mjs';

const opsRoot = resolve(import.meta.dirname, '../..');
const defaultOutDir = resolve(
  homedir(),
  'Library/Application Support/Fleet Ops/accreditation',
);

const USAGE = `Usage: generate-queue.mjs [--state <path>] [--projects <path>]
       [--audience-fit <path>] [--out-dir <path>] [--date <YYYY-MM-DD>]
       [--detail summary|full] [--stdout]`;

const args = process.argv.slice(2);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

try {
  if (args.includes('--help')) throw new Error(USAGE);
  const now = new Date();
  const date = option('--date', now.toISOString().slice(0, 10));
  const detail = option('--detail', 'summary');
  const state = readAccreditationState(resolve(option('--state', ACCREDITATION_STATE_PATH)));
  const projectsPath = resolve(option('--projects', resolve(opsRoot, 'config/projects.json')));
  const { projects } = JSON.parse(readFileSync(projectsPath, 'utf8'));
  const audienceFit = readAudienceFit(resolve(option('--audience-fit', AUDIENCE_FIT_PATH)), {
    projectIds: new Set(projects.map((project) => project.id)),
    platformIds: new Set(state.platforms.map((platform) => platform.id)),
  });

  const markdown = renderAccreditationQueue({ state, projects, audienceFit, date, detail, now });

  if (args.includes('--stdout')) {
    process.stdout.write(markdown);
  } else {
    const outDir = resolve(option('--out-dir', defaultOutDir));
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const outPath = resolve(outDir, accreditationQueueFilename(date));
    writeFileSync(outPath, markdown);
    process.stdout.write(
      `${JSON.stringify({ path: outPath, platforms: state.platforms.length, detail }, null, 2)}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
