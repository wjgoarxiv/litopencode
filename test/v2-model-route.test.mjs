import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openaiProviderModels, openAiModelEfforts } from "../src/cli/model-catalog.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, createModelEditor } from "../test-support/opencode-v2-fake.mjs";

// OpenCode 2 runs a session that carries no model of its own on the host default model; the agent's
// model is only a hint the TUI reads when it creates a session. `opencode2 run` creates the session
// without a model, so lit-loop's route never ran there. The prompt hook now routes such a session to its
// agent's model, and the model transform registers the OpenAI rows LitOpenCode routes to, as the
// OpenCode 1 `config` hook does.
const route = { providerID: "openai", id: "gpt-6-astra", variant: "xhigh" };
const catalog = [
  { providerID: "openai", id: "gpt-6.1-sol", enabled: true },
  { providerID: "openai", id: "gpt-6-astra", enabled: true },
  { providerID: "openai", id: "gpt-6-luna", enabled: true }
];

async function withServer(sessions, fn, models = catalog) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-route-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions, models });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fn(fake);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const prompt = (text, sessionID = "ses_run") => ({ sessionID, messageID: "msg_1", prompt: { text }, delivery: "queue" });

test("a session started without a model runs on its agent's route, the default lit-loop when it names no agent", async () => {
  await withServer({ ses_run: { id: "ses_run" } }, async (fake) => {
    await fake.run("session", "prompt", prompt("\"lit fix the failing test\""));
    assert.deepEqual(fake.sessionCalls.filter((call) => call.call === "switchModel"), [{ call: "switchModel", sessionID: "ses_run", model: route }]);
    assert.deepEqual(fake.sessions.get("ses_run").model, route);
    await fake.run("session", "prompt", prompt("and the next one"));
    assert.equal(fake.sessionCalls.filter((call) => call.call === "switchModel").length, 1, "routed once");
  });
});

test("a session's own model, a delegated child and a route the catalog lacks keep the host's choice", async () => {
  const chosen = { providerID: "openai", id: "gpt-6.1-sol" };
  await withServer({
    ses_own: { id: "ses_own", agent: "lit-loop", model: chosen },
    ses_child: { id: "ses_child", parentID: "ses_own", agent: "lit-explorer" },
    ses_plain: { id: "ses_plain", agent: "general" }
  }, async (fake) => {
    for (const sessionID of ["ses_own", "ses_child", "ses_plain"]) await fake.run("session", "prompt", prompt("lit go", sessionID));
    assert.deepEqual(fake.sessionCalls.filter((call) => call.call === "switchModel"), []);
    assert.deepEqual(fake.sessions.get("ses_own").model, chosen);
  });
  await withServer({ ses_run: { id: "ses_run" } }, async (fake) => {
    await fake.run("session", "prompt", prompt("lit go"));
    assert.deepEqual(fake.sessionCalls.filter((call) => call.call === "switchModel"), []);
  }, [{ providerID: "openai", id: "gpt-6.1-sol", enabled: true }]);
});

test("the route switch follows the session's agent: start-work on lit-implement runs on the helper route", async () => {
  await withServer({ ses_impl: { id: "ses_impl", agent: "lit-implement" } }, async (fake) => {
    await fake.run("session", "prompt", prompt("continue", "ses_impl"));
    assert.deepEqual(fake.sessions.get("ses_impl").model, { providerID: "openai", id: "gpt-6-luna", variant: "max" });
  });
});

test("the model transform registers each OpenAI row LitOpenCode routes to when the host catalog lacks it", async () => {
  await withServer({}, async (fake) => {
    const known = { id: "gpt-6-astra", providerID: "openai", name: "Host Astra", variants: [{ id: "xhigh", settings: { reasoningEffort: "xhigh" } }] };
    const editor = fake.applyModels(createModelEditor({ openai: [known] }));
    assert.deepEqual(editor.get("openai", "gpt-6-astra"), known, "a host row is left as the host made it");
    for (const [id, metadata] of Object.entries(openaiProviderModels)) {
      if (id === "gpt-6-astra") continue;
      const model = editor.get("openai", id);
      assert.ok(model, id);
      assert.equal(model.name, metadata.name, id);
      assert.equal(model.capabilities.tools, metadata.tool_call, id);
      assert.equal(model.capabilities.temperature, metadata.temperature, id);
      assert.deepEqual(model.variants.map((variant) => variant.id), [...openAiModelEfforts(id)], id);
      for (const variant of model.variants) assert.equal(variant.settings.reasoningEffort, variant.id, `${id}#${variant.id}`);
    }
    const unavailable = fake.applyModels(createModelEditor({}));
    assert.equal(unavailable.list().length, 0, "no provider is created");
  });
});
