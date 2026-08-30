export async function moderateText(apiKey: string, body: string) {
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input: body }),
  });
  if (!response.ok) throw new Error(`moderation_http_${response.status}`);
  return response.json();
}
