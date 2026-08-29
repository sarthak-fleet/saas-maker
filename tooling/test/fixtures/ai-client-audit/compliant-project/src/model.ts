import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

export const gateway = createOpenAICompatible({
  name: 'fleet-gateway',
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.sassmaker.com/v1',
});

export const answer = (prompt: string) =>
  generateText({ model: gateway('gpt-4o-mini'), prompt });
