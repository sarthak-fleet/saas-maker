#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "scripts/agent-bin/fleet-notify");

function run(state, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, FLEET_NOTIFY_STATE_DIR: state }
  });
}

test("queues a structured event and suppresses its duplicate", () => {
  const state = mkdtempSync(resolve(tmpdir(), "fleet-notify-"));
  try {
    const args = ["emit", "--severity", "warning", "--source", "test", "--project", "fleet-ops", "--title", "Test warning", "--body", "Details", "--dedupe-key", "same-test", "--no-drain", "--json"];
    const first = run(state, args);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).queued, true);
    const files = readdirSync(resolve(state, "pending"));
    assert.equal(files.length, 1);
    const event = JSON.parse(readFileSync(resolve(state, "pending", files[0]), "utf8"));
    assert.equal(event.schemaVersion, 1);
    assert.deepEqual(event.channels, ["openclaw-telegram"]);
    assert.equal(event.body, "Details");

    const second = run(state, args);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).duplicate, true);
    assert.equal(readdirSync(resolve(state, "pending")).length, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("routine success events remain history-only by default", () => {
  const state = mkdtempSync(resolve(tmpdir(), "fleet-notify-"));
  try {
    const result = run(state, ["emit", "--severity", "success", "--source", "test", "--title", "Done", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readdirSync(resolve(state, "pending")).length, 0);
    assert.equal(readdirSync(resolve(state, "sent")).length, 1);
    const event = JSON.parse(readFileSync(resolve(state, "sent", readdirSync(resolve(state, "sent"))[0]), "utf8"));
    assert.deepEqual(event.channels, []);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("rejects insecure event URLs", () => {
  const state = mkdtempSync(resolve(tmpdir(), "fleet-notify-"));
  try {
    const result = run(state, ["emit", "--source", "test", "--title", "Bad URL", "--url", "http://example.com"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /only HTTPS URLs/);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("concurrent producers preserve dedupe", async () => {
  const state = mkdtempSync(resolve(tmpdir(), "fleet-notify-"));
  try {
    const args = [cli, "emit", "--severity", "warning", "--source", "test", "--title", "Concurrent", "--dedupe-key", "concurrent-test", "--no-drain", "--json"];
    const children = Array.from({ length: 8 }, () => new Promise((done) => {
      const child = spawn(process.execPath, args, {
        env: { ...process.env, FLEET_NOTIFY_STATE_DIR: state }
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => done({ status, stderr }));
    }));
    const results = await Promise.all(children);
    assert.ok(results.every((result) => result.status === 0), results.map((result) => result.stderr).join("\n"));
    assert.equal(readdirSync(resolve(state, "pending")).length, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
