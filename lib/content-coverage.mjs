import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const ARCHETYPE_RULES = [
  ['comparison', /(?:^|[-/])(vs|compare|comparison)(?:[-/]|$)/u],
  ['alternatives', /alternative/u],
  ['integration', /integrat|plugin|extension/u],
  ['use-case', /use-case|for-(?:teams|developers|founders|agencies)/u],
  ['how-to', /how-to|guide|tutorial/u],
  ['proof', /case-stud|customer|benchmark|methodology|proof/u],
  ['template', /template|checklist/u],
  ['glossary', /glossary|what-is/u],
  ['feature', /feature|workflow/u],
  ['product', /(?:^|\/)(?:index|page|home)?$/u],
];

const CONTENT_EXTENSIONS = new Set(['.astro', '.md', '.mdx', '.tsx', '.jsx', '.html']);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.next', '.wrangler', 'coverage', 'dist', 'node_modules', 'out', 'target',
]);

export function buildCoverageAudit(input) {
  if (!input?.product?.id || !Array.isArray(input.pages)) {
    throw new Error('coverage input requires product.id and pages');
  }
  const pages = input.pages.map((page) => ({
    ...page,
    archetype: page.archetype ?? classifyArchetype(page.url ?? page.path ?? page.title ?? ''),
  }));
  const expected = input.expectedArchetypes ?? [];
  const coverage = expected.map((expectation) => {
    const matches = pages.filter((page) => page.archetype === expectation.archetype);
    const competitorEvidence = (input.competitorEvidence ?? []).filter(
      (entry) => entry.archetype === expectation.archetype,
    );
    let action = 'keep';
    let reason = `${matches.length} owned page(s) cover this intent.`;
    if (matches.length === 0 && competitorEvidence.length > 0) {
      action = 'create';
      reason = 'Relevant current competitor/search evidence exists but no owned page covers it.';
    } else if (matches.length === 0) {
      action = 'research';
      reason = 'No owned page or sufficient external evidence was supplied.';
    } else if (matches.length > 1) {
      action = 'merge';
      reason = 'Multiple owned pages cover the same archetype; inspect intent overlap.';
    }
    if (expectation.blockedReason) {
      action = 'blocked';
      reason = expectation.blockedReason;
    }
    return {
      archetype: expectation.archetype,
      intent: expectation.intent,
      required: expectation.required !== false,
      action,
      reason,
      ownedPages: matches.map((page) => page.url ?? page.path),
      competitorEvidence: competitorEvidence.map((entry) => entry.url),
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    product: input.product,
    inventory: {
      pageCount: pages.length,
      archetypes: countBy(pages, (page) => page.archetype),
      pages,
      unavailableEvidence: input.unavailableEvidence ?? [],
    },
    coverage,
    drafts: input.drafts ?? [],
    claimLedger: input.claimLedger ?? [],
  };
}

export function classifyArchetype(value) {
  const normalized = String(value).toLowerCase();
  return ARCHETYPE_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'other';
}

export function inventoryRegistryProduct(productId, options = {}) {
  const fleetRoot = resolve(options.fleetRoot ?? resolve(import.meta.dirname, '../../..'));
  const registryPath = resolve(
    options.registryPath ?? join(fleetRoot, 'foundry/ops/config/agent-surfaces-registry.json'),
  );
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const product = registry.products.find((entry) => entry.id === productId);
  if (!product) throw new Error(`unknown registry product: ${productId}`);

  const publicDir =
    typeof product.publicDir === 'string' && product.publicDir.length > 0
      ? product.publicDir
      : null;
  const projectsPath = join(fleetRoot, 'foundry/ops/config/projects.json');
  const project = existsSync(projectsPath)
    ? JSON.parse(readFileSync(projectsPath, 'utf8')).projects?.find(
        (entry) => entry.id === productId,
      )
    : null;
  const repositoryPath = publicDir ?? project?.sourcePath ?? project?.repo ?? null;
  if (!repositoryPath) {
    throw new Error(
      `${productId}: content inventory requires publicDir, sourcePath, or repo metadata`,
    );
  }
  const repoName = repositoryPath.split('/')[0];
  const repoRoot = repoName === 'foundry' ? resolve(fleetRoot, 'foundry') : resolve(fleetRoot, repoName);
  const candidates = [
    publicDir ? resolve(fleetRoot, publicDir) : null,
    resolve(repoRoot, 'src/pages'),
    resolve(repoRoot, 'src/app'),
    resolve(repoRoot, 'src/content'),
    resolve(repoRoot, 'content'),
    resolve(repoRoot, 'docs'),
  ].filter(
    (path, index, values) =>
      path != null && existsSync(path) && values.indexOf(path) === index,
  );

  const files = candidates.flatMap((root) => walkContentFiles(root, options.maxFiles ?? 5_000));
  const uniqueFiles = [...new Set(files)].sort();
  const pages = product.productLinks.map((link) => ({
    url: link.url,
    title: link.title,
    source: 'registry-product-link',
    archetype: classifyArchetype(link.url),
    internalLinks: [],
  }));
  for (const file of uniqueFiles) {
    pages.push({
      path: toPosix(relative(repoRoot, file)),
      title: basename(file, extname(file)),
      source: 'repository',
      archetype: classifyArchetype(toPosix(relative(repoRoot, file))),
      internalLinks: extractInternalLinks(readFileSync(file, 'utf8')),
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      id: product.id,
      name: product.name,
      url: product.url,
      summary: product.summary,
      repoRoot,
      publicDir,
    },
    pages,
    expectedArchetypes: options.expectedArchetypes ?? [],
    competitorEvidence: [],
    unavailableEvidence: [
      {
        source: 'live-sitemap',
        reason: options.live
          ? 'Live sitemap fetch is performed by the CLI and reported separately.'
          : 'Not fetched; rerun with --live for current sitemap evidence.',
      },
      {
        source: 'search-competitors',
        reason: 'Requires live research during the skill workflow.',
      },
      ...(publicDir
        ? []
        : [
            {
              source: 'public-directory',
              reason:
                'No static publicDir is declared; repository routes and live sitemap evidence remain inventory sources.',
            },
          ]),
    ],
  };
}

export async function fetchSitemapPages(siteUrl) {
  const sitemapUrls = [
    new URL('/sitemap-index.xml', siteUrl).toString(),
    new URL('/sitemap.xml', siteUrl).toString(),
  ];
  const pages = [];
  const errors = [];
  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await fetch(sitemapUrl, { redirect: 'follow' });
      if (!response.ok) {
        errors.push(`${sitemapUrl}: HTTP ${response.status}`);
        continue;
      }
      const body = await response.text();
      for (const match of body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)) {
        const url = match[1].replaceAll('&amp;', '&');
        if (!url.endsWith('.xml')) {
          pages.push({
            url,
            title: new URL(url).pathname,
            source: 'live-sitemap',
            archetype: classifyArchetype(new URL(url).pathname),
            internalLinks: [],
          });
        }
      }
      if (pages.length) break;
    } catch (error) {
      errors.push(`${sitemapUrl}: ${error.message}`);
    }
  }
  return { pages, errors };
}

function walkContentFiles(root, limit, output = []) {
  if (output.length >= limit) return output;
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (output.length >= limit) break;
    if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkContentFiles(path, limit, output);
    else if (entry.isFile() && CONTENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) output.push(path);
  }
  return output;
}

function extractInternalLinks(content) {
  const links = [];
  for (const match of content.matchAll(/(?:href=|\]\()(?:"|')?(\/[^"' )#?]+)/gu)) links.push(match[1]);
  return [...new Set(links)].sort();
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function toPosix(path) {
  return path.split(sep).join('/');
}
