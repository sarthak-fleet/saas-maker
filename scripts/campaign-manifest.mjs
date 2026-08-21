#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  campaignManifestHash,
  campaignStatePaths,
  createCampaignApproval,
  createCampaignReceipt,
  evaluateCampaignItem,
  persistCampaignApproval,
  persistCampaignManifest,
  persistCampaignReceipt,
  publicCampaignSummary,
  readJson,
  validateCampaignManifest,
} from '../lib/campaign-manifest.mjs';

const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadManifest() {
  const path = resolve(requiredOption('--manifest'));
  return { path, value: readJson(path) };
}

function runtimeOptions() {
  const runtimeRoot = option('--runtime-root');
  return runtimeRoot ? { runtimeRoot: resolve(runtimeRoot) } : {};
}

function loadApproval(manifest) {
  const paths = campaignStatePaths(manifest, runtimeOptions());
  if (!existsSync(paths.approval)) return null;
  return readJson(paths.approval);
}

function loadReceipts(manifest) {
  const paths = campaignStatePaths(manifest, runtimeOptions());
  if (!existsSync(paths.receipts)) return [];
  return readdirSync(paths.receipts)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(resolve(paths.receipts, name)));
}

function renderPreview(manifest) {
  const hash = campaignManifestHash(manifest);
  const lines = [
    `# ${manifest.campaign.title}`,
    '',
    `- Campaign: \`${manifest.campaign.id}\``,
    `- Kind: \`${manifest.campaign.kind}\``,
    `- Product: \`${manifest.campaign.projectId}\``,
    `- Source revision: \`${manifest.campaign.sourceRevision}\``,
    `- Manifest hash: \`${hash}\``,
    `- Objective: ${manifest.campaign.objective}`,
    '',
    '## Execution steps',
    '',
  ];
  for (const step of manifest.steps) {
    lines.push(`### ${step.label}`, '');
    for (const key of step.itemKeys) {
      const item = manifest.items.find((entry) => entry.key === key);
      lines.push(
        `#### ${item.title}`,
        '',
        `- Item: \`${item.key}\``,
        `- Tier: \`${item.tier}\``,
        `- Destination: [${item.destination.id}](${item.destination.url})`,
        `- Account: \`${item.destination.accountSlug ?? 'none'}\``,
        `- Cost: ${item.destination.cost}`,
        `- Execution: \`${item.execution.mode}\` — ${item.execution.action}`,
        `- Authentication: ${item.execution.requiresAuth ? 'required' : 'not required'}`,
        `- Policy checked: ${item.execution.policyVerifiedAt}`,
        `- Timing: ${item.timing.publishAt ?? 'unscheduled'}`,
      );
      if (item.execution.blockedReason) {
        lines.push(`- Blocker: ${item.execution.blockedReason}`);
      }
      lines.push('', '```text', item.content.body, '```', '');
      const fields = Object.entries(item.content.fields ?? {});
      if (fields.length) {
        lines.push('Fields:', '');
        for (const [name, value] of fields) {
          lines.push(`- ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
        }
        lines.push('');
      }
    }
  }
  lines.push('## Repository and publish permissions', '');
  for (const [label, values] of [
    ['Repository writes', manifest.permissions.repositoryWrites],
    ['Commands', manifest.permissions.commands],
    ['Publish commands', manifest.permissions.publishCommands],
  ]) {
    lines.push(`### ${label}`, '');
    if (!values.length) lines.push('- None');
    else for (const value of values) lines.push(`- \`${value}\``);
    lines.push('');
  }
  lines.push('## Exclusions', '');
  if (!manifest.exclusions.length) lines.push('- None');
  else {
    for (const exclusion of manifest.exclusions) {
      lines.push(`- \`${exclusion.destinationId}\`: ${exclusion.reason}`);
    }
  }
  lines.push(
    '',
    '## Measurement',
    '',
    `- Attribution: ${manifest.measurement.attribution}`,
    `- Metrics: ${manifest.measurement.metrics.join(', ')}`,
    `- Checkpoints: ${manifest.measurement.checkpoints.join(', ')}`,
    '',
  );
  return lines.join('\n');
}

async function main() {
  if (!['preview', 'approve', 'gate', 'record', 'status'].includes(command)) {
    throw new Error(
      'usage: campaign-manifest <preview|approve|gate|record|status> --manifest <path> [options]',
    );
  }
  const { value: manifest } = loadManifest();
  const validation = validateCampaignManifest(manifest);
  if (!validation.ok) throw new Error(validation.issues.join('\n'));
  const normalized = validation.value;

  if (command === 'preview') {
    persistCampaignManifest(normalized, runtimeOptions());
    process.stdout.write(`${renderPreview(normalized)}\n`);
    return;
  }

  if (command === 'approve') {
    const approval = createCampaignApproval(normalized, {
      decidedBy: requiredOption('--decided-by'),
      decisionReference: requiredOption('--decision-reference'),
      decidedAt: option('--decided-at') ?? undefined,
    });
    const path = persistCampaignApproval(normalized, approval, runtimeOptions());
    process.stdout.write(
      `${JSON.stringify({ ok: true, manifestHash: approval.manifestHash, approvalPath: path })}\n`,
    );
    return;
  }

  const approval = loadApproval(normalized);
  const receipts = loadReceipts(normalized);
  if (command === 'gate') {
    const decision = evaluateCampaignItem(
      normalized,
      approval,
      requiredOption('--item'),
      receipts,
    );
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    process.exitCode = decision.authorized ? 0 : 3;
    return;
  }

  if (command === 'record') {
    const itemKey = requiredOption('--item');
    const decision = evaluateCampaignItem(normalized, approval, itemKey, receipts);
    if (!decision.authorized && decision.status !== 'reconcile_required') {
      throw new Error(`item is not executable: ${decision.status}`);
    }
    const receipt = createCampaignReceipt(normalized, itemKey, {
      outcome: requiredOption('--outcome'),
      provider: requiredOption('--provider'),
      externalId: option('--external-id'),
      resultUrl: option('--result-url'),
      message: option('--message'),
    });
    const path = persistCampaignReceipt(normalized, receipt, runtimeOptions());
    process.stdout.write(`${JSON.stringify({ ok: true, receiptPath: path, receipt })}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        approval,
        summary: publicCampaignSummary(normalized, receipts),
        receipts,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
