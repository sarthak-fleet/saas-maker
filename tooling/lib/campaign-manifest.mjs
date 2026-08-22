import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const CAMPAIGN_MANIFEST_SCHEMA = 'fleet.approved-campaign-manifest.v1';
const CAMPAIGN_APPROVAL_SCHEMA = 'fleet.campaign-approval.v1';
const CAMPAIGN_RECEIPT_SCHEMA = 'fleet.campaign-item-receipt.v1';

const KINDS = new Set(['content_coverage', 'launch_campaign']);
const TIERS = new Set(['flagship', 'secondary', 'manual']);
const EXECUTION_MODES = new Set([
  'repository',
  'postiz',
  'connector',
  'browser',
  'manual',
  'blocked',
]);
const OUTCOMES = new Set([
  'confirmed',
  'queued',
  'manual',
  'blocked',
  'failed',
  'indeterminate',
  'published',
]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function validateCampaignManifest(input) {
  const issues = [];
  if (!record(input)) return invalid(['manifest must be an object']);
  if (input.$schema !== CAMPAIGN_MANIFEST_SCHEMA || input.version !== 1) {
    issues.push(`$schema must be ${CAMPAIGN_MANIFEST_SCHEMA} and version must be 1`);
  }

  const campaign = validateCampaign(input.campaign, issues);
  const sources = array(input.sources, 'sources', issues).map((source, index) =>
    validateSource(source, index, issues),
  );
  const items = array(input.items, 'items', issues).map((item, index) =>
    validateItem(item, index, issues),
  );
  const itemKeys = new Set();
  for (const item of items) {
    if (!item?.key) continue;
    if (itemKeys.has(item.key)) issues.push(`duplicate item key: ${item.key}`);
    itemKeys.add(item.key);
  }
  const steps = array(input.steps, 'steps', issues).map((step, index) =>
    validateStep(step, index, itemKeys, issues),
  );
  const referenced = new Set(steps.flatMap((step) => step?.itemKeys ?? []));
  for (const key of itemKeys) {
    if (!referenced.has(key)) issues.push(`item ${key} is missing from steps`);
  }
  const exclusions = array(input.exclusions, 'exclusions', issues).map(
    (entry, index) => validateExclusion(entry, index, issues),
  );
  const measurement = validateMeasurement(input.measurement, issues);
  const permissions = validatePermissions(input.permissions, issues);

  if (issues.length) return invalid(issues);
  return {
    ok: true,
    issues: [],
    value: {
      $schema: CAMPAIGN_MANIFEST_SCHEMA,
      version: 1,
      campaign,
      sources,
      steps,
      items,
      exclusions,
      measurement,
      permissions,
    },
  };
}

export function campaignManifestHash(input) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  return createHash('sha256').update(canonicalJson(validation.value)).digest('hex');
}

function itemIdentity(input, itemKey) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  const item = validation.value.items.find((entry) => entry.key === itemKey);
  if (!item) throw new CampaignManifestError(`unknown item: ${itemKey}`);
  return `campaign-item-${createHash('sha256')
    .update(canonicalJson({
      manifestHash: campaignManifestHash(validation.value),
      itemKey,
      destination: item.destination,
      execution: item.execution,
    }))
    .digest('hex')
    .slice(0, 24)}`;
}

export function materialChange(previous, next) {
  const previousHash = campaignManifestHash(previous);
  const nextHash = campaignManifestHash(next);
  return { changed: previousHash !== nextHash, previousHash, nextHash };
}

export function createCampaignApproval(input, options = {}) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  const decidedBy = requiredText(options.decidedBy, 'decidedBy');
  const decisionReference = requiredText(options.decisionReference, 'decisionReference');
  const decidedAt = iso(options.decidedAt ?? new Date().toISOString(), 'decidedAt');
  return {
    $schema: CAMPAIGN_APPROVAL_SCHEMA,
    version: 1,
    campaignId: validation.value.campaign.id,
    manifestHash: campaignManifestHash(validation.value),
    status: 'approved',
    decidedBy,
    decidedAt,
    decisionReference,
  };
}

function validateCampaignApproval(input) {
  const issues = [];
  if (!record(input)) return invalid(['approval must be an object']);
  if (input.$schema !== CAMPAIGN_APPROVAL_SCHEMA || input.version !== 1) {
    issues.push(`$schema must be ${CAMPAIGN_APPROVAL_SCHEMA} and version must be 1`);
  }
  const campaignId = slug(input.campaignId, 'campaignId', issues);
  const manifestHash = /^[a-f0-9]{64}$/u.test(input.manifestHash ?? '')
    ? input.manifestHash
    : (issues.push('manifestHash must be a SHA-256 hex digest'), null);
  if (input.status !== 'approved') issues.push('status must be approved');
  const decidedBy = text(input.decidedBy, 'decidedBy', issues);
  const decidedAt = date(input.decidedAt, 'decidedAt', issues);
  const decisionReference = text(
    input.decisionReference,
    'decisionReference',
    issues,
  );
  return issues.length
    ? invalid(issues)
    : {
        ok: true,
        issues: [],
        value: {
          $schema: CAMPAIGN_APPROVAL_SCHEMA,
          version: 1,
          campaignId,
          manifestHash,
          status: 'approved',
          decidedBy,
          decidedAt,
          decisionReference,
        },
      };
}

export function evaluateCampaignItem(input, approvalInput, itemKey, receipts = []) {
  const manifest = validateCampaignManifest(input);
  if (!manifest.ok) return blocked(manifest.issues);
  const approval = validateCampaignApproval(approvalInput);
  if (!approval.ok) return blocked(approval.issues);
  const hash = campaignManifestHash(manifest.value);
  if (
    approval.value.campaignId !== manifest.value.campaign.id ||
    approval.value.manifestHash !== hash
  ) {
    return blocked(['approval does not match the current campaign manifest']);
  }
  const item = manifest.value.items.find((entry) => entry.key === itemKey);
  if (!item) return blocked([`unknown item: ${itemKey}`]);
  if (item.execution.mode === 'blocked') {
    return blocked([item.execution.blockedReason ?? 'item is blocked']);
  }
  const identity = itemIdentity(manifest.value, itemKey);
  const confirmed = receipts.find(
    (receipt) =>
      receipt?.itemIdentity === identity &&
      ['confirmed', 'queued', 'published'].includes(receipt?.outcome),
  );
  if (confirmed) {
    return {
      authorized: false,
      status: 'already_completed',
      reasons: [],
      manifestHash: hash,
      itemIdentity: identity,
      item,
      receipt: confirmed,
    };
  }
  const indeterminate = receipts.find(
    (receipt) =>
      receipt?.itemIdentity === identity && receipt?.outcome === 'indeterminate',
  );
  if (indeterminate) {
    return {
      authorized: false,
      status: 'reconcile_required',
      reasons: ['an indeterminate create must be reconciled before retry'],
      manifestHash: hash,
      itemIdentity: identity,
      item,
      receipt: indeterminate,
    };
  }
  return {
    authorized: true,
    status: 'authorized',
    reasons: [],
    manifestHash: hash,
    itemIdentity: identity,
    item,
    receipt: null,
  };
}

export function createCampaignReceipt(input, itemKey, result, options = {}) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  if (!OUTCOMES.has(result?.outcome)) {
    throw new CampaignManifestError(`invalid receipt outcome: ${result?.outcome}`);
  }
  const item = validation.value.items.find((entry) => entry.key === itemKey);
  if (!item) throw new CampaignManifestError(`unknown item: ${itemKey}`);
  const resultUrl = optionalUrl(result.resultUrl, 'resultUrl');
  const outcome = result.outcome;
  if (outcome === 'published' && !resultUrl) {
    throw new CampaignManifestError('published receipt requires resultUrl');
  }
  return {
    $schema: CAMPAIGN_RECEIPT_SCHEMA,
    version: 1,
    campaignId: validation.value.campaign.id,
    manifestHash: campaignManifestHash(validation.value),
    itemKey,
    itemIdentity: itemIdentity(validation.value, itemKey),
    outcome,
    provider: requiredText(result.provider ?? item.execution.mode, 'provider'),
    externalId: optionalText(result.externalId),
    resultUrl,
    message: optionalText(result.message),
    recordedAt: iso(
      options.recordedAt ?? result.recordedAt ?? new Date().toISOString(),
      'recordedAt',
    ),
  };
}

export function publicCampaignSummary(input, receipts = []) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  const counts = Object.fromEntries([...OUTCOMES].sort().map((outcome) => [outcome, 0]));
  const publicResults = [];
  for (const receipt of receipts) {
    if (!OUTCOMES.has(receipt?.outcome)) continue;
    counts[receipt.outcome] += 1;
    if (
      receipt.outcome === 'published' &&
      typeof receipt.resultUrl === 'string' &&
      httpUrl(receipt.resultUrl)
    ) {
      publicResults.push({
        itemKey: receipt.itemKey,
        url: receipt.resultUrl,
        recordedAt: receipt.recordedAt,
      });
    }
  }
  return {
    schemaVersion: 1,
    campaignId: validation.value.campaign.id,
    kind: validation.value.campaign.kind,
    projectId: validation.value.campaign.projectId,
    manifestHash: campaignManifestHash(validation.value),
    itemCount: validation.value.items.length,
    counts,
    blockers: validation.value.items
      .filter((item) => item.execution.mode === 'blocked')
      .map((item) => ({ itemKey: item.key, reason: item.execution.blockedReason })),
    publicResults,
  };
}

function campaignRuntimeRoot(options = {}) {
  const candidate =
    options.runtimeRoot ??
    process.env.FLEET_CAMPAIGN_RUNTIME_DIR ??
    resolve(homedir(), 'Library/Application Support/Fleet Ops/growth-campaigns');
  if (!isAbsolute(candidate)) {
    throw new CampaignManifestError('campaign runtime root must be absolute');
  }
  const checkout = resolve(options.checkoutRoot ?? resolve(import.meta.dirname, '../..'));
  const rel = relative(checkout, resolve(candidate));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new CampaignManifestError('campaign runtime state must remain outside the checkout');
  }
  return resolve(candidate);
}

export function campaignStatePaths(input, options = {}) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  const root = campaignRuntimeRoot(options);
  const campaignDir = resolve(root, validation.value.campaign.id);
  return {
    root,
    campaignDir,
    manifest: resolve(campaignDir, 'manifest.json'),
    approval: resolve(campaignDir, 'approval.json'),
    receipts: resolve(campaignDir, 'receipts'),
  };
}

export function persistCampaignManifest(input, options = {}) {
  const validation = validateCampaignManifest(input);
  if (!validation.ok) throw new CampaignManifestError(validation.issues.join('; '));
  const paths = campaignStatePaths(validation.value, options);
  secureDirectory(paths.root);
  secureDirectory(paths.campaignDir);
  secureDirectory(paths.receipts);
  atomicJson(paths.manifest, validation.value);
  return paths;
}

export function persistCampaignApproval(input, approvalInput, options = {}) {
  const approval = validateCampaignApproval(approvalInput);
  if (!approval.ok) throw new CampaignManifestError(approval.issues.join('; '));
  const hash = campaignManifestHash(input);
  if (
    approval.value.campaignId !== input.campaign.id ||
    approval.value.manifestHash !== hash
  ) {
    throw new CampaignManifestError('approval does not match campaign manifest');
  }
  const paths = persistCampaignManifest(input, options);
  atomicJson(paths.approval, approval.value);
  return paths.approval;
}

export function persistCampaignReceipt(input, receipt, options = {}) {
  const paths = persistCampaignManifest(input, options);
  if (
    receipt?.$schema !== CAMPAIGN_RECEIPT_SCHEMA ||
    receipt.campaignId !== input.campaign.id ||
    receipt.manifestHash !== campaignManifestHash(input)
  ) {
    throw new CampaignManifestError('receipt does not match campaign manifest');
  }
  const receiptDigest = createHash('sha256')
    .update(canonicalJson(receipt))
    .digest('hex')
    .slice(0, 16);
  const path = resolve(paths.receipts, `${receipt.itemIdentity}-${receiptDigest}.json`);
  if (existsSync(path)) {
    const existing = readJson(path);
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw new CampaignManifestError(`receipt collision for ${receipt.itemIdentity}`);
    }
    return path;
  }
  atomicJson(path, receipt, { exclusive: true });
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function validateCampaign(input, issues) {
  if (!record(input)) {
    issues.push('campaign must be an object');
    return null;
  }
  const id = slug(input.id, 'campaign.id', issues);
  const kind = KINDS.has(input.kind)
    ? input.kind
    : (issues.push('campaign.kind must be content_coverage or launch_campaign'), null);
  return {
    id,
    kind,
    projectId: slug(input.projectId, 'campaign.projectId', issues),
    missionId: optionalSlug(input.missionId, 'campaign.missionId', issues),
    title: text(input.title, 'campaign.title', issues),
    objective: text(input.objective, 'campaign.objective', issues),
    createdAt: date(input.createdAt, 'campaign.createdAt', issues),
    sourceRevision: text(input.sourceRevision, 'campaign.sourceRevision', issues),
  };
}

function validateSource(input, index, issues) {
  const prefix = `sources[${index}]`;
  if (!record(input)) {
    issues.push(`${prefix} must be an object`);
    return null;
  }
  return {
    id: slug(input.id, `${prefix}.id`, issues),
    type: text(input.type, `${prefix}.type`, issues),
    reference: text(input.reference, `${prefix}.reference`, issues),
    verifiedAt: date(input.verifiedAt, `${prefix}.verifiedAt`, issues),
  };
}

function validateItem(input, index, issues) {
  const prefix = `items[${index}]`;
  if (!record(input)) {
    issues.push(`${prefix} must be an object`);
    return null;
  }
  const execution = record(input.execution) ? input.execution : {};
  if (!record(input.execution)) issues.push(`${prefix}.execution must be an object`);
  const mode = EXECUTION_MODES.has(execution.mode)
    ? execution.mode
    : (issues.push(`${prefix}.execution.mode is invalid`), null);
  if (mode === 'blocked' && !optionalText(execution.blockedReason)) {
    issues.push(`${prefix}.execution.blockedReason is required for blocked items`);
  }
  const destination = record(input.destination) ? input.destination : {};
  if (!record(input.destination)) issues.push(`${prefix}.destination must be an object`);
  const content = record(input.content) ? input.content : {};
  if (!record(input.content)) issues.push(`${prefix}.content must be an object`);
  const body = text(content.body, `${prefix}.content.body`, issues);
  return {
    key: slug(input.key, `${prefix}.key`, issues),
    kind: text(input.kind, `${prefix}.kind`, issues),
    tier: TIERS.has(input.tier)
      ? input.tier
      : (issues.push(`${prefix}.tier is invalid`), null),
    title: text(input.title, `${prefix}.title`, issues),
    content: {
      body,
      fields: record(content.fields) ? structuredClone(content.fields) : {},
      assets: array(content.assets ?? [], `${prefix}.content.assets`, issues).map((asset) =>
        String(asset),
      ),
    },
    destination: {
      id: slug(destination.id, `${prefix}.destination.id`, issues),
      url: url(destination.url, `${prefix}.destination.url`, issues),
      accountSlug: optionalSlug(
        destination.accountSlug,
        `${prefix}.destination.accountSlug`,
        issues,
      ),
      cost: text(destination.cost, `${prefix}.destination.cost`, issues),
    },
    execution: {
      mode,
      action: text(execution.action, `${prefix}.execution.action`, issues),
      requiresAuth: Boolean(execution.requiresAuth),
      policyVerifiedAt: date(
        execution.policyVerifiedAt,
        `${prefix}.execution.policyVerifiedAt`,
        issues,
      ),
      blockedReason: optionalText(execution.blockedReason),
    },
    timing: {
      publishAt: optionalDate(input.timing?.publishAt, `${prefix}.timing.publishAt`, issues),
    },
  };
}

function validateStep(input, index, itemKeys, issues) {
  const prefix = `steps[${index}]`;
  if (!record(input)) {
    issues.push(`${prefix} must be an object`);
    return null;
  }
  const keys = array(input.itemKeys, `${prefix}.itemKeys`, issues).map((key) => String(key));
  if (!keys.length) issues.push(`${prefix}.itemKeys must not be empty`);
  for (const key of keys) {
    if (!itemKeys.has(key)) issues.push(`${prefix} references unknown item ${key}`);
  }
  return {
    id: slug(input.id, `${prefix}.id`, issues),
    label: text(input.label, `${prefix}.label`, issues),
    itemKeys: keys,
  };
}

function validateExclusion(input, index, issues) {
  const prefix = `exclusions[${index}]`;
  if (!record(input)) {
    issues.push(`${prefix} must be an object`);
    return null;
  }
  return {
    destinationId: slug(input.destinationId, `${prefix}.destinationId`, issues),
    reason: text(input.reason, `${prefix}.reason`, issues),
  };
}

function validateMeasurement(input, issues) {
  if (!record(input)) {
    issues.push('measurement must be an object');
    return null;
  }
  const metrics = array(input.metrics, 'measurement.metrics', issues).map(String);
  const checkpoints = array(input.checkpoints, 'measurement.checkpoints', issues).map(
    String,
  );
  if (!metrics.length) issues.push('measurement.metrics must not be empty');
  if (!checkpoints.length) issues.push('measurement.checkpoints must not be empty');
  return {
    attribution: text(input.attribution, 'measurement.attribution', issues),
    metrics,
    checkpoints,
  };
}

function validatePermissions(input, issues) {
  if (!record(input)) {
    issues.push('permissions must be an object');
    return null;
  }
  return {
    repositoryWrites: array(
      input.repositoryWrites,
      'permissions.repositoryWrites',
      issues,
    ).map(String),
    commands: array(input.commands, 'permissions.commands', issues).map(String),
    publishCommands: array(
      input.publishCommands,
      'permissions.publishCommands',
      issues,
    ).map(String),
  };
}

function secureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function atomicJson(path, value, options = {}) {
  const temporary = `${path}.${process.pid}.tmp`;
  if (options.exclusive && existsSync(path)) {
    throw new CampaignManifestError(`file already exists: ${path}`);
  }
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  if (options.exclusive && existsSync(path)) {
    unlinkSync(temporary);
    throw new CampaignManifestError(`file already exists: ${path}`);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function array(value, label, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  return value;
}

function slug(value, label, issues) {
  if (!SLUG.test(value ?? '')) {
    issues.push(`${label} must be a kebab-case slug`);
    return null;
  }
  return value;
}

function optionalSlug(value, label, issues) {
  if (value === null || value === undefined) return null;
  return slug(value, label, issues);
}

function text(value, label, issues) {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${label} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function requiredText(value, label) {
  const issues = [];
  const result = text(value, label, issues);
  if (issues.length) throw new CampaignManifestError(issues.join('; '));
  return result;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function date(value, label, issues) {
  try {
    return iso(value, label);
  } catch {
    issues.push(`${label} must be an ISO date`);
    return null;
  }
}

function optionalDate(value, label, issues) {
  if (value === null || value === undefined) return null;
  return date(value, label, issues);
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new CampaignManifestError(`${label} must be an ISO date`);
  }
  return new Date(value).toISOString();
}

function url(value, label, issues) {
  if (!httpUrl(value)) {
    issues.push(`${label} must be an absolute HTTP(S) URL`);
    return null;
  }
  return new URL(value).toString();
}

function optionalUrl(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (!httpUrl(value)) throw new CampaignManifestError(`${label} must be HTTP(S)`);
  return new URL(value).toString();
}

function httpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function invalid(issues) {
  return { ok: false, issues, value: null };
}

function blocked(reasons) {
  return {
    authorized: false,
    status: 'blocked',
    reasons,
    manifestHash: null,
    itemIdentity: null,
    item: null,
    receipt: null,
  };
}

class CampaignManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CampaignManifestError';
  }
}
