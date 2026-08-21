/**
 * Bounded quiet experiment validation for the Significant Hobbies Toolbox
 * family.
 *
 * Implements the spec requirement "Quiet experiment boundaries": experiments
 * MAY run, but automation MUST respect review approval, expiry, stop rules,
 * and no automatic roadmap/promotion. Missing attribution or unmet threshold
 * at expiry stops the experiment and records an inconclusive result.
 *
 * This module is pure validation — it does not start, schedule, or publish
 * anything. It returns a verdict that callers (the CLI, tests, the Foundry
 * marketing control plane) use to decide whether to allow or stop an
 * experiment.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_EXPERIMENT_FIELDS } from './registry.mjs';

export const EXPERIMENT_OUTCOME = Object.freeze({
  APPROVED: 'approved',
  RUNNING: 'running',
  STOPPED: 'stopped',
  EXPIRED: 'expired',
  INCONCLUSIVE: 'inconclusive',
  REJECTED: 'rejected',
});

/**
 * Validate a single experiment definition against the family policy.
 *
 * @param {object} registry validated registry
 * @param {object} experiment
 * @param {object} [context]
 * @param {string|Date} [context.now]
 * @param {boolean} [context.reviewApproved] explicit human approval
 * @returns {{ outcome: string, experiment: object, reasons: string[], stops: string[] }}
 */
export function validateExperiment(registry, experiment, context = {}) {
  if (!experiment || typeof experiment !== 'object') {
    return reject('experiment must be an object');
  }
  const policy = registry.experiments;
  const reasons = []; // definition-validity problems → REJECTED
  const stops = []; // policy-gate stops → STOPPED

  // Required fields — definition validity
  for (const field of policy.requiredFields) {
    if (experiment[field] == null || experiment[field] === '') {
      reasons.push(`missing-required-field:${field}`);
    }
  }
  if (reasons.length) return reject(reasons);

  // Owner must be a known product owner — definition validity
  const owners = new Set(registry.products.map((p) => p.owner));
  if (!owners.has(experiment.owner)) {
    reasons.push(`owner-not-in-family:${experiment.owner}`);
  }

  // No paid marketing — definition validity (a paid experiment is never
  // acceptable under the family policy, regardless of approval state)
  if (policy.noPaidMarketing && experiment.budget?.paid === true) {
    reasons.push('paid-marketing-forbidden');
  }

  // Date parsing — definition validity
  const now = context.now ?? new Date();
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  const startMs = parseDate(experiment.start);
  const expiryMs = parseDate(experiment.expiry);
  if (startMs == null) reasons.push('start-not-a-date');
  if (expiryMs == null) reasons.push('expiry-not-a-date');
  if (startMs != null && expiryMs != null && expiryMs <= startMs) {
    reasons.push('expiry-must-be-after-start');
  }

  // Stop rule must be a non-empty string — definition validity
  if (typeof experiment.stopRule !== 'string' || !experiment.stopRule.trim()) {
    reasons.push('stop-rule-empty');
  }

  // Attribution key must be declared and non-empty — definition validity
  if (typeof experiment.attributionKey !== 'string' || !experiment.attributionKey.trim()) {
    reasons.push('attribution-key-empty');
  }

  if (reasons.length) return reject(reasons);

  // Approval gate — policy gate, not a definition problem. An unapproved but
  // well-formed experiment is STOPPED, not rejected.
  const reviewApproved = context.reviewApproved === true;
  if (policy.requireApproval && !reviewApproved) {
    stops.push('pending-review-approval');
    return {
      outcome: EXPERIMENT_OUTCOME.STOPPED,
      experiment,
      reasons,
      stops,
    };
  }

  // Expiry enforcement — auto-expiry is mandatory under the family policy.
  const expired = nowMs >= expiryMs;
  if (expired) {
    stops.push('auto-expiry-reached');
    if (policy.inconclusiveConditions.includes('threshold-unmet-at-expiry')) {
      const met = meetsThreshold(experiment, context);
      if (!met) {
        stops.push('threshold-unmet-at-expiry');
        return {
          outcome: EXPERIMENT_OUTCOME.INCONCLUSIVE,
          experiment,
          reasons,
          stops,
        };
      }
    }
    return {
      outcome: EXPERIMENT_OUTCOME.EXPIRED,
      experiment,
      reasons,
      stops,
    };
  }

  // Inconclusive on missing attribution at any point during the run.
  if (policy.inconclusiveConditions.includes('missing-attribution') &&
      !hasAttributionSignal(experiment, context)) {
    stops.push('missing-attribution');
    return {
      outcome: EXPERIMENT_OUTCOME.INCONCLUSIVE,
      experiment,
      reasons,
      stops,
    };
  }

  // No automatic promotion — even a successful experiment cannot reclassify
  // a Toolbox project or create a roadmap. The verdict records a
  // recommendation only.
  if (context.thresholdMet === true) {
    return {
      outcome: EXPERIMENT_OUTCOME.RUNNING,
      experiment,
      reasons,
      stops,
      recommendation: 'promotion-recommendation-for-sarthak-decision',
      noAutomaticPromotion: policy.noAutomaticPromotion,
    };
  }

  return {
    outcome: EXPERIMENT_OUTCOME.RUNNING,
    experiment,
    reasons,
    stops,
  };

  function reject(extra) {
    const all = Array.isArray(extra) ? extra : [extra];
    return {
      outcome: EXPERIMENT_OUTCOME.REJECTED,
      experiment,
      reasons: all,
      stops: all,
    };
  }
}

/**
 * Validate a batch of experiments and return per-experiment verdicts plus a
 * family-level summary. Enforces no-automatic-replacement: an expired or
 * inconclusive experiment does NOT create a replacement campaign.
 *
 * @param {object} registry
 * @param {Array<object>} experiments
 * @param {object} [context]
 * @returns {{ verdicts: Array<object>, summary: object }}
 */
export function validateExperiments(registry, experiments, context = {}) {
  const verdicts = (Array.isArray(experiments) ? experiments : []).map((exp) =>
    validateExperiment(registry, exp, context)
  );
  const byOutcome = new Map();
  for (const v of verdicts) {
    byOutcome.set(v.outcome, (byOutcome.get(v.outcome) ?? 0) + 1);
  }
  const replacementCampaignsCreated = 0; // always zero — policy enforces this
  return {
    verdicts,
    summary: {
      total: verdicts.length,
      byOutcome: Object.fromEntries(byOutcome),
      replacementCampaignsCreated,
      noAutomaticReplacement: registry.experiments.noAutomaticReplacement,
    },
  };
}

function parseDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function meetsThreshold(experiment, context) {
  if (typeof context.thresholdMet === 'boolean') return context.thresholdMet;
  if (typeof experiment.successMetric?.threshold === 'number' &&
      typeof experiment.successMetric?.observed === 'number') {
    return experiment.successMetric.observed >= experiment.successMetric.threshold;
  }
  return false;
}

function hasAttributionSignal(experiment, context) {
  if (typeof context.attributionPresent === 'boolean') return context.attributionPresent;
  return typeof experiment.attributionKey === 'string' && experiment.attributionKey.trim().length > 0;
}

/**
 * Persist an experiment verdict as a durable receipt file.
 *
 * The receipt links the verdict to the exact project, asset, channel,
 * attribution key, and time window so outcome measurement can be audited
 * without re-running the experiment. Receipts are append-only — each
 * verdict gets its own file named by timestamp and experiment ID.
 *
 * @param {object} verdict from validateExperiment or validateExperiments
 * @param {object} [options]
 * @param {string} [options.receiptDir] directory to write receipts into
 * @returns {string|null} receipt path or null if not written
 */
export function persistExperimentReceipt(verdict, options = {}) {
  if (!verdict || !verdict.experiment) return null;
  const dir = options.receiptDir;
  if (!dir) return null;
  const exp = verdict.experiment;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = exp.id || exp.attributionKey || 'unknown';
  const receipt = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    experimentId: id,
    project: exp.project || null,
    attributionKey: exp.attributionKey || null,
    channel: exp.channel || null,
    asset: exp.approvedAsset || null,
    start: exp.start || null,
    expiry: exp.expiry || null,
    outcome: verdict.outcome,
    stops: verdict.stops || [],
    reasons: verdict.reasons || [],
    recommendation: verdict.recommendation || null,
    noAutomaticPromotion: verdict.noAutomaticPromotion ?? null,
    successMetric: exp.successMetric || null,
  };
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${ts}-${id}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  return path;
}
