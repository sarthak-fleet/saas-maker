import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AI_CHAT_FOOTER_TAG, normalizeProviderIds } from '../dist/browser/element.mjs';
import { AIChatFooter, DEFAULT_PROVIDERS, getProviderUrl } from '../dist/index.mjs';

test('DEFAULT_PROVIDERS lists all five providers in order', () => {
  assert.deepEqual(DEFAULT_PROVIDERS, ['claude', 'chatgpt', 'gemini', 'perplexity', 'grok']);
});

for (const provider of DEFAULT_PROVIDERS) {
  test(`${provider} URL uses HTTPS and embeds the prompt`, () => {
    const url = getProviderUrl(provider, 'What does Acme do?');
    assert.ok(url.startsWith('https://'), 'URL must use HTTPS');
    assert.ok(
      url.includes(encodeURIComponent('What does Acme do?')),
      'URL must contain the encoded prompt'
    );
  });
}

test('claude URL points to claude.ai', () => {
  const url = getProviderUrl('claude', 'hello');
  assert.ok(url.startsWith('https://claude.ai/new'));
});

test('chatgpt URL points to chatgpt.com', () => {
  const url = getProviderUrl('chatgpt', 'hello');
  assert.ok(url.startsWith('https://chatgpt.com/'));
});

test('gemini URL points to gemini.google.com', () => {
  const url = getProviderUrl('gemini', 'hello');
  assert.ok(url.startsWith('https://gemini.google.com/app'));
  assert.ok(url.includes('is_sa_p='), 'URL must pass prompt via is_sa_p');
});

test('perplexity URL points to perplexity.ai', () => {
  const url = getProviderUrl('perplexity', 'hello');
  assert.ok(url.startsWith('https://www.perplexity.ai/'));
});

test('grok URL points to grok.com', () => {
  const url = getProviderUrl('grok', 'hello');
  assert.ok(url.startsWith('https://grok.com/'));
});

test('special characters are URL-encoded', () => {
  const prompt = 'hello & goodbye = 100%';
  const url = new URL(getProviderUrl('claude', prompt));
  assert.equal(url.searchParams.get('q'), prompt);
});

test('browser entrypoint is safe to import without a DOM', () => {
  assert.equal(AI_CHAT_FOOTER_TAG, 'ai-chat-footer');
});

test('browser entrypoint filters and de-duplicates provider attributes', () => {
  assert.deepEqual(normalizeProviderIds('chatgpt,claude,chatgpt,invalid'), ['chatgpt', 'claude']);
});

test('React footer uses compact icon-only actions with accessible provider names', () => {
  const markup = renderToStaticMarkup(
    createElement(AIChatFooter, {
      companyName: 'Acme',
      companyUrl: 'https://example.com',
    })
  );

  for (const name of ['Claude', 'ChatGPT', 'Gemini', 'Perplexity', 'Grok']) {
    assert.match(markup, new RegExp(`title="${name}"`));
    assert.match(markup, new RegExp(`aria-label="Ask ${name} about Acme`));
    assert.doesNotMatch(markup, new RegExp(`>${name}<`));
  }
  for (const provider of DEFAULT_PROVIDERS) {
    assert.match(markup, new RegExp(`data-ai-provider="${provider}"`));
  }
  assert.equal((markup.match(/class="ai-chat-footer__icon"/g) ?? []).length, 5);
  assert.match(markup, /ai-chat-footer__signal/);
});

test('React footer embeds publisher-supplied provider artwork', () => {
  const markup = renderToStaticMarkup(
    createElement(AIChatFooter, {
      companyName: 'Acme',
      companyUrl: 'https://example.com',
    })
  );

  assert.equal((markup.match(/<img class="ai-chat-footer__icon"/g) ?? []).length, 5);
  assert.ok(
    (markup.match(/src="data:image\/jpeg;base64,/g) ?? []).length >= 5,
    'each provider must render its bundled source artwork'
  );
  assert.doesNotMatch(markup, /ChatGPT icon|Claude icon|provider brand geometry/);
});

test('browser entrypoint bundles all five provider artwork files', async () => {
  const bundle = await readFile(new URL('../dist/browser/element.mjs', import.meta.url), 'utf8');

  assert.equal((bundle.match(/data:image\/jpeg;base64,/g) ?? []).length, 5);
  assert.match(bundle, /createProviderLogo/);
  assert.doesNotMatch(bundle, /createProviderIcon/);
});

for (const provider of DEFAULT_PROVIDERS) {
  test(`${provider} source artwork is a retained JPEG asset`, async () => {
    const artwork = await readFile(
      new URL(`../src/assets/provider-logos/${provider}.jpg`, import.meta.url)
    );
    assert.deepEqual([...artwork.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(artwork.byteLength > 3000);
  });
}
