import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

export const provider = createOpenAICompatible({
  name: 'project-model',
  baseURL: process.env.AI_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  apiKey: process.env.AI_API_KEY ?? 'local-no-key',
});

export const answer = (prompt: string) =>
  generateText({ model: provider('local-model'), prompt });
