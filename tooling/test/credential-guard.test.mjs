import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanFleetCredentials } from '../scripts/credential-guard.mjs';

test('reports credential categories and paths without returning matched values', () => {
  const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
  const leakedValue = 'sk-live-K6Pz8nUa7vQ2rXm9Jc4tBw5yHd3fLs1e';
  try {
    const repo = join(root, 'app');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, '.claude/settings.local.json'), '{}\n');
    writeFileSync(join(repo, 'src/config.ts'), `const key = "${leakedValue}";\n`);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', '.claude/settings.local.json', 'src/config.ts'], { cwd: repo });

    const report = scanFleetCredentials({ fleetRoot: root });
    assert.equal(report.repoCount, 1);
    assert.equal(report.summary.current, 2);
    assert.deepEqual(
      report.findings.map(({ path, category }) => ({ path, category })),
      [
        { path: '.claude/settings.local.json', category: 'tracked-machine-local-agent-settings' },
        { path: 'src/config.ts', category: 'provider-token' },
      ],
    );
    assert.doesNotMatch(JSON.stringify(report), new RegExp(leakedValue));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports project-key tokens without returning the matched value', () => {
  const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
  const leakedValue = `pk_${'A1b2C3d4'.repeat(4)}`;
  try {
    const repo = join(root, 'app');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'foundry.json'), `{"projectKey":"${leakedValue}"}\n`);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', 'foundry.json'], { cwd: repo });

    const report = scanFleetCredentials({ fleetRoot: root });
    assert.equal(report.summary.current, 1);
    assert.equal(report.findings[0].category, 'provider-token');
    assert.equal(report.findings[0].path, 'foundry.json');
    assert.doesNotMatch(JSON.stringify(report), new RegExp(leakedValue));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores explicit placeholders but catches high-entropy credential assignments', () => {
  const root = mkdtempSync(join(tmpdir(), 'credential-guard-'));
  try {
    const repo = join(root, 'app');
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, '.env.example'),
      'API_KEY=your-api-key\nLOCAL_API_KEY="$(cat ~/.config/app/key)"\nCLOUDFLARE_API_KEY=K6Pz8nUa7vQ2rXm9Jc4tBw5yHd3fLs1e\n',
    );
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', '.env.example'], { cwd: repo });
    const report = scanFleetCredentials({ fleetRoot: root });
    assert.equal(report.summary.current, 1);
    assert.equal(report.findings[0].category, 'high-entropy-credential-assignment');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
