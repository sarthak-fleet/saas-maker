#!/usr/bin/env node
/**
 * entity-identity-diff — diff one product's public identity across the four
 * places it is declared, and report every field where they disagree.
 *
 * The four sources (SAR-9):
 *   registry   geoIdentities[] in site-health/apps/backend/config/projects.json
 *   directory  projects[].public in the same file, as projected into
 *              saas-maker/catalog/generated/public.json (sassmaker.com)
 *   github     the owning org repo's name / description / homepageUrl
 *   docs       the product's own site: canonical, <title>, meta description,
 *              and its JSON-LD name — read from repo source, not fetched
 *
 * Six fields per the deliverable table: name, description, canonicalUrl,
 * docsUrl, repoUrl, pricing.
 *
 * Usage:
 *   node tooling/scripts/entity-identity-diff.mjs                # all configured
 *   node tooling/scripts/entity-identity-diff.mjs codevetter …   # subset
 *   node tooling/scripts/entity-identity-diff.mjs --no-github    # offline
 *   node tooling/scripts/entity-identity-diff.mjs --json
 *   node tooling/scripts/entity-identity-diff.mjs --markdown
 *
 * Reads only. Never writes to a product repo.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fleetRoot = path.resolve(repoRoot, '..');
const catalogPath = path.resolve(
  process.env.FLEET_PUBLIC_PRODUCTS_PATH ??
    path.join(fleetRoot, 'site-health/apps/backend/config/projects.json')
);
const projectionPath = path.join(repoRoot, 'catalog/generated/public.json');
const sourcesPath = path.join(repoRoot, 'tooling/config/entity-identity-sources.json');

const FIELDS = ['name', 'description', 'canonicalUrl', 'docsUrl', 'repoUrl', 'pricing'];
const SOURCES = ['registry', 'directory', 'github', 'docs'];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--'));
const useGithub = !flags.has('--no-github');

/** Trailing slashes and protocol case are not substance. */
function normalizeUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

/** Compare descriptions on words, not on dash style or casing. */
function normalizeText(value) {
  if (!value) return null;
  const trimmed = String(value)
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed || null;
}

function normalize(field, value) {
  if (value === null || value === undefined || value === '') return null;
  if (field.endsWith('Url')) return normalizeUrl(value);
  if (field === 'description') return normalizeText(value)?.toLowerCase() ?? null;
  return normalizeText(value);
}

// ---------------------------------------------------------------- source A/B

function registryIdentity(geo) {
  if (!geo) return null;
  const pricing =
    geo.pricing?.state === 'published'
      ? (geo.pricing.url ?? 'published')
      : (geo.pricing?.state ?? null);
  return {
    name: geo.name ?? null,
    // Added by entity-identity-apply.mjs, mirrored from projects[].public.
    // Before it existed the registry had nothing to compare and every surface
    // reported a description conflict by default.
    description: geo.description ?? null,
    canonicalUrl: geo.origin ?? null,
    docsUrl: geo.docs?.url ?? null,
    repoUrl: geo.source?.url ?? null,
    pricing,
  };
}

function directoryIdentity(project, projected, directoryEntry) {
  if (!project?.public && !projected) return null;
  const pub = project?.public ?? {};
  return {
    name: projected?.name ?? pub.name ?? null,
    description: projected?.description ?? pub.description ?? null,
    canonicalUrl: projected?.url ?? directoryEntry?.url ?? null,
    // The directory has no dedicated docs field; changelog is the closest
    // published pointer, and is reported separately rather than conflated.
    docsUrl: null,
    repoUrl: projected?.repositoryUrl ?? pub.repositoryUrl ?? null,
    pricing: null,
  };
}

// ------------------------------------------------------------------ source C

function parseRepoSlug(url) {
  if (!url) return null;
  const match = String(url).match(/github\.com\/([^/#?]+)\/([^/#?]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
}

async function githubIdentity(slug) {
  if (!slug) return { identity: null, error: 'no repo slug in registry or directory' };
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', slug, '--json', 'name,nameWithOwner,description,homepageUrl,url,isPrivate'],
      { timeout: 30_000 }
    );
    const repo = JSON.parse(stdout);
    return {
      identity: {
        // Deliberately not repo.name: the slug is kebab-case by GitHub
        // convention, so comparing it to a display name manufactures a
        // conflict on every surface. The repo's identity claims are its
        // description and homepage.
        name: null,
        description: repo.description ?? null,
        canonicalUrl: repo.homepageUrl ?? null,
        docsUrl: null,
        repoUrl: repo.url ?? null,
        pricing: null,
      },
      meta: { isPrivate: repo.isPrivate, nameWithOwner: repo.nameWithOwner },
    };
  } catch (error) {
    return { identity: null, error: `gh repo view ${slug}: ${shortError(error)}` };
  }
}

function shortError(error) {
  const raw = String(error?.stderr || error?.message || error);
  return raw.split('\n')[0].slice(0, 200);
}

// ------------------------------------------------------------------ source D

const EXTRACTORS = {
  /** First capture group of the first matching pattern. */
  async pattern(spec, surfaceRoot) {
    for (const rel of spec.files) {
      let text;
      try {
        text = await readFile(path.join(surfaceRoot, rel), 'utf8');
      } catch {
        continue;
      }
      for (const raw of spec.patterns) {
        const match = text.match(new RegExp(raw, spec.flags ?? ''));
        if (match) return { value: match[1] ?? match[0], from: `${rel}` };
      }
    }
    return { value: null, from: null };
  },
  /** A literal value asserted by the config, with a file:line citation. */
  async literal(spec) {
    return { value: spec.value ?? null, from: spec.from ?? null };
  },
  /**
   * Concatenate several pattern extractions — a docs site declares its URL as
   * `site` + `base` in two separate config keys, so neither alone is the URL.
   */
  async concat(spec, surfaceRoot) {
    const parts = [];
    const froms = [];
    for (const part of spec.parts) {
      const { value, from } = await EXTRACTORS.pattern(part, surfaceRoot);
      if (value === null) return { value: null, from: null };
      parts.push(value);
      if (from) froms.push(from);
    }
    return { value: parts.join(''), from: [...new Set(froms)].join(', ') };
  },
};

async function docsIdentity(surface) {
  const surfaceRoot = path.join(fleetRoot, surface.repoPath ?? surface.id);
  const identity = {};
  const provenance = {};
  for (const field of FIELDS) {
    const spec = surface.docs?.[field];
    if (!spec) {
      identity[field] = null;
      continue;
    }
    const extract = EXTRACTORS[spec.kind ?? 'pattern'];
    const { value, from } = await extract(spec, surfaceRoot);
    identity[field] = value;
    if (from) provenance[field] = from;
  }
  return { identity, provenance };
}

// -------------------------------------------------------------------- diffing

function diffSurface(identities) {
  const rows = [];
  for (const field of FIELDS) {
    const present = SOURCES.map((source) => ({
      source,
      raw: identities[source]?.[field] ?? null,
      norm: normalize(field, identities[source]?.[field]),
    }));
    const declared = present.filter((entry) => entry.norm !== null);
    const distinct = [...new Set(declared.map((entry) => entry.norm))];
    rows.push({
      field,
      values: present,
      declaredCount: declared.length,
      missing: present.filter((entry) => entry.norm === null).map((entry) => entry.source),
      agrees: distinct.length <= 1,
      distinct: distinct.length,
    });
  }
  return rows;
}

// ----------------------------------------------------------------------- main

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const projection = JSON.parse(await readFile(projectionPath, 'utf8'));
  const surfaces = JSON.parse(await readFile(sourcesPath, 'utf8')).surfaces;

  const geoById = new Map((catalog.geoIdentities ?? []).map((g) => [g.id, g]));
  const projectById = new Map((catalog.projects ?? []).map((p) => [p.id, p]));
  const projectedById = new Map((projection.products ?? []).map((p) => [p.id, p]));
  const directoryById = new Map((projection.directory ?? []).map((p) => [p.id, p]));

  const selected = only.length ? surfaces.filter((s) => only.includes(s.id)) : surfaces;
  if (!selected.length) {
    console.error(`No configured surface matched: ${only.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const report = [];
  for (const surface of selected) {
    const geo = geoById.get(surface.id);
    const project = projectById.get(surface.id);
    const registry = registryIdentity(geo);
    const directory = directoryIdentity(
      project,
      projectedById.get(surface.id),
      directoryById.get(surface.id)
    );
    const { identity: docs, provenance } = await docsIdentity(surface);

    const slug =
      surface.repoSlug ?? parseRepoSlug(registry?.repoUrl ?? directory?.repoUrl ?? null);
    const github = useGithub
      ? await githubIdentity(slug)
      : { identity: null, error: 'skipped (--no-github)' };

    const identities = { registry, directory, github: github.identity, docs };
    report.push({
      id: surface.id,
      label: surface.label ?? surface.id,
      domain: surface.domain ?? null,
      repoSlug: slug,
      inRegistry: Boolean(geo),
      inDirectory: Boolean(projectedById.get(surface.id)),
      githubError: github.error ?? null,
      githubMeta: github.meta ?? null,
      docsProvenance: provenance,
      identities,
      rows: diffSurface(identities),
    });
  }

  if (flags.has('--json')) {
    console.log(JSON.stringify({ generatedFrom: [catalogPath, projectionPath], report }, null, 2));
    return;
  }
  if (flags.has('--markdown')) {
    console.log(renderMarkdown(report));
    return;
  }
  console.log(renderText(report));
}

function show(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function renderText(report) {
  const lines = [];
  let disagreements = 0;
  for (const surface of report) {
    lines.push(`\n=== ${surface.label}  (${surface.id}${surface.domain ? ` · ${surface.domain}` : ''})`);
    if (!surface.inRegistry) lines.push('  !! absent from geoIdentities');
    if (!surface.inDirectory) lines.push('  !! absent from the sassmaker.com projection');
    if (surface.githubError) lines.push(`  !! github: ${surface.githubError}`);
    for (const row of surface.rows) {
      if (row.agrees && !row.missing.length) continue;
      if (!row.agrees) disagreements += 1;
      const status = row.agrees ? 'gap' : 'CONFLICT';
      lines.push(`  [${status}] ${row.field}`);
      for (const entry of row.values) {
        lines.push(`      ${entry.source.padEnd(10)} ${show(entry.raw)}`);
      }
    }
  }
  lines.push(`\n${disagreements} field conflict(s) across ${report.length} surface(s).`);
  return lines.join('\n');
}

function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `\`${String(value).replace(/\|/g, '\\|')}\``;
}

function renderMarkdown(report) {
  const lines = [];
  for (const surface of report) {
    lines.push(`### ${surface.label} — \`${surface.domain ?? surface.id}\`\n`);
    const notes = [];
    if (!surface.inRegistry) notes.push('**absent from `geoIdentities`**');
    if (!surface.inDirectory) notes.push('**absent from the `sassmaker.com` projection**');
    if (surface.githubError) notes.push(`github unreadable: ${surface.githubError}`);
    if (notes.length) lines.push(`${notes.map((n) => `- ${n}`).join('\n')}\n`);
    lines.push('| Field | registry | directory | github | docs site | verdict |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const row of surface.rows) {
      // A single declaring source is not agreement, it is an untested field.
      // The `pricing` row hit this on all 32 surfaces and read "agrees" the whole
      // time it was wrong: the registry was agreeing with itself. Say so instead —
      // entity-identity-live.mjs is what actually tests pricing against the surface.
      const verdict = !row.agrees
        ? `**conflict (${row.distinct})**`
        : row.declaredCount === 0
          ? 'undeclared everywhere'
          : row.declaredCount === 1
            ? `only ${row.values.find((v) => v.raw != null)?.source ?? 'one source'} declares it — nothing to compare`
            : row.missing.length
              ? `agrees, missing in ${row.missing.join('/')}`
              : 'agrees';
      const byName = Object.fromEntries(row.values.map((v) => [v.source, v.raw]));
      lines.push(
        `| ${row.field} | ${cell(byName.registry)} | ${cell(byName.directory)} | ${cell(byName.github)} | ${cell(byName.docs)} | ${verdict} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
