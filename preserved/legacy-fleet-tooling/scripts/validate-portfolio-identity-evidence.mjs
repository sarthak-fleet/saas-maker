#!/usr/bin/env node
import { resolve } from 'node:path';

import { loadPortfolioIdentityEvidence } from '../lib/portfolio-identity-evidence.mjs';

const path = resolve(import.meta.dirname, '../config/portfolio-identity-evidence.json');
const registry = loadPortfolioIdentityEvidence(path);
console.log(
  `portfolio-identity evidence v${registry.version}: ${registry.surfaces.length} surfaces, ` +
  `${registry.forbiddenPayloadFields.length} forbidden payload fields, ` +
  `mayRecommend=${registry.promotionPolicy.mayRecommend}`,
);
