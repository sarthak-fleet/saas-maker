#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_FLEET_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
const MAX_TEXT_BYTES = 1_000_000;
const LOCAL_AGENT_SETTINGS = /(^|\/)\.claude\/settings\.local\.json$/;
const EXCLUDED = /(^|\/)(?:node_modules|dist|build|coverage|\.next|\.open-next|vendor)(\/|$)/;
const TESTLIKE = /(^|\/)(?:docs?|archive|fixtures?|benchmarks?|test|tests|__tests__)(\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/;
const PLACEHOLDER = /(?:example|placeholder|changeme|replace|dummy|fake|sample|paste|here|test[-_ ]?only|not[-_ ]?a[-_ ]?real|your|random[-_ -]?chars?|abcdefghijklmnopqrstuvwxyz|123456789|\$\{|\$\(|<[^>]+>)/i;
const HUMAN_READABLE_PLACEHOLDER = /[a-z]{4,}[-_][a-z]{4,}/i;

const TOKEN_PATTERNS = [
  { category: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{80,}?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { category: 'provider-token', pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:live|proj)-[A-Za-z0-9_-]{20,})\b/g },
  { category: 'credential-bearing-libsql-url', pattern: /libsql:\/\/[^\s:@]+:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+@[^\s"']+/g },
];

function argument(argv, name) {
  return argv.find((value, index) => argv[index - 1] === name);
}

function trackedFiles(repoPath) {
  return execFileSync('git', ['-C', repoPath, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

function entropy(value) {
  const frequencies = new Map();
  for (const char of value) frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  return [...frequencies.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function assignmentFindings(text, path) {
  if (TESTLIKE.test(path)) return [];
  const findings = [];
  const pattern = /^\s*(?:export\s+)?(?:const\s+)?([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*(?:=|:)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_+./=-]+))\s*[,;]?\s*$/gm;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (/^(?:VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(name) || name.includes('SAASMAKER_API_KEY')) continue;
    if (/^(?:process\.env|import\.meta\.env|env\.)/i.test(value)) continue;
    const humanPhrase = (value.match(/-/g) ?? []).length >= 2 && Math.max(
      0,
      ...(value.match(/[a-z]+/g) ?? []).map((part) => part.length),
    ) >= 7;
    if (
      value.length < 24 ||
      PLACEHOLDER.test(value) ||
      HUMAN_READABLE_PLACEHOLDER.test(value) ||
      humanPhrase ||
      entropy(value) < 3.5
    ) continue;
    findings.push({ category: 'high-entropy-credential-assignment', line: lineAt(text, match.index) });
  }
  return findings;
}

function scanTrackedFile(repo, repoPath, path) {
  if (LOCAL_AGENT_SETTINGS.test(path)) {
    return [{ repo, path, line: 1, scope: 'current', category: 'tracked-machine-local-agent-settings' }];
  }
  if (EXCLUDED.test(path)) return [];
  const absolutePath = join(repoPath, path);
  if (!existsSync(absolutePath)) return [];
  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size > MAX_TEXT_BYTES) return [];
  const text = readFileSync(absolutePath, 'utf8');
  if (text.includes('\0')) return [];
  const findings = assignmentFindings(text, path);
  for (const { category, pattern } of TOKEN_PATTERNS) {
    if (category !== 'private-key' && TESTLIKE.test(path)) continue;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (PLACEHOLDER.test(match[0]) || HUMAN_READABLE_PLACEHOLDER.test(match[0])) continue;
      findings.push({ category, line: lineAt(text, match.index) });
    }
  }
  return findings.map((finding) => ({ repo, path, scope: 'current', ...finding }));
}

function historyFindings(repo, repoPath) {
  const temporary = mkdtempSync(join(tmpdir(), 'fleet-credential-history-'));
  const reportPath = join(temporary, 'gitleaks.json');
  try {
    const result = spawnSync(
      'gitleaks',
      ['git', '--no-banner', '--redact', '--report-format', 'json', '--report-path', reportPath, repoPath],
      { encoding: 'utf8', stdio: 'ignore' },
    );
    if (result.error?.code === 'ENOENT') return { available: false, findings: [] };
    if (![0, 1].includes(result.status)) return { available: false, findings: [] };
    const raw = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
    return {
      available: true,
      findings: raw.map((finding) => ({
        repo,
        path: finding.File || '(unknown)',
        line: Number(finding.StartLine || 0),
        scope: 'history',
        category: finding.RuleID || 'gitleaks-finding',
      })),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function deduplicate(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = [finding.repo, finding.path, finding.line, finding.scope, finding.category].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scanFleetCredentials({ fleetRoot, includeHistory = false }) {
  const repos = [];
  const findings = [];
  let historyAvailable = !includeHistory;
  for (const entry of readdirSync(fleetRoot).sort()) {
    const repoPath = join(fleetRoot, entry);
    if (!statSync(repoPath).isDirectory() || !existsSync(join(repoPath, '.git'))) continue;
    repos.push(entry);
    for (const path of trackedFiles(repoPath)) {
      findings.push(...scanTrackedFile(entry, repoPath, path));
    }
    if (includeHistory) {
      const history = historyFindings(entry, repoPath);
      historyAvailable ||= history.available;
      findings.push(...history.findings);
    }
  }
  const uniqueFindings = deduplicate(findings).sort((left, right) =>
    [left.repo, left.path, left.line, left.category].join('\0').localeCompare(
      [right.repo, right.path, right.line, right.category].join('\0'),
    ),
  );
  return {
    schemaVersion: 1,
    evidence: includeHistory ? 'tracked-files-and-reachable-history' : 'tracked-files',
    fleetRoot,
    repoCount: repos.length,
    historyRequested: includeHistory,
    historyScannerAvailable: historyAvailable,
    summary: {
      findings: uniqueFindings.length,
      current: uniqueFindings.filter((finding) => finding.scope === 'current').length,
      history: uniqueFindings.filter((finding) => finding.scope === 'history').length,
    },
    findings: uniqueFindings,
  };
}

function humanReport(report) {
  const lines = [
    `Credential audit: ${report.repoCount} repos; current=${report.summary.current} history=${report.summary.history}`,
  ];
  if (report.historyRequested && !report.historyScannerAvailable) {
    lines.push('history-unavailable\tgitleaks is required for reachable-history scanning');
  }
  for (const finding of report.findings) {
    lines.push(`${finding.scope}\t${finding.repo}/${finding.path}:${finding.line}\t${finding.category}`);
  }
  return lines.join('\n');
}

if (resolve(process.argv[1] ?? '') === resolve(SCRIPT_PATH)) {
  const fleetRoot = resolve(argument(process.argv, '--root') ?? DEFAULT_FLEET_ROOT);
  const report = scanFleetCredentials({
    fleetRoot,
    includeHistory: process.argv.includes('--history'),
  });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${humanReport(report)}\n`);
  if (process.argv.includes('--check') && report.summary.current > 0) process.exitCode = 1;
  if (process.argv.includes('--require-history') && !report.historyScannerAvailable) process.exitCode = 2;
}
