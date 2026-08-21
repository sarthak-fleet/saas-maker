import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const OPERATIONAL_FILE = /^(?:AGENTS\.md|agents\.md|package\.json|\.github\/workflows\/[^/]+\.(?:ya?ml)|scripts\/.+\.(?:js|mjs|cjs|ts|mts|cts|sh))$/;

const FORBIDDEN_REFERENCES = [
  {
    id: "private-fleet-path",
    pattern: /(?:\.\.\/)+foundry\/ops\//g,
    message: "references private sibling Fleet operations source",
  },
  {
    id: "private-fleet-instructions",
    pattern: /github\.com\/sass-maker\/fleet-workspace\/blob\/(?:main|master)\/AGENTS\.md/g,
    message: "requires private Fleet instructions",
  },
];

function defaultListTrackedFiles(repoPath) {
  return execFileSync("git", ["-C", repoPath, "ls-files", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function isIndependentProduct(project) {
  return (
    project.lifecycle === "maintained" &&
    typeof project.repo === "string" &&
    project.repo.length > 0 &&
    !project.repo.startsWith("foundry/")
  );
}

export function scanTrackedFile(file, content) {
  if (!OPERATIONAL_FILE.test(file)) return [];

  const rules = [...FORBIDDEN_REFERENCES];
  if (file === "AGENTS.md" || file === "agents.md") {
    rules.push({
      id: "parent-agent-instructions",
      pattern: /(?:\.\.\/)+AGENTS\.md/g,
      message: "requires parent agent instructions",
    });
  }

  return rules.flatMap((rule) => {
    rule.pattern.lastIndex = 0;
    return [...content.matchAll(rule.pattern)].map((match) => ({
      rule: rule.id,
      file,
      line: lineNumber(content, match.index),
      message: rule.message,
    }));
  });
}

export function inspectIndependentProductBoundaries({
  workspaceRoot,
  projects,
  checkoutExists = existsSync,
  listTrackedFiles = defaultListTrackedFiles,
  readTrackedFile = (repoPath, file) =>
    readFileSync(path.join(repoPath, file), "utf8"),
}) {
  return projects.filter(isIndependentProduct).map((project) => {
    const repoPath = path.join(workspaceRoot, project.repo);
    if (!checkoutExists(repoPath)) {
      return {
        id: project.id,
        repo: project.repo,
        status: "skipped",
        reason: "checkout unavailable",
        violations: [],
      };
    }

    const violations = listTrackedFiles(repoPath)
      .filter((file) => OPERATIONAL_FILE.test(file))
      .flatMap((file) =>
        scanTrackedFile(file, readTrackedFile(repoPath, file)),
      );

    return {
      id: project.id,
      repo: project.repo,
      status: violations.length === 0 ? "pass" : "fail",
      violations,
    };
  });
}
