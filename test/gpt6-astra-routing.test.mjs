import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { defaultGlobalConfigFile, mergeConfigs } from "../src/config.ts";
import { selectedLitConfig } from "../src/cli/model-policy.ts";
import { modelMenuRows, resolveModelRoute } from "../src/cli/model-catalog.ts";
import { litOpenCodeAgents, registerLitOpenCodeAgents, toOpenCodeAgentConfig } from "../src/agents/registry.ts";
import { diagnoseModelRoutes } from "../src/model-route-policy.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

const astraEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
const leadCategories = ["planning", "review"];
const helperCategories = ["execution", "research"];

function route(provider, model, effort) {
  return { provider, model, effort };
}

test("Given the OpenAI menu, when Astra is requested, then every host-supported effort is offered", () => {
  const astra = modelMenuRows("openai").find((row) => row.model === "gpt-6-astra");
  assert.ok(astra);
  assert.equal(astra.effort, "xhigh");
  assert.deepEqual(astra.efforts, astraEfforts);
  for (const effort of astraEfforts) {
    assert.deepEqual(resolveModelRoute("openai", "gpt-6-astra", effort, "--model"), route("openai", "gpt-6-astra", effort));
  }
  assert.throws(() => resolveModelRoute("openai", "gpt-6-astra-fast", "xhigh", "--model"), /not offered|gpt-6-astra-fast/u);
});

test("Given the GPT-6 OpenAI catalog, when Sol and Luna are requested, then their effort contracts are enforced", () => {
  const sol = modelMenuRows("openai").find((row) => row.model === "gpt-6-sol");
  const luna = modelMenuRows("openai").find((row) => row.model === "gpt-6-luna");
  assert.ok(sol);
  assert.ok(luna);
  assert.deepEqual(sol.efforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(luna.efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(resolveModelRoute("openai", "gpt-6-sol", "ultra", "--model"), route("openai", "gpt-6-sol", "ultra"));
  assert.throws(() => resolveModelRoute("openai", "gpt-6-luna", "ultra", "--model"), /accepts effort|ultra/u);
});

test("Given fresh config, when defaults are materialized, then lead and helper defaults stay split", () => {
  const config = defaultGlobalConfigFile();
  for (const id of leadCategories) {
    assert.deepEqual(config.categories[id], { provider: "openai", model: "gpt-6-astra", variant: "xhigh", textVerbosity: "medium" });
  }
  for (const id of helperCategories) {
    assert.deepEqual(config.categories[id], { provider: "openai", model: "gpt-6-luna", variant: "max", textVerbosity: "medium" });
  }
});

test("Given a lead-only install selection, when config is projected, then helpers retain their existing routes", () => {
  const existing = {
    categories: {
      execution: { provider: "xai", model: "grok-4.6", variant: "xhigh", providerOptions: { keep: true } },
      research: { provider: "openai", model: "gpt-5.6-luna", variant: "max", temperature: 0.2 }
    }
  };
  const projected = selectedLitConfig(existing, { provider: "openai", model: "gpt-6-astra", effort: "xhigh" });
  assert.equal(projected.categories.execution.provider, "xai");
  assert.equal(projected.categories.execution.model, "grok-4.6");
  assert.equal(projected.categories.execution.variant, "xhigh");
  assert.deepEqual(projected.categories.execution.providerOptions, { keep: true });
  assert.equal(projected.categories.research.model, "gpt-5.6-luna");
  assert.equal(projected.categories.research.temperature, 0.2);
  for (const id of leadCategories) {
    assert.equal(projected.categories[id].model, "gpt-6-astra");
    assert.equal(projected.categories[id].variant, "xhigh");
  }
});

test("Given explicit Astra helper selection, when config is projected, then helpers use the exact Astra effort", () => {
  const projected = selectedLitConfig(null, {
    provider: "openai",
    model: "gpt-6-astra",
    effort: "xhigh",
    helper: route("openai", "gpt-6-astra", "max")
  });
  for (const id of leadCategories) {
    assert.equal(projected.categories[id].model, "gpt-6-astra");
    assert.equal(projected.categories[id].variant, "xhigh");
  }
  for (const id of helperCategories) {
    assert.equal(projected.categories[id].model, "gpt-6-astra");
    assert.equal(projected.categories[id].variant, "max");
  }
});

test("Given fresh runtime registration, when agents are registered, then the lead is Astra and helpers remain Luna", () => {
  const target = {};
  registerLitOpenCodeAgents(target);
  assert.equal(target.default_agent, "lit-loop");
  assert.equal(target.agent["lit-loop"].model, "openai/gpt-6-astra");
  assert.equal(target.agent["lit-loop"].variant, "xhigh");
  assert.equal(target.agent["lit-loop"].reasoningEffort, "xhigh");
  for (const id of ["lit-implement", "lit-forge", "lit-librarian", "lit-explorer"]) {
    assert.equal(target.agent[id].model, "openai/gpt-6-luna", id);
    assert.equal(target.agent[id].variant, "max", id);
  }
});

test("Given each Astra effort, when the native agent projection runs, then reasoningEffort carries the exact value", () => {
  const agent = litOpenCodeAgents.find((candidate) => candidate.id === "lit-loop");
  assert.ok(agent);
  for (const effort of astraEfforts) {
    const projected = toOpenCodeAgentConfig(agent, {
      provider: "openai",
      model: "gpt-6-astra",
      variant: effort,
      temperature: 0.2,
      topP: 0.7
    });
    assert.equal(projected.model, "openai/gpt-6-astra");
    assert.equal(projected.variant, effort);
    assert.equal(projected.reasoningEffort, effort);
    assert.equal(projected.temperature, 0.2);
    assert.equal(projected.top_p, 0.7);
  }
});

test("Given an unsupported Astra effort or conflicting native fields, when routes are diagnosed, then registration fails closed", () => {
  assert.deepEqual(
    diagnoseModelRoutes({ unsupported: { provider: "openai", model: "gpt-6-astra", variant: "none" } }).map((diagnostic) => diagnostic.code),
    ["astra_effort_unsupported"]
  );
  assert.deepEqual(
    diagnoseModelRoutes({ conflict: { provider: "openai", model: "gpt-6-astra", variant: "high", reasoningEffort: "medium" } }).map((diagnostic) => diagnostic.code),
    ["astra_effort_conflict"]
  );
  for (const effort of astraEfforts) {
    assert.deepEqual(diagnoseModelRoutes({ [effort]: { provider: "openai", model: "gpt-6-astra", variant: effort } }), []);
  }
});

test("Given explicit old routes, when runtime registration runs, then route and special-agent overrides are preserved", () => {
  const litConfig = mergeConfigs(defaultGlobalConfigFile(), {
    agents: {
      "lit-loop": {
        provider: "openai",
        model: "gpt-5.6-luna",
        variant: "max",
        temperature: 0.2,
        topP: 0.7,
        providerOptions: { keep: true }
      }
    }
  });
  const target = {
    agent: {
      momus: { model: "openai/gpt-5.6-luna", variant: "max", temperature: 0.1, tools: { read: true } },
      "litwork-reviewer": { model: "openai/gpt-5.6-terra", variant: "high", topP: 0.6 }
    }
  };
  registerLitOpenCodeAgents(target, litConfig);
  assert.equal(target.agent["lit-loop"].model, "openai/gpt-5.6-luna");
  assert.equal(target.agent["lit-loop"].variant, "max");
  assert.equal(target.agent["lit-loop"].temperature, 0.2);
  assert.equal(target.agent["lit-loop"].top_p, 0.7);
  assert.deepEqual(target.agent["lit-loop"].providerOptions, { keep: true });
  assert.equal(target.agent.momus.model, "openai/gpt-5.6-luna");
  assert.equal(target.agent.momus.variant, "max");
  assert.equal(target.agent.momus.temperature, 0.1);
  assert.deepEqual(target.agent.momus.tools, { read: true });
  assert.equal(target.agent["litwork-reviewer"].model, "openai/gpt-5.6-terra");
  assert.equal(target.agent["litwork-reviewer"].variant, "high");
  assert.equal(target.agent["litwork-reviewer"].topP, 0.6);
});

test("Given an existing OpenAI provider, when the config hook registers, then only missing native Astra metadata is added", () => {
  const oldModel = { id: "gpt-5.6-luna", name: "Luna", custom: { keep: true } };
  const target = {
    provider: {
      openai: {
        npm: "custom-openai-provider",
        options: { baseURL: "http://localhost" },
        models: { "gpt-5.6-luna": oldModel }
      }
    }
  };
  registerLitOpenCodeAgents(target);
  assert.equal(target.provider.openai.npm, "custom-openai-provider");
  assert.deepEqual(target.provider.openai.options, { baseURL: "http://localhost" });
  assert.deepEqual(target.provider.openai.models["gpt-5.6-luna"], oldModel);
  assert.deepEqual(target.provider.openai.models["gpt-6-astra"], {
    name: "GPT-6 Astra",
    reasoning: true,
    temperature: false,
    tool_call: true
  });
});

test("Given partial Astra metadata, when the config hook registers, then only absent capability keys are filled", () => {
  const target = {
    provider: {
      openai: {
        models: {
          "gpt-6-astra": { name: "Local Astra", temperature: true, custom: { keep: true } }
        }
      }
    }
  };
  registerLitOpenCodeAgents(target);
  assert.deepEqual(target.provider.openai.models["gpt-6-astra"], {
    name: "Local Astra",
    reasoning: true,
    temperature: true,
    tool_call: true,
    custom: { keep: true }
  });
});

test("Given the installed CLI, when Astra lead and Luna helper are explicit, then the written routes stay separate", async () => {
  await withTempDir(async (dir) => {
    const result = runCli([
      "install",
      "--root",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-6-astra",
      "--effort",
      "xhigh",
      "--subagent-model",
      "openai/gpt-5.6-luna",
      "--subagent-effort",
      "max"
    ], { env: { ...process.env, NO_COLOR: "1", OPENAI_API_KEY: "test-only-sentinel" } });
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8"));
    for (const id of leadCategories) assert.deepEqual(written.categories[id], { provider: "openai", model: "gpt-6-astra", variant: "xhigh", textVerbosity: "medium" });
    for (const id of helperCategories) assert.deepEqual(written.categories[id], { provider: "openai", model: "gpt-5.6-luna", variant: "max", textVerbosity: "medium" });
  });
});
