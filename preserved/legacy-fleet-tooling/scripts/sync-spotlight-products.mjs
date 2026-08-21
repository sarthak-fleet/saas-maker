#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const FLEET_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CONTRACT_PATH = resolve(FLEET_ROOT, 'foundry/ops/config/spotlight-products.json');
const SYNC_CONFIG_PATH = resolve(FLEET_ROOT, 'foundry/ops/config/spotlight-sync.json');

function parseArgs(argv) {
  const args = { mode: 'check', strict: false, workspace: FLEET_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') args.mode = 'write';
    else if (arg === '--check') args.mode = 'check';
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--workspace') args.workspace = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function resolveCheckout(workspace, checkoutPath) {
  const inWorkspace = resolve(workspace, checkoutPath);
  if (existsSync(inWorkspace)) return inWorkspace;
  const sibling = resolve(workspace, '..', checkoutPath);
  if (existsSync(sibling)) return sibling;
  return inWorkspace;
}

function portfolioSource(contract) {
  return `export type SpotlightProduct = {\n  id: string;\n  label: string;\n  name: string;\n  url: string;\n  organizationUrl: string;\n  repositoryUrl: string;\n  description: string;\n};\n\n/** Synchronized with foundry/ops/config/spotlight-products.json. */\nexport const spotlightProducts: readonly SpotlightProduct[] = [\n${contract.products.map((product) => `  {\n    id: '${product.id}',\n    label: '${product.label}',\n    name: '${product.name}',\n    url: '${product.url}',\n    organizationUrl: '${product.organizationUrl}',\n    repositoryUrl: '${product.repositoryUrl}',\n    description: '${product.description}',\n  },`).join('\n')}\n] as const;\n`;
}

async function checkProfileFile(profile, readmePath, contract, errors, warnings, label = profile.id) {
  if (!existsSync(readmePath)) {
    warnings.push(`${label} profile mirror is unavailable at ${readmePath}`);
    return;
  }
  const source = await readFile(readmePath, 'utf8');
  for (const productId of profile.requiredProductIds) {
    const product = contract.products.find((entry) => entry.id === productId);
    if (!source.includes(product.url)) errors.push(`${label} profile is missing ${productId} URL ${product.url}`);
  }
  for (const url of profile.requiredUrls ?? []) {
    if (!source.includes(url)) errors.push(`${label} profile is missing required URL ${url}`);
  }
  for (const marker of profile.requiredText ?? []) {
    if (!source.includes(marker)) errors.push(`${label} profile is missing required text ${marker}`);
  }
}

async function profileChecks(contract, config, workspace, strict, errors, warnings) {
  for (const profile of config.targets.profiles) {
    const readmePath = resolve(resolveCheckout(workspace, profile.checkoutPath), profile.file);
    if (!existsSync(readmePath)) {
      if (strict) errors.push(`${profile.id} profile is unavailable at ${readmePath}`);
    } else {
      await checkProfileFile(profile, readmePath, contract, errors, warnings, profile.id);
    }
    if (profile.localMirror) {
      const mirrorPath = resolve(FLEET_ROOT, profile.localMirror);
      if (existsSync(mirrorPath)) {
        await checkProfileFile(profile, mirrorPath, contract, errors, warnings, `${profile.id} local mirror`);
      } else {
        warnings.push(`${profile.id} local mirror is unavailable at ${mirrorPath}`);
      }
    }
  }
}

async function validate(contract, config, options) {
  const errors = [];
  const warnings = [];
  const expected = contract.products;
  if (contract.version !== 1) errors.push(`unsupported contract version ${contract.version}`);
  if (expected.length !== 4) errors.push(`contract must contain 4 products, found ${expected.length}`);
  if (new Set(expected.map((product) => product.id)).size !== expected.length) errors.push('contract contains duplicate IDs');
  for (const product of expected) {
    for (const field of ['id', 'showcaseId', 'label', 'name', 'url', 'organizationUrl', 'repositoryUrl', 'description']) {
      if (!product[field]) errors.push(`${product.id || '<unknown>'} is missing ${field}`);
    }
  }

  const portfolioPath = resolve(resolveCheckout(options.workspace, config.targets.portfolio.checkoutPath), config.targets.portfolio.file);
  if (!existsSync(portfolioPath)) errors.push(`portfolio target is missing at ${portfolioPath}`);
  else {
    const source = await readFile(portfolioPath, 'utf8');
    for (const product of expected) {
      if (!source.includes(`id: '${product.id}'`)) errors.push(`portfolio is missing ${product.id}`);
      if (!source.includes(product.url)) errors.push(`portfolio has the wrong URL for ${product.id}`);
    }
  }

  await profileChecks(contract, config, options.workspace, options.strict, errors, warnings);
  return { errors, warnings };
}

async function writeConsumers(contract, config, workspace) {
  const portfolioPath = resolve(resolveCheckout(workspace, config.targets.portfolio.checkoutPath), config.targets.portfolio.file);
  await writeFile(portfolioPath, portfolioSource(contract));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [contract, config] = await Promise.all([readJson(CONTRACT_PATH), readJson(SYNC_CONFIG_PATH)]);
  if (options.mode === 'write') {
    await writeConsumers(contract, config, options.workspace);
    console.log('Spotlight consumers regenerated.');
  }
  const result = await validate(contract, config, options);
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  if (result.errors.length) {
    console.error('Fleet spotlight sync FAILED');
    for (const error of result.errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(`Fleet spotlight sync OK (${contract.products.length} products)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
