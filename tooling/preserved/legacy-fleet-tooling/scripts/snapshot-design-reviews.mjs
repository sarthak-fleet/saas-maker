#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeDesignReviewSnapshot } from '../lib/design-review-snapshot.mjs';

const FLEET_ROOT = path.resolve(import.meta.dirname, '../../..');

export function parseSnapshotDesignReviewArgs(argv) {
  let projectWorkspaceRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project-workspace-root') {
      projectWorkspaceRoot = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!projectWorkspaceRoot) {
    throw new Error(
      'Usage: snapshot-design-reviews.mjs --project-workspace-root <path>',
    );
  }
  return { projectWorkspaceRoot: path.resolve(projectWorkspaceRoot) };
}

export function runSnapshotDesignReviews(argv = process.argv.slice(2)) {
  const args = parseSnapshotDesignReviewArgs(argv);
  const result = writeDesignReviewSnapshot({
    fleetRoot: FLEET_ROOT,
    projectWorkspaceRoot: args.projectWorkspaceRoot,
  });
  process.stdout.write(
    `Design-review snapshot: ${result.snapshot.projects.length}/`
      + `${result.snapshot.catalogProjectIds.length} validated receipts`
      + ` (${result.snapshot.rejectedProjects.length} rejected) → `
      + `${result.outputPath}\n`,
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runSnapshotDesignReviews();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
