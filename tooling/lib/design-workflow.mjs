import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const POLICY_SCHEMA = 'fleet.design-workflow.v1';
const RECEIPT_SCHEMA = 'fleet.design-review.v1';
const MODES = new Set(['preserve', 'overhaul']);
const REGISTERS = new Set(['brand', 'product']);
const SURFACE_MODES = new Set(['persuade', 'operate', 'read', 'experience']);
const COMPREHENSION_STATUSES = new Set(['pass', 'not-applicable']);
const PURPOSE_ALIGNMENT_STATUSES = new Set(['match', 'repository-override']);
const LIBRARY_RUNTIMES = new Set(['none', 'markup-only', 'selective', 'existing', 'full']);

function validateOverhaulLane(overhaul, errors) {
  for (const field of [
    'minimumReferences',
    'maximumReferences',
    'minimumDirectionProbes',
    'maximumDirectionProbes',
  ]) {
    if (!Number.isSafeInteger(overhaul?.[field]) || overhaul[field] < 0) {
      errors.push(`overhaul.${field} must be a non-negative integer`);
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
  if (!sameMembers(overhaul?.acceptedDirectionDecisions, ['agent-selected', 'approved', 'delegated'])) {
    errors.push('overhaul acceptedDirectionDecisions must be agent-selected, approved, and delegated');
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
  if (!sameMembers(gate?.acceptedOwnerDecisions, ['agent-selected', 'keep', 'delegated'])) {
    errors.push('qualityGate acceptedOwnerDecisions must be agent-selected, keep, and delegated');
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

function validatePurposeGate(gate, errors) {
  const expectedFields = ['product', 'audience', 'value', 'mechanism', 'proof', 'nextAction'];
  if (gate?.maximumScore !== 100) errors.push('purposeGate maximumScore must be 100');
  if (!Number.isFinite(gate?.minimumScore) || gate.minimumScore < 1 || gate.minimumScore > 100) {
    errors.push('purposeGate minimumScore must be between 1 and 100');
  }
  if (gate?.visualScorePosture !== 'separate-noncompensating') {
    errors.push('purposeGate visualScorePosture must be separate-noncompensating');
  }
  const weights = gate?.fieldWeights ?? {};
  if (!sameMembers(Object.keys(weights), expectedFields)) {
    errors.push('purposeGate fieldWeights must cover product, audience, value, mechanism, proof, and nextAction');
    return;
  }
  if (expectedFields.some((field) => !Number.isFinite(weights[field]) || weights[field] < 1)) {
    errors.push('purposeGate field weights must be positive numbers');
  }
  if (expectedFields.reduce((sum, field) => sum + weights[field], 0) !== gate.maximumScore) {
    errors.push('purposeGate field weights must total 100');
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
  validatePurposeGate(policy?.purposeGate, errors);

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
  if (probes.length > 0 && !probeIds.has(direction.selected)) {
    errors.push('overhaul direction.selected must match a probe id');
  }
  if (probes.length === 0 && !direction.selected?.trim()) {
    errors.push('overhaul direction.selected is required when no probes are recorded');
  }
  if (!rules.acceptedDirectionDecisions.includes(direction.approval)) {
    errors.push('overhaul direction approval must be agent-selected, approved, or delegated');
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
  const comprehension = evidence?.comprehension;
  if (!COMPREHENSION_STATUSES.has(comprehension?.status)) {
    errors.push('comprehension status must be pass or not-applicable');
  }
  if (comprehension?.status === 'pass') {
    if (!comprehension.reviewer?.trim()) errors.push('a comprehension reviewer is required');
    for (const field of ['product', 'audience', 'value', 'mechanism', 'proof', 'nextAction']) {
      if (!comprehension.answers?.[field]?.trim()) {
        errors.push(`comprehension answer ${field} is required when the check passes`);
      }
    }
  }
}

function validateDirectionContract(contract, errors) {
  for (const field of ['purpose', 'audience', 'job', 'thesis', 'system', 'signature', 'risk']) {
    if (!contract?.[field]?.trim()) errors.push(`direction contract ${field} is required`);
  }
}

function validateLibrarySourcing(library, errors) {
  // Keep older receipts valid while requiring every newly generated receipt to
  // document upstream sourcing.
  if (library === undefined) return;
  if (library?.strategy !== 'upstream-first') {
    errors.push('direction library strategy must be upstream-first');
  }
  if (!library?.primary?.trim()) errors.push('direction library primary source is required');
  if (!Array.isArray(library?.sources)) {
    errors.push('direction library sources must be an array');
  } else if (
    library.sources.some((source) => typeof source !== 'string' || !/^https:\/\//.test(source))
  ) {
    errors.push('direction library sources must be exact HTTPS URLs');
  }
  if (!LIBRARY_RUNTIMES.has(library?.runtime)) {
    errors.push('direction library runtime must be none, markup-only, selective, existing, or full');
  }
  if (library?.primary !== 'existing-project-system' && library?.sources?.length === 0) {
    errors.push('upstream library adoption requires at least one exact component or block URL');
  }

  const replacement = library?.customReplacement;
  if (replacement?.used !== true && replacement?.used !== false) {
    errors.push('direction library customReplacement.used must be boolean');
  }
  if (replacement?.used === true) {
    if (replacement.authorization !== 'owner-requested') {
      errors.push('a custom replacement requires explicit owner-requested authorization');
    }
    if (!replacement.reason?.trim()) {
      errors.push('a custom replacement requires the missing upstream capability');
    }
  }
  if (library?.primary === 'custom' && replacement?.used !== true) {
    errors.push('a custom primary library must be recorded as an authorized custom replacement');
  }
  if (library?.runtime === 'full' && !replacement?.reason?.trim()) {
    errors.push('a full UI runtime requires an explicit reason');
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
  if (!SURFACE_MODES.has(receipt?.surfaceMode)) {
    errors.push('receipt surfaceMode must be persuade, operate, read, or experience');
  }
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
  validateDirectionContract(direction.contract, errors);
  validateLibrarySourcing(direction.library, errors);
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

  if (receipt.surfaceMode === 'persuade' && receipt.evidence?.comprehension?.status !== 'pass') {
    errors.push('persuade surfaces require a passing fresh-visitor comprehension check');
  }
  if (receipt.surfaceMode === 'persuade') {
    const contract = receipt.direction?.contract;
    if (!contract?.purposeSource?.trim()) {
      errors.push('persuade surfaces require the canonical purpose source');
    }
    if (!contract?.canonicalPurpose?.trim()) {
      errors.push('persuade surfaces require the canonical product purpose');
    }
    if (!PURPOSE_ALIGNMENT_STATUSES.has(contract?.purposeAlignment)) {
      errors.push('persuade purpose alignment must be match or repository-override');
    }
    if (contract?.purposeAlignment === 'repository-override' && !contract?.driftNote?.trim()) {
      errors.push('repository purpose overrides require a drift note');
    }
    const mismatches = receipt.evidence?.comprehension?.mismatches;
    if (!Array.isArray(mismatches) || mismatches.length > 0) {
      errors.push('persuade surfaces cannot pass with product-purpose contradictions');
    }
    validatePurposeScore(receipt.evidence?.comprehension?.purposeScore, policy.purposeGate, errors);
  }

  if (!policy.qualityGate.acceptedOwnerDecisions.includes(receipt?.ownerFeedback?.decision)) {
    errors.push('owner feedback must be agent-selected, keep, or explicitly delegated');
  }

  if (errors.length) throw new DesignWorkflowError('Design review failed', errors);
  return {
    ok: true,
    project: receipt.project,
    target: receipt.target,
    mode: receipt.mode,
    critiqueScore: receipt.evidence.critique.score,
    auditScore: receipt.evidence.audit.score,
    purposeScore: receipt.evidence.comprehension?.purposeScore?.total ?? null,
    ownerDecision: receipt.ownerFeedback.decision,
    advisoryFindings: receipt.evidence.detector.findings?.length ?? 0,
  };
}

function validatePurposeScore(score, gate, errors) {
  const fields = Object.keys(gate.fieldWeights);
  if (!score || typeof score !== 'object' || Array.isArray(score)) {
    errors.push('persuade surfaces require a purpose score');
    return;
  }
  let total = 0;
  for (const field of fields) {
    const value = score[field];
    const maximum = gate.fieldWeights[field];
    if (!Number.isFinite(value) || value < 0 || value > maximum) {
      errors.push(`purpose score ${field} must be between 0 and ${maximum}`);
      continue;
    }
    total += value;
  }
  if (score.total !== total) errors.push(`purpose score total must equal ${total}`);
  if (total < gate.minimumScore) {
    errors.push(`purpose score must be at least ${gate.minimumScore}; visual scores cannot compensate`);
  }
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
