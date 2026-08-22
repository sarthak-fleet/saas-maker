/**
 * Per-source evidence adapters for the fleet automation coverage loop.
 *
 * Each adapter is a pure transformation function: it accepts raw data from an
 * existing Fleet script, API response, or artifact file and returns an array
 * of normalized evidence records via `normalizeEvidence`.
 *
 * Adapters do NOT re-run expensive operations, require credentials, or mutate
 * production state. They consume already-generated artifacts so the coverage
 * command can fold them into the report without live provider fan-out.
 *
 * Usage:
 *   import { githubActionsAdapter, cloudflareDeployAdapter, ... } from './adapters.mjs';
 *   const records = githubActionsAdapter(workflowRuns, entry);
 */
import { normalizeEvidence } from './evidence.mjs';

/**
 * GitHub Actions workflow run → build/release evidence.
 *
 * @param {Array<{id:number,name:string,conclusion:string,created_at:string,head_sha:string,html_url:string}>} runs
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function githubActionsAdapter(runs, entry) {
  if (!Array.isArray(runs) || !runs.length) return [];
  const latest = runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const pass = latest.conclusion === 'success';
  return [normalizeEvidence({
    projectId: entry.id,
    contract: 'build',
    source: 'github-actions',
    observedAt: latest.created_at,
    status: pass ? 'pass' : 'fail',
    summary: `Workflow "${latest.name}" ${latest.conclusion}`,
    reference: latest.html_url,
    revision: latest.head_sha,
    details: { runId: latest.id, conclusion: latest.conclusion }
  })];
}

/**
 * Cloudflare resilience audit JSON → deploy/live/errors evidence.
 *
 * Consumes the JSON output of `cloudflare-resilience-audit.mjs --json`.
 *
 * @param {object} audit parsed resilience audit JSON
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function cloudflareDeployAdapter(audit, entry) {
  const records = [];
  if (!audit || typeof audit !== 'object') return records;
  const domains = audit.domains || [];
  const projectDomains = domains.filter((d) => {
    if (!d || !d.url) return false;
    return (entry.surfaces || []).some((s) => {
      try { return new URL(s).hostname === new URL(d.url).hostname; }
      catch { return false; }
    });
  });
  for (const dom of projectDomains) {
    const status = dom.status && dom.healthy ? 'pass' : dom.status ? 'fail' : 'blocked';
    records.push(normalizeEvidence({
      projectId: entry.id,
      contract: 'live',
      source: 'cloudflare-resilience',
      observedAt: dom.checkedAt || audit.generatedAt,
      status,
      summary: `${dom.url} → HTTP ${dom.status ?? 'unreachable'}`,
      reference: dom.url,
      details: { statusCode: dom.status, healthy: dom.healthy }
    }));
  }
  const findings = (audit.findings || []).filter((f) => {
    if (!f || !f.project) return false;
    return f.project === entry.id || f.project === entry.repository;
  });
  for (const finding of findings) {
    if (finding.severity === 'high' || finding.severity === 'medium') {
      records.push(normalizeEvidence({
        projectId: entry.id,
        contract: 'errors',
        source: 'cloudflare-resilience',
        observedAt: finding.observedAt || audit.generatedAt,
        status: 'fail',
        summary: `${finding.severity}: ${finding.title}`,
        reference: finding.reference || null,
        details: { severity: finding.severity, category: finding.category }
      }));
    }
  }
  return records;
}

/**
 * Live HTTP smoke probe results → live evidence.
 *
 * @param {Array<{url:string,status:number,ok:boolean,checkedAt:string}>} probes
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function liveSmokeAdapter(probes, entry) {
  if (!Array.isArray(probes)) return [];
  const records = [];
  for (const probe of probes) {
    if (!probe || !probe.url) continue;
    const matches = (entry.surfaces || []).some((s) => {
      try { return new URL(s).hostname === new URL(probe.url).hostname; }
      catch { return false; }
    });
    if (!matches) continue;
    records.push(normalizeEvidence({
      projectId: entry.id,
      contract: 'live',
      source: 'live-smoke',
      observedAt: probe.checkedAt,
      status: probe.ok ? 'pass' : 'fail',
      summary: `${probe.url} → HTTP ${probe.status ?? 'unreachable'}`,
      reference: probe.url,
      details: { statusCode: probe.status, ok: probe.ok }
    }));
  }
  return records;
}

/**
 * Site-health scorecard JSON → indexing/live evidence.
 *
 * Consumes the JSON output of `site-health-scorecard.mjs --json` (when
 * available) or a per-product scorecard object.
 *
 * @param {object} scorecard per-product scorecard with indexing/live fields
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function siteHealthAdapter(scorecard, entry) {
  if (!scorecard || typeof scorecard !== 'object') return [];
  const records = [];
  if (scorecard.indexing) {
    records.push(normalizeEvidence({
      projectId: entry.id,
      contract: 'indexing',
      source: 'site-health',
      observedAt: scorecard.observedAt || scorecard.indexing.checkedAt,
      status: scorecard.indexing.status || (scorecard.indexing.pass ? 'pass' : 'fail'),
      summary: scorecard.indexing.summary || `Indexing ${scorecard.indexing.pass ? 'healthy' : 'issues'}`,
      reference: scorecard.indexing.reference || null
    }));
  }
  if (scorecard.live) {
    records.push(normalizeEvidence({
      projectId: entry.id,
      contract: 'live',
      source: 'site-health',
      observedAt: scorecard.observedAt || scorecard.live.checkedAt,
      status: scorecard.live.status || (scorecard.live.pass ? 'pass' : 'fail'),
      summary: scorecard.live.summary || `Live probe ${scorecard.live.pass ? 'healthy' : 'failed'}`,
      reference: scorecard.live.reference || null
    }));
  }
  return records;
}

/**
 * Cron/job health JSON → jobs evidence.
 *
 * Consumes the JSON output of `fleet-automation-health.mjs`.
 *
 * @param {object} health parsed fleet-automation-health JSON
 * @param {object} entry registry entry (used to match job IDs by project)
 * @returns {Array<object>} normalized evidence records
 */
export function cronJobAdapter(health, entry) {
  if (!health || !Array.isArray(health.jobs)) return [];
  const records = [];
  for (const job of health.jobs) {
    if (!job.lastRun) continue;
    const ok = job.lastRun.exitStatus === 0;
    records.push(normalizeEvidence({
      projectId: entry.id,
      contract: 'jobs',
      source: 'cron-receipts',
      observedAt: job.lastRun.at,
      status: ok ? 'pass' : 'fail',
      summary: `Job "${job.id}" exit ${job.lastRun.exitStatus ?? 'unknown'}`,
      reference: job.lastRun.log,
      details: { jobId: job.id, exitStatus: job.lastRun.exitStatus, enabled: job.enabled }
    }));
  }
  return records;
}

/**
 * Marketing program state → marketing evidence.
 *
 * @param {object} program validated marketing program (from marketing-program.mjs)
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function marketingReceiptAdapter(program, entry) {
  if (!program || !Array.isArray(program.projects)) return [];
  const project = program.projects.find((p) =>
    p.slug === entry.id || (p.aliases || []).includes(entry.id) ||
    p.slug === entry.family || (p.aliases || []).includes(entry.family)
  );
  if (!project) return [];
  const hasMarketing = project.publicMarketing !== false;
  return [normalizeEvidence({
    projectId: entry.id,
    contract: 'marketing',
    source: 'marketing-receipts',
    observedAt: program.updatedAt || new Date().toISOString(),
    status: hasMarketing ? 'pass' : 'not-applicable',
    summary: hasMarketing
      ? `Marketing mode: ${project.mode}, CTA: ${project.cta}`
      : 'No public marketing',
    reference: project.domain,
    details: { mode: project.mode, cadence: project.cadence }
  })];
}

/**
 * PSI Swarm performance results → performance evidence.
 *
 * @param {object} perf parsed PSI Swarm results for one URL
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function performanceAdapter(perf, entry) {
  if (!perf || typeof perf !== 'object') return [];
  const score = perf.performanceScore ?? perf.score;
  if (score == null) return [];
  const status = score >= 90 ? 'pass' : score >= 50 ? 'fail' : 'fail';
  return [normalizeEvidence({
    projectId: entry.id,
    contract: 'performance',
    source: 'performance',
    observedAt: perf.observedAt || perf.generatedAt,
    status,
    summary: `Performance score ${Math.round(score)} (LCP ${perf.lcpMs ? (perf.lcpMs / 1000).toFixed(2) + 's' : 'n/a'})`,
    reference: perf.url || null,
    details: { score, lcpMs: perf.lcpMs, cls: perf.cls }
  })];
}

/**
 * Local check results (lint/test/build) → build evidence.
 *
 * @param {{command:string,exitCode:number,output:string,checkedAt:string}} result
 * @param {object} entry registry entry
 * @returns {Array<object>} normalized evidence records
 */
export function localCheckAdapter(result, entry) {
  if (!result || typeof result !== 'object') return [];
  return [normalizeEvidence({
    projectId: entry.id,
    contract: 'build',
    source: 'local-checks',
    observedAt: result.checkedAt,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    summary: `${result.command} → exit ${result.exitCode}`,
    reference: null,
    details: { command: result.command, exitCode: result.exitCode }
  })];
}

/**
 * Collect evidence from all available adapters for a registry entry.
 *
 * @param {object} entry registry entry
 * @param {object} sources map of source name → raw data
 * @returns {Array<object>} all normalized evidence records
 */
export function collectEvidence(entry, sources = {}) {
  const all = [];
  if (sources.githubActions) all.push(...githubActionsAdapter(sources.githubActions, entry));
  if (sources.cloudflareResilience) all.push(...cloudflareDeployAdapter(sources.cloudflareResilience, entry));
  if (sources.liveSmoke) all.push(...liveSmokeAdapter(sources.liveSmoke, entry));
  if (sources.siteHealth) all.push(...siteHealthAdapter(sources.siteHealth, entry));
  if (sources.cronHealth) all.push(...cronJobAdapter(sources.cronHealth, entry));
  if (sources.marketingProgram) all.push(...marketingReceiptAdapter(sources.marketingProgram, entry));
  if (sources.performance) all.push(...performanceAdapter(sources.performance, entry));
  if (sources.localCheck) all.push(...localCheckAdapter(sources.localCheck, entry));
  return all;
}
