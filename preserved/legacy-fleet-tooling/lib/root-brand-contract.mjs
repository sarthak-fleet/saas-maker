import { readFileSync } from 'node:fs';

import {
  domainStrengthRoots,
  normalizedDomain,
  registrableDomain,
} from './founder-control/domain-scope.mjs';

const ROOT_DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const MAX_ALTERNATE_NAMES = 3;

function normalizedName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function validateRootBrandContract(contract, projects) {
  if (!contract || contract.version !== 1 || !Array.isArray(contract.brands)) {
    throw new Error('root brand contract must contain version 1 and a brands array');
  }

  const byRoot = new Map();
  const globalNames = new Map();
  for (const brand of contract.brands) {
    const root = String(brand?.rootDomain ?? '').trim();
    const canonicalName = String(brand?.canonicalName ?? '').trim();
    const alternateNames = brand?.alternateNames;

    if (!ROOT_DOMAIN_PATTERN.test(root) || root !== root.toLowerCase()) {
      throw new Error(`invalid root brand domain: ${root || '(empty)'}`);
    }
    if (byRoot.has(root)) throw new Error(`duplicate root brand domain: ${root}`);
    if (!canonicalName) throw new Error(`missing canonical brand name: ${root}`);
    if (!Array.isArray(alternateNames) || alternateNames.length > MAX_ALTERNATE_NAMES) {
      throw new Error(`invalid alternate brand names: ${root}`);
    }

    const recordNames = [canonicalName, ...alternateNames];
    const localNames = new Set();
    for (const name of recordNames) {
      const trimmed = String(name ?? '').trim();
      const normalized = normalizedName(trimmed);
      if (!trimmed) throw new Error(`empty brand name: ${root}`);
      if (localNames.has(normalized)) throw new Error(`duplicate brand name for ${root}: ${trimmed}`);
      localNames.add(normalized);

      const existingRoot = globalNames.get(normalized);
      if (existingRoot && existingRoot !== root) {
        throw new Error(`brand name belongs to multiple roots: ${trimmed}`);
      }
      globalNames.set(normalized, root);
    }

    byRoot.set(root, {
      rootDomain: root,
      canonicalName,
      alternateNames: alternateNames.map((name) => String(name).trim()),
    });
  }

  const expectedRoots = domainStrengthRoots(projects);
  const actualRoots = [...byRoot.keys()].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualRoots) !== JSON.stringify(expectedRoots)) {
    const missing = expectedRoots.filter((root) => !byRoot.has(root));
    const extra = actualRoots.filter((root) => !expectedRoots.includes(root));
    throw new Error(`root brand coverage mismatch: missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`);
  }

  return byRoot;
}

export function loadRootBrandContract(path, projects) {
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  return validateRootBrandContract(contract, projects);
}

export function rootBrandForUrl(url, brandMap) {
  const domain = normalizedDomain(url);
  if (!domain) return null;
  return brandMap.get(registrableDomain(domain)) ?? null;
}
