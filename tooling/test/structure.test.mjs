import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflows = resolve(root, '..', '.github', 'workflows');
const preserved = join(root, 'preserved', 'legacy-fleet-tooling');
const activeScripts = new Set([
  'agent-stack.sh',
  'ahrefs-site-audit-health.mjs',
  'ai-client-audit.mjs',
  'apply-clarity-id.sh',
  'audit.mjs',
  'campaign-manifest.mjs',
  'check-github-actions-policy.mjs',
  'clarity-audit.mjs',
  'credential-guard.mjs',
  'deploy-health.sh',
  'design-workflow.mjs',
  'devin-autonomous-run.sh',
  'entity-identity-apply.mjs',
  'entity-identity-diff.mjs',
  'entity-identity-live.mjs',
  'fleet-capabilities.mjs',
  'fleet-deploy-guard.sh',
  'fleet-health.sh',
  'fleet-init.sh',
  'footer-source-audit.mjs',
  'geo-observatory-record.mjs',
  'git-health.sh',
  'github-priority-queue.mjs',
  'install-priority-queue-schedule.mjs',
  'install-skill-run-hook.mjs',
  'link-graph-audit.mjs',
  'link-project-agent-assets.sh',
  'psi-portfolio-delta.mjs',
  'psi-swarm-fleet.mjs',
  'reporting-loop-preflight.mjs',
  'unlink-project-agent-assets.sh',
  'validate-tooling.mjs',
  'verify-local.mjs',
]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('active workflows do not target the retired monorepo layout', () => {
  for (const name of readdirSync(workflows)) {
    const source = readFileSync(join(workflows, name), 'utf8');
    assert.doesNotMatch(
      source,
      /foundry\/(?:apps|helpers|marketing|ops|packages)\//u,
      name,
    );
  }
});

test('active tooling has an explicit entrypoint boundary and no retired paths', () => {
  assert.deepEqual(
    new Set(
      readdirSync(join(root, 'scripts'), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    ),
    activeScripts,
  );

  for (const directory of ['scripts', 'skills', 'lib']) {
    for (const path of files(join(root, directory))) {
      if (!/\.(?:d\.ts|js|json|md|mjs|sh|ts|tsx)$/u.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      assert.doesNotMatch(
        source,
        /foundry\/(?:apps|helpers|marketing|ops|packages)\//u,
        path,
      );
    }
  }
});

test('retired product and Console entrypoints remain preserved but inactive', () => {
  for (const path of [
    'scripts/ai-visibility-canary.mjs',
    'scripts/run-performance-portfolio.mjs',
    'scripts/search-console-collect.mjs',
    'scripts/agent-bin/ops-console',
    'scripts/agent-bin/ops-console-server.mjs',
    'lib/founder-control/service.mjs',
    'workflows/mobile-cockpit-ci.yml',
    'workflows/reel-pipeline-ci.yml',
  ]) {
    assert.equal(existsSync(join(preserved, path)), true, path);
  }

  const agentStack = readFileSync(join(root, 'scripts', 'agent-stack.sh'), 'utf8');
  assert.doesNotMatch(agentStack, /ops-console/u);
});
