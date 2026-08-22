import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildCatalog,
  diagnoseCatalog,
} from '../lib/capability-catalog.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('standalone capability catalog has valid roots and execution profiles', () => {
  const catalog = buildCatalog(repositoryRoot);
  const diagnosis = diagnoseCatalog(catalog);

  assert.equal(diagnosis.healthy, true, JSON.stringify(diagnosis.issues, null, 2));
  assert.deepEqual(
    catalog.roots.map((root) => root.path),
    ['skills', 'scripts', 'templates', 'docs'],
  );
  assert.equal(catalog.generatedFrom, 'sass-maker/workflows-and-skills');

  const skills = catalog.items.filter((item) => item.type === 'skill');
  assert.equal(skills.length, 47);
  assert.equal(skills.every((skill) => skill.executionProfile), true);
  assert.equal(skills.every((skill) => skill.path.startsWith('skills/')), true);

  assert.deepEqual(
    catalog.items
      .filter((item) => item.type === 'script')
      .map((item) => item.path),
    [
      'scripts/agent-stack.sh',
      'scripts/apply-clarity-id.sh',
      'scripts/audit.mjs',
      'scripts/check-github-actions-policy.mjs',
      'scripts/fleet-capabilities.mjs',
      'scripts/git-health.sh',
      'scripts/github-priority-queue.mjs',
      'scripts/link-project-agent-assets.sh',
      'scripts/unlink-project-agent-assets.sh',
      'scripts/validate-tooling.mjs',
      'scripts/verify-local.mjs',
    ],
  );
  assert.equal(
    catalog.items.some((item) => item.path === 'scripts/ai-visibility-canary.mjs'),
    false,
  );
  assert.equal(
    catalog.items.some((item) => item.path === 'scripts/founder-control.mjs'),
    false,
  );
});
