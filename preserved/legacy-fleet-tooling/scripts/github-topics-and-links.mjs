#!/usr/bin/env node
/**
 * One-pass GitHub hygiene for fleet public repos:
 *  - set topics (gh api)
 *  - ensure README has a product-domain link when missing
 *
 * Usage:
 *   node foundry/ops/scripts/github-topics-and-links.mjs --dry-run
 *   node foundry/ops/scripts/github-topics-and-links.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './lib/registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const dry = process.argv.includes('--dry-run');

const registry = loadRegistry();

/** @type {Record<string, { repo: string, topics: string[], productUrl?: string }>} */
const REPOS = {
  codevetter: {
    repo: 'Codevetter/codevetter',
    topics: ['code-review', 'ai', 'desktop', 'tauri', 'local-first'],
    productUrl: 'https://codevetter.com',
  },
  starboard: {
    repo: 'Codevetter/starboard',
    topics: ['github', 'semantic-search', 'bookmarks', 'ai'],
    productUrl: 'https://starboard.codevetter.com',
  },
  rolepatch: {
    repo: 'sass-maker/rolepatch',
    topics: ['resume', 'ats', 'career', 'ai', 'nextjs'],
    productUrl: 'https://rolepatch.com',
  },
  karte: {
    repo: 'Significant-Hobbies/karte',
    topics: ['link-in-bio', 'agents', 'personal-site'],
    productUrl: 'https://karte.cc',
  },
  'email-manager': {
    repo: 'sass-maker/email-manager',
    topics: ['email', 'gmail', 'productivity'],
    productUrl: 'https://mail.significanthobbies.com',
  },
  'high-signal': {
    repo: 'High-Signal-App/high-signal',
    topics: ['signals', 'markets', 'ai', 'research', 'nextjs'],
    productUrl: 'https://highsignal.app',
  },
  everythingrated: {
    repo: 'High-Signal-App/everythingrated',
    topics: ['ratings', 'catalogs', 'research'],
    productUrl: 'https://ratings.highsignal.app',
  },
  'research-papers': {
    repo: 'High-Signal-App/research-papers',
    topics: ['papers', 'openalex', 'research', 'rag'],
    productUrl: 'https://papers.highsignal.app',
  },
  significanthobbies: {
    repo: 'Significant-Hobbies/significanthobbies',
    topics: ['lifestyle', 'habits', 'bucket-list', 'nextjs'],
    productUrl: 'https://significanthobbies.com',
  },
  materia: {
    repo: 'Significant-Hobbies/materia',
    topics: ['health', 'evidence', 'remedies'],
    productUrl: 'https://materia.significanthobbies.com',
  },
  looptv: {
    repo: 'Significant-Hobbies/looptv',
    topics: ['video', 'tv', 'entertainment'],
    productUrl: 'https://tv.significanthobbies.com',
  },
  'anime-list': {
    repo: 'Significant-Hobbies/anime-list',
    topics: ['anime', 'manga', 'discovery'],
    productUrl: 'https://anime.significanthobbies.com',
  },
  chess: {
    repo: 'Significant-Hobbies/chess',
    topics: ['chess', 'coaching', 'stockfish'],
    productUrl: 'https://chess.significanthobbies.com',
  },
  reader: {
    repo: 'Significant-Hobbies/reader',
    topics: ['reading', 'research', 'annotations'],
    productUrl: 'https://read.significanthobbies.com',
  },
  'swe-interview-prep': {
    repo: 'Significant-Hobbies/swe-interview-prep',
    topics: ['interview', 'spaced-repetition', 'learning'],
    productUrl: 'https://learn.significanthobbies.com',
  },
  posttrainllm: {
    repo: 'PostTrainLLM/posttrainllm',
    topics: ['llm', 'mlx', 'fine-tuning', 'webgpu', 'apple-silicon'],
    productUrl: 'https://posttrainllm.com',
  },
  pace: {
    repo: 'HeyPace/pace',
    topics: ['voice-agent', 'macos', 'on-device-ai', 'accessibility'],
    productUrl: 'https://heypace.app',
  },
  'free-ai': {
    repo: 'sass-maker/free-ai',
    topics: ['llm-gateway', 'openai-compatible', 'ai'],
    productUrl: 'https://ai-gateway.sassmaker.com',
  },
  'fleet-workspace': {
    repo: 'sass-maker/fleet-workspace',
    topics: ['fleet', 'ops', 'seo', 'geo'],
    productUrl: 'https://sassmaker.com',
  },
};

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function setTopics(repo, topics) {
  const names = topics.join(',');
  if (dry) {
    console.log(`[dry-run] topics ${repo} ← ${names}`);
    return;
  }
  // PUT replaces the full set
  gh([
    'api',
    '-X',
    'PUT',
    `repos/${repo}/topics`,
    '-H',
    'Accept: application/vnd.github+json',
    '-f',
    `names[]=${topics[0]}`,
    ...topics.slice(1).flatMap((t) => ['-f', `names[]=${t}`]),
  ]);
  console.log(`✓ topics ${repo}`);
}

function ensureReadmeLink(localDir, productUrl, name) {
  if (!productUrl || !localDir) return;
  const readme = join(ROOT, localDir, 'README.md');
  if (!existsSync(readme)) {
    console.log(`· no README ${localDir}`);
    return;
  }
  const text = readFileSync(readme, 'utf8');
  if (text.includes(productUrl)) {
    console.log(`· README already links ${productUrl}`);
    return;
  }
  const badge = `\n**Product:** [${productUrl.replace(/^https?:\/\//, '')}](${productUrl})\n`;
  // insert after first H1
  let next;
  if (/^# /m.test(text)) {
    next = text.replace(/^(# .+)\n/, `$1\n${badge}\n`);
  } else {
    next = badge + text;
  }
  if (dry) {
    console.log(`[dry-run] would add product link to ${localDir}/README.md`);
    return;
  }
  writeFileSync(readme, next, 'utf8');
  console.log(`✓ README link ${localDir}`);
}

// map id → local folder
const localDirs = {
  codevetter: 'codevetter',
  starboard: 'starboard',
  rolepatch: 'rolepatch',
  karte: 'karte',
  'email-manager': 'email-manager',
  'high-signal': 'high-signal',
  everythingrated: 'everythingrated',
  drank: 'drank',
  'research-papers': 'research-papers',
  significanthobbies: 'significanthobbies',
  materia: 'materia',
  looptv: 'looptv',
  'anime-list': 'anime-list',
  chess: 'chess',
  reader: 'reader',
  'swe-interview-prep': 'swe-interview-prep',
  posttrainllm: 'posttrainllm',
  pace: 'pace',
  'free-ai': 'free-ai',
  'fleet-workspace': '.',
};

let ok = 0;
let fail = 0;
for (const [id, cfg] of Object.entries(REPOS)) {
  try {
    setTopics(cfg.repo, cfg.topics);
    ensureReadmeLink(localDirs[id], cfg.productUrl, id);
    ok++;
  } catch (e) {
    fail++;
    console.error(`✗ ${id}: ${e.stderr || e.message || e}`);
  }
}

console.log(`\nDone. ok=${ok} fail=${fail} dry=${dry}`);
console.log(
  'Note: README edits are local — commit/push per repo. Topics are live on GitHub when not --dry-run.'
);
