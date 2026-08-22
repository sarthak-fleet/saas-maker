#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectIndependentProductBoundaries } from "../lib/independent-product-boundary.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const catalogPath = path.join(
  workspaceRoot,
  "foundry/ops/config/projects.json",
);
const { projects } = JSON.parse(readFileSync(catalogPath, "utf8"));
const results = inspectIndependentProductBoundaries({
  workspaceRoot,
  projects,
  listTrackedFiles: (repoPath) =>
    execFileSync(
      "git",
      ["-C", repoPath, "ls-tree", "-r", "--name-only", "-z", "origin/main"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  readTrackedFile: (repoPath, file) =>
    execFileSync("git", ["-C", repoPath, "show", `origin/main:${file}`], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }),
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const result of results) {
    if (result.status === "pass") {
      console.log(`PASS ${result.id} (${result.repo})`);
      continue;
    }
    if (result.status === "skipped") {
      console.log(`SKIP ${result.id} (${result.repo}): ${result.reason}`);
      continue;
    }
    console.error(`FAIL ${result.id} (${result.repo})`);
    for (const violation of result.violations) {
      console.error(
        `  ${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`,
      );
    }
  }
}

if (results.some((result) => result.status === "fail")) {
  process.exitCode = 1;
}
