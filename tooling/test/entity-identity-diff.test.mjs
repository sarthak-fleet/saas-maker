import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeContradictions,
  mentionsTerm,
  readStandard,
} from '../scripts/entity-identity-diff.mjs';

// ------------------------------------------------------------- term matching

test('a term is found on non-alphanumeric boundaries', () => {
  assert.equal(mentionsTerm('The shared Hub and backend', 'hub'), true);
  assert.equal(mentionsTerm('Execution-backed verification for changes', 'verification'), true);
});

test('a term inside a longer word is not a match', () => {
  // The regression this guards: "hub" is a substring of "GitHub", so a
  // boundary-less match would score every description that links to GitHub as
  // declaring the Significant Hobbies hub.
  assert.equal(mentionsTerm('Published on GitHub', 'hub'), false);
  assert.equal(mentionsTerm('a pathological example', 'path'), false);
});

test('a hyphen separates terms, so a compound contains its parts', () => {
  assert.equal(mentionsTerm('verification for coding-agent changes', 'agent'), true);
  assert.equal(mentionsTerm('Mac-local specialist-model factory', 'factory'), true);
});

test('a regular plural matches its singular anchor', () => {
  assert.equal(mentionsTerm('documented early-breakthrough paths', 'path'), true);
  assert.equal(mentionsTerm('for Fleet products', 'product'), true);
  assert.equal(mentionsTerm('linked to the original episodes', 'episode'), true);
});

test('a multi-word term tolerates any run of whitespace', () => {
  assert.equal(mentionsTerm('one privacy-aware control plane.', 'control plane'), true);
  assert.equal(mentionsTerm('one privacy-aware control\n  plane.', 'control plane'), true);
});

test('matching is case-insensitive in both directions', () => {
  assert.equal(mentionsTerm('The shared HUB', 'Hub'), true);
  assert.equal(mentionsTerm('a Podcast index', 'podcast'), true);
});

// ------------------------------------------------------- the non-contradiction bar

const HOBBIES_CLAIM = {
  anchors: ['hub', 'control plane'],
  mentions: ['Live', 'Journal', 'Calorie', 'Setline', 'Kith', 'Anchor'],
};

test('differing wording around the same claim is not a contradiction', () => {
  // The whole point of the standard: these two describe one product for two
  // audiences. Under `identical` both would be findings; under this bar neither is.
  assert.deepEqual(
    describeContradictions({
      description:
        'Execution-backed verification for coding-agent changes, with reproducible checks.',
      claim: { anchors: ['verification'] },
    }),
    []
  );
  assert.deepEqual(
    describeContradictions({
      description: 'Execution-backed verification for AI-written software changes.',
      claim: { anchors: ['verification'] },
    }),
    []
  );
});

test('a description carrying none of the category anchors is category drift', () => {
  assert.deepEqual(
    describeContradictions({
      description: 'Source-backed index of public statements by notable people',
      claim: { anchors: ['podcast', 'episode'] },
    }),
    [{ kind: 'category-drift', detail: 'podcast | episode' }]
  );
});

test('any single anchor is enough — anchors are alternatives, not a checklist', () => {
  assert.deepEqual(
    describeContradictions({
      description: 'Attributable podcast claims with verbatim transcript evidence.',
      claim: { anchors: ['podcast', 'episode'] },
    }),
    []
  );
});

test('a retired name published in a description is the most severe finding', () => {
  assert.deepEqual(
    describeContradictions({
      description: 'Email Manager remembers the email, not the exact words.',
      claim: { anchors: ['email'] },
      retiredNames: ['Email Manager'],
    }),
    [{ kind: 'retired-name', detail: 'Email Manager' }]
  );
});

test('naming a different registered product is a foreign-entity finding', () => {
  assert.deepEqual(
    describeContradictions({
      description: 'A companion index for High Signal Podcasts.',
      claim: { anchors: ['index'] },
      foreignNames: ['High Signal Podcasts'],
    }),
    [{ kind: 'foreign-entity', detail: 'High Signal Podcasts' }]
  );
});

test('a hub may name the products it hosts when they are allowlisted', () => {
  // Significant Hobbies' real description names six sibling products. Without
  // the allowlist the check fires six times on copy that is correct.
  assert.deepEqual(
    describeContradictions({
      description:
        'The shared Hub for Live, Journal, Calorie, Setline, Kith, and Anchor, backed by one privacy-aware control plane.',
      claim: HOBBIES_CLAIM,
      foreignNames: ['Live', 'Journal', 'Calorie', 'Setline', 'Kith', 'Anchor'],
    }),
    []
  );
});

test('the same hub description drifts when the surface describes a different kind of thing', () => {
  assert.deepEqual(
    describeContradictions({
      description:
        'Life planner for private daily rituals and public living — hobbies, bucket lists, and side quests over time.',
      claim: HOBBIES_CLAIM,
    }),
    [{ kind: 'category-drift', detail: 'hub | control plane' }]
  );
});

test('an absent description is a gap, not a contradiction', () => {
  assert.deepEqual(describeContradictions({ description: null, claim: HOBBIES_CLAIM }), []);
  assert.deepEqual(describeContradictions({ description: '   ', claim: HOBBIES_CLAIM }), []);
});

test('a surface with no configured anchors is never charged with drift', () => {
  assert.deepEqual(describeContradictions({ description: 'Anything at all.', claim: {} }), []);
  assert.deepEqual(describeContradictions({ description: 'Anything at all.' }), []);
});

// --------------------------------------------------------------- the flag

test('the default standard is non-contradiction', () => {
  assert.equal(readStandard([]), 'non-contradiction');
  assert.equal(readStandard(['--markdown', 'codevetter']), 'non-contradiction');
});

test('strict equality remains reachable', () => {
  assert.equal(readStandard(['--standard=identical']), 'identical');
});

test('an unknown standard fails loudly rather than falling back', () => {
  assert.throws(() => readStandard(['--standard=whatever']), /--standard must be one of/u);
});
