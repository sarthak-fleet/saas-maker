/**
 * Name agreement — does a live surface tell an agent the same name the fleet
 * records say it has?
 *
 * agent-ready checked that /llms.txt, /api/ai and JSON-LD are PRESENT. It did
 * not check that they AGREE, so eight surfaces scored S-tier while publishing a
 * different product name to agents than the canonical record carries
 * (sass-maker/saas-maker#94). Presence is what gets a surface read; agreement is
 * what makes being read resolve to the right entity.
 *
 * Canonical order:
 *   1. tooling/config/entity-identity-canonical.json — the record of what was
 *      DECIDED, including decisions not yet applied to the catalog.
 *   2. geoIdentities[] in the site-health catalog — the applied form of those
 *      decisions, and the only place aliases are enumerated.
 *
 * The comparison is deliberately exact. Case is not cosmetic in a brand name:
 * `posttrainllm` and `drank` differ from canonical by case alone and both are
 * repo slugs leaking onto an agent surface, so normalizing case away would
 * silently pass two real defects.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// lib → tooling → saas-maker → fleet root
const TOOLING_ROOT = resolve(__dirname, '..');
const FLEET_ROOT = resolve(__dirname, '../../..');

export const CANONICAL_DECISIONS_PATH = join(
  TOOLING_ROOT,
  'config/entity-identity-canonical.json'
);
export const CATALOG_PATH =
  process.env.FLEET_PUBLIC_PRODUCTS_PATH ??
  join(FLEET_ROOT, 'site-health/apps/backend/config/projects.json');

/**
 * Drift classes, worst last. `unrecorded` is the only one that is not a record
 * we could correct: the surface asserts a name that exists nowhere internally,
 * so an agent resolving it lands on something the fleet has no row for.
 */
export const DRIFT_CLASSES = ['ok', 'casing', 'slug-leak', 'retired-alias', 'unrecorded'];

const CHANNELS = ['llms.txt', '/api/ai', 'json-ld'];

/** Slug form of a name: lowercase, runs of non-alphanumerics collapsed to `-`. */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/** A value that is already in slug shape — lowercase, no spaces, hyphen/underscore joined. */
function looksLikeSlug(value) {
  return /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value);
}

/**
 * Classify one observed name against the canonical record.
 *
 * @param {string} value observed name, exactly as published
 * @param {{ name: string, aliases?: string[] }} canonical
 * @returns {'ok'|'casing'|'slug-leak'|'retired-alias'|'unrecorded'}
 */
export function classifyName(value, canonical) {
  const observed = String(value).trim();
  const name = String(canonical?.name ?? '').trim();
  const aliases = (canonical?.aliases ?? []).map((a) => String(a).trim());
  if (!observed || !name) return 'unrecorded';
  if (observed === name) return 'ok';
  if (observed.toLowerCase() === name.toLowerCase()) return 'casing';
  // A repo slug is classified as a slug leak even when it is a recorded alias:
  // recording it stops it being unexplained, it does not make it a name the
  // product goes by. psi-swarm publishes `psi-swarm` where the product is
  // `PSI Swarm`, and that is a defect in the surface, not in the record.
  if (looksLikeSlug(observed) && slugify(observed) === slugify(name)) return 'slug-leak';
  if (aliases.some((alias) => alias === observed)) return 'retired-alias';
  if (aliases.some((alias) => alias.toLowerCase() === observed.toLowerCase())) {
    return 'retired-alias';
  }
  return 'unrecorded';
}

/** Worst (last-listed) class in a set. */
export function worstClass(classes) {
  let worst = 'ok';
  for (const value of classes) {
    if (DRIFT_CLASSES.indexOf(value) > DRIFT_CLASSES.indexOf(worst)) worst = value;
  }
  return worst;
}

/** llms.txt declares the product in its first markdown heading. */
export function llmsName(text) {
  if (!text) return null;
  const line = text.split('\n').find((l) => l.trim().startsWith('#'));
  return line ? line.replace(/^#+\s*/, '').trim() || null : null;
}

/** /api/ai declares it as `name` (some surfaces nest it under `product`). */
export function apiAiName(text) {
  if (!text) return null;
  let data = text;
  if (typeof text === 'string') {
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const name = data?.name ?? data?.product?.name ?? null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * The name a model reads from markup is the WebSite / application node — NOT
 * the first `"name"` in the document, which is usually the Person node for the
 * author and reports false drift on every surface that credits one.
 * Organization is read only as a fallback, for surfaces that publish no
 * WebSite/app node at all.
 */
export function jsonLdNames(html) {
  if (!html) return [];
  const primary = [];
  const fallback = [];
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, body] of blocks) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === 'object') {
        const types = [node['@type']].flat().filter(Boolean);
        if (node.name && typeof node.name === 'string') {
          if (types.some((t) => ['WebSite', 'SoftwareApplication', 'WebApplication'].includes(t))) {
            primary.push(node.name.trim());
          } else if (types.includes('Organization')) {
            fallback.push(node.name.trim());
          }
        }
        stack.push(...Object.values(node));
      }
    }
  }
  return primary.length ? primary : fallback;
}

export function jsonLdName(html) {
  return jsonLdNames(html)[0] ?? null;
}

/**
 * Read the canonical identity record: geoIdentities as the applied form, with
 * entity-identity-canonical.json decisions layered on top so a decision that
 * has been made but not yet written into the catalog still governs.
 *
 * @returns {Map<string, { id: string, name: string, aliases: string[], origin: string|null }>}
 */
export function loadCanonicalIdentities({
  catalogPath = CATALOG_PATH,
  decisionsPath = CANONICAL_DECISIONS_PATH,
} = {}) {
  const identities = new Map();

  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    for (const entry of catalog.geoIdentities ?? []) {
      if (!entry?.id || !entry?.name) continue;
      identities.set(entry.id, {
        id: entry.id,
        name: entry.name,
        aliases: [...(entry.aliases ?? [])],
        origin: entry.origin ?? null,
      });
    }
  }

  if (existsSync(decisionsPath)) {
    const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
    for (const decision of decisions.decisions ?? []) {
      if (!decision?.id) continue;
      const current = identities.get(decision.id) ?? {
        id: decision.id,
        name: decision.name ?? null,
        aliases: [],
        origin: decision.canonicalUrl ?? null,
      };
      const aliases = new Set(current.aliases);
      for (const alias of decision.addAliases ?? []) aliases.add(alias);
      if (decision.name && decision.name !== current.name) {
        // A decided rename the catalog has not caught up with yet. The name it
        // replaced stays resolvable as an alias when the decision retired it.
        if (decision.retireNameToAlias && current.name) aliases.add(current.name);
        current.name = decision.name;
      }
      if (!current.name) continue;
      identities.set(decision.id, {
        ...current,
        aliases: [...aliases],
        origin: decision.canonicalUrl ?? current.origin,
      });
    }
  }

  return identities;
}

/** Look an identity up by registry id, falling back to the origin's host. */
export function canonicalIdentityFor(identities, { id, origin } = {}) {
  if (id && identities.has(id)) return identities.get(id);
  if (!origin) return null;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }
  for (const identity of identities.values()) {
    if (!identity.origin) continue;
    try {
      if (new URL(identity.origin).host === host) return identity;
    } catch {
      /* a malformed origin in the record is not this check's problem */
    }
  }
  return null;
}

/**
 * Grade the three agent-readable channels against the canonical record.
 *
 * Any drift fails the check, which is what stops a name-drifting surface
 * scoring S-tier. `unrecorded` drift is reported as an identity conflict —
 * the caller floors the tier on it, because a surface asserting a name that
 * exists in no record resolves to a different product entirely.
 *
 * @param {{ canonical: object|null, observed: Record<string, string|null> }} input
 */
export function gradeNameAgreement({ canonical, observed }) {
  if (!canonical) {
    return {
      status: 'skip',
      detail: 'no canonical identity record for this origin',
      data: { channels: [] },
    };
  }
  const channels = [];
  for (const channel of CHANNELS) {
    const value = observed?.[channel];
    if (value == null || value === '') continue;
    channels.push({ channel, value, class: classifyName(value, canonical) });
  }
  if (channels.length === 0) {
    return {
      status: 'skip',
      detail: `no name declared on any channel (canonical "${canonical.name}")`,
      data: { canonicalId: canonical.id, canonicalName: canonical.name, channels: [] },
    };
  }
  const drift = channels.filter((c) => c.class !== 'ok');
  const worst = worstClass(channels.map((c) => c.class));
  const data = {
    canonicalId: canonical.id,
    canonicalName: canonical.name,
    worst,
    identityConflict: worst === 'unrecorded',
    channels,
  };
  if (drift.length === 0) {
    return {
      status: 'pass',
      detail: `${channels.length} channel(s) declare "${canonical.name}"`,
      data,
    };
  }
  return {
    status: 'fail',
    detail:
      `canonical "${canonical.name}" · ` +
      drift.map((c) => `${c.channel}="${c.value}" (${c.class})`).join(', ') +
      (worst === 'unrecorded' ? ' — identity conflict' : ''),
    data,
  };
}
