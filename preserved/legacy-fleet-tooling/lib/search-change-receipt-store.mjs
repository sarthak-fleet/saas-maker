import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SEARCH_CHANGE_RECEIPT_SCHEMA = 'fleet.search-change-receipt.v1';
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const REVISION = /^[0-9a-f]{40}$/;

function normalizeSearchChangeReceipt(value) {
  const allowed = new Set(['schemaVersion', 'projectId', 'actionId', 'query', 'landingPage', 'revision', 'changedAt']);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('search change receipt must be an object');
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`search change receipt.${key} is not allowed`);
  }
  if (value.schemaVersion !== SEARCH_CHANGE_RECEIPT_SCHEMA) throw new Error('unsupported search change receipt schema');
  for (const field of ['projectId', 'actionId']) {
    if (typeof value[field] !== 'string' || !IDENTIFIER.test(value[field])) throw new Error(`search change receipt.${field} is invalid`);
  }
  if (typeof value.query !== 'string' || value.query.trim().length === 0 || value.query.length > 2048) {
    throw new Error('search change receipt.query is invalid');
  }
  let landingPage;
  try {
    landingPage = new URL(value.landingPage);
    if (landingPage.protocol !== 'https:' || landingPage.username || landingPage.password) throw new Error();
  } catch {
    throw new Error('search change receipt.landingPage must be an HTTPS URL');
  }
  if (typeof value.revision !== 'string' || !REVISION.test(value.revision)) throw new Error('search change receipt.revision is invalid');
  if (typeof value.changedAt !== 'string' || !Number.isFinite(Date.parse(value.changedAt))) throw new Error('search change receipt.changedAt must be ISO-8601');
  return {
    schemaVersion: SEARCH_CHANGE_RECEIPT_SCHEMA,
    projectId: value.projectId,
    actionId: value.actionId,
    query: value.query.trim(),
    landingPage: landingPage.href,
    revision: value.revision,
    changedAt: new Date(value.changedAt).toISOString(),
  };
}

export function defaultSearchChangeReceiptPath({ home = process.env.HOME ?? '' } = {}) {
  return join(home, '.fleet', 'search-change-receipts', 'ledger.jsonl');
}

export function readSearchChangeReceipts({ path = defaultSearchChangeReceiptPath() } = {}) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [normalizeSearchChangeReceipt(JSON.parse(line))]; } catch { return []; }
  }).sort((left, right) => Date.parse(left.changedAt) - Date.parse(right.changedAt));
}

export function appendSearchChangeReceipt(receipt, { path = defaultSearchChangeReceiptPath() } = {}) {
  const normalized = normalizeSearchChangeReceipt(receipt);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return normalized;
}
