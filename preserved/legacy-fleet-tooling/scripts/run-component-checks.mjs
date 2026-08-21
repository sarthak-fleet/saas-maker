#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const checks = [
  ['ai-visibility', 'foundry/helpers/ai-visibility', 'pnpm', ['check']],
  ['fleet-console', 'foundry/apps/dashboard/fleet-console', 'npm', ['run', 'build']],
];

for (const [id, relativeRoot, command, args] of checks) {
  console.log(`\n== ${id}: ${command} ${args.join(' ')} ==`);
  const result = spawnSync(command, args, {
    cwd: path.join(root, relativeRoot),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
