#!/usr/bin/env node
import { resolve } from 'node:path';

import { loadQuietExperiments } from '../lib/portfolio-identity-quiet-experiments.mjs';

const path = resolve(import.meta.dirname, '../config/portfolio-identity-quiet-experiments.json');
const registry = loadQuietExperiments(path);
const launchable = registry.experiments.filter((e) => e.launchApproved).length;
console.log(
  `portfolio-identity quiet experiments v${registry.version}: ${registry.experiments.length} experiments, ` +
  `${launchable} launch-approved (must be 0)`,
);
