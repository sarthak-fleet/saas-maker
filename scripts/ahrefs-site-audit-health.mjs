#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AHREFS_SITE_AUDIT_ERROR_SCHEMA,
  AhrefsSiteAuditError,
  collectAhrefsSiteAuditHealth,
  normalizeBrands,
  renderAhrefsSiteAuditErrorMarkdown,
  renderAhrefsSiteAuditMarkdown,
  sanitizeAhrefsSiteAuditResult,
} from '../lib/ahrefs-site-audit.mjs';
import {
  collectLocalSiteAudit,
  renderLocalSiteAuditMarkdown,
} from '../lib/local-site-audit.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const FLEET_ROOT = resolve(REPOSITORY_ROOT, '..');
export const DEFAULT_BRANDS_PATH = resolve(
  FLEET_ROOT,
  'site-health/apps/backend/config/root-brands.json',
);
export const DEFAULT_OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  'docs/ahrefs-site-audit-latest.md',
);

export function loadCanonicalBrands(path = DEFAULT_BRANDS_PATH) {
  if (!existsSync(path)) {
    throw new AhrefsSiteAuditError(
      'missing-brand-catalog',
      `Site Health root-brands.json is required at ${path}. Workflows and Skills does not own the brand catalog.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new AhrefsSiteAuditError(
      'invalid-brands',
      `Site Health brand catalog at ${path} is not valid JSON`,
      { cause },
    );
  }
  return normalizeBrands(parsed);
}

export async function runAhrefsSiteAuditHealth(options = {}) {
  const outputPath = resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH);
  mkdirSync(dirname(outputPath), { recursive: true });
  const act = options.act !== false;
  let brands = options.brands;
  let ahrefsError = null;
  let result = null;
  try {
    brands = brands ?? loadCanonicalBrands(options.brandsPath ?? DEFAULT_BRANDS_PATH);
    result = sanitizeAhrefsSiteAuditResult(
      await collectAhrefsSiteAuditHealth({
        apiKey: options.apiKey ?? process.env.AHREFS_API_KEY,
        brands,
        maxAgeDays: options.maxAgeDays,
        now: options.now,
        fetchImpl: options.fetchImpl,
      }),
    );
  } catch (error) {
    ahrefsError = {
      schema: AHREFS_SITE_AUDIT_ERROR_SCHEMA,
      status: 'blocked',
      code: error?.code ?? 'unknown-error',
      httpStatus: error?.httpStatus ?? null,
      message: error?.message ?? 'Ahrefs Site Audit collection failed',
      outputPath,
    };
    if (!brands) {
      writeFileSync(
        outputPath,
        renderAhrefsSiteAuditErrorMarkdown(error, { now: options.now }),
        'utf8',
      );
      return { ok: false, outputPath, error: ahrefsError, actions: [] };
    }
  }

  const local = act
    ? await collectLocalSiteAudit({
      brands,
      fetchImpl: options.localFetchImpl ?? options.fetchImpl,
      maxPagesPerRoot: options.maxPagesPerRoot,
      now: options.now,
    })
    : null;
  const markdown = [
    result
      ? renderAhrefsSiteAuditMarkdown(result)
      : renderAhrefsSiteAuditErrorMarkdown(
        { code: ahrefsError.code, httpStatus: ahrefsError.httpStatus, message: ahrefsError.message },
        { now: options.now },
      ),
    local ? renderLocalSiteAuditMarkdown(local) : '',
  ].join('\n');
  writeFileSync(outputPath, markdown, 'utf8');
  const errorActions = local?.summary.errorActions ?? 0;
  return {
    ok: Boolean(result) && result.status === 'complete' && errorActions === 0,
    outputPath,
    result,
    error: ahrefsError,
    local,
    actions: local?.actions ?? [],
  };
}

function argument(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (!argv[index + 1]) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

export async function main(argv = process.argv) {
  const maxAgeDays = argument('--max-age-days', argv);
  const outcome = await runAhrefsSiteAuditHealth({
    brandsPath: argument('--brands-path', argv),
    outputPath: argument('--output', argv),
    maxAgeDays: maxAgeDays == null ? undefined : Number(maxAgeDays),
    act: !argv.includes('--no-act'),
  });
  process.stdout.write(`${JSON.stringify({
    ahrefs: outcome.result ?? outcome.error,
    local: outcome.local
      ? { schema: outcome.local.schema, summary: outcome.local.summary, actions: outcome.actions }
      : null,
  }, null, 2)}\n`);
  if (!outcome.ok) process.exitCode = 1;
  return outcome;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
