#!/usr/bin/env node
/**
 * Generate crisp geometric SVG favicons for all fleet public products.
 * Path-based (no text glyphs) so 16×16 tabs stay legible.
 *
 * Usage:
 *   node foundry/ops/scripts/generate-favicons.mjs
 *   node foundry/ops/scripts/generate-favicons.mjs --dry-run
 *   node foundry/ops/scripts/generate-favicons.mjs --only=rolepatch,chess
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const dryRun = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : null;

/** @typedef {{ bg: string, fg: string, mark: string, note?: string }} IconSpec */

/**
 * viewBox is always 0 0 32 32.
 * `mark` is inner SVG paths/shapes (absolute coords in 32 space).
 * Prefer filled shapes over thin strokes for 16×16 clarity.
 */
/** @type {Record<string, IconSpec>} */
const ICONS = {
  codevetter: {
    bg: "#0e0f13",
    fg: "#d4a039",
    note: "diamond gem (existing brand)",
    mark: `
      <path fill="#d4a039" d="M16 5 L26.5 16 L16 27 L5.5 16 Z" opacity=".95"/>
      <path fill="#0e0f13" d="M16 9.5 L22.5 16 L16 22.5 L9.5 16 Z"/>
      <path fill="#d4a039" d="M16 13 L19 16 L16 19 L13 16 Z" opacity=".65"/>
    `,
  },
  rolepatch: {
    bg: "#141413",
    fg: "#e8e6e1",
    note: "L-mono parallel lines (final)",
    mark: `
      <rect x="6" y="8" width="13" height="2.4" rx="0.7" fill="#6b6b66"/>
      <rect x="6" y="12.5" width="18.5" height="2.4" rx="0.7" fill="#e8e6e1"/>
      <rect x="6" y="17" width="10.5" height="2.4" rx="0.7" fill="#3a3a36"/>
      <rect x="6" y="21.5" width="15.5" height="2.4" rx="0.7" fill="#e8e6e1" opacity=".55"/>
    `,
  },
  "high-signal": {
    bg: "#09090b",
    fg: "#22d3ee",
    note: "signal waveform",
    mark: `
      <path fill="none" stroke="#22d3ee" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
        d="M5 22h3.2l3.4-11 3.8 16 3.6-12h4"/>
      <path fill="none" stroke="#e4e4e7" stroke-width="2" stroke-linecap="round" d="M5 8h22" opacity=".85"/>
    `,
  },
  karte: {
    bg: "#0a0805",
    fg: "#c4a46b",
    note: "gold foil playing card",
    mark: `
      <defs>
        <linearGradient id="kGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f6e5b8"/>
          <stop offset="55%" stop-color="#c4a46b"/>
          <stop offset="100%" stop-color="#8a6b34"/>
        </linearGradient>
      </defs>
      <rect x="8" y="5" width="16" height="22" rx="2.2" fill="url(#kGold)"/>
      <rect x="9.2" y="6.2" width="13.6" height="19.6" rx="1.4" fill="#0a0805"/>
      <path fill="url(#kGold)" d="M16 11.2l1.35 2.75 3.03.44-2.19 2.14.52 3.02L16 17.95l-2.71 1.42.52-3.02-2.19-2.14 3.03-.44z"/>
      <circle cx="11.6" cy="8.6" r="1.1" fill="url(#kGold)"/>
      <circle cx="20.4" cy="23.4" r="1.1" fill="url(#kGold)"/>
    `,
  },
  significanthobbies: {
    bg: "#047857",
    fg: "#ecfdf5",
    note: "soft life stamp — single ring + center",
    mark: `
      <circle cx="16" cy="16" r="8.2" fill="none" stroke="#ecfdf5" stroke-width="2.8"/>
      <circle cx="16" cy="16" r="3" fill="#ecfdf5"/>
    `,
  },
  materia: {
    bg: "#2f6b4f",
    fg: "#faf8f3",
    note: "crafted M monogram",
    mark: `
      <path fill="#faf8f3" d="M8 23V9.5h3.1L16 17l4.9-7.5H24V23h-3.2v-8.3L16.6 21h-1.2L11.2 14.7V23H8Z"/>
    `,
  },
  starboard: {
    bg: "#0c1222",
    fg: "#38bdf8",
    note: "navigation star + board line",
    mark: `
      <path fill="#38bdf8" d="M16 5.5 18 12.2h7l-5.7 4.1 2.2 6.7L16 19l-5.5 4 2.2-6.7-5.7-4.1h7z"/>
      <rect x="6" y="25" width="20" height="2" rx="1" fill="#64748b"/>
      <rect x="10" y="25" width="8" height="2" rx="1" fill="#38bdf8"/>
    `,
  },
  everythingrated: {
    bg: "#111827",
    fg: "#f9fafb",
    note: "rating card with four dots",
    mark: `
      <path fill="#f9fafb" d="M9 9h14v14H9z"/>
      <path fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" d="M12 14.5h8M12 19.5h8"/>
      <circle cx="9" cy="9" r="3.2" fill="#f97316"/>
      <circle cx="23" cy="9" r="3.2" fill="#22c55e"/>
      <circle cx="9" cy="23" r="3.2" fill="#3b82f6"/>
      <circle cx="23" cy="23" r="3.2" fill="#eab308"/>
    `,
  },
  "research-papers": {
    bg: "#0b0f14",
    fg: "#4ea1ff",
    note: "folded paper document",
    mark: `
      <path fill="#4ea1ff" d="M9 5.5h11l4 4v17H9z"/>
      <path fill="#0b0f14" d="M19 6.5v5h5z"/>
      <path fill="none" stroke="#e7eef7" stroke-width="2" stroke-linecap="round" d="M12.5 16h9M12.5 20h7.5M12.5 24h5.5"/>
    `,
  },
  posttrainllm: {
    bg: "#0d0e10",
    fg: "#48e5c2",
    note: "training loss curve",
    mark: `
      <rect x="0.6" y="0.6" width="30.8" height="30.8" rx="6.4" fill="none" stroke="#48e5c2" stroke-opacity=".3"/>
      <path fill="none" stroke="#48e5c2" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
        d="M5 8 C9 8 11 21 17 24 C21 26 23 26 27 26"/>
      <circle cx="27" cy="26" r="2.5" fill="#48e5c2"/>
      <circle cx="27" cy="26" r="5.2" fill="#48e5c2" fill-opacity=".18"/>
    `,
  },
  pace: {
    bg: "#000000",
    fg: "#4f8bff",
    note: "equalizer pace bars",
    mark: `
      <rect x="6" y="13" width="3.2" height="7" rx="1.5" fill="#4f8bff"/>
      <rect x="12" y="8" width="3.2" height="16" rx="1.5" fill="#4f8bff"/>
      <rect x="18" y="10.5" width="3.2" height="11.5" rx="1.5" fill="#4f8bff"/>
      <rect x="24" y="13.5" width="2.4" height="6" rx="1.1" fill="#4f8bff"/>
    `,
  },
  drank: {
    bg: "#0f172a",
    fg: "#f59e0b",
    note: "domain rank rising bars",
    mark: `
      <rect x="6" y="18" width="4.5" height="8" rx="1.2" fill="#334155"/>
      <rect x="13.5" y="13" width="4.5" height="13" rx="1.2" fill="#64748b"/>
      <rect x="21" y="7" width="4.5" height="19" rx="1.2" fill="#f59e0b"/>
      <path fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round" d="M7 16 L15 11 L24 6"/>
    `,
  },
  looptv: {
    bg: "#18181b",
    fg: "#dc2626",
    note: "TV frame + play",
    mark: `
      <rect x="3.5" y="7" width="25" height="18" rx="3.5" fill="#18181b" stroke="#3f3f46" stroke-width="1.6"/>
      <path fill="#dc2626" d="M13 11.5v9l8.5-4.5z"/>
    `,
  },
  "anime-list": {
    bg: "#1a1a2e",
    fg: "#60a5fa",
    note: "MAL explorer mark",
    mark: `
      <path fill="#60a5fa" d="M8 23V9h3.4l4.6 9.2L20.6 9H24v14h-3.1v-8.8L16.7 21h-1.4L11.1 14.2V23H8z"/>
      <rect x="5" y="25.5" width="22" height="2.4" rx="1.2" fill="#f59e0b"/>
    `,
  },
  chess: {
    bg: "#1c1917",
    fg: "#fafaf9",
    note: "stylized chess knight",
    mark: `
      <path fill="#fafaf9" d="M9.5 25.5h13c.8 0 1.3-.7 1-1.4l-1.2-2.6H9.7l-1.2 2.6c-.3.7.2 1.4 1 1.4z"/>
      <path fill="#fafaf9" d="M10 20.8c0-3.2 1.2-5.6 3.4-7.2-.4-1.2-.2-2.6.8-3.5.8-.7 1.9-.9 2.9-.6.3-.7 1-1.2 1.9-1.2.7 0 1.3.3 1.7.8l1.1-.4c.5-.2 1.1.2 1.1.8v2.1c1.4 1.3 2.3 3.2 2.3 5.6 0 1.4-.3 2.6-.8 3.6H10.8c-.5-1-.8-2.2-.8-3.6z"/>
      <circle cx="16.8" cy="12.4" r="1.1" fill="#1c1917"/>
      <rect x="11.5" y="22.2" width="9" height="1.6" rx=".6" fill="#a8a29e"/>
    `,
  },
  reader: {
    bg: "#0f172a",
    fg: "#f8fafc",
    note: "open book",
    mark: `
      <path fill="#f8fafc" d="M16 9c-1.3-1.1-3.1-1.8-5.1-1.8H7.2v14.8c1.8 0 3.5.5 4.9 1.3L16 25.2l3.9-2c1.4-.8 3.1-1.3 4.9-1.3V7.2h-3.7C19.1 7.2 17.3 7.9 16 9z"/>
      <path fill="#94a3b8" d="M15.15 10.6h1.7v12.2h-1.7z"/>
      <path fill="none" stroke="#0f172a" stroke-width="1.4" stroke-linecap="round" d="M9.4 12.2h4M9.4 15.2h4M9.4 18.2h3M18.6 12.2h4M18.6 15.2h4M18.6 18.2h3"/>
    `,
  },
  "email-manager": {
    bg: "#0f172a",
    fg: "#2563eb",
    note: "inbox envelope + green status",
    mark: `
      <path fill="#2563eb" d="M6.5 10.5c0-1.4 1.1-2.5 2.5-2.5h14c1.4 0 2.5 1.1 2.5 2.5v11c0 1.4-1.1 2.5-2.5 2.5H9c-1.4 0-2.5-1.1-2.5-2.5z"/>
      <path fill="none" stroke="#dbeafe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 12 7 5.5L23 12"/>
      <circle cx="23.5" cy="9" r="3.6" fill="#22c55e"/>
    `,
  },
  "free-ai": {
    bg: "#0e7490",
    fg: "#ffffff",
    note: "AI gateway layers",
    mark: `
      <path fill="#ffffff" d="M16 6 8.5 10l7.5 4 7.5-4z" opacity=".95"/>
      <path fill="none" stroke="#ffffff" stroke-width="1.6" d="M8.5 15.5 16 19.5l7.5-4" opacity=".85"/>
      <path fill="none" stroke="#ffffff" stroke-width="1.6" d="M8.5 20.5 16 24.5l7.5-4" opacity=".7"/>
    `,
  },
  "swe-interview-prep": {
    bg: "#030712",
    fg: "#a78bfa",
    note: "code lines + chevron",
    mark: `
      <rect x="6" y="6" width="20" height="20" rx="5" fill="#7c3aed" fill-opacity=".22"/>
      <path fill="none" stroke="#c4b5fd" stroke-width="2.2" stroke-linecap="round" d="M10 13h9M10 17h12M10 21h7"/>
      <path fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m21 10 3 3-3 3"/>
    `,
  },
  "psi-swarm": {
    bg: "#0b1220",
    fg: "#22d3ee",
    note: "performance radar / swarm",
    mark: `
      <circle cx="16" cy="16" r="10" fill="none" stroke="#1e293b" stroke-width="1.6"/>
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="#334155" stroke-width="1.4"/>
      <path fill="#22d3ee" fill-opacity=".25" d="M16 16 L16 6 A10 10 0 0 1 24.7 20.5 Z"/>
      <path fill="none" stroke="#22d3ee" stroke-width="1.8" stroke-linecap="round" d="M16 16 L16 6"/>
      <path fill="none" stroke="#22d3ee" stroke-width="1.8" stroke-linecap="round" d="M16 16 L24.7 20.5"/>
      <circle cx="16" cy="16" r="2" fill="#22d3ee"/>
      <circle cx="11" cy="12" r="1.2" fill="#67e8f9"/>
      <circle cx="21" cy="14" r="1" fill="#67e8f9" opacity=".8"/>
      <circle cx="14" cy="21" r="1.1" fill="#67e8f9" opacity=".9"/>
    `,
  },
};

/**
 * Where to write each product's icons.
 * - public: static hosting / Astro / publicDir from registry
 * - appIcon: Next.js app/icon.svg (file-based metadata)
 * - appIco: Next.js app/favicon.ico replacement path (we write SVG sibling)
 */
/** @type {Record<string, { public?: string[], appSvg?: string[], alsoAs?: string[] }>} */
const TARGETS = {
  codevetter: {
    public: ["codevetter/apps/landing-page-astro/public"],
  },
  rolepatch: {
    public: ["rolepatch/public"],
    appSvg: ["rolepatch/src/app"],
  },
  "high-signal": {
    public: ["high-signal/apps/web/public"],
    appSvg: ["high-signal/apps/web/src/app"],
  },
  karte: {
    public: ["karte/public"],
    appSvg: ["karte/src/app"],
  },
  significanthobbies: {
    public: ["significanthobbies/public"],
    appSvg: ["significanthobbies/src/app"],
  },
  materia: {
    public: ["materia/public"],
  },
  starboard: {
    public: ["starboard/public"],
    appSvg: ["starboard/src/app"],
  },
  everythingrated: {
    public: ["everythingrated/apps/web/public"],
    appSvg: ["everythingrated/apps/web/src/app"],
  },
  "research-papers": {
    public: ["research-papers/web/public"],
  },
  posttrainllm: {
    public: ["posttrainllm/browser/public"],
  },
  pace: {
    public: ["pace/website/public"],
  },
  drank: {
    public: ["drank/public"],
    appSvg: ["drank/app"],
  },
  looptv: {
    public: ["looptv/public"],
    appSvg: ["looptv/src/app"],
  },
  "anime-list": {
    public: ["anime-list/public"],
    appSvg: ["anime-list/src/app"],
  },
  chess: {
    public: ["chess/public"],
  },
  reader: {
    public: ["reader/public"],
    appSvg: ["reader/src/app"],
  },
  "email-manager": {
    public: ["email-manager/public"],
  },
  "free-ai": {
    public: ["free-ai/site/public"],
  },
  "swe-interview-prep": {
    public: ["swe-interview-prep/public"],
  },
  "psi-swarm": {
    public: ["psi-swarm/web/public"],
  },
};

function wrapSvg(spec) {
  // Full-bleed square tile: no outer corner radius. Rounded rects leave
  // transparent corners on a square favicon canvas (looks like "blank space").
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="favicon">
  <rect width="32" height="32" fill="${spec.bg}"/>
  ${spec.mark.trim()}
</svg>
`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  if (dryRun) {
    console.log(`[dry-run] would write ${path.relative(ROOT, filePath)} (${content.length}b)`);
    return;
  }
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`wrote ${path.relative(ROOT, filePath)}`);
}

let written = 0;
let skipped = 0;

for (const [id, spec] of Object.entries(ICONS)) {
  if (only && !only.has(id)) {
    skipped++;
    continue;
  }
  const targets = TARGETS[id];
  if (!targets) {
    console.warn(`no targets for ${id}`);
    continue;
  }
  const svg = wrapSvg(spec);
  for (const pub of targets.public || []) {
    const abs = path.join(ROOT, pub);
    if (!fs.existsSync(abs) && !dryRun) {
      ensureDir(abs);
    }
    writeFile(path.join(ROOT, pub, "favicon.svg"), svg);
    writeFile(path.join(ROOT, pub, "icon.svg"), svg);
    written += 2;
  }
  for (const app of targets.appSvg || []) {
    const abs = path.join(ROOT, app);
    if (!fs.existsSync(abs) && !dryRun) {
      console.warn(`skip missing app dir: ${app}`);
      continue;
    }
    writeFile(path.join(ROOT, app, "icon.svg"), svg);
    // Prefer SVG favicon for Next App Router when present
    writeFile(path.join(ROOT, app, "favicon.svg"), svg);
    written += 2;
  }
}

console.log(`\nDone. files=${written} skipped_products=${skipped} dryRun=${dryRun}`);
console.log(`Products: ${Object.keys(ICONS).filter((k) => !only || only.has(k)).join(", ")}`);
