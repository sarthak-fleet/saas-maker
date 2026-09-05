#!/usr/bin/env node
/**
 * entity-identity-live — probe what each live surface actually TELLS an agent
 * it is called, and compare that to the canonical name in the registry.
 *
 * Why this exists separately from agent-ready: agent-ready checks that
 * /llms.txt, /api/ai and JSON-LD are PRESENT. It does not check that they
 * AGREE. Every fleet surface scores S-tier / 100% there while three of them
 * publish a different product name to agents than they publish in markup —
 * which is precisely the entity-resolution failure the audit is supposed to
 * catch. Presence is not identity.
 *
 * Canonical source is geoIdentities[].name in the site-health catalog, with
 * geoIdentities[].aliases accepted as a known-retired name rather than an
 * unexplained mismatch.
 *
 * Four channels, not three. The probe originally read only the agent endpoints
 * (/llms.txt, /api/ai, JSON-LD) and so undercounted: heypace.app publishes the
 * retired name in its <title> as well, and a title is what a search crawler reads
 * first. Restricting the check to endpoints built for agents misses the surface
 * with the widest reach.
 *
 * It also probes the pricing declaration, for the same reason. entity-identity-diff
 * reads its `pricing` row out of the registry and has no live column to compare it
 * to, so that row can only ever report "agrees" — it is the registry agreeing with
 * itself. podcasts.highsignal.app/pricing shipped and sat behind a registry that
 * still said `not-declared` until a human noticed. This probe is what would have
 * caught it. It reports only whether a declaration EXISTS at a discoverable URL;
 * it deliberately does not try to read "free" or "paid" out of the prose, because
 * that is a judgement call and a probe that guesses is worse than one that asks.
 *
 * Usage:
 *   node tooling/scripts/entity-identity-live.mjs             # all registry surfaces with an origin
 *   node tooling/scripts/entity-identity-live.mjs codevetter …
 *   node tooling/scripts/entity-identity-live.mjs --json
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fleetRoot = path.resolve(repoRoot, '..');
const catalogPath = path.resolve(
  process.env.FLEET_PUBLIC_PRODUCTS_PATH ??
    path.join(fleetRoot, 'site-health/apps/backend/config/projects.json')
);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = new Set(args.filter((a) => !a.startsWith('--')));
const asJson = flags.has('--json');
const TIMEOUT_MS = 20_000;

async function get(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'fleet-entity-identity-live/1.0' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** llms.txt declares the product in its first markdown heading. */
function llmsName(text) {
  if (!text) return null;
  const line = text.split('\n').find((l) => l.trim().startsWith('#'));
  return line ? line.replace(/^#+\s*/, '').trim() || null : null;
}

function apiName(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return data.name ?? data.product?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * The name a model reads from markup is the WebSite / app node — NOT the first
 * "name" in the document, which is usually the Person node for the author and
 * will produce a false mismatch on every surface that credits one.
 */
function jsonLdNames(html) {
  if (!html) return [];
  const names = [];
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
        if (types.some((t) => ['WebSite', 'SoftwareApplication', 'WebApplication'].includes(t))) {
          if (node.name) names.push(String(node.name));
        }
        stack.push(...Object.values(node));
      }
    }
  }
  return names;
}

/** Fixed, not random: a stable control path keeps runs comparable. */
const CONTROL_PATH = 'a7f3c9';

export function pageTitle(html) {
  if (!html) return null;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  // Titles are HTML text: &#39; and &amp; arrive escaped and would otherwise
  // break a name match on any brand containing an apostrophe or ampersand.
  const text = m[1]
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return text.replace(/\s+/g, ' ').trim() || null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find `name` in `text` as a whole word, returning the live casing that matched.
 *
 * Word boundaries are letter/number aware rather than \b so that a name sitting
 * inside a longer one does not count: "Pace" must NOT match inside "HeyPace", or
 * the surface that correctly says HeyPace would be scored as publishing the
 * retired alias.
 */
function matchName(text, name) {
  const m = text.match(
    new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRe(name)})(?:[^\\p{L}\\p{N}]|$)`, 'iu')
  );
  return m ? m[1] : null;
}

/**
 * The <title> is the first name-bearing thing a search crawler reads, so it
 * belongs in the same drift count as the agent endpoints.
 *
 * It is tested differently from them, though. llms.txt and /api/ai assert
 * "name = X"; a title is prose that happens to contain the name. Extracting
 * "the name" from "Pace — private Mac voice agent that sees your screen" means
 * guessing where the name ends, and per the note above, a probe that guesses is
 * worse than one that asks. So this asks only which recorded form of the name is
 * present, and never invents one that isn't.
 */
export function titleVerdict(title, name, aliases) {
  if (!title) return null;
  const hit = matchName(title, name);
  if (hit === name) return null;
  if (hit) return { channel: '<title>', value: hit, kind: 'casing' };
  for (const alias of aliases) {
    const aliasHit = matchName(title, alias);
    if (aliasHit) return { channel: '<title>', value: aliasHit, kind: 'retired-alias' };
  }
  // No recorded form of the name appears at all. Reported as the whole title
  // because there is nothing narrower to point at — and unlike the other kinds,
  // this one cannot say what the surface thinks it is called.
  return { channel: '<title>', value: title, kind: 'name-absent' };
}

/**
 * Does a real pricing declaration exist at `${base}/pricing`?
 *
 * A 200 is not enough. Static hosts and SPAs answer every unknown path with the
 * same fallback document, so a naive check would report a pricing page on every
 * surface in the fleet. We fetch a path that cannot exist and compare titles: if
 * /pricing is indistinguishable from a made-up path, it is the fallback, not a
 * declaration.
 */
async function probePricingPage(base) {
  const [pricing, control] = await Promise.all([
    get(`${base}/pricing`),
    get(`${base}/entity-identity-live-control-${CONTROL_PATH}`),
  ]);
  if (!pricing) return { present: false, title: null };
  const title = pageTitle(pricing);
  const controlTitle = pageTitle(control);
  if (control && controlTitle && title && controlTitle === title) {
    return { present: false, title, softFallback: true };
  }
  return { present: true, title };
}

/**
 * Registry pricing state vs. what the surface actually publishes.
 *
 * `not-applicable` is not probed: it means the product has no pricing surface by
 * nature (a CLI, a dataset, someone else's repo), and hitting /pricing on it would
 * only manufacture noise.
 */
function pricingVerdict(state, recordedUrl, probe) {
  if (state === 'not-applicable') return null;
  if (probe.present && state === 'not-declared') {
    return {
      kind: 'undeclared-live-pricing',
      detail: `/pricing is live ("${probe.title}") but the registry says not-declared`,
    };
  }
  if (!probe.present && (state === 'published' || state === 'free')) {
    // Only a claim pointing at a /pricing path is falsified by this probe. pace
    // records the origin itself, which is a different assertion and not tested here.
    if (recordedUrl && /\/pricing\/?$/.test(recordedUrl)) {
      return { kind: 'missing-pricing-page', detail: `registry says ${state} at ${recordedUrl}, which did not respond` };
    }
    return null;
  }
  return null;
}

async function probeSurface(surface) {
  const base = surface.origin.replace(/\/+$/, '');
  const [llms, api, html, pricingProbe] = await Promise.all([
    get(`${base}/llms.txt`),
    get(`${base}/api/ai`),
    get(`${base}/`),
    surface.pricing.state === 'not-applicable'
      ? Promise.resolve({ present: false, title: null })
      : probePricingPage(base),
  ]);

  const observed = {
    'llms.txt': llmsName(llms),
    '/api/ai': apiName(api),
    'json-ld': jsonLdNames(html)[0] ?? null,
  };
  const title = pageTitle(html);
  const titleDrift = titleVerdict(title, surface.name, surface.aliases);

  const known = new Set([surface.name, ...surface.aliases].map((n) => n.toLowerCase()));
  const drift = Object.entries(observed).filter(([, value]) => value && value !== surface.name);

  return {
    ...surface,
    observed,
    title,
    drift: drift
      .map(([channel, value]) => {
        // Case is not cosmetic in a brand name: "posttrainllm" is the repo
        // slug leaking into an agent surface, not the product. Classify it
        // rather than normalizing it away, or a focus-tier product publishing
        // its slug to every agent endpoint reads as passing.
        const kind =
          value.toLowerCase() === surface.name.toLowerCase()
            ? 'casing'
            : known.has(value.toLowerCase())
              ? 'retired-alias'
              : 'unrecorded';
        return { channel, value, kind };
      })
      .concat(titleDrift ?? []),
    pricingState: surface.pricing.state,
    pricingProbe,
    pricingDrift: pricingVerdict(surface.pricing.state, surface.pricing.url ?? null, pricingProbe),
    unreachable: Object.entries(observed)
      .filter(([, v]) => v === null)
      .map(([c]) => c)
      .concat(title === null ? ['<title>'] : []),
  };
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  const surfaces = catalog.geoIdentities
    .filter((g) => g.origin && (only.size === 0 || only.has(g.id)))
    .map((g) => ({
      id: g.id,
      name: g.name,
      aliases: g.aliases ?? [],
      origin: g.origin,
      pricing: g.pricing ?? { state: 'not-declared' },
    }));

  const results = await Promise.all(surfaces.map(probeSurface));

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.some((r) => r.drift.length || r.pricingDrift) ? 1 : 0);
  }

  const drifted = results.filter((r) => r.drift.length);
  const pricingDrifted = results.filter((r) => r.pricingDrift);

  for (const r of results) {
    const mark = r.drift.length ? 'DRIFT' : '  ok ';
    const detail = r.drift.length
      ? r.drift.map((d) => `${d.channel}="${d.value}" (${d.kind})`).join(', ')
      : `all channels say "${r.name}"`;
    console.log(`${mark}  ${r.id.padEnd(24)} ${detail}`);
    if (r.unreachable.length)
      console.log(`       ${''.padEnd(24)} no data: ${r.unreachable.join(', ')}`);
  }

  console.log(
    `\n${results.length - drifted.length}/${results.length} surfaces declare one consistent name to agents.`
  );

  if (pricingDrifted.length) {
    console.log('\npricing declaration vs registry:');
    for (const r of pricingDrifted) {
      console.log(`DRIFT  ${r.id.padEnd(24)} ${r.pricingDrift.detail}`);
    }
  }
  const declared = results.filter((r) => r.pricingProbe.present);
  console.log(
    `${declared.length}/${results.length} surfaces publish a /pricing declaration; ${pricingDrifted.length} disagree with the registry.`
  );

  process.exit(drifted.length || pricingDrifted.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
