import { ACCREDITATION_BLOCKERS, isStale, stateCounts } from './accreditation-state.mjs';
import { matchPlatforms } from './platform-matching.mjs';

const PRIORITY_ORDER = ['P1', 'P2', 'P4'];
const DETAIL_MODES = new Set(['summary', 'full']);
const STATE_FILE_LABEL = 'foundry/ops/config/directory-submissions/accreditation-state.json';

export function accreditationQueueFilename(date) {
  return `platform-accreditation-queue-${date}.md`;
}

function platformLine(platform) {
  const url = platform.submitUrl ?? platform.home ?? null;
  const label = url ? `[${platform.name}](${url})` : platform.name;
  const notes = [`\`${platform.id}\``, platform.source];
  if (platform.blocker) notes.push(`blocker: ${platform.blocker}`);
  if (platform.rejectionReason) notes.push(`reason: ${platform.rejectionReason}`);
  if (platform.overrideReason) notes.push(`override: ${platform.overrideReason}`);
  if (platform.verifiedAt) notes.push(`verified ${platform.verifiedAt.slice(0, 10)}`);
  if (platform.fitScore > 0) {
    notes.push(`fit ${platform.fitScore}: ${platform.matchedAudienceTags.join(', ')}`);
  } else if (platform.fitReason) notes.push(`fit: ${platform.fitReason}`);
  return `- ${label} — ${notes.join(' · ')}`;
}

function section(lines, heading, platforms, emptyNote) {
  lines.push(`**${heading} (${platforms.length})**`, '');
  if (platforms.length === 0) lines.push(`- none — ${emptyNote}`);
  else for (const platform of platforms) lines.push(platformLine(platform));
  lines.push('');
}

function blockedSection(lines, platforms) {
  lines.push(`**Blocked — enablement decision required (${platforms.length})**`, '');
  if (platforms.length === 0) {
    lines.push('- none — no blocked platforms', '');
    return;
  }
  for (const blocker of ACCREDITATION_BLOCKERS) {
    const entries = platforms.filter((platform) => platform.blocker === blocker);
    if (entries.length === 0) continue;
    lines.push(`_${blocker} (${entries.length})_`, '');
    for (const platform of entries) lines.push(platformLine(platform));
    lines.push('');
  }
}

function orderedProducts(projects) {
  const groups = new Map(PRIORITY_ORDER.map((priority) => [priority, []]));
  const extra = new Map();
  for (const project of projects) {
    if (!project.portfolio) continue;
    const priority = project.portfolio.priority ?? 'unprioritized';
    const bucket = groups.get(priority) ?? extra.get(priority) ?? [];
    bucket.push(project);
    if (groups.has(priority)) groups.set(priority, bucket);
    else extra.set(priority, bucket);
  }
  const ordered = [...groups.entries(), ...[...extra.entries()].sort()];
  return ordered.map(([priority, entries]) => [
    priority,
    entries.sort((left, right) => left.id.localeCompare(right.id)),
  ]);
}

function renderProduct(lines, project, state, audienceFit, { detail, now }) {
  const portfolio = project.portfolio;
  const name = project.name ?? project.id;
  lines.push(`### ${name} (\`${project.id}\`)`, '');
  lines.push(
    `- Kind: ${portfolio.kind} · Status: ${portfolio.status} · Deployed: ${portfolio.deployed ? 'yes' : 'no'}`,
  );

  if (!portfolio.readyToBeShared) {
    const reason = portfolio.sharingReadiness?.reason ?? 'no recorded sharing-readiness reason';
    lines.push(`- Not ready to share — excluded from submission planning. Reason: ${reason}`, '');
    return;
  }

  lines.push('');
  renderProductSections(lines, matchPlatforms(state, {
    artifact: 'product',
    productId: project.id,
    audienceFit,
    now,
  }), detail);
}

function visible(entries) {
  return entries.filter((entry) => entry.qualityGate !== 'protected');
}

function renderSeedPointer(lines, seeds) {
  lines.push(
    `**Seed — live verification required before any submission (${seeds.length})**`,
    '',
    seeds.length === 0
      ? '- none — no seed platforms match this product'
      : `- ${seeds.length} audience-compatible unverified platforms match this product. Run the generator with \`--detail full\` to expand this product-specific set; the shared [Seed inventory](#seed-inventory) remains the complete registry.`,
    '',
  );
}

function renderProductSections(lines, match, detail) {
  const accredited = visible(match.accredited);
  const seeds = visible(match.seed);

  section(
    lines,
    'Accredited — ready for manifest inclusion',
    accredited.filter((entry) => !entry.stale),
    'no platform has recorded verification evidence yet',
  );
  section(
    lines,
    'Accredited but stale — re-verification required',
    accredited.filter((entry) => entry.stale),
    'no accredited platform is past the staleness window',
  );
  if (detail === 'full') {
    section(
      lines,
      'Seed — live verification required before any submission',
      seeds,
      'no seed platforms match this product',
    );
  } else {
    renderSeedPointer(lines, seeds);
  }
  blockedSection(lines, visible(match.blocked));
  section(
    lines,
    'Rejected — excluded unless the owner overrides',
    visible(match.rejected),
    'no rejected platforms',
  );
  section(
    lines,
    'Unclassified — missing or non-overlapping audience evidence',
    visible(match.unclassified),
    'every artifact-compatible destination has explicit audience overlap',
  );
}

function renderProtected(lines, state) {
  const channels = state.platforms.filter((platform) => platform.qualityGate === 'protected');
  lines.push(
    '## Protected channels',
    '',
    'Hacker News, LinkedIn, and X are owner exclusions. They never enter broad',
    'accreditation and are always individually planned inside each campaign',
    'manifest with destination-native content.',
    '',
  );
  for (const channel of channels) {
    lines.push(`${platformLine(channel)} · state: \`${channel.currentState}\``);
  }
  lines.push('');
}

function renderSeedInventory(lines, state) {
  const seeds = state.platforms.filter(
    (platform) => platform.currentState === 'seed' && platform.qualityGate !== 'protected',
  );
  lines.push(
    '## Seed inventory',
    '',
    `${seeds.length} platforms are unverified registry evidence. Each one needs a live`,
    'probe (form present, cost, policy, authentication, CAPTCHA). Product-specific',
    'audience fit is applied in the product sections above.',
    'and a recorded transition before it can enter a campaign manifest.',
    '',
  );
  const bySource = new Map();
  for (const seed of seeds) {
    if (!bySource.has(seed.source)) bySource.set(seed.source, []);
    bySource.get(seed.source).push(seed);
  }
  for (const [source, entries] of [...bySource.entries()].sort()) {
    lines.push(`### ${source} (${entries.length})`, '');
    for (const entry of entries) lines.push(platformLine(entry));
    lines.push('');
  }
}

function renderSummary(lines, state, now) {
  const counts = stateCounts(state);
  const stale = state.platforms.filter((platform) =>
    isStale(platform, { stalenessDays: state.stalenessDays, now }),
  ).length;
  lines.push('## Summary counts', '', '| State | Platforms |', '| --- | --- |');
  for (const [name, count] of Object.entries(counts)) lines.push(`| ${name} | ${count} |`);
  lines.push(
    `| **total** | **${state.platforms.length}** |`,
    '',
    `- Protected channels (owner exclusions): ${state.ownerExclusions.length}`,
    `- Accredited platforms past the ${state.stalenessDays}-day staleness window: ${stale}`,
    '',
  );
}

export function renderAccreditationQueue({
  state,
  projects,
  audienceFit,
  date,
  detail = 'summary',
  now = new Date(),
}) {
  if (!DETAIL_MODES.has(detail)) throw new Error('detail must be summary or full');
  const lines = [
    `# Platform accreditation queue — ${date}`,
    '',
    `- State file: \`${STATE_FILE_LABEL}\` (version ${state.version}, updated ${state.updated})`,
    `- Platforms tracked: ${state.platforms.length}`,
    `- Staleness window: ${state.stalenessDays} days`,
    `- Detail mode: \`${detail}\``,
    '',
    '## How to read this queue',
    '',
    '- `seed` entries are **unverified** registry evidence. They are discovery',
    '  input only and are never ready for submission until a live probe records',
    '  evidence and advances the platform.',
    '- `accredited` entries have been probed with recorded evidence (live URL,',
    '  HTTP status, form and blocker detection) and are ready for manifest',
    '  inclusion after per-campaign audience-fit confirmation.',
    '- `blocked` entries carry a recorded blocker; enabling one is an owner',
    '  decision, never a bypass.',
    '- Every external write still requires an exact hash-approved campaign',
    '  manifest. This queue plans work; it does not authorize it.',
    '- Work is ordered by Fleet product priority: P1, then P2, then P4.',
    '- Product lists are ordered by explicit audience-tag overlap. Missing or',
    '  non-overlapping signals remain unclassified and never enter verification',
    '  or manifest queues.',
    '',
  ];

  renderProtected(lines, state);

  for (const [priority, entries] of orderedProducts(projects)) {
    lines.push(`## ${priority} products (${entries.length})`, '');
    if (entries.length === 0) lines.push('- none', '');
    for (const project of entries) {
      renderProduct(lines, project, state, audienceFit, { detail, now });
    }
  }

  renderSeedInventory(lines, state);
  renderSummary(lines, state, now);
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`;
}
