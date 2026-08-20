import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeProjects, PortfolioProjectStrip, withReferralSource } from '../dist/index.mjs';

test('normalizes valid projects and removes duplicate ids', () => {
  assert.deepEqual(
    normalizeProjects([
      { id: 'one', name: 'One', url: 'https://one.example' },
      { id: 'one', name: 'Duplicate', url: 'https://duplicate.example' },
      { id: 'bad', name: 'Bad', url: 'javascript:alert(1)' },
    ]),
    [{ id: 'one', name: 'One', url: 'https://one.example' }]
  );
});

test('rejects non-arrays', () => assert.deepEqual(normalizeProjects(null), []));

test('keeps short project lists static and excludes the current project', () => {
  const markup = renderToStaticMarkup(
    createElement(PortfolioProjectStrip, {
      catalogUrl: '',
      currentProjectId: 'current',
      projects: [
        { id: 'current', name: 'Current', url: 'https://current.example' },
        { id: 'one', name: 'One', url: 'https://one.example', description: 'First project' },
        { id: 'two', name: 'Two', url: 'https://two.example' },
      ],
    })
  );

  assert.doesNotMatch(markup, />Current</);
  assert.match(markup, /data-loop="false"/);
  assert.doesNotMatch(markup, />Pause</);
  assert.doesNotMatch(markup, />More from Sarthak</);
  assert.match(markup, /href="https:\/\/one\.example\/\?ref=current"/);
  assert.match(markup, /aria-label="One \(opens in a new tab\)"/);
  assert.match(markup, /aria-describedby=/);
  assert.match(markup, /role="tooltip" hidden=""/);
  assert.equal((markup.match(/portfolio-project-strip__dot/g) ?? []).length, 1);
});

test('duplicates long lists accessibly without visible metadata controls', () => {
  const markup = renderToStaticMarkup(
    createElement(PortfolioProjectStrip, {
      catalogUrl: '',
      projects: [
        { id: 'one', name: 'One', url: 'https://one.example' },
        { id: 'two', name: 'Two', url: 'https://two.example' },
        { id: 'three', name: 'Three', url: 'https://three.example' },
      ],
    })
  );

  assert.match(markup, /data-loop="true"/);
  assert.doesNotMatch(markup, /aria-pressed/);
  assert.doesNotMatch(markup, /portfolio-project-strip__meta/);
  assert.equal(
    (markup.match(/portfolio-project-strip__duplicate" aria-hidden="true"/g) ?? []).length,
    3
  );
});

test('adds referral source without mutating canonical destination state', () => {
  const canonical = 'https://one.example/path?campaign=launch#details';
  assert.equal(
    withReferralSource(canonical, 'codevetter'),
    'https://one.example/path?campaign=launch&ref=codevetter#details'
  );
  assert.equal(canonical, 'https://one.example/path?campaign=launch#details');
  assert.equal(withReferralSource(canonical), canonical);
  assert.equal(withReferralSource('not a url', 'codevetter'), 'not a url');
});
