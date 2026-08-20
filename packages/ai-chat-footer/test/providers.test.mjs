import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PROVIDERS, getProviderUrl } from '../dist/index.mjs';

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
