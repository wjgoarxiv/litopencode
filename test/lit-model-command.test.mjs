import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { findLitOpenCodeCommand, litOpenCodeCommands } from "../src/commands.ts";
import { runModelPick } from "../src/model-pick.ts";
import { litOpenCodeTools } from "../src/tools.ts";
import { withTempDir } from "../test-support/cli-fixture.ts";

const host = () => ({
  known: true,
  models: [
    { provider: "my-gateway", model: "deepseek-chat" },
    { provider: "my-gateway", model: "qwen-coder" }
  ]
});

async function routes(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8")).categories;
}

function numberOf(listText, id) {
  const line = listText.split("\n").find((entry) => entry.trim().endsWith(". " + id));
  assert.ok(line !== undefined, id + " is listed");
  return line.trim().split(".")[0];
}

test("/lit-model is a registered command that routes to the lit-model tool", () => {
  const command = findLitOpenCodeCommand("/lit-model");
  assert.ok(command !== undefined);
  assert.equal(command.readOnly, true);
  assert.match(command.activationText, /Call the `lit-model` tool once/u);
  assert.ok(litOpenCodeCommands.some((entry) => entry.slash === "/lit-model"));
  assert.equal(typeof litOpenCodeTools["lit-model"].execute, "function");
});

test("an empty pick lists OpenAI, xAI and every host model by number and writes nothing", async () => {
  await withTempDir(async (dir) => {
    const result = await runModelPick({ choice: "", root: dir, hostModels: host });
    assert.equal(result.changed, false);
    assert.match(result.text, /^\s+1\. openai\/gpt-6-astra$/mu);
    assert.match(result.text, /\d+\. my-gateway\/deepseek-chat$/mu);
    assert.match(result.text, /\/lit-model lead <number>/u);
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")));
  });
});

test("a number sets both roles; lead or helper sets one; the file keeps its other keys", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "litopencode.json"), JSON.stringify({ permissionMode: "balanced" }, null, 2));
    const listText = (await runModelPick({ choice: "", root: dir, hostModels: host })).text;
    const deepseek = numberOf(listText, "my-gateway/deepseek-chat");
    const both = await runModelPick({ choice: deepseek, root: dir, hostModels: host });
    assert.equal(both.changed, true);
    let saved = await routes(dir);
    for (const id of ["planning", "review", "execution", "research"]) {
      assert.deepEqual([saved[id].provider, saved[id].model, saved[id].variant], ["my-gateway", "deepseek-chat", undefined]);
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8")).permissionMode, "balanced");

    await runModelPick({ choice: "helper my-gateway/qwen-coder", root: dir, hostModels: host });
    saved = await routes(dir);
    assert.deepEqual([saved.planning.model, saved.execution.model, saved.research.model], ["deepseek-chat", "qwen-coder", "qwen-coder"]);

    await runModelPick({ choice: "lead 1", root: dir, hostModels: host });
    saved = await routes(dir);
    assert.deepEqual([saved.planning.provider, saved.planning.model, saved.planning.variant], ["openai", "gpt-6-astra", "xhigh"]);
    assert.equal(saved.execution.model, "qwen-coder");
    assert.match((await runModelPick({ choice: "", root: dir, hostModels: host })).text, /Lead \(plans, reviews\): openai\/gpt-6-astra · xhigh\. Helper \(workers, research\): my-gateway\/qwen-coder\./u);
  });
});

test("a bad pick writes nothing and says why", async () => {
  await withTempDir(async (dir) => {
    for (const [choice, message] of [["999", /no model number 999/u], ["my-gateway/typo", /my-gateway\/typo is not on the list.*deepseek-chat.*install --model my-gateway\/typo/u], ["openai/gpt-9", /not on the list.*openai\/gpt-6-astra/u], ["anthropic/claude-x", /not on the list.*install --model anthropic\/claude-x/u], ["lead", /Use \/lit-model/u], ["one two three", /Use \/lit-model/u]]) {
      const result = await runModelPick({ choice, root: dir, hostModels: host });
      assert.equal(result.changed, false, choice);
      assert.match(result.text, message, choice);
    }
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")));
    await fs.writeFile(path.join(dir, "litopencode.json"), "{ not json");
    const malformed = await runModelPick({ choice: "1", root: dir, hostModels: host });
    assert.equal(malformed.changed, false);
    assert.equal(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"), "{ not json");
  });
});

test("a model id with its own slash is saved qualified, read back, and dispatched to its provider", async () => {
  const { readInstallModelSelection } = await import("../src/cli/install-config.ts");
  const { defaultGlobalConfigFile, mergeConfigs } = await import("../src/config.ts");
  const { registerLitOpenCodeAgents } = await import("../src/agents/registry.ts");
  await withTempDir(async (dir) => {
    const nested = () => ({ known: true, models: [{ provider: "openrouter", model: "anthropic/claude-sonnet" }] });
    const saved = await runModelPick({ choice: "openrouter/anthropic/claude-sonnet", root: dir, hostModels: nested });
    assert.equal(saved.changed, true, saved.text);
    const file = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    assert.deepEqual([file.categories.planning.provider, file.categories.planning.model], ["openrouter", "openrouter/anthropic/claude-sonnet"]);
    assert.deepEqual(await readInstallModelSelection(dir), {
      provider: "openrouter",
      model: "anthropic/claude-sonnet",
      helper: { provider: "openrouter", model: "anthropic/claude-sonnet" }
    });
    const target = {};
    registerLitOpenCodeAgents(target, mergeConfigs(defaultGlobalConfigFile(), file));
    assert.equal(target.agent["lit-loop"].model, "openrouter/anthropic/claude-sonnet");
  });
});

test("the reply says when opencode.json still sets a model for a LitOpenCode agent", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify({ agent: { "lit-loop": { model: "my-gateway/qwen-coder" } } }));
    const result = await runModelPick({ choice: "my-gateway/deepseek-chat", root: dir, hostModels: host });
    assert.equal(result.changed, true);
    assert.match(result.text, /opencode\.json sets a model for lit-loop; that model still wins/u);
  });
});
