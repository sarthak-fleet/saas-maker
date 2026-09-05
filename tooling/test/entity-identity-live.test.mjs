import assert from 'node:assert/strict';
import test from 'node:test';

import { pageTitle, titleVerdict } from '../scripts/entity-identity-live.mjs';

test('a title carrying the canonical name is not drift', () => {
  assert.equal(titleVerdict('CodeVetter — Execution-backed agent verification', 'CodeVetter', []), null);
});

test('a title carrying a retired alias is drift, and names the alias it found', () => {
  const verdict = titleVerdict(
    'Pace — private Mac voice agent that sees your screen',
    'HeyPace',
    ['Pace']
  );
  assert.deepEqual(verdict, { channel: '<title>', value: 'Pace', kind: 'retired-alias' });
});

test('the canonical name is not mistaken for an alias contained inside it', () => {
  // The regression this guards: "Pace" is a substring of "HeyPace". A boundary-less
  // match would score the surface that correctly says HeyPace as publishing the
  // retired name — turning the one compliant surface into a false positive.
  assert.equal(titleVerdict('HeyPace — private Mac voice agent', 'HeyPace', ['Pace']), null);
});

test('canonical name wins even when an alias also appears', () => {
  assert.equal(titleVerdict('HeyPace (formerly Pace)', 'HeyPace', ['Pace']), null);
});

test('a differently-cased canonical name is classified as casing, not as absent', () => {
  assert.deepEqual(titleVerdict('drank · Track Domain Ratings in Your Browser', 'Drank', []), {
    channel: '<title>',
    value: 'drank',
    kind: 'casing',
  });
});

test('a title naming no recorded form of the product reports the whole title', () => {
  assert.deepEqual(titleVerdict('Home', 'CodeVetter', ['Code Vetter']), {
    channel: '<title>',
    value: 'Home',
    kind: 'name-absent',
  });
});

test('a hyphenated slug does not satisfy a spaced canonical name', () => {
  // psi-swarm publishes its repo slug where the product is "PSI Swarm".
  assert.deepEqual(titleVerdict('psi-swarm · distributional Lighthouse tracker', 'PSI Swarm', ['psi-swarm']), {
    channel: '<title>',
    value: 'psi-swarm',
    kind: 'retired-alias',
  });
});

test('an unreachable page is not scored as drift', () => {
  assert.equal(titleVerdict(null, 'CodeVetter', []), null);
});

test('regex metacharacters in a product name do not throw or match loosely', () => {
  assert.equal(titleVerdict('C++ Weekly — the newsletter', 'C++', []), null);
  assert.deepEqual(titleVerdict('CXX Weekly', 'C++', []), {
    channel: '<title>',
    value: 'CXX Weekly',
    kind: 'name-absent',
  });
});

test('pageTitle decodes entities so escaped names still match', () => {
  // Fetched live from significanthobbies.com: &#39; arrives escaped, and a
  // name-match against the raw string would miss any brand with an apostrophe.
  assert.equal(pageTitle('<title>LoopTV — channel-surf YouTube like it&#39;s TV</title>'),
    "LoopTV — channel-surf YouTube like it's TV");
  assert.equal(pageTitle('<title>Sarthak Agrawal — AI Infrastructure &amp; Product</title>'),
    'Sarthak Agrawal — AI Infrastructure & Product');
});

test('pageTitle collapses whitespace and treats an empty title as no data', () => {
  assert.equal(pageTitle('<title>\n  Kith —\n  Private notes\n</title>'), 'Kith — Private notes');
  assert.equal(pageTitle('<title>   </title>'), null);
  assert.equal(pageTitle('<html><body>no title here</body></html>'), null);
});
