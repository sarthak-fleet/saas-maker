import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const SEARCH_INDEXING_REQUEST_SCHEMA = 'fleet.search-indexing-request.v1';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;

function normalizeTimestamp(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${path} must be ISO-8601`);
  }
  return new Date(value).toISOString();
}

function normalizeHttpsUrl(value, path) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error(`${path} must be an HTTPS URL`);
  }
}

function normalizeSearchIndexingRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('indexing request must be an object');
  }
  const allowed = new Set(['schemaVersion', 'projectId', 'inspectedUrl', 'requestedAt']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`indexing request.${key} is not allowed`);
  }
  if (value.schemaVersion !== SEARCH_INDEXING_REQUEST_SCHEMA) {
    throw new Error('unsupported indexing request schema');
  }
  if (typeof value.projectId !== 'string' || !IDENTIFIER.test(value.projectId)) {
    throw new Error('indexing request.projectId is invalid');
  }
  return {
    schemaVersion: SEARCH_INDEXING_REQUEST_SCHEMA,
    projectId: value.projectId,
    inspectedUrl: normalizeHttpsUrl(value.inspectedUrl, 'indexing request.inspectedUrl'),
    requestedAt: normalizeTimestamp(value.requestedAt, 'indexing request.requestedAt'),
  };
}

export function defaultSearchIndexingRequestPath({ home = process.env.HOME ?? '' } = {}) {
  return join(home, '.fleet', 'search-indexing-requests', 'ledger.jsonl');
}

export function readSearchIndexingRequests({ path = defaultSearchIndexingRequestPath() } = {}) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [normalizeSearchIndexingRequest(JSON.parse(line))];
      } catch {
        return [];
      }
    })
    .sort((left, right) => Date.parse(left.requestedAt) - Date.parse(right.requestedAt));
}

export function appendSearchIndexingRequest(request, {
  path = defaultSearchIndexingRequestPath(),
} = {}) {
  const normalized = normalizeSearchIndexingRequest(request);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return normalized;
}
