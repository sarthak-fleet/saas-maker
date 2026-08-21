import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUTH_MODELS,
  buildManifest,
  parsePolicyExclusions,
} from './build-audit-manifest.mjs';

const projects = [
  {
    id: 'fleet-workspace',
    family: 'fleet-workspace',
    authModel: 'public-personalized',
    tier: 'active',
    repo: 'fleet-ops',
    domains: ['sassmaker.com'],
    status: 'live',
    notes: '',
  },
  {
    id: 'pace',
    family: 'pace',
    authModel: 'public-persistent',
    tier: 'focus',
    repo: 'pace',
    domains: ['heypace.app'],
    status: 'live',
    notes: '',
  },
  {
    id: 'protein-index',
    authModel: 'public-persistent',
    tier: 'parked',
    repo: 'protein-index',
    domains: ['protein.example'],
    status: 'live',
    notes: 'Retired; explicit reactivation is required.',
  },
  {
    id: 'truehire',
    authModel: 'public-persistent',
    tier: 'out-of-fleet',
    repo: 'truehire',
    domains: ['truehire.example'],
    status: 'live',
    notes: '',
  },
  {
    id: 'local-only',
    authModel: 'required-user',
    tier: 'active',
    repo: 'local-only',
    domains: [],
    status: 'undeployed',
    notes: '',
  },
];

test('parses the root Out Of Fleet policy section', () => {
  const policy = `# Rules

## Out Of Fleet

- \`truehire\`
- \`open-historia\`

## Another Section
`;
  assert.deepEqual(parsePolicyExclusions(policy), ['truehire', 'open-historia']);
});

test('builds the default live public manifest', () => {
  const manifest = buildManifest({
    projects,
    policyExclusions: ['truehire'],
  });

  assert.deepEqual(
    manifest.products.map((project) => project.id),
    ['fleet-workspace', 'pace'],
  );
  assert.equal(manifest.products[0].maxSurfaces, 6);
  assert.equal(manifest.products[0].authModel, 'public-personalized');
  assert.ok(
    manifest.excluded.find((project) => project.id === 'protein-index').reasons
      .includes('retired or reactivation-only'),
  );
});

test('rejects a missing or unknown auth model for an eligible product', () => {
  assert.throws(
    () =>
      buildManifest({
        projects: [{ ...projects[1], authModel: undefined }],
      }),
    /must declare a valid authModel/,
  );
  assert.throws(
    () =>
      buildManifest({
        projects: [{ ...projects[1], authModel: 'optional' }],
      }),
    /must declare a valid authModel/,
  );
});

test('the Fleet registry classifies every project and preserves key boundaries', () => {
  const registry = JSON.parse(
    readFileSync(
      new URL('../../../config/projects.json', import.meta.url),
      'utf8',
    ),
  );
  const byId = new Map(
    registry.projects.map((project) => [project.id, project.authModel]),
  );

  assert.ok(
    registry.projects.every((project) => AUTH_MODELS.has(project.authModel)),
  );
  assert.equal(byId.get('email-manager'), 'required-user');
  assert.equal(byId.get('free-ai'), 'required-service');
  assert.equal(byId.get('app-health'), 'required-service');
  assert.equal(byId.get('knowledge-base'), 'required-service');
  assert.equal(byId.get('starboard'), 'public-personalized');
  assert.equal(byId.get('reader'), 'public-persistent');
});

test('honors explicit Fleet Workspace exclusion and only filters', () => {
  const manifest = buildManifest({
    projects,
    policyExclusions: ['truehire'],
    excludeIds: ['fleet-workspace'],
    onlyIds: ['fleet-workspace', 'pace'],
  });

  assert.deepEqual(
    manifest.products.map((project) => project.id),
    ['pace'],
  );
  assert.ok(
    manifest.excluded.find((project) => project.id === 'fleet-workspace').reasons
      .includes('explicit exclusion'),
  );
});
