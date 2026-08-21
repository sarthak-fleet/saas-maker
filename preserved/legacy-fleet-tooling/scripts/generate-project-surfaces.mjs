#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPublicProducts } from '../lib/public-products.mjs';
import {
  buildAutomationProjection,
  buildMarketingProjection,
  renderInternalCatalog,
  renderReadmePortfolio,
  replaceGeneratedSection,
  validateProjectCatalog,
} from '../lib/project-catalog.mjs';
import {
  renderSeoGeoPublishing,
  validateSeoGeoPublishing,
} from '../lib/seo-geo-publishing.mjs';
import {
  buildSeoGeoDestinations,
  renderSeoGeoDestinations,
} from '../lib/seo-geo-destinations.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const check = process.argv.includes('--check');
const paths = {
  catalog: path.join(root, 'foundry/ops/config/projects.json'),
  automation: path.join(root, 'foundry/ops/config/automation-registry.json'),
  marketing: path.join(root, 'foundry/ops/config/marketing-program.json'),
  sites: path.join(root, 'foundry/ops/config/project-sites.json'),
  toolbox: path.join(root, 'foundry/ops/config/significant-hobbies-toolbox.json'),
  agentRegistry: path.join(root, 'foundry/ops/config/agent-surfaces-registry.json'),
  seoGeoPublishing: path.join(root, 'foundry/ops/config/seo-geo-publishing.json'),
  seoGeoDestinationSupplements: path.join(root, 'foundry/ops/config/seo-geo-destination-supplements.json'),
  directorySubmissions: path.join(root, 'foundry/ops/config/directory-submissions/directories.json'),
  directoryResearchProbe: path.join(root, 'foundry/ops/config/directory-submissions/research-probe.json'),
  public: path.join(root, 'foundry/ops/public/products.json'),
  internalReadme: path.join(root, 'foundry/ops/docs/project-catalog.md'),
  seoGeoPublishingGuide: path.join(root, 'foundry/ops/docs/seo-geo-external-publishing.md'),
  seoGeoDestinationGuide: path.join(root, 'foundry/ops/docs/seo-geo-destinations.md'),
  rootReadme: path.join(root, 'README.md'),
};

const [catalog, automation, marketing, sites, toolbox, agentRegistry, seoGeoPublishing, seoGeoDestinationSupplements, directorySubmissions, directoryResearchProbe, rootReadme] = await Promise.all([
  readJson(paths.catalog),
  readJson(paths.automation),
  readJson(paths.marketing),
  readJson(paths.sites),
  readJson(paths.toolbox),
  readJson(paths.agentRegistry),
  readJson(paths.seoGeoPublishing),
  readJson(paths.seoGeoDestinationSupplements),
  readJson(paths.directorySubmissions),
  readJson(paths.directoryResearchProbe),
  readFile(paths.rootReadme, 'utf8'),
]);

validateProjectCatalog(catalog, {
  fleetRoot: root,
  automationRegistry: automation,
  marketingProgram: marketing,
  siteRegistry: sites,
  toolboxRegistry: toolbox,
  agentRegistry,
});
validateSeoGeoPublishing(seoGeoPublishing, catalog);
const seoGeoDestinations = buildSeoGeoDestinations({
  program: seoGeoPublishing,
  directories: directorySubmissions,
  probe: directoryResearchProbe,
  supplements: seoGeoDestinationSupplements,
});

const outputs = new Map([
  [paths.automation, json(buildAutomationProjection(catalog, automation))],
  [paths.marketing, json(buildMarketingProjection(catalog, marketing))],
  [paths.public, json(buildPublicProducts(catalog))],
  [paths.internalReadme, renderInternalCatalog(catalog)],
  [paths.seoGeoPublishingGuide, renderSeoGeoPublishing(seoGeoPublishing, catalog)],
  [paths.seoGeoDestinationGuide, renderSeoGeoDestinations(seoGeoDestinations)],
  [paths.rootReadme, replaceGeneratedSection(rootReadme, renderReadmePortfolio(catalog))],
]);

const stale = [];
for (const [file, rendered] of outputs) {
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current === rendered) continue;
  if (check) stale.push(path.relative(root, file));
  else await writeFile(file, rendered);
}

if (stale.length) {
  console.error(`Generated project surfaces are stale:\n- ${stale.join('\n- ')}`);
  process.exitCode = 1;
} else if (check) {
  console.log(`Project catalog is current (${catalog.projects.length} identities)`);
} else {
  console.log(`Generated project surfaces from ${catalog.projects.length} identities`);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
