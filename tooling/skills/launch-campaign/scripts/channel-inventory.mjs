#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';

import {
  ACCREDITATION_STATE_PATH,
  isStale,
  readAccreditationState,
} from '../../../lib/accreditation-state.mjs';
import {
  ARTICLE_SYNDICATION,
  loadCuratedDirectories,
  loadLongTailSeeds,
  PROTECTED_CHANNELS,
} from '../../../lib/channel-registry.mjs';

const VALID_ARTIFACTS = new Set(['article', 'product', 'major-feature']);

function parseArtifact(argv) {
  const index = argv.indexOf('--artifact');
  const artifact = index === -1 ? null : argv[index + 1];
  if (!VALID_ARTIFACTS.has(artifact)) {
    throw new Error(
      'Usage: channel-inventory.mjs --artifact <article|product|major-feature> [--state <path>]',
    );
  }
  return artifact;
}

function loadAccreditation(argv) {
  const index = argv.indexOf('--state');
  const path = resolve(index === -1 ? ACCREDITATION_STATE_PATH : argv[index + 1]);
  try {
    const state = readAccreditationState(path);
    return { state, byId: new Map(state.platforms.map((platform) => [platform.id, platform])) };
  } catch (error) {
    return { state: null, byId: new Map(), error: error.message };
  }
}

function annotate(channels, accreditation) {
  return channels.map((channel) => {
    const platform = accreditation.byId.get(channel.id) ?? null;
    return {
      ...channel,
      currentState: platform?.currentState ?? 'untracked',
      verifiedAt: platform?.verifiedAt ?? null,
      stale: platform
        ? isStale(platform, { stalenessDays: accreditation.state.stalenessDays })
        : null,
      blocker: platform?.blocker ?? null,
    };
  });
}

try {
  const argv = process.argv.slice(2);
  const artifact = parseArtifact(argv);
  const accreditation = loadAccreditation(argv);
  const forProduct = artifact !== 'article';

  const protectedChannels = annotate(PROTECTED_CHANNELS, accreditation);
  const articleSyndication = annotate(ARTICLE_SYNDICATION, accreditation);
  const curatedDirectories = forProduct ? annotate(loadCuratedDirectories(), accreditation) : [];
  const longTailSeeds = forProduct ? annotate(loadLongTailSeeds(), accreditation) : [];
  const all = [
    ...protectedChannels,
    ...articleSyndication,
    ...curatedDirectories,
    ...longTailSeeds,
  ];

  process.stdout.write(`${JSON.stringify({
    artifact,
    warning: 'Seed inventory only. Live verification and immutable-manifest approval are required before execution. Accredited platforms still require per-campaign audience-fit confirmation.',
    accreditation: {
      statePath: ACCREDITATION_STATE_PATH,
      loaded: Boolean(accreditation.state),
      updated: accreditation.state?.updated ?? null,
      stalenessDays: accreditation.state?.stalenessDays ?? null,
      ...(accreditation.error ? { error: accreditation.error } : {}),
    },
    protected: protectedChannels,
    articleSyndication,
    curatedDirectories,
    longTailSeeds,
    counts: {
      protected: protectedChannels.length,
      articleSyndication: articleSyndication.length,
      curatedDirectories: curatedDirectories.length,
      longTailSeeds: longTailSeeds.length,
      accredited: all.filter((channel) => channel.currentState === 'accredited').length,
      seed: all.filter((channel) => channel.currentState === 'seed').length,
    },
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
