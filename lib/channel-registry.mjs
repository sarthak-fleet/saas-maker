import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DIRECTORY_SUBMISSIONS_DIR = resolve(
  import.meta.dirname,
  '../config/directory-submissions',
);

export const ARTICLE_SYNDICATION = [
  ['medium', 'Medium', 'full-canonical', 'https://medium.com/new-story'],
  ['dev-community', 'DEV Community', 'full-canonical', 'https://dev.to/new'],
  ['hashnode', 'Hashnode', 'full-canonical', 'https://hashnode.com/'],
  ['hackernoon', 'HackerNoon', 'editorial', 'https://hackernoon.com/'],
  ['daily-dev', 'daily.dev', 'discovery', 'https://app.daily.dev/'],
  ['peerlist', 'Peerlist', 'discovery', 'https://peerlist.io/'],
  ['indie-hackers', 'Indie Hackers', 'discovery', 'https://www.indiehackers.com/'],
  ['reddit', 'Reddit', 'discovery', 'https://www.reddit.com/'],
  ['lobsters', 'Lobsters', 'moderation-sensitive', 'https://lobste.rs/'],
  ['substack', 'Substack', 'owned-publication', 'https://substack.com/'],
  ['ghost', 'Ghost', 'owned-publication', 'https://ghost.org/'],
  ['wordpress', 'WordPress', 'owned-publication', 'https://wordpress.com/'],
  ['blogger', 'Blogger', 'owned-publication', 'https://www.blogger.com/'],
  ['tumblr', 'Tumblr', 'owned-publication', 'https://www.tumblr.com/'],
  ['beehiiv', 'Beehiiv', 'owned-publication', 'https://www.beehiiv.com/'],
].map(([id, name, distributionMode, home]) => ({
  id,
  name,
  distributionMode,
  home,
  requiresConfiguredPublication: distributionMode === 'owned-publication',
  requiresLiveVerification: true,
}));

export const PROTECTED_CHANNELS = [
  ['hacker-news', 'Hacker News', 'https://news.ycombinator.com/submit'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/'],
  ['x', 'X', 'https://x.com/'],
].map(([id, name, home]) => ({
  id,
  name,
  home,
  qualityGate: 'protected',
  requiresLiveVerification: true,
}));

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function collectLongTail(value, bucket = null, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectLongTail(entry, bucket, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;

  if (typeof value.id === 'string') {
    output.push({
      id: value.id,
      name: value.title || value.id,
      submitUrl: value.url || value.final || null,
      observedBucket: bucket,
      source: 'research-probe',
      requiresLiveVerification: true,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'id') collectLongTail(child, bucket || key, output);
  }
  return output;
}

function uniqueById(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function loadCuratedDirectories(configDir = DIRECTORY_SUBMISSIONS_DIR) {
  const source = readJson(resolve(configDir, 'directories.json'));
  return uniqueById(source.directories.map((entry) => ({
    id: entry.id,
    name: entry.name,
    submitUrl: entry.submitUrl,
    home: entry.home,
    storedCost: entry.cost,
    storedAutomation: entry.automation,
    source: 'curated-directory-registry',
    requiresLiveVerification: true,
  })));
}

export function loadLongTailSeeds(configDir = DIRECTORY_SUBMISSIONS_DIR) {
  return uniqueById(collectLongTail(readJson(resolve(configDir, 'research-probe.json'))));
}
