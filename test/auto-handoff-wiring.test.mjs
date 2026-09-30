import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { litHandoffPromptInjection } from "../src/activation.ts";
import { defaultGlobalConfigFile, defaultGlobalConfigJson, LitOpenCodeConfigError, loadConfig } from "../src/config.ts";
import { findLitOpenCodeFeature } from "../src/features.ts";
import { runCli, withTempDir as withCliTempDir } from "../test-support/cli-fixture.ts";

const handoffBanner = "🔥 LIT IGNITED · lit-handoff 🔥";
const envNames = ["LITOPENCODE_AUTO_HANDOFF", "LITOPENCODE_AUTO_HANDOFF_PERCENT"];

async function withProject(fn, env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-auto-wiring-"));
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, env);
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg-config");
  try {
    await fn(dir);
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function recordingClient(window = 1000) {
  const calls = [];
  return {
    calls,
    client: {
      session: {
        get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }),
        promptAsync: async (request) => { calls.push({ kind: "promptAsync", request }); return { data: undefined }; },
        summarize: async (request) => { calls.push({ kind: "summarize", request }); return { data: true }; },
        status: async () => ({ data: { ses_w: { type: "idle" } } })
      },
      config: {
        providers: async () => ({
          data: { providers: [{ id: "prov", models: { mod: { id: "mod", limit: { context: window, output: 10 } } } }], default: {} }
        })
      },
      tui: { showToast: async (request) => { calls.push({ kind: "toast", body: request.body }); return { data: true }; } }
    }
  };
}

async function startPlugin(dir, client) {
  return litOpenCode.pluginModule.server({
    directory: dir,
    worktree: dir,
    project: {},
    client,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost:4096"),
    $: {}
  });
}

const assistant = (total) => ({
  type: "message.updated",
  properties: {
    info: {
      id: "msg_a", sessionID: "ses_w", role: "assistant", providerID: "prov", modelID: "mod", mode: "lit-loop",
      parentID: "msg_u", path: { cwd: "/", root: "/" }, cost: 0, time: { created: Date.now(), completed: Date.now() },
      tokens: { input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    }
  }
});

// ---- configuration ----

test("the default config carries an OFF auto-handoff block", () => {
  assert.deepEqual(defaultGlobalConfigFile().autoHandoff, { enabled: false, percent: null });
  assert.deepEqual(defaultGlobalConfigJson().autoHandoff, { enabled: false, percent: null });
});

test("the config file parses auto-handoff strictly", async () => {
  await withProject(async (dir) => {
    const runtime = path.join(dir, ".litopencode");
    await fs.mkdir(runtime);
    const write = (value) => fs.writeFile(path.join(runtime, "config.json"), JSON.stringify(value));

    await write({ autoHandoff: { enabled: true, percent: 70 } });
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: true, percent: 70 });

    await write({ autoHandoff: { percent: 40 } });
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: false, percent: 40 });

    for (const bad of [
      { autoHandoff: "on" },
      { autoHandoff: { enabled: "yes", percent: 50 } },
      { autoHandoff: { enabled: true, percent: "50" } },
      { autoHandoff: { enabled: true, percent: 50, mode: "loud" } }
    ]) {
      await write(bad);
      await assert.rejects(loadConfig(dir), LitOpenCodeConfigError, JSON.stringify(bad));
    }
  });
});

// ---- plugin wiring ----

test("the plugin starts the handoff at the crossing and compacts after the reply", async () => {
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(600) });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_w" } } });
    const prompt = calls.find((call) => call.kind === "promptAsync");
    assert.ok(prompt, "handoff request sent through the plugin event hook");
    const marker = /Auto-handoff marker: (\S+ \S+)/.exec(prompt.request.body.parts[0].text)[1];
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `Auto-handoff marker: ${marker}\nBody\n`);
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "ses_w", status: { type: "busy" } } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_w" } } });
    assert.equal(calls.filter((call) => call.kind === "summarize").length, 1);
    await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "ses_w" } } });
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "ses_w" }, output);
    assert.ok(output.system.some((entry) => entry.includes("Body")), "digest reaches the model through the system hook");
  }, { LITOPENCODE_AUTO_HANDOFF: "1", LITOPENCODE_AUTO_HANDOFF_PERCENT: "50" });
});

test("the plugin does nothing without the switch", async () => {
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(950) });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_w" } } });
    assert.deepEqual(calls, []);
  });
});

test("/lit-handoff auto on <percent> replaces the handoff template and saves the setting", async () => {
  await withProject(async (dir) => {
    const hooks = await startPlugin(dir, recordingClient().client);
    const output = { parts: [{ type: "text", text: litHandoffPromptInjection }] };
    await hooks["command.execute.before"]({ command: "lit-handoff", sessionID: "ses_w", arguments: "auto on 70" }, output);
    assert.equal(output.parts.length, 1);
    assert.doesNotMatch(output.parts[0].text, new RegExp(handoffBanner));
    assert.match(output.parts[0].text, /ON at 70%/);
    assert.match(output.parts[0].text, /Do not write a handoff/);
    const saved = JSON.parse(await fs.readFile(path.join(dir, ".litopencode", "auto-handoff.json"), "utf8"));
    assert.deepEqual(saved, { enabled: true, percent: 70 });

    const status = { parts: [{ type: "text", text: litHandoffPromptInjection }] };
    await hooks["command.execute.before"]({ command: "/lit-handoff", sessionID: "ses_w", arguments: "auto status" }, status);
    assert.match(status.parts[0].text, /ON at 70%/);

    const offOutput = { parts: [{ type: "text", text: litHandoffPromptInjection }] };
    await hooks["command.execute.before"]({ command: "/lit-handoff", sessionID: "ses_w", arguments: "auto off" }, offOutput);
    assert.match(offOutput.parts[0].text, /OFF/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, ".litopencode", "auto-handoff.json"), "utf8")), { enabled: false, percent: 70 });
  });
});

test("the settings command takes effect in the running plugin", async () => {
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks["command.execute.before"](
      { command: "lit-handoff", sessionID: "ses_w", arguments: "auto on 50" },
      { parts: [{ type: "text", text: litHandoffPromptInjection }] }
    );
    await hooks.event({ event: assistant(600) });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_w" } } });
    assert.equal(calls.filter((call) => call.kind === "promptAsync").length, 1);
  });
});

test("plain /lit-handoff and plain arguments still write a handoff", async () => {
  await withProject(async (dir) => {
    const hooks = await startPlugin(dir, recordingClient().client);
    for (const args of ["", "automation notes", "sensitive argument"]) {
      const output = { parts: [] };
      await hooks["command.execute.before"]({ command: "/lit-handoff", sessionID: "ses_w", arguments: args }, output);
      assert.equal(output.parts.length, 1, args);
      assert.equal(output.parts[0].text.startsWith(`${handoffBanner}\n`), true, args);
    }
  });
});

test("the exact chat message lit-handoff auto on <percent> is a settings route, not a handoff", async () => {
  await withProject(async (dir) => {
    const hooks = await startPlugin(dir, recordingClient().client);
    const output = {
      message: { id: "msg_c", sessionID: "ses_w", role: "user" },
      parts: [{ id: "p1", sessionID: "ses_w", messageID: "msg_c", type: "text", text: "lit-handoff auto on 65" }]
    };
    await hooks["chat.message"]({ sessionID: "ses_w", messageID: "msg_c", agent: "lit-loop" }, output);
    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /ON at 65%/);
    assert.doesNotMatch(output.parts[1].text, new RegExp(handoffBanner));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, ".litopencode", "auto-handoff.json"), "utf8")), { enabled: true, percent: 65 });
  });
});

test("a chat message that only mentions the route stays inert", async () => {
  await withProject(async (dir) => {
    const hooks = await startPlugin(dir, recordingClient().client);
    for (const text of ["could you run lit-handoff auto on 65 for me", "`lit-handoff auto on 65`"]) {
      const output = {
        message: { id: "msg_i", sessionID: "ses_w", role: "user" },
        parts: [{ id: "p1", sessionID: "ses_w", messageID: "msg_i", type: "text", text }]
      };
      await hooks["chat.message"]({ sessionID: "ses_w", messageID: "msg_i", agent: "lit-loop" }, output);
      await assert.rejects(fs.readFile(path.join(dir, ".litopencode", "auto-handoff.json"), "utf8"), { code: "ENOENT" }, text);
    }
  });
});

// ---- doctor and catalog ----

test("doctor shows the auto-handoff state and warns at or above the host compaction point", async () => {
  await withCliTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, ".litopencode"));
    await fs.writeFile(path.join(dir, ".litopencode", "auto-handoff.json"), JSON.stringify({ enabled: true, percent: 95 }));
    const configured = runCli(["install", "--root", dir, "--provider", "openai", "--model", "gpt-5.6-luna", "--effort", "high"], {
      env: { ...process.env, XDG_CONFIG_HOME: path.join(dir, "xdg-config") }
    });
    assert.equal(configured.status, 0, configured.stderr);
    const result = runCli(["doctor", "--root", dir, "--no-auto-update"], {
      env: { ...process.env, XDG_CONFIG_HOME: path.join(dir, "xdg-config") }
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout).autoHandoff;
    assert.equal(report.enabled, true);
    assert.equal(report.percent, 95);
    assert.equal(report.host.compactionPercent, 90);
    assert.match(report.warnings.join("\n"), /90%/);
    assert.match(report.warnings.join("\n"), /95%/);
  });
});

test("doctor reports OFF by default with no warnings", async () => {
  await withCliTempDir(async (dir) => {
    const result = runCli(["doctor", "--root", dir, "--no-auto-update"], {
      env: { ...process.env, XDG_CONFIG_HOME: path.join(dir, "xdg-config") }
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout).autoHandoff;
    assert.equal(report.enabled, false);
    assert.equal(report.percent, null);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.env.enabled, "LITOPENCODE_AUTO_HANDOFF");
    assert.equal(report.env.percent, "LITOPENCODE_AUTO_HANDOFF_PERCENT");
  });
});

test("doctor turns an invalid percent into OFF with a warning", async () => {
  await withCliTempDir(async (dir) => {
    const result = runCli(["doctor", "--root", dir, "--no-auto-update"], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(dir, "xdg-config"),
        LITOPENCODE_AUTO_HANDOFF: "1",
        LITOPENCODE_AUTO_HANDOFF_PERCENT: "150"
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout).autoHandoff;
    assert.equal(report.enabled, false);
    assert.match(report.warnings.join("\n"), /LITOPENCODE_AUTO_HANDOFF_PERCENT/);
  });
});

test("the feature registry binds the automatic route to lit-handoff", () => {
  const feature = findLitOpenCodeFeature("lit-handoff");
  const surfaces = feature.bindings.map((binding) => `${binding.kind}:${binding.id}`);
  assert.ok(surfaces.includes("hook:event"), surfaces.join(","));
  assert.ok(surfaces.includes("hook:experimental.chat.system.transform"), surfaces.join(","));
  assert.ok(feature.verification.includes("node --test test/auto-handoff.test.mjs"));
});

test("the lit-handoff skill documents the automatic route", async () => {
  const skill = await fs.readFile("skills/lit-handoff/SKILL.md", "utf8");
  assert.match(skill, /auto on <percent>/);
  assert.match(skill, /LITOPENCODE_AUTO_HANDOFF_PERCENT/);
});
