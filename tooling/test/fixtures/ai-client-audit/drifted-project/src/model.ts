import { generateText } from 'ai';

export const answer = (prompt: string) => generateText({ model: 'gpt-4o-mini', prompt });
