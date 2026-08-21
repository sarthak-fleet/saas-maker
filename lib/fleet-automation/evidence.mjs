import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const evidenceStatuses = new Set([
  "pass", "fail", "stale", "blocked", "accepted-exception", "not-applicable"
]);

const privateKeys = /^(?:authorization|cookie|set-cookie|token|accessToken|refreshToken|apiKey|secret|password|body|content|emailBody|prompt|unpublishedContent)$/i;
const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|ghp|github_pat|cf|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi,
  /\b[A-Za-z0-9_-]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_-]*\s*[=:]\s*[^\s,;]+/gi
];

function redactText(value) {
  let result = String(value);
  for (const pattern of credentialPatterns) result = result.replace(pattern, "[REDACTED]");
  return result;
}

export function sanitizeEvidence(value, key = "") {
  if (privateKeys.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeEvidence(child, childKey)]));
  }
  return typeof value === "string" ? redactText(value) : value;
}

export function normalizeEvidence(input, sourceFile = "inline") {
  const sanitized = sanitizeEvidence(input);
  const required = ["projectId", "contract", "source", "observedAt", "status", "summary"];
  for (const field of required) {
    if (!sanitized[field]) throw new Error(`${sourceFile}: evidence missing ${field}`);
  }
  if (!evidenceStatuses.has(sanitized.status)) throw new Error(`${sourceFile}: unknown status ${sanitized.status}`);
  if (!Number.isFinite(Date.parse(sanitized.observedAt))) throw new Error(`${sourceFile}: invalid observedAt`);
  return {
    schemaVersion: 1,
    projectId: sanitized.projectId,
    contract: sanitized.contract,
    source: sanitized.source,
    observedAt: new Date(sanitized.observedAt).toISOString(),
    status: sanitized.status,
    summary: sanitized.summary,
    reference: sanitized.reference || sourceFile,
    revision: sanitized.revision || null,
    details: sanitized.details || null
  };
}

export function loadEvidenceDirectory(directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const name of readdirSync(directory).filter((item) => item.endsWith(".json")).sort()) {
    if (name === "last-known-good.json") continue;
    const path = resolve(directory, name);
    if (!statSync(path).isFile()) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.evidence) ? parsed.evidence : [parsed];
    for (const record of records) results.push(normalizeEvidence(record, basename(path)));
  }
  return results;
}

export function loadLastKnownGood(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(parsed) ? parsed : parsed.evidence || []).map((record) => normalizeEvidence(record, path));
}

export function saveLastKnownGood(path, evidence) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const current = new Map(loadLastKnownGood(path).map((record) => [`${record.projectId}:${record.contract}`, record]));
  for (const record of evidence) {
    if (record.status === "pass") current.set(`${record.projectId}:${record.contract}`, record);
  }
  const payload = { schemaVersion: 1, updatedAt: new Date().toISOString(), evidence: [...current.values()] };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function freshestEvidence(records, projectId, contract) {
  return records
    .filter((record) => record.projectId === projectId && record.contract === contract)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] || null;
}
