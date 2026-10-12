import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { modelMenuRows, resolveModelRoute } from "../src/cli/model-catalog.ts";
import { diagnoseModelRoutes } from "../src/model-route-policy.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

// The reasoning efforts OpenCode 1.18.35 offers for each model, read from `opencode models <provider>
// --verbose` (each model's `variants`). The installer offers exactly these, in this order.
const withNone = ["none", "low", "medium", "high", "xhigh", "max"];
const withoutNone = ["low", "medium", "high", "xhigh", "max"];
const hostEfforts = {
  "gpt-6-astra": withoutNone,
  "gpt-6.1-sol": withoutNone,
  "gpt-6-luna": withNone,
  "gpt-6-sol": withNone,
  "gpt-5.6-sol": withNone,
  "gpt-5.6-luna": withNone,
  "gpt-5.6": withNone,
  "gpt-5.6-terra": withNone
};

const catalog = {
  xai: {
    id: "xai",
    models: {
      "grok-4.6": { id: "grok-4.6", reasoning: true, release_date: "2026-08-12", reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }] },
      "grok-4.3": { id: "grok-4.3", reasoning: true, release_date: "2026-04-17", reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high"] }] }
    }
  }
};

async function withHostEnv(dir, run) {
  const cacheHome = path.join(dir, "xdg-cache");
  await fs.mkdir(path.join(cacheHome, "opencode"), { recursive: true });
  await fs.mkdir(path.join(dir, "xdg-data", "opencode"), { recursive: true });
  await fs.writeFile(path.join(cacheHome, "opencode", "models.json"), JSON.stringify(catalog));
  const env = { ...process.env, XDG_CACHE_HOME: cacheHome, XDG_DATA_HOME: path.join(dir, "xdg-data"), NO_COLOR: "1", OPENAI_API_KEY: "openai-credential-sentinel" };
  delete env.CI;
  await run(env, cacheHome);
}

test("every OpenAI model offers exactly the efforts OpenCode accepts for it, keeping the recommended default", () => {
  const rows = modelMenuRows("openai");
  const missing = {};
  const extra = {};
  for (const row of rows) {
    const host = hostEfforts[row.model];
    assert.ok(host !== undefined, `${row.model} has a verified host effort list`);
    const lacking = host.filter((effort) => !row.efforts.includes(effort));
    const unknown = row.efforts.filter((effort) => !host.includes(effort));
    if (lacking.length > 0) missing[row.model] = lacking;
    if (unknown.length > 0) extra[row.model] = unknown;
    assert.ok(host.includes(row.effort), `${row.model}: the recommended ${row.effort} is a host effort`);
  }
  assert.deepEqual({ missing, extra }, { missing: {}, extra: {} });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.model, row.efforts])), hostEfforts);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.model, row.effort])), {
    "gpt-6-astra": "xhigh", "gpt-6.1-sol": "xhigh", "gpt-6-luna": "max", "gpt-6-sol": "xhigh",
    "gpt-5.6-sol": "xhigh", "gpt-5.6-luna": "max", "gpt-5.6": "high", "gpt-5.6-terra": "xhigh"
  });
});

test("flags and the route guard accept every host effort and refuse one the host does not offer", () => {
  for (const [model, efforts] of Object.entries(hostEfforts)) {
    for (const effort of efforts) {
      assert.deepEqual(resolveModelRoute("openai", model, effort, "--model"), { provider: "openai", model, effort });
      assert.deepEqual(diagnoseModelRoutes({ lead: { provider: "openai", model, variant: effort } }), [], `${model}/${effort} is a safe route`);
    }
  }
  assert.throws(() => resolveModelRoute("openai", "gpt-6-astra", "ultra", "--model"));
  assert.throws(() => resolveModelRoute("openai", "gpt-6-astra", "none", "--model"));
  assert.notDeepEqual(diagnoseModelRoutes({ lead: { provider: "openai", model: "gpt-6-astra", variant: "ultra" } }), []);
});

test("the xai menu keeps a catalog effort of none", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (_env, cacheHome) => {
      const previous = process.env.XDG_CACHE_HOME;
      process.env.XDG_CACHE_HOME = cacheHome;
      try {
        assert.deepEqual(modelMenuRows("xai").find((row) => row.model === "grok-4.3")?.efforts, ["none", "low", "medium", "high"]);
      } finally {
        if (previous === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = previous;
      }
    });
  });
});

test("the interactive install asks for an effort after each model and lists every host effort", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      // provider openai, lead gpt-6-astra, lead effort 4 (max), helper provider openai, helper gpt-6-luna, helper effort 0 (none), Enter
      const result = runCli(["install", "--root", dir, "--model-prompt"], { env, input: "\n0\n4\n\n\n0\n\n" });
      assert.equal(result.status, 0, result.stderr);
      const out = result.stdout;
      const leadMenu = out.slice(out.indexOf("Choose the LEAD reasoning effort for gpt-6-astra."), out.indexOf("Choose the provider for HELPER agents"));
      assert.match(leadMenu, /0\. low\n\s+1\. medium\n\s+2\. high\n\s+3\. xhigh\s+— recommended\n\s+4\. max\nSelect 0-4 \[3\]:/u);
      const helperMenu = out.slice(out.indexOf("Choose the HELPER reasoning effort for gpt-6-luna."), out.indexOf("╭─ MODEL ROUTE"));
      assert.match(helperMenu, /0\. none\n\s+1\. low\n\s+2\. medium\n\s+3\. high\n\s+4\. xhigh\n\s+5\. max\s+— recommended\nSelect 0-5 \[5\]:/u);
      assert.match(out, /│ Lead\s+gpt-6-astra · max\n│ Helpers\s+gpt-6-luna · none/u);
      const routes = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8")).categories;
      assert.deepEqual([routes.planning.variant, routes.review.variant, routes.execution.variant, routes.research.variant], ["max", "max", "none", "none"]);
    });
  });
});

const ultraRoutes = {
  categories: {
    planning: { provider: "openai", model: "gpt-6-astra", variant: "ultra" },
    review: { provider: "openai", model: "gpt-6-astra", variant: "ultra" },
    execution: { provider: "openai", model: "gpt-6-luna", variant: "max" },
    research: { provider: "openai", model: "gpt-6-luna", variant: "max" }
  },
  agents: { "lit-forge": { provider: "openai", model: "gpt-6.1-sol", variant: "ultra", reasoningEffort: "ultra" } }
};

test("a saved ultra route keeps working as max until the next install rewrites it", async () => {
  const { defaultGlobalConfigFile, mergeConfigs, effectiveAgentConfig } = await import("../src/config.ts");
  const { registerLitOpenCodeAgents } = await import("../src/agents/registry.ts");
  const config = mergeConfigs(defaultGlobalConfigFile(), ultraRoutes);
  assert.equal(effectiveAgentConfig(config, "lit-forge").variant, "max");
  assert.equal(effectiveAgentConfig(config, "lit-forge").reasoningEffort, "max");
  const target = {};
  assert.doesNotThrow(() => registerLitOpenCodeAgents(target, config), "OpenCode still starts with LitOpenCode's agents");
  assert.equal(target.agent["lit-loop"].variant, "max");
  assert.equal(target.agent["lit-forge"].variant, "max");
});

test("doctor warns plainly about a saved ultra route and changes nothing", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "litopencode.json");
    const before = JSON.stringify(ultraRoutes, null, 2) + "\n";
    await fs.writeFile(filePath, before);
    const result = runCli(["doctor", "--root", dir]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.opencodeConfig.routeDiagnostics, []);
    assert.deepEqual(output.opencodeConfig.retiredEfforts, [
      "ultra is no longer offered by OpenCode for gpt-6-astra (categories.planning); the next install moves it to max.",
      "ultra is no longer offered by OpenCode for gpt-6-astra (categories.review); the next install moves it to max.",
      "ultra is no longer offered by OpenCode for gpt-6.1-sol (agents.lit-forge); the next install moves it to max."
    ]);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
  });
});

test("the next install moves ultra to max with a one-line notice and a backup", async () => {
  await withTempDir(async (dir) => {
    await withHostEnv(dir, async (env) => {
      const filePath = path.join(dir, "litopencode.json");
      const before = JSON.stringify(ultraRoutes, null, 2) + "\n";
      await fs.writeFile(filePath, before);
      const dry = runCli(["install", "--root", dir, "--dry-run"], { env });
      assert.equal(dry.status, 0, dry.stderr);
      assert.equal(await fs.readFile(filePath, "utf8"), before, "a dry run writes nothing");
      const result = runCli(["install", "--root", dir, "--no-model-prompt"], { env });
      assert.equal(result.status, 0, result.stderr);
      const notices = result.stdout.split("\n").filter((line) => line.includes("ultra"));
      assert.deepEqual(notices, [`Moved 3 routes from ultra to max, which OpenCode no longer offers; the old file is at ${filePath}.litopencode-backup.`]);
      assert.equal(await fs.readFile(filePath + ".litopencode-backup", "utf8"), before);
      const after = JSON.parse(await fs.readFile(filePath, "utf8"));
      assert.equal(after.categories.planning.variant, "max");
      assert.equal(after.categories.review.variant, "max");
      assert.deepEqual([after.agents["lit-forge"].variant, after.agents["lit-forge"].reasoningEffort], ["max", "max"]);
      assert.doesNotMatch(JSON.stringify(after), /ultra/u);
    });
  });
});
