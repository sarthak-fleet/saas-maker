import assert from 'node:assert/strict';

describe('intelligence boundary', () => {
  it('classifies a provider request as a model call', () => {
    assert.equal(classifyRequest('https://api.openai.com/v1/chat/completions'), 'model');
    assert.equal(classifyRequest('https://api.anthropic.com/v1/messages'), 'model');
  });
});
