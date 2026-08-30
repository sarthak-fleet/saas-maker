const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export async function reason(prompt: string, options: { baseUrl?: string; apiKey: string }) {
  const baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });
  return response.json();
}
