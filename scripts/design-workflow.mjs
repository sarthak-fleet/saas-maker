#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DesignWorkflowError,
  validateDesignReview,
  validateDesignWorkflowPolicy,
  validateInstalledImpeccable,
} from '../lib/design-workflow.mjs';

const fleetRoot = path.resolve(import.meta.dirname, '../../..');
const policyPath = path.join(fleetRoot, 'foundry/ops/config/design-workflow.json');
const templatePath = path.join(fleetRoot, 'foundry/ops/templates/design-review.json');
const command = process.argv[2] ?? 'self-check';
const args = parseArgs(process.argv.slice(3));

try {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  validateDesignWorkflowPolicy(policy);

  if (command === 'create') {
    const projectRoot = resolveProject(args.project);
    const mode = args.mode;
    const register = args.register;
    const target = args.target;
    if (!['preserve', 'overhaul'].includes(mode)) throw new Error('--mode must be preserve or overhaul');
    if (!['brand', 'product'].includes(register)) throw new Error('--register must be brand or product');
    if (!target) throw new Error('--target is required');

    const destination = path.join(projectRoot, '.fleet/design-review.json');
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(templatePath, destination, {
      force: args.force === true,
      errorOnExist: args.force !== true,
    });
    const receipt = JSON.parse(await readFile(destination, 'utf8'));
    receipt.project = path.basename(projectRoot);
    receipt.target = target;
    receipt.mode = mode;
    receipt.register = register;
    receipt.direction.approval = mode === 'preserve' ? 'not-required' : 'pending';
    if (mode === 'overhaul') {
      receipt.direction.selected = '';
      receipt.direction.before = '';
    }
    await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`);
    output({ ok: true, receipt: path.relative(projectRoot, destination), mode, register }, args.json);
  } else if (command === 'check') {
    const projectRoot = resolveProject(args.project);
    const receiptPath = path.resolve(projectRoot, args.receipt ?? '.fleet/design-review.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    output(validateDesignReview(receipt, policy, { projectRoot }), args.json);
  } else if (command === 'self-check') {
    const skillFile = args['skill-file']
      ? path.resolve(args['skill-file'])
      : path.join(fleetRoot, '.agents/skills/impeccable/SKILL.md');
    const version = validateInstalledImpeccable(policy, skillFile);
    output({
      ok: true,
      policy: path.relative(fleetRoot, policyPath),
      impeccablePackageVersion: policy.impeccablePackageVersion,
      impeccableVersion: version.installed,
      detectorPosture: policy.qualityGate.detectorPosture,
      minimumCritiqueScore: policy.qualityGate.minimumCritiqueScore,
      minimumAuditScore: policy.qualityGate.minimumAuditScore,
    }, args.json);
  } else {
    throw new Error('usage: design-workflow.mjs <create|check|self-check> [options]');
  }
} catch (error) {
  if (args.json) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      findings: error instanceof DesignWorkflowError ? error.errors : [],
    }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}

function resolveProject(value) {
  return path.resolve(value ?? process.cwd());
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    if (['json', 'force'].includes(key)) {
      parsed[key] = true;
    } else {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function output(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (value.receipt) {
    console.log(`Created ${value.receipt} (${value.mode}, ${value.register})`);
  } else if (value.target) {
    console.log(`Design review passed: ${value.project} / ${value.target}`);
  } else {
    console.log(`Design workflow ready (Impeccable ${value.impeccableVersion})`);
  }
}
