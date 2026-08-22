import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const POLICY_SCHEMA = 'fleet.design-workflow.v1';
const RECEIPT_SCHEMA = 'fleet.design-review.v1';
const MODES = new Set(['preserve', 'overhaul']);
const REGISTERS = new Set(['brand', 'product']);

function validateOverhaulLane(overhaul, errors) {
  for (const field of [
    'minimumReferences',
    'maximumReferences',
    'minimumDirectionProbes',
    'maximumDirectionProbes',
  ]) {
    if (!Number.isSafeInteger(overhaul?.[field]) || overhaul[field] < 1) {
      errors.push(`overhaul.${field} must be a positive integer`);
    }
  }
  if (
    Number.isSafeInteger(overhaul?.minimumReferences)
    && Number.isSafeInteger(overhaul?.maximumReferences)
    && overhaul.minimumReferences > overhaul.maximumReferences
  ) {
    errors.push('overhaul reference bounds are inverted');
  }
  if (
    Number.isSafeInteger(overhaul?.minimumDirectionProbes)
    && Number.isSafeInteger(overhaul?.maximumDirectionProbes)
    && overhaul.minimumDirectionProbes > overhaul.maximumDirectionProbes
  ) {
    errors.push('overhaul direction-probe bounds are inverted');
  }
  if (!sameMembers(overhaul?.acceptedDirectionDecisions, ['approved', 'delegated'])) {
    errors.push('overhaul acceptedDirectionDecisions must be approved and delegated');
  }
}

function validateQualityGate(gate, errors) {
  for (const [scoreField, maximumField] of [
    ['minimumCritiqueScore', 'critiqueMaximum'],
    ['minimumAuditScore', 'auditMaximum'],
  ]) {
    if (
      !Number.isFinite(gate?.[scoreField])
      || !Number.isFinite(gate?.[maximumField])
      || gate[scoreField] < 1
      || gate[scoreField] > gate[maximumField]
    ) {
      errors.push(`qualityGate ${scoreField} must fit within ${maximumField}`);
    }
  }
  if (
    !Array.isArray(gate?.requiredViewportWidths)
    || gate.requiredViewportWidths.length < 2
    || gate.requiredViewportWidths.some((width) => !Number.isSafeInteger(width) || width < 320)
  ) {
    errors.push('qualityGate requiredViewportWidths must contain valid widths');
  }
  if (!sameMembers(gate?.acceptedOwnerDecisions, ['keep', 'delegated'])) {
    errors.push('qualityGate acceptedOwnerDecisions must be keep and delegated');
  }
  if (gate?.detectorPosture !== 'advisory') {
    errors.push('qualityGate detectorPosture must be advisory');
  }
  if (gate?.requirePassingProjectCheck !== true) {
    errors.push('qualityGate must require a passing project check');
  }
  for (const severity of ['p0', 'p1']) {
    if (gate?.maximumUnresolved?.[severity] !== 0) {
      errors.push(`qualityGate maximumUnresolved.${severity} must be zero`);
    }
  }
}

export function validateDesignWorkflowPolicy(policy) {
  const errors = [];
  if (policy?.$schema !== POLICY_SCHEMA || policy.version !== 1) {
    errors.push(`policy must use ${POLICY_SCHEMA} version 1`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(policy?.impeccableVersion ?? '')) {
    errors.push('policy impeccableVersion must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(policy?.impeccablePackageVersion ?? '')) {
    errors.push('policy impeccablePackageVersion must be an exact semantic version');
  }

  if (policy?.lanes?.preserve?.requireBeforeEvidence !== true) {
    errors.push('preserve lane must require before evidence');
  }
  validateOverhaulLane(policy?.lanes?.overhaul, errors);
  validateQualityGate(policy?.qualityGate, errors);

  if (errors.length) throw new DesignWorkflowError('Design workflow policy invalid', errors);
  return structuredClone(policy);
}

function validateOverhaulDirection(direction, rules, root, pathExists, errors) {
  const references = direction.references ?? [];
  const probes = direction.probes ?? [];
  if (!bounded(references.length, rules.minimumReferences, rules.maximumReferences)) {
    errors.push(`overhaul requires ${rules.minimumReferences}-${rules.maximumReferences} named references`);
  }
  if (references.some((reference) => typeof reference !== 'string' || !reference.trim())) {
    errors.push('overhaul references must be non-empty names');
  }
  if (!bounded(probes.length, rules.minimumDirectionProbes, rules.maximumDirectionProbes)) {
    errors.push(`overhaul requires ${rules.minimumDirectionProbes}-${rules.maximumDirectionProbes} direction probes`);
  }
  const probeIds = new Set();
  for (const probe of probes) {
    if (!probe?.id?.trim() || probeIds.has(probe.id)) {
      errors.push('overhaul direction probes require unique ids');
    } else {
      probeIds.add(probe.id);
    }
    requireEvidencePath(probe?.path, `direction.probes.${probe?.id ?? 'unknown'}`, root, pathExists, errors);
  }
  if (!probeIds.has(direction.selected)) {
    errors.push('overhaul direction.selected must match a probe id');
  }
  if (!rules.acceptedDirectionDecisions.includes(direction.approval)) {
    errors.push('overhaul direction approval must be approved or delegated');
  }
}

function validateReviewEvidence(evidence, policy, enforceMinimumScores, root, pathExists, errors) {
  const screenshots = evidence.screenshots ?? [];
  for (const width of policy.qualityGate.requiredViewportWidths) {
    const screenshot = screenshots.find((entry) => entry?.width === width);
    if (!screenshot) {
      errors.push(`missing required viewport ${width}`);
      continue;
    }
    requireEvidencePath(screenshot.path, `screenshot.${width}`, root, pathExists, errors);
  }
  validateScore(
    evidence.critique,
    enforceMinimumScores ? policy.qualityGate.minimumCritiqueScore : 1,
    policy.qualityGate.critiqueMaximum,
    'critique',
    errors,
  );
  validateScore(
    evidence.audit,
    enforceMinimumScores ? policy.qualityGate.minimumAuditScore : 1,
    policy.qualityGate.auditMaximum,
    'audit',
    errors,
  );
  for (const severity of ['p0', 'p1']) {
    const count = evidence?.unresolved?.[severity];
    if (!Number.isSafeInteger(count) || count > policy.qualityGate.maximumUnresolved[severity]) {
      errors.push(`unresolved ${severity.toUpperCase()} findings exceed the allowed maximum`);
    }
  }
  if (
    policy.qualityGate.requirePassingProjectCheck
    && (evidence?.projectCheck?.status !== 'pass' || !evidence.projectCheck.command?.trim())
  ) {
    errors.push('a named passing project check is required');
  }
  if (evidence?.detector?.posture !== policy.qualityGate.detectorPosture) {
    errors.push('detector posture must be advisory');
  }
}

export function validateDesignReview(receipt, policyInput, {
  projectRoot,
  pathExists = existsSync,
  enforceMinimumScores = true,
} = {}) {
  const policy = validateDesignWorkflowPolicy(policyInput);
  const root = path.resolve(projectRoot ?? process.cwd());
  const errors = [];

  if (receipt?.$schema !== RECEIPT_SCHEMA || receipt.version !== 1) {
    errors.push(`receipt must use ${RECEIPT_SCHEMA} version 1`);
  }
  if (!receipt?.project?.trim()) errors.push('receipt project is required');
  if (!receipt?.target?.trim()) errors.push('receipt target is required');
  if (!MODES.has(receipt?.mode)) errors.push('receipt mode must be preserve or overhaul');
  if (!REGISTERS.has(receipt?.register)) errors.push('receipt register must be brand or product');

  for (const [field, fallback] of [
    ['product', 'PRODUCT.md'],
    ['design', 'DESIGN.md'],
  ]) {
    const value = receipt?.context?.[field] ?? fallback;
    requireEvidencePath(value, `context.${field}`, root, pathExists, errors);
  }

  const direction = receipt?.direction ?? {};
  if (receipt?.mode === 'preserve') {
    requireEvidencePath(direction.before, 'direction.before', root, pathExists, errors);
    if (!direction.selected?.trim()) errors.push('preserve direction.selected is required');
  }
  if (receipt?.mode === 'overhaul') {
    validateOverhaulDirection(direction, policy.lanes.overhaul, root, pathExists, errors);
  }

  validateReviewEvidence(
    receipt?.evidence ?? {},
    policy,
    enforceMinimumScores,
    root,
    pathExists,
    errors,
  );

  if (!policy.qualityGate.acceptedOwnerDecisions.includes(receipt?.ownerFeedback?.decision)) {
    errors.push('owner feedback must be keep or explicitly delegated');
  }

  if (errors.length) throw new DesignWorkflowError('Design review failed', errors);
  return {
    ok: true,
    project: receipt.project,
    target: receipt.target,
    mode: receipt.mode,
    critiqueScore: receipt.evidence.critique.score,
    auditScore: receipt.evidence.audit.score,
    ownerDecision: receipt.ownerFeedback.decision,
    advisoryFindings: receipt.evidence.detector.findings?.length ?? 0,
  };
}

export function validateDesignReviewEvidence(receipt, policyInput, options = {}) {
  return validateDesignReview(receipt, policyInput, {
    ...options,
    enforceMinimumScores: false,
  });
}

function installedImpeccableVersion(skillFile) {
  if (!skillFile || !existsSync(skillFile)) return null;
  const match = readFileSync(skillFile, 'utf8').match(/^version:\s*["']?([^"' \r\n]+)["']?\s*$/m);
  return match?.[1] ?? null;
}

export function validateInstalledImpeccable(policyInput, skillFile) {
  const policy = validateDesignWorkflowPolicy(policyInput);
  const installed = installedImpeccableVersion(skillFile);
  if (installed !== policy.impeccableVersion) {
    throw new DesignWorkflowError('Impeccable version drift', [
      `expected ${policy.impeccableVersion}, found ${installed ?? 'missing'}`,
    ]);
  }
  return { ok: true, expected: policy.impeccableVersion, installed };
}

export class DesignWorkflowError extends Error {
  constructor(message, errors) {
    super(`${message}:\n- ${errors.join('\n- ')}`);
    this.name = 'DesignWorkflowError';
    this.errors = errors;
  }
}

function requireEvidencePath(value, label, root, pathExists, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} path is required`);
    return;
  }
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(`${label} must stay inside the project`);
  } else if (!pathExists(resolved)) {
    errors.push(`${label} does not exist: ${value}`);
  }
}

function validateScore(value, minimum, maximum, label, errors) {
  if (value?.maximum !== maximum) {
    errors.push(`${label} maximum must be ${maximum}`);
  }
  if (!Number.isFinite(value?.score) || value.score < minimum || value.score > maximum) {
    errors.push(`${label} score must be between ${minimum} and ${maximum}`);
  }
}

function bounded(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function sameMembers(value, expected) {
  return (
    Array.isArray(value)
    && value.length === expected.length
    && [...value].sort().join('\0') === [...expected].sort().join('\0')
  );
}
