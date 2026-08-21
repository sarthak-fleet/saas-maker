import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  validateDesignReviewEvidence,
  validateDesignWorkflowPolicy,
} from './design-workflow.mjs';
import { visibilityProjects } from './visibility-projects.mjs';

export const DESIGN_REVIEW_SNAPSHOT_SCHEMA = 'fleet.design-review-snapshot.v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OWNER_DECISIONS = new Set(['keep', 'delegated']);
const REJECTION_REASONS = new Set([
  'invalid-json',
  'validation-failed',
  'evidence-unreadable',
]);

export function buildDesignReviewSnapshot({
  fleetRoot,
  projectWorkspaceRoot,
  catalogPath = path.resolve(fleetRoot, 'foundry/ops/config/projects.json'),
  policyPath = path.resolve(fleetRoot, 'foundry/ops/config/design-workflow.json'),
} = {}) {
  const resolvedFleetRoot = requiredDirectory(fleetRoot, 'fleetRoot');
  const resolvedWorkspaceRoot = requiredDirectory(
    projectWorkspaceRoot,
    'projectWorkspaceRoot',
  );
  const resolvedCatalogPath = path.resolve(resolvedFleetRoot, catalogPath);
  const resolvedPolicyPath = path.resolve(resolvedFleetRoot, policyPath);
  const catalogBytes = readFileSync(resolvedCatalogPath);
  const policyBytes = readFileSync(resolvedPolicyPath);
  const catalog = parseJson(catalogBytes, resolvedCatalogPath);
  const policy = parseJson(policyBytes, resolvedPolicyPath);
  validateDesignWorkflowPolicy(policy);
  const projects = visibilityProjects(catalog)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const reviews = [];
  const rejectedProjects = [];

  for (const project of projects) {
    if (!project.repo) continue;
    const projectRoot = resolveProjectRoot(resolvedWorkspaceRoot, project);
    const receiptPath = path.resolve(projectRoot, '.fleet/design-review.json');
    if (!existsSync(receiptPath)) continue;

    try {
      const receiptBytes = readFileSync(receiptPath);
      const receipt = parseJson(receiptBytes, receiptPath);
      const validation = validateDesignReviewEvidence(receipt, policy, { projectRoot });
      const evidenceFiles = requiredEvidencePaths(receipt, policy)
        .map((relativePath) => {
          const normalizedPath = normalizeRelativePath(relativePath);
          return {
            path: normalizedPath,
            sha256: sha256(readFileSync(path.resolve(projectRoot, normalizedPath))),
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path));

      reviews.push({
        projectId: project.id,
        receiptSha256: sha256(receiptBytes),
        evidenceFiles,
        critique: {
          score: validation.critiqueScore,
          maximum: receipt.evidence.critique.maximum,
        },
        audit: {
          score: validation.auditScore,
          maximum: receipt.evidence.audit.maximum,
        },
        ownerDecision: validation.ownerDecision,
      });
    } catch (error) {
      rejectedProjects.push({
        projectId: project.id,
        reason: rejectionReason(error),
      });
    }
  }

  return {
    $schema: DESIGN_REVIEW_SNAPSHOT_SCHEMA,
    version: 1,
    catalogSha256: sha256(catalogBytes),
    policySha256: sha256(policyBytes),
    catalogProjectIds: projects.map((project) => project.id),
    rejectedProjects,
    projects: reviews,
  };
}

export function writeDesignReviewSnapshot({
  outputPath,
  ...options
} = {}) {
  const fleetRoot = path.resolve(options.fleetRoot);
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(fleetRoot, 'foundry/ops/data/design-reviews/latest.json'),
  );
  const snapshot = buildDesignReviewSnapshot(options);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { outputPath: resolvedOutputPath, snapshot };
}

export function validateDesignReviewSnapshot(snapshot, {
  projectIds,
  policySha256,
} = {}) {
  const errors = [];
  if (
    snapshot?.$schema !== DESIGN_REVIEW_SNAPSHOT_SCHEMA
    || snapshot?.version !== 1
  ) {
    errors.push(`snapshot must use ${DESIGN_REVIEW_SNAPSHOT_SCHEMA} version 1`);
  }
  if (!SHA256_PATTERN.test(snapshot?.catalogSha256 ?? '')) {
    errors.push('snapshot catalogSha256 must be a SHA-256 digest');
  }
  if (!SHA256_PATTERN.test(snapshot?.policySha256 ?? '')) {
    errors.push('snapshot policySha256 must be a SHA-256 digest');
  }
  if (policySha256 && snapshot?.policySha256 !== policySha256) {
    errors.push('snapshot design-workflow policy hash does not match');
  }

  const expectedProjectIds = projectIds
    ? [...projectIds].sort((left, right) => left.localeCompare(right))
    : null;
  const catalogProjectIds = Array.isArray(snapshot?.catalogProjectIds)
    ? snapshot.catalogProjectIds
    : [];
  if (
    catalogProjectIds.some((projectId) => typeof projectId !== 'string' || !projectId)
    || new Set(catalogProjectIds).size !== catalogProjectIds.length
    || !isSorted(catalogProjectIds)
  ) {
    errors.push('snapshot catalogProjectIds must be unique non-empty sorted strings');
  }
  if (
    expectedProjectIds
    && expectedProjectIds.join('\0') !== catalogProjectIds.join('\0')
  ) {
    errors.push('snapshot catalog project inventory does not match');
  }

  const reviews = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const rejectedProjects = Array.isArray(snapshot?.rejectedProjects)
    ? snapshot.rejectedProjects
    : [];
  const rejectedProjectIds = rejectedProjects.map((project) => project?.projectId);
  if (
    rejectedProjects.some(
      (project) => (
        typeof project?.projectId !== 'string'
        || !catalogProjectIds.includes(project.projectId)
        || !REJECTION_REASONS.has(project?.reason)
      ),
    )
    || new Set(rejectedProjectIds).size !== rejectedProjectIds.length
    || !isSorted(rejectedProjectIds)
  ) {
    errors.push('snapshot rejectedProjects must use unique canonical ids and stable reasons');
  }
  const seenProjects = new Set();
  for (const review of reviews) {
    if (
      typeof review?.projectId !== 'string'
      || !review.projectId
      || seenProjects.has(review.projectId)
      || (catalogProjectIds.length > 0 && !catalogProjectIds.includes(review.projectId))
    ) {
      errors.push('snapshot reviews require unique canonical project ids');
    } else {
      seenProjects.add(review.projectId);
    }
    if (!SHA256_PATTERN.test(review?.receiptSha256 ?? '')) {
      errors.push(`${review?.projectId ?? 'unknown'} receipt hash is invalid`);
    }
    validateSnapshotScore(review?.critique, 'critique', review?.projectId, errors);
    validateSnapshotScore(review?.audit, 'audit', review?.projectId, errors);
    if (!OWNER_DECISIONS.has(review?.ownerDecision)) {
      errors.push(`${review?.projectId ?? 'unknown'} owner decision is invalid`);
    }
    const evidenceFiles = Array.isArray(review?.evidenceFiles)
      ? review.evidenceFiles
      : [];
    const evidencePaths = evidenceFiles.map((file) => file?.path);
    if (
      evidenceFiles.length === 0
      || new Set(evidencePaths).size !== evidencePaths.length
      || !isSorted(evidencePaths)
    ) {
      errors.push(`${review?.projectId ?? 'unknown'} evidence files must be unique and sorted`);
    }
    for (const file of evidenceFiles) {
      try {
        normalizeRelativePath(file?.path);
      } catch {
        errors.push(`${review?.projectId ?? 'unknown'} evidence path is invalid`);
      }
      if (!SHA256_PATTERN.test(file?.sha256 ?? '')) {
        errors.push(`${review?.projectId ?? 'unknown'} evidence hash is invalid`);
      }
    }
  }
  if (!isSorted(reviews.map((review) => review?.projectId ?? ''))) {
    errors.push('snapshot reviews must be sorted by project id');
  }
  if (reviews.some((review) => rejectedProjectIds.includes(review.projectId))) {
    errors.push('snapshot project cannot be both validated and invalid');
  }

  if (errors.length > 0) {
    throw new Error(`Design-review snapshot invalid:\n- ${errors.join('\n- ')}`);
  }
  return structuredClone(snapshot);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
  return resolved;
}

function parseJson(bytes, sourcePath) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid JSON at ${sourcePath}: ${error.message}`, { cause: error });
  }
}

function resolveProjectRoot(projectWorkspaceRoot, project) {
  if (project.id === 'fleet-workspace') {
    return path.resolve(
      projectWorkspaceRoot,
      'foundry/apps/dashboard/fleet-console',
    );
  }
  return path.resolve(projectWorkspaceRoot, project.repo);
}

function requiredEvidencePaths(receipt, policy) {
  const paths = new Set([
    receipt?.context?.product ?? 'PRODUCT.md',
    receipt?.context?.design ?? 'DESIGN.md',
  ]);
  if (receipt?.mode === 'preserve') paths.add(receipt?.direction?.before);
  if (receipt?.mode === 'overhaul') {
    for (const probe of receipt?.direction?.probes ?? []) paths.add(probe?.path);
  }
  for (const width of policy?.qualityGate?.requiredViewportWidths ?? []) {
    paths.add(
      (receipt?.evidence?.screenshots ?? [])
        .find((screenshot) => screenshot?.width === width)
        ?.path,
    );
  }
  return [...paths].map(normalizeRelativePath);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('evidence path is required');
  }
  const normalized = path.normalize(value);
  if (
    path.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`evidence path must stay relative: ${value}`);
  }
  return normalized.split(path.sep).join('/');
}

function validateSnapshotScore(score, label, projectId, errors) {
  if (
    !Number.isFinite(score?.score)
    || !Number.isFinite(score?.maximum)
    || score.maximum <= 0
    || score.score < 1
    || score.score > score.maximum
  ) {
    errors.push(`${projectId ?? 'unknown'} ${label} score is invalid`);
  }
}

function isSorted(values) {
  return values.every((value, index) => (
    index === 0 || String(values[index - 1]).localeCompare(String(value)) <= 0
  ));
}

function rejectionReason(error) {
  if (error?.name === 'DesignWorkflowError') return 'validation-failed';
  if (String(error?.message ?? '').startsWith('invalid JSON at ')) return 'invalid-json';
  return 'evidence-unreadable';
}
