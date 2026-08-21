import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const fleetRoot = resolve(moduleDir, "../../../..");
const registryPath = resolve(fleetRoot, "foundry/ops/config/automation-registry.json");

const attentionClasses = new Set(["my-work", "toolbox", "foundry", "ignored"]);
const runtimeTypes = new Set([
  "public-web", "api", "worker", "background-job", "data-pipeline",
  "data-store", "desktop", "mobile", "local-tool"
]);
const contractTypes = new Set([
  "build", "live", "indexing", "activation", "errors", "jobs", "release",
  "data-durability", "api-health", "performance", "marketing"
]);
const actionPolicies = new Set(["human-direction", "quiet-maintenance", "factory-safe", "excluded"]);

export function loadAutomationRegistry(path = registryPath) {
  if (!existsSync(path)) throw new Error(`Missing automation registry: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

export function validateAutomationRegistry(registry) {
  const errors = [];
  const warnings = [];
  if (registry?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(registry?.entries)) return { errors: [...errors, "entries must be an array"], warnings };

  const ids = registry.entries.map((entry) => entry.id).filter(Boolean);
  for (const id of duplicates(ids)) errors.push(`duplicate identity: ${id}`);

  const expectedCounts = registry.attentionCounts || {};
  for (const attention of attentionClasses) {
    const actual = registry.entries.filter((entry) => entry.attention === attention).length;
    if (expectedCounts[attention] !== actual) {
      errors.push(`attention count ${attention}: expected ${expectedCounts[attention]}, found ${actual}`);
    }
  }

  const surfaceOwners = new Map();
  for (const entry of registry.entries) {
    const label = entry.id || "<missing-id>";
    for (const field of ["id", "name", "attention", "family", "owner", "actionPolicy", "alertPolicy"]) {
      if (!entry[field]) errors.push(`${label}: missing ${field}`);
    }
    if (!attentionClasses.has(entry.attention)) errors.push(`${label}: unknown attention ${entry.attention}`);
    if (!actionPolicies.has(entry.actionPolicy)) errors.push(`${label}: unknown actionPolicy ${entry.actionPolicy}`);
    for (const field of ["runtimes", "surfaces", "dependencies", "evidenceSources", "contracts", "exceptions"]) {
      if (!Array.isArray(entry[field])) errors.push(`${label}: ${field} must be an array`);
    }
    for (const runtime of entry.runtimes || []) {
      if (!runtimeTypes.has(runtime)) errors.push(`${label}: unknown runtime ${runtime}`);
    }
    for (const contract of entry.contracts || []) {
      if (!contractTypes.has(contract)) errors.push(`${label}: unknown contract ${contract}`);
    }
    for (const exception of entry.exceptions || []) {
      if (!exception?.contract || !exception?.reason) errors.push(`${label}: exceptions require contract and reason`);
      if (exception?.contract !== "all" && !contractTypes.has(exception?.contract)) {
        errors.push(`${label}: exception has unknown contract ${exception?.contract}`);
      }
    }

    const inScope = ["my-work", "toolbox", "foundry"].includes(entry.attention);
    if (inScope) {
      if (!entry.repository) errors.push(`${label}: in-scope entry has no repository`);
      if (!(entry.runtimes || []).length) errors.push(`${label}: in-scope entry has no runtimes`);
      if (!(entry.evidenceSources || []).length) errors.push(`${label}: in-scope entry has no evidence sources`);
      if (!(entry.contracts || []).length) errors.push(`${label}: in-scope entry has no contracts`);
    } else if ((entry.contracts || []).length || (entry.evidenceSources || []).length) {
      errors.push(`${label}: excluded entry must not schedule contracts or evidence sources`);
    }
    if (entry.attention === "foundry" && entry.owner !== "foundry") {
      errors.push(`${label}: Foundry helper must be owned by foundry`);
    }

    for (const surface of entry.surfaces || []) {
      let normalized;
      try {
        const parsed = new URL(surface);
        if (parsed.protocol !== "https:") throw new Error("not HTTPS");
        normalized = `${parsed.hostname}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
      } catch {
        errors.push(`${label}: invalid HTTPS surface ${surface}`);
        continue;
      }
      if (surfaceOwners.has(normalized)) {
        errors.push(`conflicting surface ownership: ${surface} (${surfaceOwners.get(normalized)}, ${label})`);
      } else {
        surfaceOwners.set(normalized, label);
      }
    }

    if ((entry.runtimes || []).includes("background-job") && !(entry.contracts || []).includes("jobs")) {
      errors.push(`${label}: background-job runtime requires jobs contract`);
    }
    if ((entry.runtimes || []).includes("data-store") && !(entry.contracts || []).includes("data-durability")) {
      errors.push(`${label}: data-store runtime requires data-durability contract`);
    }
    if ((entry.runtimes || []).some((runtime) => runtime === "api" || runtime === "worker") &&
        !(entry.contracts || []).some((contract) => contract === "api-health" || contract === "errors")) {
      errors.push(`${label}: API/Worker runtime requires api-health or errors contract`);
    }
  }

  return { errors, warnings };
}

export function entryById(registry, id) {
  return registry.entries.find((entry) => entry.id === id) || null;
}
