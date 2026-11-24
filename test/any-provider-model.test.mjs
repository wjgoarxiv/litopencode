import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { configuredProviderModels, listHostModels, parseHostModelLines } from "../src/cli/host-models.ts";
import { resolveModelRoute } from "../src/cli/model-catalog.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

// A custom OpenAI-compatible provider the way a user declares it: OpenCode 1 shape and OpenCode 2 shape.
const v1Config = {
  provider: {
    "my-gateway": {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://127.0.0.1:9/v1" },
      models: { "deepseek-chat": { name: "DeepSeek Chat" }, "qwen-coder": { name: "Qwen Coder" } }
    }
  }
};
const v2Config = {
  providers: {
    "local-lab": {
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:9/v1" },
      models: { "llama-big": { name: "Llama Big", capabilities: { tools: true } } }
    }
  }
};

function hostEnv(dir) {
  const env = { ...process.env, XDG_CACHE_HOME: path.join(dir, "xdg-cache"), XDG_DATA_HOME: path.join(dir, "xdg-data"), NO_COLOR: "1", OPENAI_API_KEY: "openai-credential-sentinel" };
  delete env.CI;
  return env;
}

async function readRoutes(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, "litopencode.json"), "utf8")).categories;
}

test("the host model list is read from `opencode models` lines, ignoring noise and duplicates", () => {
  const text = "\nopencode/big-pickle\nmy-gateway/deepseek-chat\nnot a model\nmy-gateway/deepseek-chat\nollama/qwen3:8b\n";
  assert.deepEqual(parseHostModelLines(text), [
    { provider: "opencode", model: "big-pickle" },
    { provider: "my-gateway", model: "deepseek-chat" },
    { provider: "ollama", model: "qwen3:8b" }
  ]);
});

test("custom providers are read from both OpenCode 1 `provider` and OpenCode 2 `providers` blocks", () => {
  assert.deepEqual(configuredProviderModels(v1Config).map((m) => m.provider + "/" + m.model), ["my-gateway/deepseek-chat", "my-gateway/qwen-coder"]);
  assert.deepEqual(configuredProviderModels(v2Config).map((m) => m.provider + "/" + m.model), ["local-lab/llama-big"]);
  assert.deepEqual(configuredProviderModels({ provider: "bad" }), []);
});

test("listHostModels merges the host command and the config files, and says when it knows nothing", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(listHostModels({ root: dir }), { models: [], known: false });
    await fs.writeFile(path.join(dir, "opencode.jsonc"), "// mine\n" + JSON.stringify(v2Config));
    const list = listHostModels({ root: dir, command: "opencode", run: () => [{ provider: "openai", model: "gpt-6-astra" }] });
    assert.equal(list.known, true);
    assert.deepEqual(list.models.map((m) => m.provider + "/" + m.model), ["openai/gpt-6-astra", "local-lab/llama-big"]);
  });
});

test("a custom provider route is accepted by --model; OpenAI and xAI rows keep their checks", () => {
  assert.deepEqual(resolveModelRoute("my-gateway", "deepseek-chat", undefined, "--model"), { provider: "my-gateway", model: "deepseek-chat" });
  assert.deepEqual(resolveModelRoute("my-gateway", "deepseek-chat", "high", "--model"), { provider: "my-gateway", model: "deepseek-chat", effort: "high" });
  assert.throws(() => resolveModelRoute("openai", "gpt-9", undefined, "--model"), /is not offered/u);
  assert.throws(() => resolveModelRoute("bad provider", "x", undefined, "--model"), /needs provider\/model/u);
});

test("install --model writes a listed custom model into all four categories without an effort", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v1Config, null, 2));
    const result = runCli(["install", "--root", dir, "--no-model-prompt", "--model", "my-gateway/deepseek-chat", "--subagent-model", "qwen-coder"], { env: hostEnv(dir) });
    assert.equal(result.status, 0, result.stderr);
    const routes = await readRoutes(dir);
    for (const id of ["planning", "review"]) assert.deepEqual([routes[id].provider, routes[id].model, routes[id].variant], ["my-gateway", "deepseek-chat", undefined]);
    for (const id of ["execution", "research"]) assert.deepEqual([routes[id].provider, routes[id].model, routes[id].variant], ["my-gateway", "qwen-coder", undefined]);
    assert.doesNotMatch(result.stdout, /MY-GATEWAY_API_KEY/u, "no credential warning for a provider whose key lives in OpenCode");
  });
});

test("install --model refuses a custom model OpenCode does not list, names the known ones, and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v1Config, null, 2));
    const result = runCli(["install", "--root", dir, "--no-model-prompt", "--model", "my-gateway/deepseek-typo"], { env: hostEnv(dir) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /does not list the model my-gateway\/deepseek-typo.*my-gateway\/deepseek-chat/su);
    await assert.rejects(fs.stat(path.join(dir, "litopencode.json")));
  });
});

test("without OpenCode's own list, a provider the config does not declare is accepted with a note", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v1Config, null, 2));
    const result = runCli(["install", "--root", dir, "--no-model-prompt", "--model", "anthropic/claude-x"], { env: hostEnv(dir) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /anthropic\/claude-x was not checked/u);
    assert.deepEqual([(await readRoutes(dir)).planning.provider, (await readRoutes(dir)).planning.model], ["anthropic", "claude-x"]);
  });
});

test("the interactive menu lists a custom provider, skips the effort step, and offers the route again next time", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v1Config, null, 2));
    // provider 2 (my-gateway), model 0 (deepseek-chat); helper provider 2, model 1 (qwen-coder); Enter
    const first = runCli(["install", "--root", dir, "--model-prompt"], { env: hostEnv(dir), input: "2\n0\n2\n1\n\n" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /2\. my-gateway\s+\(2 models\)/u);
    assert.match(first.stdout, /\d\. Type provider\/model/u);
    assert.doesNotMatch(first.stdout, /reasoning effort for deepseek-chat/u);
    const routes = await readRoutes(dir);
    assert.deepEqual([routes.planning.model, routes.execution.model], ["deepseek-chat", "qwen-coder"]);
    // An update run keeps the saved custom route, and the installer reads it back as the current choice.
    const second = runCli(["install", "--root", dir], { env: hostEnv(dir) });
    assert.equal(second.status, 0, second.stderr);
    const again = await readRoutes(dir);
    assert.deepEqual([again.planning.provider, again.planning.model, again.execution.model], ["my-gateway", "deepseek-chat", "qwen-coder"]);
    const { readInstallModelSelection } = await import("../src/cli/install-config.ts");
    assert.deepEqual(await readInstallModelSelection(dir), {
      provider: "my-gateway",
      model: "deepseek-chat",
      helper: { provider: "my-gateway", model: "qwen-coder" }
    });
  });
});

test("a typed provider/model is accepted when OpenCode lists it", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v2Config, null, 2));
    // provider 3 (Type provider/model) for both roles
    const result = runCli(["install", "--root", dir, "--model-prompt"], { env: hostEnv(dir), input: "3\nlocal-lab/llama-big\n3\nlocal-lab/llama-big\n\n" });
    assert.equal(result.status, 0, result.stderr);
    const routes = await readRoutes(dir);
    assert.deepEqual([routes.planning.provider, routes.planning.model], ["local-lab", "llama-big"]);
  });
});

test("switching from an OpenAI route to a custom one drops the old effort", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "opencode.json"), JSON.stringify(v1Config, null, 2));
    assert.equal(runCli(["install", "--root", dir, "--no-model-prompt", "--model", "openai/gpt-6-astra"], { env: hostEnv(dir) }).status, 0);
    assert.equal((await readRoutes(dir)).planning.variant, "xhigh");
    assert.equal(runCli(["install", "--root", dir, "--no-model-prompt", "--model", "my-gateway/deepseek-chat"], { env: hostEnv(dir) }).status, 0);
    assert.equal((await readRoutes(dir)).planning.variant, undefined);
  });
});

test("a model the user set for a LitOpenCode agent in opencode.json is kept when litopencode.json authored none for it", async () => {
  const { defaultGlobalConfigFile, mergeConfigs } = await import("../src/config.ts");
  const { registerLitOpenCodeAgents } = await import("../src/agents/registry.ts");
  const kept = { agent: { "lit-loop": { model: "my-gateway/deepseek-chat" } } };
  registerLitOpenCodeAgents(kept, defaultGlobalConfigFile());
  assert.equal(kept.agent["lit-loop"].model, "my-gateway/deepseek-chat");
  assert.equal(kept.agent["lit-loop"].variant, undefined, "the default effort is not glued onto the user's model");
  assert.ok(kept.agent["lit-loop"].prompt.length > 0, "the agent is still LitOpenCode's");

  const authored = mergeConfigs(defaultGlobalConfigFile(), { agents: { "lit-loop": { category: "execution", provider: "openai", model: "gpt-6-luna", variant: "max" } } });
  const overridden = { agent: { "lit-loop": { model: "my-gateway/deepseek-chat" } } };
  registerLitOpenCodeAgents(overridden, authored);
  assert.equal(overridden.agent["lit-loop"].model, "openai/gpt-6-luna", "a route written in litopencode.json for that agent still wins");
});
