import { campaignManifestHash } from './campaign-manifest.mjs';
import { buildPromptOwnershipReport } from './prompt-ownership.mjs';

export function buildMissingPromptCoverageManifests({
  marketingProgram,
  catalog,
  agentRegistry,
  createdAt,
  sourceRevisions = {},
}) {
  const report = buildPromptOwnershipReport({
    marketingProgram,
    identities: catalog.geoIdentities,
    agentRegistry,
  });
  const projects = new Map(catalog.projects.map((project) => [project.id, project]));
  const identities = new Map(catalog.geoIdentities.map((identity) => [identity.id, identity]));
  const surfaces = new Map(agentRegistry.products.map((product) => [product.id, product]));
  return report.rows
    .filter((row) => row.state === 'missing')
    .map((row) => {
      const project = projects.get(row.projectId);
      const identity = identities.get(row.projectId);
      const surface = surfaces.get(row.projectId);
      const competitor = row.competitors[0];
      const competitorSlug = slugify(competitor.name);
      const route = `/compare/${competitorSlug}`;
      const destinationUrl = new URL(route, `${identity.origin}/`).toString();
      const title = `${identity.name} comparison guide: ${competitor.name} and the category`;
      const body = comparisonDraft({
        identity,
        summary: project.public.description,
        prompt: row.prompt,
        competitor,
        sourceUrl: publicSource(identity),
      });
      const manifest = {
        $schema: 'fleet.approved-campaign-manifest.v1',
        version: 1,
        campaign: {
          id: `geo-comparison-${row.projectId}`,
          kind: 'content_coverage',
          projectId: row.projectId,
          missionId: null,
          title,
          objective: `Give the exact buyer prompt an honest owned answer without unsupported competitor claims: ${row.prompt}`,
          createdAt,
          sourceRevision: sourceRevisions[row.projectId] ?? 'unresolved-before-write',
        },
        sources: [
          { id: 'canonical-product', type: 'first-party', reference: identity.origin, verifiedAt: createdAt },
          { id: 'official-competitor', type: 'primary-external', reference: competitor.url, verifiedAt: createdAt },
          ...(publicSource(identity)
            ? [{ id: 'product-source', type: 'first-party-source', reference: publicSource(identity), verifiedAt: createdAt }]
            : []),
        ],
        steps: [{ id: 'draft-and-route', label: 'Approve the complete draft and select a repo-local route adapter', itemKeys: ['comparison-page'] }],
        items: [{
          key: 'comparison-page',
          kind: 'durable-comparison-page',
          tier: 'secondary',
          title,
          content: {
            body,
            fields: {
              title,
              description: `A source-linked decision guide for: ${row.prompt}`,
              slug: route,
              intent: row.prompt,
              outline: ['Direct answer', 'Evaluation criteria', `${identity.name} evidence`, `${competitor.name} official source`, 'Decision guide', 'Limitations', 'Sources'],
              sources: [identity.origin, competitor.url, publicSource(identity)].filter(Boolean),
              internalLinks: [identity.origin, surface.productLinks?.[0]?.url].filter(Boolean),
              schema: ['Article', 'BreadcrumbList'],
              cta: `Inspect ${identity.name} at ${identity.origin}`,
              claimLedger: [{ claim: project.public.description, support: identity.origin }],
            },
            assets: [],
          },
          destination: { id: 'canonical-site', url: destinationUrl, accountSlug: null, cost: '$0' },
          execution: {
            mode: 'blocked',
            action: `Create ${route} in ${project.repo ?? project.sourcePath}`,
            requiresAuth: false,
            policyVerifiedAt: createdAt,
            blockedReason: 'Select and approve the owning repository content adapter and exact file path before any write.',
          },
          timing: { publishAt: null },
        }],
        exclusions: [{ destinationId: 'third-party-posting', reason: 'No spam backlinks, fabricated reviews, or unsupported third-party publishing.' }],
        measurement: {
          attribution: `Exact prompt: ${row.prompt}`,
          metrics: ['provider appearance', 'description accuracy', 'citation count', 'owned citation count'],
          checkpoints: ['after indexed publication', '14 days', '30 days'],
        },
        permissions: { repositoryWrites: [], commands: [], publishCommands: [] },
      };
      return { projectId: row.projectId, promptKey: row.promptKey, manifest, manifestHash: campaignManifestHash(manifest) };
    });
}

function comparisonDraft({ identity, summary, prompt, competitor, sourceUrl }) {
  return `# ${identity.name}: an evidence-first comparison guide

## Direct answer

The question this page owns is: **${prompt}**

${identity.name} is ${summary} This page is a decision aid, not a claim that one product is universally best. Start with the workflow, privacy boundary, evidence quality, availability, price, and maintenance posture that matter to you, then verify each product against its official source.

## Evaluation criteria

1. Can the product complete the workflow described in the question?
2. What data leaves the user's device or organization?
3. Are important outputs supported by inspectable evidence?
4. What setup, account, platform, and pricing constraints apply?
5. Is the current product maintained, and where are changes recorded?

## ${identity.name} evidence

- Canonical product: ${identity.origin}
${sourceUrl ? `- Official source: ${sourceUrl}` : '- Source posture: internal; no public source claim is made.'}
- Current first-party description: ${summary}

Only those first-party facts are asserted here. Product behavior, pricing, and availability must be refreshed from the linked canonical surface before publication.

## ${competitor.name}

Official source: ${competitor.url}

This draft deliberately makes no feature, privacy, pricing, or performance claim about ${competitor.name}. Inspect its current official documentation before adding a row to a comparison table. If a fact cannot be supported by a primary URL and observation date, omit it.

## Decision guide

Choose ${identity.name} when its documented workflow and constraints match the question and its evidence is sufficient for your decision. Choose another product when its official documentation better matches the required platform, integration, support, or operating model. Test both with the same representative task before relying on a marketing claim.

## Limitations

This page does not invent customer proof, benchmark parity, market share, or competitor behavior. It must be updated when the product, price, availability, or cited source changes.

## Sources

- ${identity.origin}
- ${competitor.url}
${sourceUrl ? `- ${sourceUrl}` : ''}

## Next step

Inspect ${identity.name} at ${identity.origin}, then re-run the exact buyer prompt and retain provider, model, answer, competitor, and citation evidence.`;
}

function publicSource(identity) {
  return identity.source.state === 'public' ? identity.source.url : null;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}
