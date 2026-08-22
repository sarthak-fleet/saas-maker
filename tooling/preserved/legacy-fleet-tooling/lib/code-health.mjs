import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const REPORT_SCHEMA_VERSION = 'fleet.code-health-report.v1';
export const POLICY_SCHEMA_VERSION = 'fleet.code-health-policy.v1';

export const CAPABILITY_IDS = [
  'format',
  'lint',
  'types',
  'tests',
  'unused',
  'complexity',
  'duplication',
  'coverage',
  'dependency-risk',
  'cycles',
  'suppressions',
  'repository-hygiene',
];

export const PROFILE_IDS = [
  'javascript-typescript',
  'python',
  'rust',
  'go',
  'swift-native',
  'mixed',
  'content-config',
];

const RESULT_STATES = [
  'pass',
  'fail',
  'warning',
  'unavailable',
  'not-applicable',
  'excluded',
];

const MAINTAINED_TIERS = new Set(['focus', 'active', 'secondary']);
const TIER_ORDER = new Map([
  ['focus', 0],
  ['active', 1],
  ['secondary', 2],
]);
const IGNORED_DIRECTORIES = new Set([
  '.astro',
  '.build',
  '.cache',
  '.git',
  '.next',
  '.open-next',
  '.wrangler',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'releases',
  'tmp',
]);
const MARKER_NAMES = new Set([
  '.jscpd.json',
  '.jscpd.jsonc',
  '.periphery.yml',
  '.periphery.yaml',
  '.ruff.toml',
  'Cargo.toml',
  'Package.swift',
  'biome.json',
  'biome.jsonc',
  'eslint.config.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  'go.mod',
  'knip.config.cjs',
  'knip.config.js',
  'knip.config.mjs',
  'knip.config.ts',
  'knip.json',
  'knip.jsonc',
  'oxlint.config.ts',
  'package.json',
  'pyproject.toml',
  'ruff.toml',
  'tsconfig.json',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.ts',
]);

const requiredTargetRules = {
  cognitiveComplexity: { minimum: 1 },
  changedLineCoveragePercent: { minimum: 0, maximum: 100 },
  newProjectLineCoveragePercent: { minimum: 0, maximum: 100 },
  newProjectFunctionCoveragePercent: { minimum: 0, maximum: 100 },
  newProjectStatementCoveragePercent: { minimum: 0, maximum: 100 },
  newProjectBranchCoveragePercent: { minimum: 0, maximum: 100 },
  newDependencyCycles: { minimum: 0 },
  criticalVulnerabilities: { minimum: 0 },
  highVulnerabilities: { minimum: 0 },
  duplicationRegressionPercent: { minimum: 0 },
};

const pathExists = async (candidate) => access(candidate).then(
  () => true,
  () => false,
);

const stableUnique = (values) => [...new Set(values)].sort((left, right) => (
  left.localeCompare(right)
));

const isPlainObject = (value) => Boolean(
  value && typeof value === 'object' && !Array.isArray(value),
);

const normalizedDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ''))) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
};

const isMaintainedProject = (project) => (
  project?.lifecycle === 'maintained' && MAINTAINED_TIERS.has(project?.tier)
);

export function adoptionSequence(projects) {
  return projects
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => isMaintainedProject(project))
    .sort((left, right) => (
      (TIER_ORDER.get(left.project.tier) ?? Number.MAX_SAFE_INTEGER)
        - (TIER_ORDER.get(right.project.tier) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
      || left.project.id.localeCompare(right.project.id)
    ))
    .map(({ project }) => project.id);
}

function validateStringArray(value, label, allowed, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      errors.push(`${label} must contain non-empty strings`);
      continue;
    }
    if (allowed && !allowed.has(item)) {
      errors.push(`${label} contains unknown capability ${item}`);
      continue;
    }
    normalized.push(item);
  }
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${label} contains duplicate values`);
  }
  return normalized;
}

export function validateCodeHealthPolicy({
  policy,
  projects,
  today = new Date().toISOString().slice(0, 10),
}) {
  const errors = [];
  if (!isPlainObject(policy)) {
    return { ok: false, errors: ['code-health policy must be an object'] };
  }
  if (policy.$schema !== POLICY_SCHEMA_VERSION) {
    errors.push(`policy $schema must be ${POLICY_SCHEMA_VERSION}`);
  }

  const capabilities = validateStringArray(
    policy.capabilities,
    'policy.capabilities',
    null,
    errors,
  );
  if (JSON.stringify(capabilities) !== JSON.stringify(CAPABILITY_IDS)) {
    errors.push(`policy.capabilities must equal ${CAPABILITY_IDS.join(', ')}`);
  }
  const capabilitySet = new Set(capabilities);

  if (!isPlainObject(policy.targets)) {
    errors.push('policy.targets must be an object');
  } else {
    const actualTargetIds = Object.keys(policy.targets).sort();
    const expectedTargetIds = Object.keys(requiredTargetRules).sort();
    if (JSON.stringify(actualTargetIds) !== JSON.stringify(expectedTargetIds)) {
      errors.push(`policy.targets must define exactly ${expectedTargetIds.join(', ')}`);
    }
    for (const [target, rule] of Object.entries(requiredTargetRules)) {
      const value = policy.targets[target];
      if (!Number.isFinite(value)) {
        errors.push(`policy.targets.${target} must be a finite number`);
        continue;
      }
      if (value < rule.minimum || (rule.maximum !== undefined && value > rule.maximum)) {
        errors.push(`policy.targets.${target} is outside its allowed range`);
      }
    }
  }

  if (!isPlainObject(policy.profiles)) {
    errors.push('policy.profiles must be an object');
  } else {
    const actualProfiles = Object.keys(policy.profiles).sort();
    const expectedProfiles = [...PROFILE_IDS].sort();
    if (JSON.stringify(actualProfiles) !== JSON.stringify(expectedProfiles)) {
      errors.push(`policy.profiles must define exactly ${expectedProfiles.join(', ')}`);
    }
    for (const profileId of PROFILE_IDS) {
      const profile = policy.profiles[profileId];
      if (!isPlainObject(profile)) {
        errors.push(`policy.profiles.${profileId} must be an object`);
        continue;
      }
      const required = validateStringArray(
        profile.required,
        `policy.profiles.${profileId}.required`,
        capabilitySet,
        errors,
      );
      const advisory = validateStringArray(
        profile.advisory,
        `policy.profiles.${profileId}.advisory`,
        capabilitySet,
        errors,
      );
      const overlap = required.filter((capability) => advisory.includes(capability));
      if (overlap.length > 0) {
        errors.push(`policy.profiles.${profileId} repeats ${overlap.join(', ')} across required and advisory`);
      }
    }
  }

  const registryProjects = new Map(projects.map((project) => [project.id, project]));
  const maintainedIds = projects.filter(isMaintainedProject).map((project) => project.id).sort();
  const configuredProjects = isPlainObject(policy.projects) ? policy.projects : {};
  if (!isPlainObject(policy.projects)) errors.push('policy.projects must be an object');
  const configuredIds = Object.keys(configuredProjects).sort();
  if (JSON.stringify(configuredIds) !== JSON.stringify(maintainedIds)) {
    const missing = maintainedIds.filter((id) => !configuredIds.includes(id));
    const extra = configuredIds.filter((id) => !maintainedIds.includes(id));
    if (missing.length > 0) errors.push(`policy.projects is missing maintained projects: ${missing.join(', ')}`);
    if (extra.length > 0) errors.push(`policy.projects includes non-maintained or unknown projects: ${extra.join(', ')}`);
  }

  for (const [projectId, projectPolicy] of Object.entries(configuredProjects)) {
    if (!registryProjects.has(projectId)) continue;
    if (!isPlainObject(projectPolicy)) {
      errors.push(`policy.projects.${projectId} must be an object`);
      continue;
    }
    if (!PROFILE_IDS.includes(projectPolicy.profile)) {
      errors.push(`policy.projects.${projectId}.profile is unknown`);
    }
    if (
      projectPolicy.evidenceRoot !== undefined
      && (
        typeof projectPolicy.evidenceRoot !== 'string'
        || projectPolicy.evidenceRoot.length === 0
        || path.isAbsolute(projectPolicy.evidenceRoot)
      )
    ) {
      errors.push(`policy.projects.${projectId}.evidenceRoot must be a non-empty relative path`);
    }
    if (projectPolicy.equivalents !== undefined) {
      if (!isPlainObject(projectPolicy.equivalents)) {
        errors.push(`policy.projects.${projectId}.equivalents must be an object`);
      } else {
        for (const [capability, reason] of Object.entries(projectPolicy.equivalents)) {
          if (!capabilitySet.has(capability)) {
            errors.push(`policy.projects.${projectId}.equivalents contains unknown capability ${capability}`);
          }
          if (typeof reason !== 'string' || reason.trim().length < 10) {
            errors.push(`policy.projects.${projectId}.equivalents.${capability} needs a concrete reason`);
          }
        }
      }
    }
  }

  const exceptionIds = new Set();
  const exceptionKeys = new Set();
  if (!Array.isArray(policy.exceptions)) {
    errors.push('policy.exceptions must be an array');
  } else {
    for (const [index, exception] of policy.exceptions.entries()) {
      const label = `policy.exceptions[${index}]`;
      if (!isPlainObject(exception)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      for (const field of ['id', 'projectId', 'capability', 'reason', 'owner', 'issue', 'reviewDate']) {
        if (typeof exception[field] !== 'string' || exception[field].trim().length === 0) {
          errors.push(`${label}.${field} must be a non-empty string`);
        }
      }
      if (!Object.hasOwn(exception, 'accepted')) {
        errors.push(`${label}.accepted is required`);
      }
      if (exceptionIds.has(exception.id)) errors.push(`${label}.id duplicates ${exception.id}`);
      exceptionIds.add(exception.id);
      const key = `${exception.projectId}:${exception.capability}`;
      if (exceptionKeys.has(key)) errors.push(`${label} duplicates ${key}`);
      exceptionKeys.add(key);
      if (!maintainedIds.includes(exception.projectId)) {
        errors.push(`${label}.projectId must reference a maintained project`);
      }
      if (!capabilitySet.has(exception.capability)) {
        errors.push(`${label}.capability is unknown`);
      }
      if (typeof exception.reason === 'string' && exception.reason.trim().length < 20) {
        errors.push(`${label}.reason must explain the accepted debt`);
      }
      if (
        typeof exception.issue === 'string'
        && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/u.test(exception.issue)
      ) {
        errors.push(`${label}.issue must be a GitHub issue URL`);
      }
      const reviewDate = normalizedDate(exception.reviewDate);
      if (!reviewDate) errors.push(`${label}.reviewDate must be an ISO date`);
      else if (reviewDate < today) errors.push(`${label}.reviewDate expired on ${reviewDate}`);
    }
  }

  validateStringArray(policy.trendMetrics, 'policy.trendMetrics', null, errors);
  return { ok: errors.length === 0, errors };
}

async function collectMarkerFiles(root, maximumDepth = 4) {
  const markers = [];
  const visit = async (directory, depth) => {
    if (depth > maximumDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.endsWith('.xcodeproj')) {
          const projectFile = path.join(candidate, 'project.pbxproj');
          if (await pathExists(projectFile)) markers.push(projectFile);
          continue;
        }
        await visit(candidate, depth + 1);
      } else if (MARKER_NAMES.has(entry.name)) {
        markers.push(candidate);
      }
    }
  };
  await visit(root, 0);
  return markers.sort((left, right) => left.localeCompare(right));
}

async function readableText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function hasGitBoundary(startDirectory) {
  let current = startDirectory;
  while (true) {
    if (await pathExists(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function recordEvidence(evidence, capability, source) {
  if (!evidence.has(capability)) evidence.set(capability, []);
  evidence.get(capability).push(source);
}

function packageEvidence(relativePath, content, evidence) {
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    return;
  }
  const scripts = isPlainObject(manifest.scripts) ? manifest.scripts : {};
  const dependencies = {
    ...(isPlainObject(manifest.dependencies) ? manifest.dependencies : {}),
    ...(isPlainObject(manifest.devDependencies) ? manifest.devDependencies : {}),
  };
  const command = Object.entries(scripts)
    .map(([name, value]) => `${name} ${String(value)}`)
    .join('\n');
  const packages = Object.keys(dependencies).join('\n');
  const source = `${relativePath} package scripts`;

  if (
    typeof scripts['format:check'] === 'string'
    || /(?:biome\s+check|prettier\s+--check|ruff\s+format\s+--check|swiftformat\s+--lint)/u.test(command)
  ) recordEvidence(evidence, 'format', source);
  if (
    typeof scripts.lint === 'string'
    || /(?:biome\s+(?:check|lint)|eslint|oxlint|ruff\s+check|cargo\s+clippy|go\s+vet|swiftlint)/u.test(command)
  ) recordEvidence(evidence, 'lint', source);
  if (
    typeof scripts.typecheck === 'string'
    || /(?:tsc\b|astro\s+check|cargo\s+(?:check|clippy)|go\s+(?:build|test|vet)|swift\s+(?:build|test)|xcodebuild)/u.test(command)
  ) recordEvidence(evidence, 'types', source);
  if (typeof scripts.test === 'string' || /(?:vitest|jest|pytest|cargo\s+test|go\s+test|swift\s+test|xcodebuild.+test)/u.test(command)) {
    recordEvidence(evidence, 'tests', source);
  }
  if (
    typeof scripts.knip === 'string'
    || typeof scripts['knip:strict'] === 'string'
    || typeof scripts['quality:unused'] === 'string'
    || Object.hasOwn(dependencies, 'knip')
    || /(?:ruff[^\n]*F401|\bvulture\b|\bperiphery\b)/u.test(command)
  ) recordEvidence(evidence, 'unused', source);
  if (
    typeof scripts['quality:complexity'] === 'string'
    || /noExcessiveCognitiveComplexity|max-complexity|cognitive.?complexity|ruff.+C90/u.test(command)
  ) {
    recordEvidence(evidence, 'complexity', source);
  }
  if (/\bjscpd\b|sonar/u.test(`${command}\n${packages}`)) recordEvidence(evidence, 'duplication', source);
  if (typeof scripts['test:coverage'] === 'string' || /(?:--coverage|\bc8\b|\bnyc\b|llvm-cov|pytest-cov|go\s+test.+-cover|xccov)/u.test(command)) {
    recordEvidence(evidence, 'coverage', source);
  }
  if (
    typeof scripts['quality:cycles'] === 'string'
    || /\bmadge\b|dependency-cruiser|\bdpdm\b|circular-dependency/u.test(`${command}\n${packages}`)
  ) {
    recordEvidence(evidence, 'cycles', source);
  }
  recordEvidence(evidence, 'dependency-risk', `${relativePath} dependency manifest`);
}

function pyprojectEvidence(relativePath, content, evidence) {
  if (/ruff\s+format\s+--check/u.test(content) || /\[tool\.ruff\]/u.test(content)) {
    recordEvidence(evidence, 'format', `${relativePath} python formatter configuration`);
  }
  if (/ruff\s+check(?:\s|$)/u.test(content) || /\[tool\.ruff\.lint\]/u.test(content)) {
    recordEvidence(evidence, 'lint', `${relativePath} python lint configuration`);
  }
  if (
    /\bpytest\b/u.test(content)
    && /optional-dependencies|dependency-groups|(?:^|\n)dev\s*=|\baddopts\b/u.test(content)
  ) {
    recordEvidence(evidence, 'tests', `${relativePath} python test configuration`);
  }
  if (/\bpytest-cov\b|--cov\b/u.test(content)) {
    recordEvidence(evidence, 'coverage', `${relativePath} python coverage configuration`);
  }
  if (/\bC90\b|max-complexity/u.test(content)) {
    recordEvidence(evidence, 'complexity', `${relativePath} python complexity configuration`);
  }
}

function markerEvidence(relativePath, name, content, evidence) {
  if (name === 'pyproject.toml') pyprojectEvidence(relativePath, content, evidence);
  if (name === 'ruff.toml' || name === '.ruff.toml') {
    recordEvidence(evidence, 'format', `${relativePath} python formatter configuration`);
  }
  if (/^(?:biome\.jsonc?|eslint\.config\.|oxlint\.config\.|\.ruff\.toml$|ruff\.toml$)/u.test(name)) {
    recordEvidence(evidence, 'lint', `${relativePath} lint configuration`);
  }
  if (name === 'tsconfig.json' || ['Cargo.toml', 'go.mod', 'Package.swift'].includes(name)) {
    recordEvidence(evidence, 'types', `${relativePath} native compiler configuration`);
  }
  if (name === 'project.pbxproj') {
    recordEvidence(evidence, 'types', `${relativePath} Xcode project`);
    recordEvidence(evidence, 'tests', `${relativePath} Xcode test boundary`);
  }
  if (
    name.startsWith('knip.')
    || name.startsWith('knip.config.')
    || name === '.periphery.yml'
    || name === '.periphery.yaml'
    || /\bvulture\b|cargo-machete/u.test(content)
  ) recordEvidence(evidence, 'unused', `${relativePath} unused-code configuration`);
  if (
    /noExcessiveCognitiveComplexity|maxAllowedComplexity|max-complexity|mccabe|C90/u.test(content)
    || /ultracite\/(?:biome|eslint|oxlint)\//u.test(content)
    || /ops\/templates\/biome\.base\.json/u.test(content)
  ) recordEvidence(evidence, 'complexity', `${relativePath} complexity configuration`);
  if (name.startsWith('.jscpd.') || /\bjscpd\b|sonar\.cpd/u.test(content)) {
    recordEvidence(evidence, 'duplication', `${relativePath} duplication configuration`);
  }
  if (/\bcoverage\b|thresholds/u.test(content) && /vitest|pytest|llvm-cov|xccov|go\s+test/u.test(content)) {
    recordEvidence(evidence, 'coverage', `${relativePath} coverage configuration`);
  }
  if (/\bmadge\b|dependency-cruiser|\bdpdm\b|circular-dependency/u.test(content)) {
    recordEvidence(evidence, 'cycles', `${relativePath} cycle configuration`);
  }
  if (['pyproject.toml', 'Cargo.toml', 'go.mod', 'Package.swift'].includes(name)) {
    recordEvidence(evidence, 'dependency-risk', `${relativePath} dependency manifest`);
  }
  if (
    name === 'Package.swift'
    || name === 'Cargo.toml'
    || name === 'go.mod'
    || /(?:^|\/)Tests?(?:\/|$)/u.test(relativePath)
  ) recordEvidence(evidence, 'tests', `${relativePath} native test boundary`);
}

export async function discoverCodeHealthCapabilities({ repositoryRoot }) {
  const markers = await collectMarkerFiles(repositoryRoot);
  const evidence = new Map();
  for (const marker of markers) {
    const relativePath = path.relative(repositoryRoot, marker) || path.basename(marker);
    const name = path.basename(marker);
    const content = await readableText(marker);
    if (name === 'package.json') packageEvidence(relativePath, content, evidence);
    if (name === 'pyproject.toml') pyprojectEvidence(relativePath, content, evidence);
    markerEvidence(relativePath, name, content, evidence);
  }

  if (await hasGitBoundary(repositoryRoot)) {
    recordEvidence(evidence, 'repository-hygiene', 'git diff --check');
    recordEvidence(evidence, 'suppressions', 'Fleet changed-source suppression review');
  }

  return Object.fromEntries(CAPABILITY_IDS.map((capability) => [
    capability,
    stableUnique(evidence.get(capability) ?? []),
  ]));
}

function exceptionIndex(exceptions) {
  return new Map(exceptions.map((exception) => [
    `${exception.projectId}:${exception.capability}`,
    exception,
  ]));
}

function coverageResult({ capability, disposition, sources, equivalent, exception }) {
  if (disposition === 'not-applicable') {
    return {
      capability,
      disposition,
      status: 'not-applicable',
      evidenceKind: 'policy',
      sources: [],
      reason: 'Profile does not apply this capability',
    };
  }
  if (equivalent) {
    return {
      capability,
      disposition,
      status: 'pass',
      evidenceKind: 'configured-equivalent',
      sources: [equivalent],
      reason: 'Approved ecosystem-native equivalent is configured',
    };
  }
  if (sources.length > 0) {
    return {
      capability,
      disposition,
      status: 'pass',
      evidenceKind: 'configured',
      sources,
      reason: 'Repository-native coverage path discovered; execution not asserted',
    };
  }
  if (exception) {
    return {
      capability,
      disposition,
      status: 'warning',
      evidenceKind: 'exception',
      sources: [exception.issue],
      reason: `${exception.reason} (review ${exception.reviewDate})`,
    };
  }
  return {
    capability,
    disposition,
    status: disposition === 'required' ? 'unavailable' : 'warning',
    evidenceKind: 'missing',
    sources: [],
    reason: disposition === 'required'
      ? 'Required repository-native coverage was not discovered'
      : 'Advisory repository-native coverage was not discovered',
  };
}

function summarizeProject(capabilities) {
  if (capabilities.some((item) => item.status === 'fail')) return 'fail';
  if (capabilities.some((item) => item.status === 'unavailable')) return 'unavailable';
  if (capabilities.some((item) => item.status === 'warning')) return 'warning';
  return 'pass';
}

function statusCounts(projects) {
  return Object.fromEntries(RESULT_STATES.map((status) => [
    status,
    projects.filter((project) => project.status === status).length,
  ]));
}

export async function buildCodeHealthReport({
  policy,
  projects,
  workspaceRoot,
  projectIds = [],
  today = new Date().toISOString().slice(0, 10),
}) {
  const validation = validateCodeHealthPolicy({ policy, projects, today });
  if (!validation.ok) {
    const error = new Error(`Invalid code-health policy:\n${validation.errors.join('\n')}`);
    error.code = 'ERR_CODE_HEALTH_POLICY';
    error.validation = validation;
    throw error;
  }

  const selectedIds = new Set(projectIds);
  const unknownSelections = projectIds.filter((id) => !projects.some((project) => project.id === id));
  if (unknownSelections.length > 0) {
    throw new Error(`Unknown project selection: ${unknownSelections.join(', ')}`);
  }
  const exceptions = exceptionIndex(policy.exceptions);
  const results = [];

  for (const project of [...projects].sort((left, right) => left.id.localeCompare(right.id))) {
    if (selectedIds.size > 0 && !selectedIds.has(project.id)) continue;
    const relativeCheckout = project.sourcePath ?? project.repo ?? null;
    if (!isMaintainedProject(project)) {
      results.push({
        id: project.id,
        tier: project.tier,
        lifecycle: project.lifecycle,
        profile: null,
        repositoryPath: relativeCheckout,
        status: 'excluded',
        coverageMode: 'configuration',
        capabilities: [],
        reason: project.lifecycle === 'past'
          ? 'Lifecycle past is outside maintained enforcement'
          : `Tier ${project.tier} is outside maintained enforcement`,
      });
      continue;
    }

    const projectPolicy = policy.projects[project.id];
    const profile = policy.profiles[projectPolicy.profile];
    const checkout = relativeCheckout ? path.resolve(workspaceRoot, relativeCheckout) : null;
    const evidenceRoot = checkout
      ? path.resolve(checkout, projectPolicy.evidenceRoot ?? '.')
      : null;
    const available = Boolean(evidenceRoot && await pathExists(evidenceRoot));
    const discovered = available
      ? await discoverCodeHealthCapabilities({ repositoryRoot: evidenceRoot })
      : Object.fromEntries(CAPABILITY_IDS.map((capability) => [capability, []]));
    const required = new Set(profile.required);
    const advisory = new Set(profile.advisory);
    const capabilities = CAPABILITY_IDS.map((capability) => {
      const disposition = required.has(capability)
        ? 'required'
        : advisory.has(capability) ? 'advisory' : 'not-applicable';
      return coverageResult({
        capability,
        disposition,
        sources: discovered[capability],
        equivalent: projectPolicy.equivalents?.[capability],
        exception: exceptions.get(`${project.id}:${capability}`),
      });
    });
    const status = available ? summarizeProject(capabilities) : 'unavailable';
    results.push({
      id: project.id,
      tier: project.tier,
      lifecycle: project.lifecycle,
      profile: projectPolicy.profile,
      repositoryPath: relativeCheckout,
      evidenceRoot: available ? path.relative(workspaceRoot, evidenceRoot) || '.' : null,
      status,
      coverageMode: 'configuration',
      capabilities,
      reason: available
        ? 'Coverage inventory only; configured paths are not executed proof'
        : 'Registered evidence root is unavailable',
    });
  }

  const counts = statusCounts(results);
  const maintainedTotal = results.filter((project) => project.status !== 'excluded').length;
  const ok = counts.fail === 0 && counts.unavailable === 0;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    ok,
    coverageMode: 'configuration',
    summary: {
      maintainedTotal,
      excludedTotal: counts.excluded,
      counts,
    },
    adoptionSequence: adoptionSequence(projects).filter((id) => (
      selectedIds.size === 0 || selectedIds.has(id)
    )),
    projects: results,
  };
}

export function reportExitCode(report, { strict = false } = {}) {
  if (!strict) return 0;
  return report.ok ? 0 : 1;
}
