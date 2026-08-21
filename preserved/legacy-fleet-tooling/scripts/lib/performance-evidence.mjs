const PERCENTILES = [50, 75, 95, 99];
const MAX_LEGACY_SAMPLE_COUNT = 10_000;

function finiteNonNegative(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function boundedString(value, field, maximum = 160) {
  const hasControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || hasControlCharacter) {
    throw new Error(`${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function safeLabel(value, field) {
  const label = boundedString(value, field);
  if (label.includes("?") || /^(?:https?|file):/i.test(label)) {
    throw new Error(`${field} must not contain a URL or query string`);
  }
  return label;
}

function timestamp(value, field) {
  const candidate = boundedString(value, field, 64);
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(candidate).toISOString();
}

function eventProperties(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("legacy event must be an object");
  const properties = event.properties ?? event;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("legacy event properties must be an object");
  return properties;
}

function first(properties, names) {
  for (const name of names) {
    if (properties[name] !== undefined && properties[name] !== null) return properties[name];
  }
  return null;
}

function mappingContext(event, properties, context) {
  const projectId = safeLabel(context.projectId ?? first(properties, ["project_id", "project_slug", "project", "foundry_project_id"]), "projectId");
  const surfaceId = safeLabel(context.surfaceId, "surfaceId");
  const environment = safeLabel(context.environment ?? "production", "environment");
  const observedAt = timestamp(context.observedAt ?? event.timestamp, "observedAt");
  return {
    projectId,
    surfaceId,
    environment,
    observedAt,
    revision: context.revision == null ? null : safeLabel(context.revision, "revision")
  };
}

export function percentile(values, percentileValue) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(3));
}

export function percentileSet(values, extraPercentiles = []) {
  const result = {};
  for (const value of [...PERCENTILES, ...extraPercentiles]) result[`p${value}`] = percentile(values, value);
  return result;
}

export function aggregateTimingPhase(samples, phase) {
  const values = samples.map((sample) => sample.timingsMs?.[phase]).filter((value) => typeof value === "number" && Number.isFinite(value));
  const availableSamples = values.length;
  return {
    availability: availableSamples === 0 ? "unavailable" : availableSamples === samples.length ? "available" : "partial",
    availableSamples,
    unavailableSamples: samples.length - availableSamples,
    percentilesMs: availableSamples === 0 ? null : percentileSet(values)
  };
}

export function aggregateProbeSegment(samples) {
  const statusCounts = new Map();
  const errorCounts = new Map();
  for (const sample of samples) {
    const status = sample.status == null ? "unavailable" : String(sample.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    if (sample.errorCode) errorCounts.set(sample.errorCode, (errorCounts.get(sample.errorCode) ?? 0) + 1);
  }
  const successCount = samples.filter((sample) => sample.ok).length;
  const sortedObject = (entries) => Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
  return {
    sampleCount: samples.length,
    successCount,
    failureCount: samples.length - successCount,
    timeoutCount: samples.filter((sample) => sample.timedOut).length,
    outcome: successCount === samples.length ? "pass" : successCount === 0 ? "fail" : "partial",
    statusCounts: sortedObject(statusCounts),
    errorCounts: sortedObject(errorCounts),
    timings: {
      dns: aggregateTimingPhase(samples, "dns"),
      connect: aggregateTimingPhase(samples, "connect"),
      tls: aggregateTimingPhase(samples, "tls"),
      ttfb: aggregateTimingPhase(samples, "ttfb"),
      total: aggregateTimingPhase(samples, "total")
    }
  };
}

export function mapApiCallTimingEvent(event, context = {}) {
  const properties = eventProperties(event);
  const mappedContext = mappingContext(event, properties, context);
  const routeTemplate = safeLabel(first(properties, ["route", "route_template"]), "routeTemplate");
  const sampleCount = Number(first(properties, ["sample_count", "sampleCount"]));
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_LEGACY_SAMPLE_COUNT) {
    throw new Error(`sampleCount must be between 1 and ${MAX_LEGACY_SAMPLE_COUNT}`);
  }
  const metric = (prefix) => ({
    p50: finiteNonNegative(first(properties, [`${prefix}_p50`, `${prefix}P50`])),
    p75: null,
    p90: finiteNonNegative(first(properties, [`${prefix}_p90`, `${prefix}P90`])),
    p95: null,
    p99: null,
    max: finiteNonNegative(first(properties, [`${prefix}_max`, `${prefix}Max`]))
  });
  return {
    schemaVersion: 1,
    kind: "performance-rollup",
    evidenceKind: "api",
    ...mappedContext,
    source: { kind: "browser-rum", provider: "posthog", event: "api_call_timing", imported: true },
    sampleCount,
    dimensions: { routeTemplate, method: null, statusClass: null, coldWarm: null },
    metrics: {
      totalMs: metric("duration"),
      ttfbMs: metric("ttfb"),
      transferBytes: { total: finiteNonNegative(first(properties, ["transfer_size_total", "transferSizeTotal"])) }
    }
  };
}

export function mapFoundryTraceEvent(event, context = {}) {
  const properties = eventProperties(event);
  const mappedContext = mappingContext(event, properties, context);
  const durationMs = finiteNonNegative(first(properties, ["traceDuration", "duration_ms", "durationMs"]));
  if (durationMs === null) throw new Error("foundry_trace duration is missing or invalid");
  const routeValue = first(properties, ["route_template", "route"]);
  const methodValue = first(properties, ["method", "http_method"]);
  const statusValue = first(properties, ["status_class", "statusClass"]);
  return {
    schemaVersion: 1,
    kind: "performance-span",
    evidenceKind: "api",
    ...mappedContext,
    source: { kind: "server-runtime", provider: "posthog", event: "foundry_trace", imported: true },
    operation: safeLabel(first(properties, ["traceName", "operation", "op"]), "operation"),
    routeTemplate: routeValue == null ? null : safeLabel(routeValue, "routeTemplate"),
    method: methodValue == null ? null : boundedString(String(methodValue).toUpperCase(), "method", 12),
    statusClass: statusValue == null ? null : boundedString(String(statusValue), "statusClass", 8),
    outcome: first(properties, ["outcome"]) == null ? null : boundedString(String(first(properties, ["outcome"])), "outcome", 24),
    durationMs,
    traceId: event.uuid == null ? null : safeLabel(String(event.uuid), "traceId")
  };
}

export function mapLegacyPerformanceEvent(event, context = {}) {
  const name = event?.event ?? event?.name;
  if (name === "api_call_timing") return mapApiCallTimingEvent(event, context);
  if (name === "foundry_trace") return mapFoundryTraceEvent(event, context);
  throw new Error(`unsupported legacy performance event: ${String(name)}`);
}
