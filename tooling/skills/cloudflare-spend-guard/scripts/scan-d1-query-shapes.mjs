#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_FLEET_ROOT = resolve(dirname(SCRIPT_PATH), '../../../../..');
const WRANGLER_CONFIG = /(^|\/)wrangler(?:\.[^/]+)?\.(?:toml|jsonc?)$/;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py)$/;
const EXCLUDED_SOURCE = /(^|\/)(?:node_modules|dist|build|coverage|fixtures?|migrations?|docs?|scripts?|test|tests|__tests__)(\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|(^|\/)tooling\/(?:preserved|templates)(\/|$)/;
const GROUPING = /\bGROUP\s+BY\b|\.groupBy\s*\(/gi;

function argument(argv, name) {
  return argv.find((value, index) => argv[index - 1] === name);
}

function trackedFiles(repoPath) {
  return execFileSync('git', ['-C', repoPath, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

function d1Configs(repoPath, files) {
  return files
    .filter((file) => WRANGLER_CONFIG.test(file))
    .flatMap((file) => {
      const text = readFileSync(join(repoPath, file), 'utf8');
      if (!/\bd1_databases\b|\bdatabase_name\s*[=:]/i.test(text)) return [];
      const names = [...text.matchAll(/["']?database_name["']?\s*[=:]\s*["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .sort();
      return [{ path: file, databaseNames: names }];
    });
}

function templateLiteralAt(text, offset) {
  const start = text.lastIndexOf('`', offset);
  const end = text.indexOf('`', offset);
  if (start === -1 || end === -1 || start >= offset || end <= offset) return null;
  return text.slice(start + 1, end);
}

function queryBuilderWindow(text, offset) {
  const start = text.lastIndexOf(';', offset) + 1;
  const end = text.indexOf(';', offset);
  return text.slice(start, end === -1 ? offset + 200 : end + 1);
}

export function classifyGrouping({ text, lines, lineIndex, offset, kind }) {
  const context = kind === 'raw-sql' ? templateLiteralAt(text, offset) ?? lines[lineIndex] : queryBuilderWindow(text, offset);
  if (/\$\{\s*(?:where|filter|conditions?)/i.test(context)) return 'dynamic-review';
  if (kind === 'query-builder') {
    if (/\.where\s*\([\s\S]*?(?:eq|gt|gte|lt|lte|inArray|like|between)\s*\(/i.test(context)) return 'bounded';
    return /\.where\s*\(/i.test(context) ? 'dynamic-review' : 'unbounded';
  }
  const hasPredicate = /\bwhere\b/i.test(context);
  const hasParameterizedBound = /(?:=|<>|!=|<=|>=|<|>)\s*\?|\bbetween\s+\?\s+and\s+\?|\bmatch\s+\?|\bin\s*\([^)]*\?/i.test(context);
  const hasInterpolatedBound = /\bwhere\b[\s\S]*?\$\{(?!\s*(?:where|filter|conditions?))/i.test(context);
  return hasPredicate && (hasParameterizedBound || hasInterpolatedBound)
    ? 'bounded'
    : 'unbounded';
}

function reviewedUnbounded(lines, lineIndex) {
  const nearby = lines.slice(Math.max(0, lineIndex - 3), lineIndex + 1).join('\n');
  return nearby.match(/d1-scan:\s*reviewed-unbounded\s+([^\n]+)/i)?.[1]?.trim() ?? null;
}

function scanFile(repo, repoPath, file) {
  const text = readFileSync(join(repoPath, file), 'utf8');
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (const match of text.matchAll(GROUPING)) {
    const before = text.slice(0, match.index);
    const lineIndex = before.split(/\r?\n/).length - 1;
    const kind = match[0].startsWith('.') ? 'query-builder' : 'raw-sql';
    const context = kind === 'raw-sql' ? templateLiteralAt(text, match.index) : queryBuilderWindow(text, match.index);
    if (kind === 'raw-sql' && (!context || !/\bselect\b/i.test(context))) continue;
    if (kind === 'query-builder' && !/\.from\s*\(/i.test(context)) continue;
    const review = reviewedUnbounded(lines, lineIndex);
    findings.push({
      repo,
      path: file,
      line: lineIndex + 1,
      kind,
      classification: review ? 'reviewed-unbounded' : classifyGrouping({
        text,
        lines,
        lineIndex,
        offset: match.index,
        kind,
      }),
      ...(review ? { review } : {}),
    });
  }
  return findings;
}

export function scanD1QueryShapes({ fleetRoot }) {
  const repos = [];
  for (const entry of readdirSync(fleetRoot).sort()) {
    const repoPath = join(fleetRoot, entry);
    if (!statSync(repoPath).isDirectory() || !existsSync(join(repoPath, '.git'))) continue;
    const files = trackedFiles(repoPath);
    const configs = d1Configs(repoPath, files);
    if (configs.length === 0) continue;
    const findings = files
      .filter((file) => SOURCE_FILE.test(file) && !EXCLUDED_SOURCE.test(file))
      .flatMap((file) => scanFile(entry, repoPath, file));
    repos.push({ repo: entry, configs, findings });
  }
  const findings = repos.flatMap((repo) => repo.findings);
  return {
    schemaVersion: 1,
    evidence: 'source-static-analysis',
    fleetRoot,
    repoCount: repos.length,
    databaseNames: [...new Set(repos.flatMap((repo) => repo.configs.flatMap((config) => config.databaseNames)))].sort(),
    summary: {
      bounded: findings.filter((finding) => finding.classification === 'bounded').length,
      dynamicReview: findings.filter((finding) => finding.classification === 'dynamic-review').length,
      reviewedUnbounded: findings.filter((finding) => finding.classification === 'reviewed-unbounded').length,
      unbounded: findings.filter((finding) => finding.classification === 'unbounded').length,
    },
    repos,
  };
}

function humanReport(report) {
  const lines = [
    `D1 query-shape audit: ${report.repoCount} repos, ${report.databaseNames.length} configured databases`,
    `bounded=${report.summary.bounded} dynamic-review=${report.summary.dynamicReview} reviewed-unbounded=${report.summary.reviewedUnbounded} unbounded=${report.summary.unbounded}`,
  ];
  for (const repo of report.repos) {
    for (const finding of repo.findings.filter((item) => item.classification !== 'bounded')) {
      lines.push(`${finding.classification}\t${repo.repo}/${finding.path}:${finding.line}\t${finding.kind}`);
    }
  }
  return lines.join('\n');
}

if (resolve(process.argv[1] ?? '') === resolve(SCRIPT_PATH)) {
  const fleetRoot = resolve(argument(process.argv, '--root') ?? DEFAULT_FLEET_ROOT);
  const report = scanD1QueryShapes({ fleetRoot });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${humanReport(report)}\n`);
  if (process.argv.includes('--fail-on-unbounded') && report.summary.unbounded > 0) process.exitCode = 1;
}
