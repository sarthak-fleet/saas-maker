const PRIORITIES = ['P1', 'P2', 'P4'];
const STATES = new Set(['publish', 'prepare']);
const RANKS = new Set(['primary', 'secondary']);
const ACTORS = new Set(['agent', 'shared', 'owner']);
const EXECUTION_MODES = new Set(['agent-direct', 'agent-with-unblock', 'owner-only']);

export function validateSeoGeoPublishing(program, catalog) {
  const errors = [];
  const projects = new Map((catalog.projects ?? []).map((project) => [project.id, project]));
  validateProgramMetadata(program, errors);
  const channels = validateChannels(program, errors);
  const expected = validatePublishingScope(program, projects, errors);
  const plans = validateProjectPlans(program, projects, channels, expected, errors);

  const missing = [...expected].filter((id) => !plans.has(id));
  const extra = [...plans.keys()].filter((id) => !expected.has(id));
  if (missing.length) errors.push(`project plans missing: ${missing.sort().join(', ')}`);
  if (extra.length) errors.push(`project plans extra: ${extra.sort().join(', ')}`);

  if (errors.length) {
    throw new Error(`SEO/GEO publishing program invalid:\n- ${errors.join('\n- ')}`);
  }
  return {
    projectCount: expected.size,
    p1Count: countPriority(expected, projects, 'P1'),
    p2Count: countPriority(expected, projects, 'P2'),
    p4Count: countPriority(expected, projects, 'P4'),
    channelCount: channels.size,
  };
}

function validateProgramMetadata(program, errors) {
  if (program?.$schema !== 'fleet.seo-geo-publishing.v1') {
    errors.push(`invalid schema ${program?.$schema ?? 'missing'}`);
  }
  if (!Number.isInteger(program?.version) || program.version < 1) {
    errors.push('version must be a positive integer');
  }
  if (!isDate(program?.updatedAt)) errors.push('updatedAt must be YYYY-MM-DD');
  if (!Array.isArray(program?.principles) || program.principles.length === 0) {
    errors.push('principles must be a non-empty array');
  }
}

function validateChannels(program, errors) {
  const channels = new Map();
  for (const channel of program?.channels ?? []) {
    if (!channel.id) {
      errors.push('channel missing id');
      continue;
    }
    if (channels.has(channel.id)) errors.push(`${channel.id}: duplicate channel`);
    channels.set(channel.id, channel);
    for (const field of ['name', 'kind', 'value', 'rule']) {
      if (!channel[field]) errors.push(`${channel.id}: missing ${field}`);
    }
    if (!ACTORS.has(channel.defaultActor)) {
      errors.push(`${channel.id}: invalid defaultActor ${channel.defaultActor}`);
    }
    if (!isHttpsUrl(channel.guidanceUrl)) errors.push(`${channel.id}: guidanceUrl must be HTTPS`);
    if (!isDate(channel.reviewedAt)) errors.push(`${channel.id}: reviewedAt must be YYYY-MM-DD`);
  }
  if (channels.size === 0) errors.push('channels must be non-empty');
  validateChannelExecution(program?.channelExecution ?? {}, channels, errors);
  return channels;
}

function validateChannelExecution(channelExecution, channels, errors) {
  for (const channelId of channels.keys()) {
    if (!EXECUTION_MODES.has(channelExecution[channelId])) {
      errors.push(`${channelId}: invalid or missing channel execution mode ${channelExecution[channelId] ?? 'missing'}`);
    }
  }
  for (const channelId of Object.keys(channelExecution)) {
    if (!channels.has(channelId)) errors.push(`${channelId}: execution mode references unknown channel`);
  }
}

function validatePublishingScope(program, projects, errors) {
  const selectedP4 = program?.selectedP4 ?? [];
  if (!Array.isArray(selectedP4)) errors.push('selectedP4 must be an array');
  if (new Set(selectedP4).size !== selectedP4.length) errors.push('selectedP4 contains duplicates');
  const eligibleP4 = [...projects.values()]
    .filter((project) => isEligibleP4(project))
    .map((project) => project.id);
  for (const id of selectedP4) validateSelectedP4(id, projects, errors);
  const missingEligibleP4 = eligibleP4.filter((id) => !selectedP4.includes(id));
  if (missingEligibleP4.length) {
    errors.push(`eligible P4 projects missing from selectedP4: ${missingEligibleP4.sort().join(', ')}`);
  }
  const expected = new Set(
    [...projects.values()]
      .filter((project) => ['P1', 'P2'].includes(project.portfolio?.priority))
      .map((project) => project.id),
  );
  for (const id of eligibleP4) expected.add(id);
  return expected;
}

function isEligibleP4(project) {
  const portfolio = project.portfolio ?? {};
  return portfolio.priority === 'P4'
    && portfolio.status === 'active'
    && portfolio.deployed === true
    && portfolio.readyToBeShared === true;
}

function validateSelectedP4(id, projects, errors) {
  const project = projects.get(id);
  if (!project) {
    errors.push(`selected P4 ${id}: unknown project`);
    return;
  }
  if (!isEligibleP4(project)) {
    errors.push(`selected P4 ${id}: must be P4, active, deployed, and ready to be shared`);
  }
}

function validateProjectPlans(program, projects, channels, expected, errors) {
  const plans = new Map();
  for (const plan of program?.projects ?? []) {
    if (!plan.projectId) {
      errors.push('project plan missing projectId');
      continue;
    }
    if (plans.has(plan.projectId)) errors.push(`${plan.projectId}: duplicate project plan`);
    plans.set(plan.projectId, plan);
    const project = projects.get(plan.projectId);
    if (!project) {
      errors.push(`${plan.projectId}: unknown project plan`);
      continue;
    }
    validateProjectPlan(plan, project, channels, expected, errors);
  }
  return plans;
}

function validateProjectPlan(plan, project, channels, expected, errors) {
  if (!expected.has(plan.projectId)) {
    errors.push(`${plan.projectId}: not in P1, P2, or eligible P4 scope`);
  }
  if (!STATES.has(plan.state)) errors.push(`${plan.projectId}: invalid state ${plan.state}`);
  for (const field of ['narrative', 'sourceAsset']) {
    if (!plan[field]) errors.push(`${plan.projectId}: missing ${field}`);
  }
  const expectedState = project.portfolio?.readyToBeShared === true ? 'publish' : 'prepare';
  if (plan.state !== expectedState) {
    errors.push(`${plan.projectId}: state ${plan.state} must match catalog readiness ${expectedState}`);
  }
  const placements = plan.placements ?? [];
  if (!Array.isArray(placements)) {
    errors.push(`${plan.projectId}: placements must be an array`);
    return;
  }
  validatePlacementPolicy(plan, placements, channels, errors);
  const placementChannels = validatePlacements(plan.projectId, placements, channels, errors);
  validateExclusions(plan, placementChannels, channels, errors);
}

function validatePlacementPolicy(plan, placements, channels, errors) {
  if (plan.state === 'prepare') {
    if (placements.length) errors.push(`${plan.projectId}: prepare plan cannot contain placements`);
    if (!Array.isArray(plan.prerequisites) || plan.prerequisites.length === 0) {
      errors.push(`${plan.projectId}: prepare plan requires prerequisites`);
    }
    validateChannelReferences(plan.projectId, plan.futureChannels ?? [], channels, errors);
    return;
  }
  if (placements.length < 2) errors.push(`${plan.projectId}: publish plan requires at least two placements`);
  if (!placements.some((placement) => placement.rank === 'primary')) {
    errors.push(`${plan.projectId}: publish plan requires a primary placement`);
  }
}

function validatePlacements(projectId, placements, channels, errors) {
  const placementChannels = new Set();
  for (const placement of placements) {
    if (!channels.has(placement.channelId)) errors.push(`${projectId}: unknown placement channel ${placement.channelId}`);
    if (placementChannels.has(placement.channelId)) errors.push(`${projectId}: duplicate placement channel ${placement.channelId}`);
    placementChannels.add(placement.channelId);
    if (!RANKS.has(placement.rank)) errors.push(`${projectId}: invalid placement rank ${placement.rank}`);
    if (!ACTORS.has(placement.actor)) errors.push(`${projectId}: invalid placement actor ${placement.actor}`);
    if (!placement.format) errors.push(`${projectId}: placement missing format`);
    if (!placement.fit) errors.push(`${projectId}: placement missing fit`);
  }
  return placementChannels;
}

function validateExclusions(plan, placementChannels, channels, errors) {
  const exclusionChannels = new Set();
  for (const exclusion of plan.exclusions ?? []) {
    if (!channels.has(exclusion.channelId)) errors.push(`${plan.projectId}: unknown exclusion channel ${exclusion.channelId}`);
    if (exclusionChannels.has(exclusion.channelId)) errors.push(`${plan.projectId}: duplicate exclusion channel ${exclusion.channelId}`);
    exclusionChannels.add(exclusion.channelId);
    if (placementChannels.has(exclusion.channelId)) {
      errors.push(`${plan.projectId}: channel ${exclusion.channelId} cannot be placed and excluded`);
    }
    if (!exclusion.reason) errors.push(`${plan.projectId}: exclusion missing reason`);
  }
}

export function renderSeoGeoPublishing(program, catalog) {
  validateSeoGeoPublishing(program, catalog);
  const projects = new Map(catalog.projects.map((project) => [project.id, project]));
  const channels = new Map(program.channels.map((channel) => [channel.id, channel]));
  const plans = new Map(program.projects.map((plan) => [plan.projectId, plan]));
  const lines = renderPublishingIntroduction(program, projects, plans);

  for (const priority of PRIORITIES) {
    const ids = priority === 'P4'
      ? program.selectedP4
      : catalog.projects
        .filter((project) => project.portfolio?.priority === priority)
        .map((project) => project.id);
    const title = priority === 'P4' ? 'Eligible finished P4' : priority;
    lines.push(`## ${title} — ${ids.length}`, '');
    for (const id of ids) {
      const project = projects.get(id);
      const plan = plans.get(id);
      const url = project.domains?.[0] ? `https://${project.domains[0]}` : project.public?.repositoryUrl;
      const state = plan.state === 'publish' ? 'Publishable' : 'Preparation only';
      lines.push(`### ${project.name} — ${state}`, '');
      if (url) lines.push(`**Canonical:** [${url}](${url})`, '');
      lines.push(`**Narrative:** ${plan.narrative}`, '', `**Source asset:** ${plan.sourceAsset}`);
      if (plan.state === 'prepare') {
        lines.push(
          '',
          `**Catalog blocker:** ${project.portfolio.sharingReadiness.reason} (verified ${project.portfolio.sharingReadiness.verifiedAt})`,
          '',
          '**Before publishing:**',
          '',
          ...plan.prerequisites.map((item) => `- ${item}`),
          '',
          `**Future candidates after re-verification:** ${plan.futureChannels.length > 0
            ? plan.futureChannels.map((channelId) => channels.get(channelId).name).join(', ')
            : 'None in the current campaign.'}`,
        );
      } else {
        lines.push(
          '',
          '| Rank | Channel | Format | Execution | Content owner | Why this fits |',
          '|---|---|---|---|---|---|',
          ...[...plan.placements]
            .sort((left, right) => rankOrder(left.rank) - rankOrder(right.rank))
            .map((placement) => (
              `| ${capitalize(placement.rank)} | [${escapeCell(channels.get(placement.channelId).name)}](${channels.get(placement.channelId).guidanceUrl}) | ${escapeCell(placement.format)} | ${executionLabel(program.channelExecution[placement.channelId])} | ${actorLabel(placement.actor)} | ${escapeCell(placement.fit)} |`
            )),
        );
      }
      if ((plan.exclusions ?? []).length) {
        lines.push('', '**Do not use:**', '');
        for (const exclusion of plan.exclusions) {
          lines.push(`- **${channels.get(exclusion.channelId).name}:** ${exclusion.reason}`);
        }
      }
      lines.push('');
    }
  }

  lines.push(
    '## Maintenance contract',
    '',
    '- Update `projects.json` first when priority, deployment, lifecycle, or `readyToBeShared` changes.',
    '- Update `seo-geo-publishing.json` when the scoped product set, narrative, source asset, venue fit, execution boundary, or reviewed platform rule changes.',
    '- Run `node foundry/ops/scripts/generate-project-surfaces.mjs` to regenerate this guide.',
    '- Run `node foundry/ops/scripts/generate-project-surfaces.mjs --check` in review and CI-style validation.',
    '- Before using a channel, re-check its linked official guidance if `reviewedAt` is stale or the submission UI/rules have changed.',
    '- Do not record mutable completion state here; use the existing execution systems.',
    '',
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderPublishingIntroduction(program, projects, plans) {
  return [
    '# Fleet external SEO/GEO publishing matrix',
    '',
    `**Strategy reviewed:** ${program.updatedAt}`,
    '',
    `**Coverage:** all P1 (${countPlans(plans, projects, 'P1')}), all P2 (${countPlans(plans, projects, 'P2')}), all eligible finished P4 (${program.selectedP4.length})`,
    '',
    '**Source of truth:** `foundry/ops/config/seo-geo-publishing.json`',
    '',
    'This is the current external publishing strategy, not a completion tracker or permission to mass-submit. External URLs and outcomes belong in the existing submission receipts or GitHub Issues. Actual P2 execution remains limited to at most five projects per work cycle.',
    '',
    '## How to read execution and content ownership',
    '',
    '| Execution | Boundary |',
    '|---|---|',
    '| Agent direct | After authentication and exact campaign approval, the agent can prepare, submit, verify, and receipt the action end to end. |',
    '| Agent with unblock | The agent still owns execution; the owner intervenes only when authentication, CAPTCHA/2FA, payment, legal attestation, release authority, or an unexpected moderation gate requires it. |',
    '| Owner only | Reserved for a destination that explicitly requires the owner to perform the action personally. No current channel is classified this way. |',
    '',
    '| Content owner | Boundary |',
    '|---|---|',
    '| Agent | The agent can derive and adapt factual content from verified product evidence. |',
    '| Shared | The agent drafts and adapts; the owner reviews identity-sensitive or first-person claims. |',
    '| Owner | The content depends on the owner\'s personal experience, reputation, or judgment, but the agent can still execute the approved post. |',
    '',
    'Authentication does not override venue rules, CAPTCHA/2FA, payment approval, or the requirement for an authentic human contribution. No channel guarantees rankings, followed links, acceptance, traffic, or LLM citations.',
    '',
    '## Operating principles',
    '',
    ...program.principles.map((principle) => `- ${principle}`),
    '',
    '## Channel registry',
    '',
    '| Channel | Kind | Execution | Default content owner | Best use and current constraint | Reviewed |',
    '|---|---|---|---|---|---|',
    ...program.channels.map((channel) => (
      `| [${escapeCell(channel.name)}](${channel.guidanceUrl}) | ${escapeCell(channel.kind)} | ${executionLabel(program.channelExecution[channel.id])} | ${actorLabel(channel.defaultActor)} | ${escapeCell(channel.value)} ${escapeCell(channel.rule)} | ${channel.reviewedAt} |`
    )),
    '',
  ];
}

function validateChannelReferences(projectId, channelIds, channels, errors) {
  if (!Array.isArray(channelIds)) {
    errors.push(`${projectId}: futureChannels must be an array`);
    return;
  }
  if (new Set(channelIds).size !== channelIds.length) {
    errors.push(`${projectId}: duplicate future channel`);
  }
  for (const id of channelIds) {
    if (!channels.has(id)) errors.push(`${projectId}: unknown future channel ${id}`);
  }
}

function countPriority(ids, projects, priority) {
  return [...ids].filter((id) => projects.get(id)?.portfolio?.priority === priority).length;
}

function countPlans(plans, projects, priority) {
  return [...plans.keys()].filter((id) => projects.get(id)?.portfolio?.priority === priority).length;
}

function rankOrder(rank) {
  return rank === 'primary' ? 0 : 1;
}

function actorLabel(actor) {
  return actor === 'agent' ? 'Agent' : actor === 'shared' ? 'Shared' : 'Owner';
}

function executionLabel(mode) {
  return {
    'agent-direct': 'Agent direct',
    'agent-with-unblock': 'Agent with unblock',
    'owner-only': 'Owner only',
  }[mode] ?? mode;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
