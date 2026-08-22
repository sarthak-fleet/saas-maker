#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadAiVisibilityPortfolio } from '../lib/founder-control/ai-visibility-registry.mjs';
import { buildFleetConnections } from '../lib/founder-control/connections.mjs';
import { loadFounderProjects } from '../lib/founder-control/registry.mjs';
import { buildMarketingProjection } from '../lib/founder-control/service.mjs';
import { FounderControlStore } from '../lib/founder-control/store.mjs';
import { visibilityProjects } from '../lib/visibility-projects.mjs';
import { domainRatingPercentile } from '../lib/domain-authority-percentile.mjs';

const FLEET_ROOT = resolve(import.meta.dirname, '../../..');
const OUTPUT_PATH = resolve(FLEET_ROOT, 'foundry/ops/docs/metric-90-latest.md');
const PROJECT_CATALOG_PATH = resolve(
  FLEET_ROOT,
  'foundry/ops/config/projects.json',
);
const DOMAIN_RATING_BENCHMARK_PATH = resolve(
  FLEET_ROOT,
  'foundry/ops/config/domain-rating-benchmark.json',
);

const catalog = JSON.parse(readFileSync(PROJECT_CATALOG_PATH, 'utf8'));
const domainRatingBenchmark = JSON.parse(
  readFileSync(DOMAIN_RATING_BENCHMARK_PATH, 'utf8'),
);
const expectedProjectIds = visibilityProjects(catalog).map((project) => project.id);
const projects = loadFounderProjects(PROJECT_CATALOG_PATH);
const store = new FounderControlStore({ projects });
const projections = store.rebuildProjections();
const marketing = buildMarketingProjection(
  projections,
  loadAiVisibilityPortfolio(),
);
const connections = buildFleetConnections({
  fleetRoot: FLEET_ROOT,
  marketing,
  missions: projections.missions,
});
store.close();

const scoredRows = connections.outputs.projects
  .filter((project) => project.metricEligibility.publicSite)
  .map(scoreProject);
assertProjectCoverage(scoredRows, expectedProjectIds);
const rowsById = new Map(scoredRows.map((row) => [row.id, row]));
const rows = expectedProjectIds.map((id) => rowsById.get(id));

const gates = [
  ['domainRating', 'D-Rank external percentile ≥90'],
  ['search', 'Search class A'],
  ['aiVisibility', 'Live AI visibility ≥90'],
  ['agentReadiness', 'Agent readiness ≥90'],
  ['agentReadable', 'Agent-readable coverage ≥90'],
  ['crawlability', 'AI crawlability ≥90'],
  ['performance', 'PSI performance ≥90'],
  ['lcp', 'LCP ≤2.5 s'],
  ['design', 'Design critique and audit ≥90%'],
];

const generatedAt = new Date().toISOString();
const markdown = `# Fleet metric 90 gate

Generated ${generatedAt} from the canonical visibility project set.

This is a strict progress ledger. Missing evidence and fixture-only AI
visibility fail closed. D-Rank retains the raw Ahrefs score and uses a
conservative percentile lower bound from an attributed external cohort;
search remains an external outcome.

Domain Rating benchmark: [${domainRatingBenchmark.cohort.provider}](${domainRatingBenchmark.cohort.sourceUrl}),
${domainRatingBenchmark.cohort.total.toLocaleString('en-US')} websites,
observed ${domainRatingBenchmark.cohort.observedAt}.

## Portfolio progress

| Gate | Passing | Remaining |
| --- | ---: | ---: |
${gates.map(([id, label]) => {
  const passing = rows.filter((row) => row.gates[id].pass).length;
  return `| ${label} | ${passing}/${rows.length} | ${rows.length - passing} |`;
}).join('\n')}

## Projects

| Project | DR | DR percentile floor | Search | AI visibility | Agent | Readable | Crawl | PSI | LCP | Design | Gates |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
${rows.map(renderRow).join('\n')}

## Remaining work

${rows.flatMap((row) =>
  gates.flatMap(([id, label]) =>
    row.gates[id].pass
      ? []
      : [`- **${row.name} · ${label}** — ${row.gates[id].detail}`],
  ),
).join('\n')}
`;

writeFileSync(OUTPUT_PATH, markdown, 'utf8');

const allPassing = rows.every((row) =>
  gates.every(([id]) => row.gates[id].pass),
);
process.stdout.write(
  `Metric 90 report: ${allPassing ? 'all gates pass' : 'work remains'} → ${OUTPUT_PATH}\n`,
);
if (!allPassing) process.exitCode = 1;

function scoreProject(project) {
  const signals = new Map(
    project.history.signals.map((signal) => [signal.label, signal.value]),
  );
  const domainRating = finite(signals.get('Domain rating'));
  const domainRatingEvidence = domainRatingPercentile(
    domainRating,
    domainRatingBenchmark,
  );
  const search = finite(signals.get('Worst tracked query class'));
  const aiVisibility = finite(signals.get('AI visibility score'));
  const agentReadiness = finite(signals.get('Agent readiness'));
  const agentReadable = finite(signals.get('Agent-readable coverage'));
  const crawlability = finite(signals.get('AI crawlability'));
  const performance = finite(signals.get('PSI performance'));
  const lcp = finite(signals.get('PSI LCP'));
  const critiqueRatio = ratio(
    project.designReview?.critique,
    project.designReview?.critiqueMaximum,
  );
  const auditRatio = ratio(
    project.designReview?.audit,
    project.designReview?.auditMaximum,
  );
  const liveAiVisibility =
    project.aiVisibility?.evidenceMode &&
    project.aiVisibility.evidenceMode !== 'fixture';

  return {
    id: project.projectId,
    name: project.name,
    values: {
      domainRating,
      domainRatingPercentile:
        domainRatingEvidence?.percentileLowerBound ?? null,
      search,
      aiVisibility,
      agentReadiness,
      agentReadable,
      crawlability,
      performance,
      lcp,
      critiqueRatio,
      auditRatio,
    },
    gates: {
      domainRating: domainRatingGate(domainRatingEvidence),
      search: {
        pass: search === 3,
        detail: search == null ? 'not measured' : `current class ${searchClass(search)}`,
      },
      aiVisibility: {
        pass: liveAiVisibility && aiVisibility != null && aiVisibility >= 90,
        detail: aiVisibilityDetail({ liveAiVisibility, aiVisibility }),
      },
      agentReadiness: threshold(agentReadiness, 90, 'higher'),
      agentReadable: threshold(agentReadable, 90, 'higher'),
      crawlability: threshold(crawlability, 90, 'higher'),
      performance: threshold(performance, 90, 'higher'),
      lcp: threshold(lcp, 2_500, 'lower', 'ms'),
      design: {
        pass:
          critiqueRatio != null &&
          auditRatio != null &&
          critiqueRatio >= 0.9 &&
          auditRatio >= 0.9,
        detail:
          critiqueRatio == null || auditRatio == null
            ? 'no valid design-review receipt'
            : `critique ${percent(critiqueRatio)} · audit ${percent(auditRatio)}`,
      },
    },
  };
}

function domainRatingGate(evidence) {
  if (!evidence) {
    return { pass: false, detail: 'not measured' };
  }
  return {
    pass: evidence.percentileLowerBound >= 90,
    detail:
      `raw DR ${format(evidence.raw)}; external percentile floor ` +
      `${format(evidence.percentileLowerBound)}; target ≥90`,
  };
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratio(value, maximum) {
  const score = finite(value);
  const max = finite(maximum);
  return score == null || max == null || max <= 0 ? null : score / max;
}

function threshold(value, target, direction, unit = '') {
  const pass =
    value != null &&
    (direction === 'higher' ? value >= target : value <= target);
  return {
    pass,
    detail: thresholdDetail({ value, target, direction, unit }),
  };
}

function aiVisibilityDetail({ liveAiVisibility, aiVisibility }) {
  if (!liveAiVisibility) return 'fixture-only evidence';
  if (aiVisibility == null) return 'not measured';
  return `current score ${format(aiVisibility)}`;
}

function thresholdDetail({ value, target, direction, unit }) {
  if (value == null) return 'not measured';
  const unitSuffix = unit ? ` ${unit}` : '';
  const operator = direction === 'higher' ? '≥' : '≤';
  return `current ${format(value)}${unitSuffix}; target ${operator}${format(target)}${unitSuffix}`;
}

function assertProjectCoverage(rows, expectedIds) {
  const actualIds = rows.map((row) => row.id);
  const duplicates = actualIds.filter(
    (id, index) => actualIds.indexOf(id) !== index,
  );
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  const missing = expectedIds.filter((id) => !actual.has(id));
  const extra = actualIds.filter((id) => !expected.has(id));
  if (duplicates.length === 0 && missing.length === 0 && extra.length === 0) {
    return;
  }
  throw new Error(
    `Metric 90 inventory mismatch: missing=${missing.join(',') || 'none'}; ` +
      `extra=${extra.join(',') || 'none'}; ` +
      `duplicates=${[...new Set(duplicates)].join(',') || 'none'}`,
  );
}

function renderRow(row) {
  const passed = Object.values(row.gates).filter((gate) => gate.pass).length;
  return [
    `| ${escapeCell(row.name)}`,
    format(row.values.domainRating),
    row.values.domainRatingPercentile == null
      ? '—'
      : `${format(row.values.domainRatingPercentile)}th`,
    searchClass(row.values.search),
    format(row.values.aiVisibility),
    format(row.values.agentReadiness),
    format(row.values.agentReadable),
    format(row.values.crawlability),
    format(row.values.performance),
    row.values.lcp == null ? '—' : `${format(row.values.lcp)} ms`,
    row.values.critiqueRatio == null || row.values.auditRatio == null
      ? '—'
      : `${percent(row.values.critiqueRatio)} / ${percent(row.values.auditRatio)}`,
    `${passed}/${Object.keys(row.gates).length} |`,
  ].join(' | ');
}

function searchClass(value) {
  return ({ 1: 'C', 2: 'B', 3: 'A' })[value] ?? '—';
}

function format(value) {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|');
}
