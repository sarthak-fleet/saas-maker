import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  apiAiName,
  classifyName,
  canonicalIdentityFor,
  gradeNameAgreement,
  jsonLdName,
  llmsName,
  loadCanonicalIdentities,
  slugify,
} from '../lib/entity-name-agreement.mjs';

const kinetic = { id: 'email-manager', name: 'Kinetic', aliases: ['Email Manager'] };
const psiSwarm = { id: 'psi-swarm', name: 'PSI Swarm', aliases: ['psi-swarm'] };
const hobbies = { id: 'significanthobbies', name: 'Significant Hobbies', aliases: [] };

test('a surface publishing the canonical name on every channel agrees', () => {
  const check = gradeNameAgreement({
    canonical: kinetic,
    observed: { 'llms.txt': 'Kinetic', '/api/ai': 'Kinetic', 'json-ld': 'Kinetic' },
  });
  assert.equal(check.status, 'pass');
  assert.equal(check.data.worst, 'ok');
  assert.equal(check.data.identityConflict, false);
});

test('a retired alias is drift, not agreement', () => {
  // email-manager: the rename to Kinetic shipped; llms.txt and /api/ai still
  // say "Email Manager", which the record keeps only as a retired alias.
  const check = gradeNameAgreement({
    canonical: kinetic,
    observed: {
      'llms.txt': 'Email Manager',
      '/api/ai': 'Email Manager',
      'json-ld': 'Kinetic',
    },
  });
  assert.equal(check.status, 'fail');
  assert.equal(check.data.worst, 'retired-alias');
  assert.equal(check.data.identityConflict, false);
  assert.deepEqual(
    check.data.channels.map((c) => c.class),
    ['retired-alias', 'retired-alias', 'ok']
  );
});

test('a repo slug is a slug leak even when the record lists it as an alias', () => {
  // Recording the slug stops it being unexplained; it does not make it a name
  // the product goes by, so it stays a defect in the surface.
  assert.equal(classifyName('psi-swarm', psiSwarm), 'slug-leak');
  const check = gradeNameAgreement({
    canonical: psiSwarm,
    observed: { 'llms.txt': 'psi-swarm', '/api/ai': 'psi-swarm', 'json-ld': 'psi-swarm' },
  });
  assert.equal(check.status, 'fail');
  assert.equal(check.data.worst, 'slug-leak');
});

test('a name in no record at all is an identity conflict', () => {
  // significanthobbies declares "Live" — a different fleet product, and a name
  // that appears in no record for this id.
  const check = gradeNameAgreement({
    canonical: hobbies,
    observed: {
      'llms.txt': 'Live by Significant Hobbies',
      '/api/ai': 'Live',
      'json-ld': 'Significant Hobbies',
    },
  });
  assert.equal(check.status, 'fail');
  assert.equal(check.data.worst, 'unrecorded');
  assert.equal(check.data.identityConflict, true);
  assert.match(check.detail, /identity conflict/);
});

test('case is classified, never normalized away', () => {
  assert.equal(classifyName('posttrainllm', { name: 'PostTrainLLM', aliases: [] }), 'casing');
  assert.equal(classifyName('DRank', { name: 'Drank', aliases: [] }), 'casing');
  const check = gradeNameAgreement({
    canonical: { id: 'drank', name: 'Drank', aliases: [] },
    observed: { 'llms.txt': 'DRank', '/api/ai': 'DRank', 'json-ld': 'Drank' },
  });
  assert.equal(check.status, 'fail');
  assert.equal(check.data.worst, 'casing');
});

test('the canonical name is not confused with an alias it contains', () => {
  // "Pace" is a substring of "HeyPace"; a loose compare would score the
  // compliant surface as publishing the retired name.
  assert.equal(classifyName('HeyPace', { name: 'HeyPace', aliases: ['Pace'] }), 'ok');
  assert.equal(classifyName('Pace', { name: 'HeyPace', aliases: ['Pace'] }), 'retired-alias');
});

test('an origin with no canonical record is skipped, not failed', () => {
  const check = gradeNameAgreement({ canonical: null, observed: { 'llms.txt': 'Whatever' } });
  assert.equal(check.status, 'skip');
});

test('a surface declaring no name anywhere is skipped — absence is another check', () => {
  const check = gradeNameAgreement({
    canonical: kinetic,
    observed: { 'llms.txt': null, '/api/ai': null, 'json-ld': null },
  });
  assert.equal(check.status, 'skip');
  assert.deepEqual(check.data.channels, []);
});

test('slugify collapses punctuation so a slug leak is recognised', () => {
  assert.equal(slugify('PSI Swarm'), 'psi-swarm');
  assert.equal(slugify('Anime List'), 'anime-list');
});

test('llms.txt name comes from the first markdown heading', () => {
  assert.equal(llmsName('# Kinetic\n\n> Remember the email.\n'), 'Kinetic');
  assert.equal(llmsName('\n\n## Live by Significant Hobbies\ntext'), 'Live by Significant Hobbies');
  assert.equal(llmsName('no heading here'), null);
  assert.equal(llmsName(null), null);
});

test('/api/ai name reads name, or product.name, and never throws on junk', () => {
  assert.equal(apiAiName('{"name":"Kinetic","surfaces":[]}'), 'Kinetic');
  assert.equal(apiAiName('{"product":{"name":"Kinetic"}}'), 'Kinetic');
  assert.equal(apiAiName('<!doctype html>'), null);
  assert.equal(apiAiName(null), null);
});

test('JSON-LD reads the WebSite node, not the author Person node', () => {
  // The regression this guards: the first "name" in the document is usually the
  // Person node crediting the author, which reports false drift everywhere.
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [
      { '@type': 'Person', name: 'Sarthak Agrawal' },
      { '@type': 'WebSite', name: 'Kinetic' },
    ],
  })}</script>`;
  assert.equal(jsonLdName(html), 'Kinetic');
});

test('JSON-LD falls back to Organization only when no WebSite/app node exists', () => {
  const orgOnly = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Organization',
    name: 'SaaS Maker',
  })}</script>`;
  assert.equal(jsonLdName(orgOnly), 'SaaS Maker');
  assert.equal(jsonLdName('<html><body>no markup</body></html>'), null);
});

test('a decided-but-unapplied rename governs, and retires the old name to an alias', () => {
  const dir = mkdtempSync(join(tmpdir(), 'entity-identity-'));
  const catalogPath = join(dir, 'projects.json');
  const decisionsPath = join(dir, 'canonical.json');
  writeFileSync(
    catalogPath,
    JSON.stringify({
      geoIdentities: [
        { id: 'email-manager', name: 'Email Manager', origin: 'https://mail.example.com' },
      ],
    })
  );
  writeFileSync(
    decisionsPath,
    JSON.stringify({
      decisions: [
        {
          id: 'email-manager',
          name: 'Kinetic',
          retireNameToAlias: true,
          canonicalUrl: 'https://mail.example.com',
        },
      ],
    })
  );

  const identities = loadCanonicalIdentities({ catalogPath, decisionsPath });
  const identity = identities.get('email-manager');
  assert.equal(identity.name, 'Kinetic');
  assert.deepEqual(identity.aliases, ['Email Manager']);
  assert.equal(classifyName('Email Manager', identity), 'retired-alias');

  // A URL target with no registry id still resolves by host.
  assert.equal(
    canonicalIdentityFor(identities, { origin: 'https://mail.example.com' })?.name,
    'Kinetic'
  );
  assert.equal(canonicalIdentityFor(identities, { origin: 'https://unknown.example' }), null);
});
