const PROTECTED = [
  ['hacker-news', 'Hacker News', 'https://news.ycombinator.com/submit'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/'],
  ['x', 'X', 'https://x.com/'],
];

const ARTICLE = [
  ['medium', 'Medium', 'https://medium.com/new-story'],
  ['dev', 'DEV Community', 'https://dev.to/new'],
  ['hashnode', 'Hashnode', 'https://hashnode.com/'],
  ['editorial-outreach', 'HackerNoon', 'https://hackernoon.com/'],
  ['specialist-communities', 'daily.dev', 'https://app.daily.dev/'],
  ['specialist-communities', 'Peerlist', 'https://peerlist.io/'],
  ['indie-hackers', 'Indie Hackers', 'https://www.indiehackers.com/'],
  ['reddit', 'Reddit', 'https://www.reddit.com/'],
  ['specialist-communities', 'Lobsters', 'https://lobste.rs/'],
  ['substack', 'Substack', 'https://substack.com/'],
  ['substack', 'Ghost', 'https://ghost.org/'],
  ['substack', 'WordPress.com', 'https://wordpress.com/'],
  ['substack', 'Blogger', 'https://www.blogger.com/'],
  ['substack', 'Tumblr', 'https://www.tumblr.com/'],
  ['substack', 'Beehiiv', 'https://www.beehiiv.com/'],
];

const DIRECTORY_CHANNELS = {
  'product-hunt': 'product-hunt',
  uneed: 'uneed',
  alternativeto: 'alternative-to',
  'indie-hackers': 'indie-hackers',
  saashub: 'saashub',
  taaft: 'taaft',
  devhunt: 'devhunt',
  g2: 'g2-capterra',
  capterra: 'g2-capterra',
  'hacker-news': 'hacker-news',
};

export function buildSeoGeoDestinations({ program, directories, probe, supplements }) {
  const raw = [];
  for (const [channelId, name, submitUrl] of PROTECTED) {
    raw.push(core({ id: channelId, name, channelId: channelId === 'x' ? null : channelId, submitUrl, source: 'protected' }, program));
  }
  for (const [channelId, name, submitUrl] of ARTICLE) {
    raw.push(core({ id: slug(name), name, channelId, submitUrl, source: 'article' }, program));
  }
  for (const entry of directories.directories ?? []) {
    raw.push(core({
      id: entry.id,
      name: entry.name,
      channelId: DIRECTORY_CHANNELS[entry.id] ?? null,
      submitUrl: entry.submitUrl,
      source: 'curated-directory',
      cost: entry.cost,
    }, program));
  }
  for (const entry of collectLongTail(probe)) {
    raw.push({
      ...entry,
      channelId: null,
      execution: 'agent-with-unblock',
      state: 'research-only',
      auth: 'unknown',
      cost: 'unknown',
      reviewedAt: null,
      projectIds: [],
      source: 'long-tail-probe',
    });
  }
  for (const entry of supplements.destinations ?? []) {
    raw.push(core({ ...entry, source: 'maintained-supplement' }, program));
  }

  const destinations = dedupe(raw);
  const channelsCovered = new Set(destinations.map((entry) => entry.channelId).filter(Boolean));
  const missingChannels = program.channels.map((channel) => channel.id).filter((id) => !channelsCovered.has(id));
  if (missingChannels.length) throw new Error(`destination inventory missing channel families: ${missingChannels.join(', ')}`);
  if (destinations.some((entry) => !https(entry.submitUrl))) throw new Error('destination inventory contains a non-HTTPS submit URL');
  return {
    rawSourceRecords: raw.length,
    destinationCount: destinations.length,
    actionableCount: destinations.filter((entry) => entry.state === 'verify-before-submit').length,
    researchOnlyCount: destinations.filter((entry) => entry.state === 'research-only').length,
    channelCount: channelsCovered.size,
    destinations,
  };
}

export function renderSeoGeoDestinations(input) {
  const lines = [
    '# Fleet SEO/GEO destination inventory',
    '',
    `**Concrete destinations accounted for:** ${input.destinationCount}`,
    '',
    `**Maintained candidates:** ${input.actionableCount}`,
    '',
    `**Long-tail research-only candidates:** ${input.researchOnlyCount}`,
    '',
    `**Source records reconciled before deduplication:** ${input.rawSourceRecords}`,
    '',
    'This is the destination-level inventory behind the publishing matrix. “Maintained candidate” does not authorize blind submission: recheck the live policy, audience, cost, authentication, and moderation flow before adding an item to an approved campaign manifest. Research-only entries remain accounted for but cannot be submitted until promoted with current evidence.',
    '',
  ];
  for (const [state, title] of [['verify-before-submit', 'Maintained candidates'], ['research-only', 'Research-only long tail']]) {
    const rows = input.destinations.filter((entry) => entry.state === state).sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`## ${title} — ${rows.length}`, '', '| Destination | Family | Execution | Auth | Cost | Source | Projects |', '|---|---|---|---|---|---|---|');
    for (const entry of rows) {
      lines.push(`| [${cell(entry.name)}](${entry.submitUrl}) | ${entry.channelId ?? 'standalone/general directory'} | ${entry.execution} | ${entry.auth} | ${cell(entry.cost)} | ${entry.source} | ${entry.projectIds.length ? entry.projectIds.join(', ') : 'fit per campaign'} |`);
    }
    lines.push('');
  }
  lines.push('## Maintenance contract', '', '- Add new concrete destinations to the maintained supplement or the directory research registries; do not hide them inside a generic family label.', '- Keep stale, dead, paid, or low-quality candidates accounted for as research-only or explicitly excluded rather than deleting the evidence.', '- A campaign may execute only a maintained candidate that has been live-verified and included in an exact approved manifest.', '- Run `npm run generate:projects` after changes; `npm run check:projects` fails if any channel family loses destination coverage.', '');
  return lines.join('\n');
}

function core(entry, program) {
  return {
    ...entry,
    execution: entry.channelId ? program.channelExecution[entry.channelId] : 'agent-with-unblock',
    state: 'verify-before-submit',
    auth: 'required-or-verify',
    cost: entry.cost ?? 'free-or-verify',
    reviewedAt: program.updatedAt,
    projectIds: entry.projectIds ?? [],
  };
}

function collectLongTail(value, bucket = null, output = []) {
  const pending = [{ value, bucket }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      for (const entry of current.value.toReversed()) {
        pending.push({ value: entry, bucket: current.bucket });
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (typeof current.value.id === 'string' && https(current.value.url || current.value.final)) {
      output.push({
        id: current.value.id,
        name: current.value.title || current.value.id,
        submitUrl: current.value.url || current.value.final,
        observedBucket: current.bucket,
      });
    }
    for (const [key, child] of Object.entries(current.value).toReversed()) {
      if (key !== 'id') pending.push({ value: child, bucket: current.bucket || key });
    }
  }
  return output;
}

function dedupe(entries) {
  const output = new Map();
  for (const entry of entries) {
    const key = entry.source === 'maintained-supplement' ? `supplement:${entry.id}` : host(entry.submitUrl);
    const existing = output.get(key);
    if (!existing || rank(entry.state) > rank(existing.state)) output.set(key, entry);
  }
  return [...output.values()];
}

function rank(state) { return state === 'verify-before-submit' ? 2 : 1; }
function host(url) { return new URL(url).hostname.replace(/^www\./, ''); }
function https(url) { try { return new URL(url).protocol === 'https:'; } catch { return false; } }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function cell(value) { return String(value).replaceAll('|', '\\|').replaceAll('\n', ' '); }
