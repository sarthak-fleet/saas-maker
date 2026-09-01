#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FLEET_ROOT = resolve(TOOLING_ROOT, '..', '..');

const ENTRY_FIELDS = new Set(['allows', 'files', 'id', 'kind', 'reason', 'recordedAt', 'state']);
const MANIFEST_FIELDS = new Set(['schemaVersion', 'surfaces', 'updatedAt']);
const STATES = new Set(['required', 'retired-exception']);
const KINDS = new Set(['visual', 'factory']);
const ACKNOWLEDGEABLE_CODES = new Set(['COMPOSE_OPT_OUT']);
const PROJECT_STRIP = /(?:https:\/\/sassmaker\.com)?\/(?:portfolio-)?project-strip\.js\b/gu;
const AI_FOOTER = /(?:https:\/\/sassmaker\.com)?\/ai-chat-footer\.js\b/gu;
const COMPOSE_OPT_OUT = /data-compose\s*=\s*(?:["']false["']|\{false\}|false\b)/iu;

export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, problems: ['manifest must be an object'] };
  }
  for (const field of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.has(field)) problems.push(`unsupported manifest field: ${field}`);
  }
  if (manifest.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(manifest.updatedAt ?? '')) {
    problems.push('updatedAt must be an ISO date');
  }
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) {
    problems.push('surfaces must be a non-empty array');
    return { valid: problems.length === 0, problems };
  }

  const ids = new Set();
  for (const [index, surface] of manifest.surfaces.entries()) {
    const label = surface?.id || `surfaces[${index}]`;
    if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
      problems.push(`${label}: entry must be an object`);
      continue;
    }
    for (const field of Object.keys(surface)) {
      if (!ENTRY_FIELDS.has(field)) problems.push(`${label}: unsupported field ${field}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(surface.id ?? '')) {
      problems.push(`${label}: id must be a lowercase slug`);
    } else if (ids.has(surface.id)) {
      problems.push(`${label}: duplicate id`);
    } else {
      ids.add(surface.id);
    }
    if (!KINDS.has(surface.kind)) problems.push(`${label}: kind must be visual or factory`);
    if (!STATES.has(surface.state)) {
      problems.push(`${label}: state must be required or retired-exception`);
    }
    if (!Array.isArray(surface.files) || surface.files.length === 0) {
      problems.push(`${label}: files must be a non-empty array`);
    } else {
      for (const file of surface.files) {
        if (typeof file !== 'string' || !file || isAbsolute(file) || file.split(/[\\/]/u).includes('..')) {
          problems.push(`${label}: files must contain safe relative paths`);
        }
      }
    }
    if (surface.state === 'retired-exception') {
      if (!Array.isArray(surface.allows) || surface.allows.length === 0) {
        problems.push(`${label}: retired-exception requires a non-empty allows list`);
      } else {
        for (const code of surface.allows) {
          if (!ACKNOWLEDGEABLE_CODES.has(code)) {
            problems.push(`${label}: cannot acknowledge ${code}`);
          }
        }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(surface.recordedAt ?? '')) {
        problems.push(`${label}: retired-exception requires recordedAt`);
      }
      if (typeof surface.reason !== 'string' || surface.reason.trim().length < 20) {
        problems.push(`${label}: retired-exception requires a written reason`);
      }
    } else if ('allows' in surface || 'reason' in surface || 'recordedAt' in surface) {
      problems.push(`${label}: only retired-exception may carry allows, reason, or recordedAt`);
    }
  }
  return { valid: problems.length === 0, problems };
}

export function loadManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read footer manifest ${path}: ${error.message}`);
  }
  const validation = validateManifest(manifest);
  if (!validation.valid) throw new Error(validation.problems.join('\n'));
  return manifest;
}

export function inspectFooterSource(source) {
  const projectMatches = [...String(source).matchAll(PROJECT_STRIP)];
  const aiMatches = [...String(source).matchAll(AI_FOOTER)];
  return {
    projectStripLoaders: projectMatches.length,
    aiFooterLoaders: aiMatches.length,
    ordered: projectMatches.length > 0 && aiMatches.length > 0
      ? projectMatches[0].index < aiMatches[0].index
      : false,
    composeOptOut: COMPOSE_OPT_OUT.test(String(source)),
  };
}

export function auditFooterSources({ manifest, fleetRoot = DEFAULT_FLEET_ROOT, now = Date.now() }) {
  const validation = validateManifest(manifest);
  if (!validation.valid) throw new Error(validation.problems.join('\n'));

  const resolvedRoot = resolve(fleetRoot);
  const results = [];
  const findings = [];
  for (const surface of manifest.surfaces) {
    const files = [];
    for (const file of surface.files) {
      const absolute = resolve(resolvedRoot, file);
      if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${sep}`)) {
        throw new Error(`${surface.id}: source path escapes Fleet root`);
      }
      if (!existsSync(absolute)) {
        files.push({ path: file, exists: false });
        findings.push(finding(surface, file, 'MISSING_SOURCE', 'source file is not present'));
        continue;
      }
      const evidence = inspectFooterSource(readFileSync(absolute, 'utf8'));
      files.push({ path: file, exists: true, ...evidence });
      if (evidence.projectStripLoaders === 0) {
        findings.push(finding(surface, file, 'MISSING_PROJECT_STRIP', 'project-strip loader is absent'));
      }
      if (evidence.aiFooterLoaders === 0) {
        findings.push(finding(surface, file, 'MISSING_AI_FOOTER', 'Ask AI loader is absent'));
      }
      if (evidence.projectStripLoaders > 0 && evidence.aiFooterLoaders > 0 && !evidence.ordered) {
        findings.push(finding(surface, file, 'LOADER_ORDER', 'project strip must load before Ask AI'));
      }
      if (evidence.composeOptOut) {
        findings.push(finding(surface, file, 'COMPOSE_OPT_OUT', 'legacy composition opt-out remains'));
      }
    }
    results.push({ ...surface, files });
  }

  const annotated = findings.map((entry) => {
    const surface = manifest.surfaces.find((candidate) => candidate.id === entry.surface);
    return {
      ...entry,
      acknowledged: surface.state === 'retired-exception' && surface.allows.includes(entry.code),
      ...(surface.state === 'retired-exception' && surface.allows.includes(entry.code)
        ? { exception: { recordedAt: surface.recordedAt, reason: surface.reason } }
        : {}),
    };
  });
  const staleExceptions = manifest.surfaces
    .filter((surface) => surface.state === 'retired-exception')
    .filter((surface) => !annotated.some(
      (entry) => entry.surface === surface.id && surface.allows.includes(entry.code)
    ))
    .map((surface) => ({
      surface: surface.id,
      file: surface.files[0],
      code: 'STALE_EXCEPTION',
      message: 'recorded retirement exception no longer matches source debt',
      acknowledged: false,
    }));
  const allFindings = [...annotated, ...staleExceptions];
  const blocking = allFindings.filter((entry) => !entry.acknowledged);
  const visual = manifest.surfaces.filter((surface) => surface.kind === 'visual');
  const factories = manifest.surfaces.filter((surface) => surface.kind === 'factory');
  const compliant = results.filter((surface) => !allFindings.some((entry) => entry.surface === surface.id));
  const compliantIds = new Set(compliant.map((surface) => surface.id));

  return {
    schema: 'fleet.footer-source-audit.v1',
    generatedAt: new Date(now).toISOString(),
    manifest: { updatedAt: manifest.updatedAt, surfaces: manifest.surfaces.length },
    summary: {
      visual: visual.length,
      factories: factories.length,
      required: manifest.surfaces.filter((surface) => surface.state === 'required').length,
      compliant: compliant.length,
      compliantVisual: visual.filter((surface) => compliantIds.has(surface.id)).length,
      compliantFactories: factories.filter((surface) => compliantIds.has(surface.id)).length,
      acknowledgedExceptions: new Set(
        allFindings.filter((entry) => entry.acknowledged).map((entry) => entry.surface)
      ).size,
      findings: allFindings.length,
      blocking: blocking.length,
    },
    findings: allFindings,
    blocking,
    results,
  };
}

function finding(surface, file, code, message) {
  return { surface: surface.id, file, code, message };
}

const VALUE_FLAGS = new Set(['--fleet-root', '--manifest']);

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!VALUE_FLAGS.has(token)) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    options[token] = value;
    index += 1;
  }
  return options;
}

const HELP = `Fleet footer source audit

Usage:
  footer-source-audit.mjs --manifest <file> [--fleet-root <dir>] [--json] [--check]

The caller owns the manifest of expected visual surfaces. This public tool only
reads those relative source paths and checks that the project strip loads before
Ask AI, both loaders exist, and active source has no data-compose=false opt-out.

A dated retired-exception records known source debt without making it disappear.
The audit fails if required source drifts or an exception becomes stale.

Exit codes:
  0  Nothing blocking.
  1  Source drift or an invalid manifest.
  2  Usage error.`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return null;
  }
  let options;
  let manifest;
  try {
    options = parseArguments(argv);
    if (!options['--manifest']) throw new Error('--manifest is required');
    manifest = loadManifest(resolve(options['--manifest']));
  } catch (error) {
    process.stderr.write(`${error.message}\n${HELP}\n`);
    process.exitCode = 2;
    return null;
  }

  const report = auditFooterSources({
    manifest,
    fleetRoot: resolve(options['--fleet-root'] ?? DEFAULT_FLEET_ROOT),
  });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderText(report, argv.includes('--check'))}\n`);
  if (report.blocking.length > 0) process.exitCode = 1;
  return report;
}

function renderText(report, compact) {
  const lines = [
    `Footer source audit — receipt updated ${report.manifest.updatedAt}`,
    `${report.summary.compliantVisual}/${report.summary.visual} visual identities source-ready, `
      + `${report.summary.compliantFactories}/${report.summary.factories} shared factory source-ready, `
      + `${report.summary.acknowledgedExceptions} recorded exception(s)`,
  ];
  if (!compact) {
    lines.push('', 'Per surface:');
    for (const result of report.results) {
      const state = report.findings.some((entry) => entry.surface === result.id)
        ? result.state === 'retired-exception' ? 'recorded exception' : 'drifted'
        : 'compliant';
      lines.push(`  ${result.id.padEnd(28)} ${state}`);
    }
  }
  const acknowledged = report.findings.filter((entry) => entry.acknowledged);
  if (acknowledged.length > 0) {
    lines.push('', 'Recorded debt:');
    for (const entry of acknowledged) lines.push(`  - [${entry.code}] ${entry.surface}: ${entry.file}`);
  }
  if (report.blocking.length > 0) {
    lines.push('', 'Blocking:');
    for (const entry of report.blocking) {
      lines.push(`  - [${entry.code}] ${entry.surface}: ${entry.file} — ${entry.message}`);
    }
  } else {
    lines.push('', 'No blocking findings.');
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
