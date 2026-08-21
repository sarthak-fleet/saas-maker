#!/usr/bin/env node

import { resolve } from "node:path";
import { loadAutomationRegistry, validateAutomationRegistry } from "../lib/fleet-automation/registry.mjs";

const args = process.argv.slice(2);
const pathIndex = args.indexOf("--registry");
const path = pathIndex >= 0 ? resolve(args[pathIndex + 1]) : undefined;
const json = args.includes("--json");

try {
  const registry = loadAutomationRegistry(path);
  const result = validateAutomationRegistry(registry);
  const summary = {
    valid: result.errors.length === 0,
    total: registry.entries.length,
    inScope: registry.entries.filter((entry) => ["my-work", "toolbox", "foundry"].includes(entry.attention)).length,
    excluded: registry.entries.filter((entry) => entry.attention === "ignored").length,
    counts: Object.fromEntries(Object.keys(registry.attentionCounts).map((attention) => [attention, registry.entries.filter((entry) => entry.attention === attention).length])),
    errors: result.errors,
    warnings: result.warnings
  };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Fleet automation registry: ${summary.valid ? "valid" : "invalid"}`);
    console.log(`${summary.total} entries; ${summary.inScope} in scope; ${summary.excluded} excluded`);
    for (const error of summary.errors) console.error(`ERROR: ${error}`);
    for (const warning of summary.warnings) console.warn(`WARN: ${warning}`);
  }
  process.exitCode = summary.valid ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
