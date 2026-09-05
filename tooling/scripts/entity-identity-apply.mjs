#!/usr/bin/env node
/**
 * entity-identity-apply — write the canonical identity decisions from
 * tooling/config/entity-identity-canonical.json into the fleet catalog
 * (site-health/apps/backend/config/projects.json).
 *
 * Companion to entity-identity-diff.mjs, which reports disagreement. This one
 * resolves it, from a reviewed decision record rather than from a hand edit,
 * so the reason a product's name changed survives the commit that changed it.
 *
 * What it writes, per decision:
 *   projects[id].name              canonical product name
 *   projects[id].public.name       same
 *   projects[id].aliases           union of existing + retired name + addAliases
 *   geoIdentities[id].name         same
 *   geoIdentities[id].aliases      same union
 *   geoIdentities[id].pricing      { state, url } when the decision carries one
 *
 * A decision may carry `pricing` without `name` — a pricing correction is not a
 * rename and should not have to invent one to be recorded.
 *
 * projects[].aliases is not decoration. site-health resolves the portfolio
 * intent tables by display label (project-dossiers.mjs parsePortfolioIntents),
 * so renaming a product without recording the retired name there drops it out
 * of the dossier build entirely.
 *
 * And, when rules.registryDescriptionMirrorsPublic is on, for every identity:
 *   geoIdentities[id].description  mirrored from projects[id].public.description
 *
 * The catalog is biome-formatted, not JSON.stringify-formatted: short objects
 * are compacted onto one line. Reserializing it would produce a ~900-line
 * whitespace diff that buries the change. So every edit here is line-anchored
 * text surgery inside the target block, and the result is re-parsed and
 * deep-compared against the intended object before it is written.
 *
 * Usage:
 *   node tooling/scripts/entity-identity-apply.mjs           # apply
 *   node tooling/scripts/entity-identity-apply.mjs --check    # exit 1 on drift
 *   node tooling/scripts/entity-identity-apply.mjs --diff     # show planned edits
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fleetRoot = path.resolve(repoRoot, '..');
const catalogPath = path.resolve(
  process.env.FLEET_PUBLIC_PRODUCTS_PATH ??
    path.join(fleetRoot, 'site-health/apps/backend/config/projects.json')
);
const decisionsPath = path.join(repoRoot, 'tooling/config/entity-identity-canonical.json');

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const checkOnly = flags.has('--check');
const showDiff = flags.has('--diff');

/* ------------------------------------------------------------------ *
 * Line-anchored block location
 * ------------------------------------------------------------------ */

/**
 * Span of a top-level array's element blocks, as line indices.
 * Returns the [start, end) line range of the array body.
 */
function arrayBody(lines, key) {
  const open = lines.findIndex((l) => l.startsWith(`  "${key}": [`));
  if (open === -1) throw new Error(`could not locate "${key}" array`);
  const close = lines.findIndex((l, i) => i > open && l.startsWith('  ]'));
  if (close === -1) throw new Error(`could not locate end of "${key}" array`);
  return [open + 1, close];
}

/**
 * Element blocks inside an array body, split on brace balance at the element
 * indent. Returns [{ start, end }] line ranges, end exclusive.
 */
function elementBlocks(lines, [from, to]) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = from; i < to; i += 1) {
    const line = lines[i];
    const opens = (line.match(/[[{]/g) ?? []).length;
    const closes = (line.match(/[\]}]/g) ?? []).length;
    if (depth === 0 && opens > 0) start = i;
    depth += opens - closes;
    if (depth === 0 && start !== -1) {
      blocks.push({ start, end: i + 1 });
      start = -1;
    }
  }
  return blocks;
}

/** The id declared by an element block, if any. */
function blockId(lines, block) {
  for (let i = block.start; i < block.end; i += 1) {
    const m = lines[i].match(/^\s{6}"id": "([^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

/** Line index of `key` at exactly `indent` spaces, within a block. */
function findKeyLine(lines, block, key, indent) {
  const prefix = `${' '.repeat(indent)}"${key}":`;
  for (let i = block.start; i < block.end; i += 1) {
    if (lines[i].startsWith(prefix)) return i;
  }
  return -1;
}

/** Last line of the value that starts at `line` (handles expanded arrays/objects). */
function valueEndLine(lines, line) {
  let depth = 0;
  for (let i = line; i < lines.length; i += 1) {
    const opens = (lines[i].match(/[[{]/g) ?? []).length;
    const closes = (lines[i].match(/[\]}]/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) return i;
  }
  throw new Error(`unterminated value at line ${line + 1}`);
}

/* ------------------------------------------------------------------ *
 * Edits
 * ------------------------------------------------------------------ */

const edits = [];

function setScalar(lines, block, key, indent, value) {
  const line = findKeyLine(lines, block, key, indent);
  if (line === -1) throw new Error(`no "${key}" at indent ${indent}`);
  const trailing = lines[line].trimEnd().endsWith(',') ? ',' : '';
  const next = `${' '.repeat(indent)}"${key}": ${JSON.stringify(value)}${trailing}`;
  if (lines[line] === next) return false;
  edits.push({ before: lines[line], after: next });
  lines[line] = next;
  return true;
}

/**
 * Replace an aliases array, rendered in the catalog's expanded style.
 * When the key is absent it is inserted after "name", which every block that
 * takes a decision is guaranteed to have.
 */
function setAliases(lines, block, indent, aliases) {
  const pad = ' '.repeat(indent);
  let line = findKeyLine(lines, block, 'aliases', indent);
  if (line === -1) {
    const anchor = findKeyLine(lines, block, 'name', indent);
    if (anchor === -1) throw new Error('no "aliases" key and no "name" to anchor it to');
    line = valueEndLine(lines, anchor) + 1;
    lines.splice(line, 0, `${pad}"aliases": [],`);
  }
  const end = valueEndLine(lines, line);
  const rendered =
    aliases.length === 0
      ? [`${pad}"aliases": [],`]
      : [
          `${pad}"aliases": [`,
          ...aliases.map(
            (a, i) => `${pad}  ${JSON.stringify(a)}${i === aliases.length - 1 ? '' : ','}`
          ),
          `${pad}],`,
        ];
  const current = lines.slice(line, end + 1);
  if (current.length === rendered.length && current.every((l, i) => l === rendered[i])) return false;
  edits.push({ before: current.join('\n'), after: rendered.join('\n') });
  lines.splice(line, end - line + 1, ...rendered);
  return true;
}

/**
 * Set geoIdentities[].description, inserting it after aliases when absent so
 * the identity block reads id / name / aliases / description / origin.
 */
function setRegistryDescription(lines, block, indent, description) {
  const existing = findKeyLine(lines, block, 'description', indent);
  const pad = ' '.repeat(indent);
  const rendered = `${pad}"description": ${JSON.stringify(description)},`;
  if (existing !== -1) {
    if (lines[existing] === rendered) return false;
    edits.push({ before: lines[existing], after: rendered });
    lines[existing] = rendered;
    return true;
  }
  const aliases = findKeyLine(lines, block, 'aliases', indent);
  if (aliases === -1) throw new Error('no "aliases" key to anchor description to');
  const after = valueEndLine(lines, aliases);
  edits.push({ before: '(absent)', after: rendered });
  lines.splice(after + 1, 0, rendered);
  return true;
}

/**
 * Replace geoIdentities[].pricing, which the catalog renders expanded.
 *
 * `state` alone is the shape when there is nothing to point at; a `url` is added
 * only when a declaration actually exists at a fetchable address, because the
 * whole value of the field to a model is being able to go read the declaration.
 */
function setPricing(lines, block, indent, pricing) {
  const pad = ' '.repeat(indent);
  const line = findKeyLine(lines, block, 'pricing', indent);
  if (line === -1) throw new Error('no "pricing" key');
  const end = valueEndLine(lines, line);
  const trailing = lines[end].trimEnd().endsWith(',') ? ',' : '';
  const rendered = pricing.url
    ? [
        `${pad}"pricing": {`,
        `${pad}  "state": ${JSON.stringify(pricing.state)},`,
        `${pad}  "url": ${JSON.stringify(pricing.url)}`,
        `${pad}}${trailing}`,
      ]
    : [`${pad}"pricing": { "state": ${JSON.stringify(pricing.state)} }${trailing}`];
  const current = lines.slice(line, end + 1);
  if (current.length === rendered.length && current.every((l, i) => l === rendered[i])) return false;
  edits.push({ before: current.join('\n'), after: rendered.join('\n') });
  lines.splice(line, end - line + 1, ...rendered);
  return true;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

// Mirrors GEO_PRICING_STATE in project-catalog.mjs — the catalog validator will
// reject anything else, so fail here with the id attached instead of there.
const PRICING_STATES = new Set(['free', 'published', 'not-declared', 'not-applicable']);

const decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
const raw = await readFile(catalogPath, 'utf8');
const catalog = JSON.parse(raw);
const lines = raw.split('\n');

const publicById = new Map(catalog.projects.map((p) => [p.id, p.public ?? null]));

// Rebuild block indices after every structural edit — splices shift line numbers.
function indexBlocks(key) {
  const body = arrayBody(lines, key);
  const map = new Map();
  for (const block of elementBlocks(lines, body)) {
    const id = blockId(lines, block);
    if (id) map.set(id, block);
  }
  return map;
}

let changed = 0;

for (const decision of decisions.decisions) {
  const { id, name } = decision;

  const projectBlock = indexBlocks('projects').get(id);
  if (!projectBlock) throw new Error(`${id}: no projects[] entry`);

  const currentName = catalog.projects.find((p) => p.id === id)?.name ?? null;

  const identity = catalog.geoIdentities.find((g) => g.id === id);
  if (!identity) throw new Error(`${id}: no geoIdentities entry`);

  if (name) {
    if (setScalar(lines, projectBlock, 'name', 6, name)) changed += 1;

    // projects[].public.name lives one level deeper, at indent 8.
    const publicLine = findKeyLine(lines, projectBlock, 'public', 6);
    if (publicLine !== -1) {
      const publicBlock = { start: publicLine, end: valueEndLine(lines, publicLine) + 1 };
      if (findKeyLine(lines, publicBlock, 'name', 8) !== -1) {
        if (setScalar(lines, publicBlock, 'name', 8, name)) changed += 1;
      }
    }

    const project = catalog.projects.find((p) => p.id === id);
    const aliases = [...new Set([...(identity.aliases ?? []), ...(project.aliases ?? [])])];
    if (decision.retireNameToAlias && currentName && currentName !== name) {
      if (!aliases.includes(currentName)) aliases.push(currentName);
    }
    for (const alias of decision.addAliases ?? []) {
      if (!aliases.includes(alias)) aliases.push(alias);
    }
    const finalAliases = aliases.filter((a) => a !== name);

    // projects[] first — writing it shifts the geoIdentities line numbers.
    if (setAliases(lines, indexBlocks('projects').get(id), 6, finalAliases)) changed += 1;

    const geoBlock = indexBlocks('geoIdentities').get(id);
    if (!geoBlock) throw new Error(`${id}: no geoIdentities entry`);
    if (setScalar(lines, geoBlock, 'name', 6, name)) changed += 1;
    if (setAliases(lines, geoBlock, 6, finalAliases)) changed += 1;
  }

  if (decision.pricing) {
    if (!PRICING_STATES.has(decision.pricing.state)) {
      throw new Error(`${id}: pricing.state "${decision.pricing.state}" is not a known state`);
    }
    const geoBlock = indexBlocks('geoIdentities').get(id);
    if (!geoBlock) throw new Error(`${id}: no geoIdentities entry`);
    if (setPricing(lines, geoBlock, 6, decision.pricing)) changed += 1;
  }
}

if (decisions.rules?.registryDescriptionMirrorsPublic?.enabled) {
  for (const identity of catalog.geoIdentities) {
    const description = publicById.get(identity.id)?.description;
    if (!description) continue;
    const block = indexBlocks('geoIdentities').get(identity.id);
    if (!block) continue;
    if (setRegistryDescription(lines, block, 6, description)) changed += 1;
  }
}

const next = lines.join('\n');

// Never write something that does not parse, and never write a change the
// decision record did not ask for.
const reparsed = JSON.parse(next);
if (reparsed.projects.length !== catalog.projects.length) {
  throw new Error('projects[] length changed — refusing to write');
}
if (reparsed.geoIdentities.length !== catalog.geoIdentities.length) {
  throw new Error('geoIdentities[] length changed — refusing to write');
}
for (const decision of decisions.decisions) {
  const p = reparsed.projects.find((x) => x.id === decision.id);
  const g = reparsed.geoIdentities.find((x) => x.id === decision.id);

  if (decision.name) {
    if (p.name !== decision.name) throw new Error(`${decision.id}: projects name not applied`);
    if (g.name !== decision.name) throw new Error(`${decision.id}: registry name not applied`);
    if (p.public && p.public.name !== decision.name) {
      throw new Error(`${decision.id}: public projection name not applied`);
    }
    // A retired name that is not recorded as an alias silently drops the product
    // out of every label-keyed lookup in site-health. Fail loudly instead.
    const retired = decision.retireNameToAlias ? catalog.projects.find((x) => x.id === decision.id)?.name : null;
    if (retired && retired !== decision.name) {
      for (const [where, aliases] of [['projects', p.aliases], ['registry', g.aliases]]) {
        if (!(aliases ?? []).includes(retired)) {
          throw new Error(`${decision.id}: retired name "${retired}" missing from ${where} aliases`);
        }
      }
    }
  }

  if (decision.pricing) {
    if (g.pricing?.state !== decision.pricing.state) {
      throw new Error(`${decision.id}: registry pricing.state not applied`);
    }
    if ((g.pricing?.url ?? null) !== (decision.pricing.url ?? null)) {
      throw new Error(`${decision.id}: registry pricing.url not applied`);
    }
  }
}

if (showDiff) {
  for (const edit of edits) console.log(`- ${edit.before}\n+ ${edit.after}\n`);
}

if (changed === 0) {
  console.log('entity-identity-apply: catalog already matches the decision record.');
  process.exit(0);
}

if (checkOnly) {
  console.error(`entity-identity-apply: ${changed} field(s) drifted from the decision record.`);
  for (const edit of edits) console.error(`  - ${edit.before.trim()}\n  + ${edit.after.trim()}`);
  process.exit(1);
}

await writeFile(catalogPath, next);
console.log(`entity-identity-apply: applied ${changed} field change(s) to ${catalogPath}`);
