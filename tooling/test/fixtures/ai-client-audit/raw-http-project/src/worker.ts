export async function ask(env: { AI_GATEWAY_TOKEN: string }, prompt: string) {
  const response = await fetch('https://ai-gateway.sassmaker.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  });
  return response.json();
}
