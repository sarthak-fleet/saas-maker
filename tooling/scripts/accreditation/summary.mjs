#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';

import {
  ACCREDITATION_STATE_PATH,
  readAccreditationState,
  summarizeAccreditationState,
} from '../../lib/accreditation-state.mjs';

const USAGE = `Usage: summary.mjs [--state <path>] [--platform <id>] [--state-filter <state>]
       [--stale-only] [--json]

Read-only. Prints per-platform accreditation state, last recorded evidence, and
staleness. Never modifies the state file.`;

const args = process.argv.slice(2);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

function describe(platform) {
  const evidence = platform.lastEvidence;
  const parts = [
    `${platform.id.padEnd(28)} ${platform.currentState.padEnd(11)}`,
    platform.stale ? 'STALE' : '     ',
    platform.verifiedAt ? `verified ${platform.verifiedAt.slice(0, 10)}` : 'never verified',
  ];
  if (evidence) {
    parts.push(
      `last ${evidence.outcome}${evidence.applied ? '' : ' (not applied)'} ${evidence.observedAt.slice(0, 10)}`,
      evidence.liveUrl
        ? `${evidence.liveUrl} (${evidence.httpStatus ?? 'no status'})`
        : 'no live URL',
    );
  } else {
    parts.push('no evidence recorded');
  }
  if (platform.blocker) parts.push(`blocker: ${platform.blocker}`);
  if (platform.rejectionReason) parts.push(`rejected: ${platform.rejectionReason}`);
  return parts.join(' | ');
}

try {
  if (args.includes('--help')) throw new Error(USAGE);
  const state = readAccreditationState(resolve(option('--state', ACCREDITATION_STATE_PATH)));
  const summary = summarizeAccreditationState(state);
  const platformId = option('--platform');
  const stateFilter = option('--state-filter');

  const platforms = summary.platforms.filter((platform) => {
    if (platformId && platform.id !== platformId) return false;
    if (stateFilter && platform.currentState !== stateFilter) return false;
    return args.includes('--stale-only') ? platform.stale : true;
  });

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...summary, platforms }, null, 2)}\n`);
  } else {
    const counts = Object.entries(summary.counts)
      .map(([name, count]) => `${name}=${count}`)
      .join(' ');
    const header = `Accreditation state updated ${summary.updated} · staleness ${summary.stalenessDays}d`;
    const totals = `${counts}\nprotected=${summary.protectedCount} stale=${summary.staleCount}`;
    process.stdout.write(`${header}\n${totals}\n\n${platforms.map(describe).join('\n')}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
