import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRuntimePaths } from "../src/state.ts";
import { defaultGlobalConfigFile, LitOpenCodeConfigError, loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-test-"));
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg-config");
  try {
    await fn(dir);
  } finally {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("loads config defaults without creating runtime files", async () => {
  await withTempDir(async (dir) => {
    const loaded = await loadConfig(dir);

    assert.equal(loaded.source, "defaults");
    assert.deepEqual(loaded.config, defaultGlobalConfigFile());
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("loads explicit JSON config and rejects malformed input clearly", async () => {
  await withTempDir(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ enabled: false, logLevel: "debug" }));

    const loaded = await loadConfig(dir);
    assert.equal(loaded.source, "project");
    assert.equal(loaded.config.enabled, false);
    assert.equal(loaded.config.logLevel, "debug");
    assert.equal(loaded.config.permissionMode, "safe");
    assert.deepEqual(loaded.config.boundedAuthority, {
      maxEvents: 64,
      maxHistory: 32,
      maxReceipts: 64,
      maxContextBytes: 65536
    });
    assert.deepEqual(loaded.config.knowledge, { capture: true });
    assert.equal(loaded.config.agents["lit-loop"].category, "execution");

    await fs.writeFile(path.join(runtime, "config.json"), "{ not-json");
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
  });
});

test("loads bounded-authority settings and rejects unsafe bounds", async () => {
  await withTempDir(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({
      boundedAuthority: { maxEvents: 12, maxHistory: 6, maxReceipts: 16, maxContextBytes: 4096 }
    }));
    const loaded = await loadConfig(dir);
    assert.deepEqual(loaded.config.boundedAuthority, {
      maxEvents: 12,
      maxHistory: 6,
      maxReceipts: 16,
      maxContextBytes: 4096
    });

    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ boundedAuthority: { maxEvents: 1 } }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ boundedAuthority: { maxContextBytes: 2_000_000 } }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ boundedAuthority: { allowResumeByTool: true } }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
  });
});

test("loads the project-local knowledge capture opt-out and rejects malformed settings", async () => {
  await withTempDir(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ knowledge: { capture: false } }));
    assert.deepEqual((await loadConfig(dir)).config.knowledge, { capture: false });

    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ knowledge: { capture: "no" } }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ knowledge: { mineChat: true } }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
  });
});

test("loads explicit balanced and YOLO permission modes and rejects invalid mode", async () => {
  await withTempDir(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ permissionMode: "balanced" }));

    const balanced = await loadConfig(dir);
    assert.equal(balanced.config.permissionMode, "balanced");

    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ permissionMode: "yolo" }));

    const loaded = await loadConfig(dir);
    assert.equal(loaded.config.permissionMode, "yolo");

    await fs.writeFile(path.join(runtime, "config.json"), JSON.stringify({ permissionMode: "reckless" }));
    await assert.rejects(loadConfig(dir), LitOpenCodeConfigError);
  });
});

test("creates deterministic runtime path helpers under the project root", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);

    assert.equal(paths.projectRoot, path.resolve(dir));
    assert.equal(paths.runtimeDir, path.join(path.resolve(dir), ".litopencode"));
    assert.equal(paths.configFile, path.join(paths.runtimeDir, "config.json"));
    assert.equal(paths.stateFile, path.join(paths.runtimeDir, "state.json"));
    assert.equal(paths.logFile, path.join(paths.runtimeDir, "logs", "litopencode.log"));
    assert.equal(paths.ledgerFile, path.join(paths.runtimeDir, "litgoal", "lit-loop", "ledger.jsonl"));
    assert.equal(paths.lifecycleStateFile, path.join(paths.runtimeDir, "litgoal", "lit-loop", "work-schema-3.json"));
    assert.equal(paths.lifecycleEventsFile, path.join(paths.runtimeDir, "litgoal", "lit-loop", "work-schema-3.jsonl"));
    assert.equal(paths.knowledgeDir, path.join(paths.runtimeDir, "knowledge"));
    assert.equal(paths.knowledgeClaimsFile, path.join(paths.runtimeDir, "knowledge", "claims.jsonl"));
    assert.equal(paths.opencodeConfigFile, path.join(path.resolve(dir), "opencode.json"));
  });
});

test("logger writes only when explicitly enabled", async () => {
  await withTempDir(async (dir) => {
    const paths = createRuntimePaths(dir);

    await createLogger(paths).info("quiet");
    await assert.rejects(fs.stat(paths.logFile), { code: "ENOENT" });

    await createLogger(paths, { enabled: true }).info("visible");
    const log = await fs.readFile(paths.logFile, "utf8");
    assert.match(log, /"level":"info"/);
    assert.match(log, /"message":"visible"/);
  });
});
