#!/usr/bin/env node

import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const COMMANDS = ['node', 'blender', 'gltfpack', 'gltf-transform', 'ffmpeg'];
const PACKAGES = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  '@babylonjs/core',
  'babylonjs',
  'ogl',
  'regl',
  'pixi.js',
  'motion',
  'framer-motion',
  'gsap',
  'lottie-web',
  '@rive-app/react-canvas',
];

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.project ?? process.cwd());
  const packagePath = join(projectRoot, 'package.json');
  const packageJson = readPackage(packagePath);
  const declared = packageJson
    ? {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
        ...packageJson.optionalDependencies,
      }
    : {};
  const searchPath = args.path ?? process.env.PATH ?? '';
  const commands = COMMANDS.map((name) => {
    const executable = findExecutable(name, searchPath);
    return { name, available: executable !== null, path: executable };
  });
  const packages = PACKAGES.map((name) => ({
    name,
    declared: Object.hasOwn(declared, name),
    version: declared[name] ?? null,
  }));
  const availableCommands = new Set(
    commands.filter(({ available }) => available).map(({ name }) => name),
  );
  const declaredPackages = new Set(
    packages.filter(({ declared: isDeclared }) => isDeclared).map(({ name }) => name),
  );
  const report = {
    schemaVersion: 'fleet.design-engineering-doctor.v1',
    projectRoot,
    packageFile: packageJson ? packagePath : null,
    commands,
    packages,
    capabilities: {
      assetAuthoring: availableCommands.has('blender'),
      assetOptimization:
        availableCommands.has('gltfpack') ||
        availableCommands.has('gltf-transform') ||
        availableCommands.has('blender'),
      web3dRuntime: [...declaredPackages].some((name) =>
        ['three', '@react-three/fiber', '@babylonjs/core', 'babylonjs', 'ogl', 'regl'].includes(name),
      ),
      effectsRuntime: [...declaredPackages].some((name) =>
        ['pixi.js', 'motion', 'framer-motion', 'gsap', 'lottie-web', '@rive-app/react-canvas'].includes(name),
      ),
    },
    warnings: [
      ...(packageJson ? [] : ['No package.json found at the project root.']),
      ...(availableCommands.has('node') ? [] : ['Node is not available on the inspected PATH.']),
    ],
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
} catch (error) {
  process.stderr.write(`design-engineering doctor: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--json') {
      parsed.json = true;
      continue;
    }
    if (!['--project', '--path'].includes(value)) {
      throw new Error('usage: doctor.mjs [--project <path>] [--path <path-list>] [--json]');
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
    parsed[value.slice(2)] = next;
    index += 1;
  }
  return parsed;
}

function readPackage(packagePath) {
  if (!existsSync(packagePath)) return null;
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

function findExecutable(name, searchPath) {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return null;
}

function printHuman(report) {
  const available = report.commands.filter(({ available: found }) => found).map(({ name }) => name);
  const declared = report.packages.filter(({ declared: found }) => found).map(({ name }) => name);
  process.stdout.write(`Design engineering doctor: ${report.projectRoot}\n`);
  process.stdout.write(`Commands: ${available.join(', ') || 'none'}\n`);
  process.stdout.write(`Declared packages: ${declared.join(', ') || 'none'}\n`);
  for (const warning of report.warnings) process.stdout.write(`Warning: ${warning}\n`);
}
