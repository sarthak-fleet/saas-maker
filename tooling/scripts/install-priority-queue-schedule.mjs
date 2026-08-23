#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_LABEL = 'com.sarthak.priority-queue-sync';
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 20;
const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const VALUED_ARGUMENTS = ['owner', 'project', 'author', 'label', 'hour', 'minute', 'path'];

function usage() {
  return `Usage:
  node saas-maker/tooling/scripts/install-priority-queue-schedule.mjs \\
    --owner OWNER --project NUMBER --author LOGIN [--hour 9] [--minute 20]

Installs a per-user launchd agent that runs github-priority-queue.mjs --apply
once a day, using the operator's existing gh authentication. No token, secret,
or credential is written by this script.

Options:
  --owner OWNER     GitHub Project owner login (required)
  --project NUMBER  GitHub Project number (required)
  --author LOGIN    Issue author login (required)
  --label LABEL     launchd label (default: ${DEFAULT_LABEL})
  --hour HOUR       Local hour to run, 0-23 (default: ${DEFAULT_HOUR})
  --minute MINUTE   Local minute to run, 0-59 (default: ${DEFAULT_MINUTE})
  --path PATH       PATH given to the agent (default: homebrew and system bins)
  --uninstall       Remove the agent and its plist
  --dry-run         Print the plist and the launchctl plan without writing
  --help            Show this help
`;
}

export function parseArgs(argv) {
  const options = {
    label: DEFAULT_LABEL,
    hour: DEFAULT_HOUR,
    minute: DEFAULT_MINUTE,
    path: DEFAULT_PATH,
    uninstall: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--uninstall') {
      options.uninstall = true;
      continue;
    }
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    const key = argument.slice(2);
    if (!VALUED_ARGUMENTS.includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[key] = value;
    index += 1;
  }

  if (options.help) return options;
  if (!options.uninstall) {
    for (const key of ['owner', 'project', 'author']) {
      if (!options[key]) throw new Error(`Missing required argument: --${key}`);
    }
    if (!/^\d+$/.test(String(options.project))) {
      throw new Error('--project must be a positive integer');
    }
  }
  options.hour = Number(options.hour);
  options.minute = Number(options.minute);
  if (!Number.isInteger(options.hour) || options.hour < 0 || options.hour > 23) {
    throw new Error('--hour must be an integer between 0 and 23');
  }
  if (!Number.isInteger(options.minute) || options.minute < 0 || options.minute > 59) {
    throw new Error('--minute must be an integer between 0 and 59');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.label)) {
    throw new Error('--label must be a plain launchd label');
  }
  return options;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function buildCommand({ syncScript, owner, project, author, logPath }) {
  const parts = [
    'exec node',
    JSON.stringify(syncScript),
    '--owner',
    JSON.stringify(String(owner)),
    '--project',
    JSON.stringify(String(project)),
    '--author',
    JSON.stringify(String(author)),
    '--apply',
    '>>',
    JSON.stringify(logPath),
    '2>&1',
  ];
  return parts.join(' ');
}

export function buildPlist({ label, command, hour, minute, path, home, logPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(path)}</string>
    <key>HOME</key>
    <string>${escapeXml(home)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export function planLaunchctl(label, plistPath, uid) {
  return {
    bootout: ['bootout', `gui/${uid}/${label}`],
    bootstrap: ['bootstrap', `gui/${uid}`, plistPath],
    kickstart: ['kickstart', '-p', `gui/${uid}/${label}`],
  };
}

export function installSchedule(
  options,
  {
    run = spawnSync,
    write = (line) => console.log(line),
    writeFile = writeFileSync,
    remove = rmSync,
    makeDirectory = mkdirSync,
    home = process.env.HOME ?? '',
    uid = process.getuid?.() ?? 0,
    scriptDirectory = dirname(fileURLToPath(import.meta.url)),
  } = {},
) {
  if (!home) throw new Error('HOME is not set; cannot resolve the LaunchAgents directory');

  const agentsDirectory = join(home, 'Library', 'LaunchAgents');
  const plistPath = join(agentsDirectory, `${options.label}.plist`);
  const logPath = join(home, 'Library', 'Logs', `${options.label}.log`);
  const syncScript = resolve(scriptDirectory, 'github-priority-queue.mjs');
  const plan = planLaunchctl(options.label, plistPath, uid);

  if (options.uninstall) {
    if (options.dryRun) {
      write(`Would run: launchctl ${plan.bootout.join(' ')}`);
      write(`Would remove ${plistPath}`);
      return { plistPath, logPath, uninstalled: false };
    }
    run('launchctl', plan.bootout, { encoding: 'utf8' });
    remove(plistPath, { force: true });
    write(`Removed ${options.label} and ${plistPath}`);
    return { plistPath, logPath, uninstalled: true };
  }

  const command = buildCommand({
    syncScript,
    owner: options.owner,
    project: options.project,
    author: options.author,
    logPath,
  });
  const plist = buildPlist({
    label: options.label,
    command,
    hour: options.hour,
    minute: options.minute,
    path: options.path,
    home,
    logPath,
  });

  if (options.dryRun) {
    write(plist.trimEnd());
    write(`Would write ${plistPath}`);
    write(`Would run: launchctl ${plan.bootout.join(' ')}`);
    write(`Would run: launchctl ${plan.bootstrap.join(' ')}`);
    return { plistPath, logPath, plist, installed: false };
  }

  makeDirectory(agentsDirectory, { recursive: true });
  makeDirectory(dirname(logPath), { recursive: true });
  writeFile(plistPath, plist, 'utf8');

  run('launchctl', plan.bootout, { encoding: 'utf8' });
  const bootstrap = run('launchctl', plan.bootstrap, { encoding: 'utf8' });
  if (bootstrap.status !== 0) {
    throw new Error(
      `launchctl bootstrap failed: ${String(bootstrap.stderr ?? '').trim() || 'unknown error'}`,
    );
  }

  write(
    `Installed ${options.label}: daily at ${String(options.hour).padStart(2, '0')}:${String(options.minute).padStart(2, '0')} local`,
  );
  write(`Plist ${plistPath}`);
  write(`Log ${logPath}`);
  return { plistPath, logPath, plist, installed: true };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    installSchedule(options);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
