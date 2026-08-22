const DEFAULT_PROBE_CONCURRENCY = 4;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000];

export function configuredProbeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PROBE_CONCURRENCY;
  return Math.min(parsed, 16);
}

function isTransientProbeFailure(response) {
  return response.status === 0 || response.status === 429 || response.status >= 500;
}

export function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function retryDelayMs(response, fallbackDelayMs, maxDelayMs = 10_000) {
  const retryAfterMs = parseRetryAfterMs(response.retryAfter);
  return Math.min(maxDelayMs, Math.max(fallbackDelayMs, retryAfterMs));
}

export async function withTransientRetries(
  run,
  {
    delaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  } = {},
) {
  let response = await run();
  for (const fallbackDelayMs of delaysMs) {
    if (!isTransientProbeFailure(response)) break;
    await sleep(retryDelayMs(response, fallbackDelayMs));
    response = await run();
  }
  return response;
}
