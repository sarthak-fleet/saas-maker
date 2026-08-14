import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeProjects, PortfolioProjectStrip } from '../dist/index.mjs';

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
        { id: 'one', name: 'One', url: 'https://one.example' },
        { id: 'two', name: 'Two', url: 'https://two.example' },
      ],
    })
  );

  assert.doesNotMatch(markup, />Current</);
  assert.match(markup, /data-loop="false"/);
  assert.doesNotMatch(markup, />Pause</);
  assert.equal((markup.match(/portfolio-project-strip__dot/g) ?? []).length, 1);
});

test('duplicates long lists accessibly and renders an explicit motion control', () => {
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
  assert.match(markup, /aria-pressed="false"/);
  assert.equal(
    (markup.match(/class="portfolio-project-strip__item" aria-hidden="true"/g) ?? []).length,
    3
  );
});
