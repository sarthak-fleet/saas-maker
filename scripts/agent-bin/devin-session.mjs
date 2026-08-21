#!/usr/bin/env node

const BASE_URL = "https://api.devin.ai/v3";
const [command = "status", ...args] = process.argv.slice(2);

function needs() {
  console.log("Required for Devin API integration:");
  console.log("  DEVIN_API_KEY     least-privilege service-user token (cog_ prefix)");
  console.log("  DEVIN_ORG_ID      Devin organization ID");
  console.log("  DEVIN_ALLOW_SPEND set to yes only for an explicitly approved session");
}

function credentials() {
  const apiKey = process.env.DEVIN_API_KEY;
  const orgId = process.env.DEVIN_ORG_ID;
  if (!apiKey || !orgId) {
    needs();
    process.exit(2);
  }
  return { apiKey, orgId };
}

async function api(path, init = {}) {
  const { apiKey } = credentials();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.detail || body?.message || `Devin API returned ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function status() {
  if (!process.env.DEVIN_API_KEY || !process.env.DEVIN_ORG_ID) {
    console.log("adapter: installed");
    console.log("credentials: missing");
    return;
  }
  const body = await api("/self");
  console.log("adapter: installed");
  console.log("credentials: authenticated");
  console.log(`principal: ${body.service_user_name || body.user_name || "available"}`);
}

async function createSession(values) {
  if (process.env.DEVIN_ALLOW_SPEND !== "yes") {
    throw new Error("Refusing paid Devin work without DEVIN_ALLOW_SPEND=yes for this command.");
  }
  const { orgId } = credentials();
  const titleIndex = values.indexOf("--title");
  const title = titleIndex >= 0 ? values[titleIndex + 1] : undefined;
  const promptParts = titleIndex >= 0 ? values.filter((_, index) => index !== titleIndex && index !== titleIndex + 1) : values;
  const prompt = promptParts.join(" ").trim();
  if (!prompt) throw new Error("usage: devin-session create [--title <title>] <prompt>");

  const body = await api(`/organizations/${encodeURIComponent(orgId)}/sessions`, {
    method: "POST",
    body: JSON.stringify({ prompt, ...(title ? { title } : {}), tags: ["fleet-ops"] })
  });
  console.log(`session: ${body.session_id || "created"}`);
  if (body.url) console.log(`url: ${body.url}`);
  if (body.status) console.log(`status: ${body.status}`);
}

try {
  if (command === "needs") needs();
  else if (command === "status") await status();
  else if (command === "create") await createSession(args);
  else {
    console.error("usage: devin-session <needs|status|create>");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
