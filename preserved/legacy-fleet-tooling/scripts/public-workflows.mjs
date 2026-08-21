#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const moduleRoot = path.join(root, 'foundry/ops/workflows');
const auditScript = path.join(moduleRoot, 'scripts/audit.mjs');
const command = process.argv[2] ?? 'validate';
const rest = process.argv.slice(3);

const args = command === 'validate'
  ? [auditScript, '--validate-only']
  : command === 'availability'
    ? [auditScript, '--mode', 'availability', '--runs', '1', ...rest]
    : command === 'performance'
      ? [auditScript, '--mode', 'performance', ...rest]
      : null;

if (!args) {
  console.error('Usage: public-workflows.mjs <validate|availability|performance> [--runs 1|3|5]');
  process.exit(2);
}

const result = spawnSync(process.execPath, args, {
  cwd: moduleRoot,
  stdio: 'inherit',
});
if (result.error) {
  console.error(`Public workflow module is unavailable: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
