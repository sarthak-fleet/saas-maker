#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  ACCREDITATION_STATE_PATH,
  ACCREDITATION_BLOCKERS,
  ACCREDITATION_STATES,
  applyTransition,
  readAccreditationState,
  seedAccreditationState,
  writeAccreditationState,
} from '../../lib/accreditation-state.mjs';

const USAGE = `Usage:
  update-state.mjs init [--state <path>] [--config-dir <path>] [--date <YYYY-MM-DD>] [--force]
  update-state.mjs transition --platform <id> --to <${ACCREDITATION_STATES.join('|')}>
      [--outcome confirmed|indeterminate] [--live-url <url>] [--http-status <code>]
      [--final-status <code>] [--form-detected true|false] [--captcha-detected true|false]
      [--signin-required true|false] [--payment-required true|false] [--screenshot <path>]
      [--blocker <${ACCREDITATION_BLOCKERS.join('|')}>] [--reason <text>] [--note <text>] [--observed-at <iso>]
      [--state <path>]`;

const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required\n\n${USAGE}`);
  return value;
}

function booleanOption(name) {
  const value = option(name);
  if (value === null) return null;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

function integerOption(name) {
  const value = option(name);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function statePath() {
  return resolve(option('--state', ACCREDITATION_STATE_PATH));
}

function runInit() {
  const path = statePath();
  if (existsSync(path) && !args.includes('--force')) {
    throw new Error(`${path} already exists. Pass --force to reseed and discard recorded evidence.`);
  }
  const configDir = option('--config-dir');
  const date = option('--date');
  const state = seedAccreditationState({
    ...(configDir ? { configDir: resolve(configDir) } : {}),
    ...(date ? { updated: date } : {}),
  });
  writeAccreditationState(path, state);
  process.stdout.write(
    `${JSON.stringify({ path, platforms: state.platforms.length, currentState: 'seed' }, null, 2)}\n`,
  );
}

function runTransition() {
  const path = statePath();
  const state = readAccreditationState(path);
  const observedAt = option('--observed-at');
  const result = applyTransition(state, {
    platformId: requiredOption('--platform'),
    toState: requiredOption('--to'),
    outcome: option('--outcome', 'confirmed'),
    blocker: option('--blocker'),
    reason: option('--reason'),
    note: option('--note'),
    ...(observedAt ? { observedAt } : {}),
    evidence: {
      liveUrl: option('--live-url'),
      httpStatus: integerOption('--http-status'),
      finalStatus: integerOption('--final-status'),
      formDetected: booleanOption('--form-detected'),
      captchaDetected: booleanOption('--captcha-detected'),
      signinRequired: booleanOption('--signin-required'),
      paymentRequired: booleanOption('--payment-required'),
      screenshotPath: option('--screenshot'),
    },
  });
  writeAccreditationState(path, result.state);
  process.stdout.write(`${JSON.stringify(result.platform, null, 2)}\n`);
}

try {
  if (command === 'init') runInit();
  else if (command === 'transition') runTransition();
  else throw new Error(USAGE);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
