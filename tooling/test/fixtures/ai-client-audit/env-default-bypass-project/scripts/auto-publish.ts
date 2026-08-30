/**
 * Environment:
 *   AI_BASE_URL   default https://api.deepseek.com/v1
 */
const AI_BASE_URL = process.env['AI_BASE_URL'] ?? 'https://api.deepseek.com/v1';
const AI_API_KEY = process.env['AI_API_KEY'] ?? '';

export async function judge(body: string) {
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AI_API_KEY}` },
    body,
  });
  return response.json();
}
