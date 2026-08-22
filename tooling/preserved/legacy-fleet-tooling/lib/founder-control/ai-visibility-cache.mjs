import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function defaultAiVisibilityCachePath({ homeDirectory = process.env.HOME } = {}) {
  if (!homeDirectory) throw new Error('A home directory is required to resolve the AI visibility cache');
  return join(
    homeDirectory,
    'Library',
    'Application Support',
    'Fleet Ops',
    'founder-control',
    'ai-visibility-cache.json',
  );
}

function sanitizedAttempt(attempt) {
  return {
    ...structuredClone(attempt),
    responseText: null,
    error: null,
    analysis: attempt.analysis
      ? {
          ...structuredClone(attempt.analysis),
          reasoning: 'Normalized cached analysis',
        }
      : null,
  };
}

export class NormalizedAiVisibilityCache {
  constructor({ path = defaultAiVisibilityCachePath() } = {}) {
    this.path = path;
    this.entries = {};
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed?.schema === 'fleet.ai-visibility-cache.v1' && parsed.entries) {
        this.entries = parsed.entries;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async get(fingerprint) {
    return this.entries[fingerprint] ? structuredClone(this.entries[fingerprint]) : null;
  }

  async set(fingerprint, entry) {
    this.entries[fingerprint] = {
      storedAt: entry.storedAt,
      value: sanitizedAttempt(entry.value),
    };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ schema: 'fleet.ai-visibility-cache.v1', entries: this.entries }, null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporaryPath, this.path);
    chmodSync(this.path, 0o600);
  }
}
