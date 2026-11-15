import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import * as handoff from "../src/auto-handoff.ts";
import { defaultGlobalConfigFile, loadConfig, mergeConfigs } from "../src/config.ts";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

// The automatic handoff is ON by default (70% of the window). One setting turns it off: autoHandoff.enabled
// false in a LitOpenCode config file; the saved `lit-handoff auto off` and LITOPENCODE_AUTO_HANDOFF=0 still work.

const envNames = ["LITOPENCODE_AUTO_HANDOFF", "LITOPENCODE_AUTO_HANDOFF_PERCENT"];

async function withProject(fn, env = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-auto-default-")));
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
const idleEvent = { type: "session.idle", properties: { sessionID: "ses_w" } };

async function writeProjectConfig(dir, value) {
  await fs.mkdir(path.join(dir, ".litopencode"), { recursive: true });
  await fs.writeFile(path.join(dir, ".litopencode", "config.json"), JSON.stringify(value));
}

test("the shipped default is ON at 70 percent, and the config carries it", async () => {
  assert.deepEqual({ ...handoff.defaultAutoHandoff }, { enabled: true, percent: 70 });
  assert.deepEqual(defaultGlobalConfigFile().autoHandoff, { enabled: true, percent: 70 });
  await withProject(async (dir) => {
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: true, percent: 70 });
  });
});

test("with no setting anywhere the resolution is ON at 70 and names the default as its source", () => {
  const resolved = handoff.resolveAutoHandoff({ config: defaultGlobalConfigFile().autoHandoff, state: undefined, env: {} });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.percent, 70);
  assert.deepEqual(resolved.sources, { enabled: "default", percent: "default" });
  assert.deepEqual(resolved.warnings, []);
});

test("an explicit enabled false in a config file names the config as its source", () => {
  const resolved = handoff.resolveAutoHandoff({ config: { enabled: false, percent: 70 }, state: undefined, env: {} });
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.sources.enabled, "config");
});

test("the plugin saves a handoff before the compaction by default, and brings it back after", async () => {
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(700) });
    await hooks.event({ event: idleEvent });
    const prompt = calls.find((call) => call.kind === "promptAsync");
    assert.ok(prompt, "a handoff request is sent at 70% with no switch set");
    const marker = /Auto-handoff marker: (\S+ \S+)/.exec(prompt.request.body.parts[0].text)[1];
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `# Handoff\nAuto-handoff marker: ${marker}\nNext step: row 3.\n`);
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "ses_w", status: { type: "busy" } } } });
    await hooks.event({ event: idleEvent });
    assert.equal(calls.filter((call) => call.kind === "summarize").length, 1);
    await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "ses_w" } } });
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "ses_w" }, output);
    assert.ok(output.system.some((entry) => entry.includes("Next step: row 3.")), "the digest reaches the model");
  });
});

test("below 70 percent nothing is sent", async () => {
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(699) });
    await hooks.event({ event: idleEvent });
    assert.deepEqual(calls, []);
  });
});

test("autoHandoff.enabled false in the project config turns it off and keeps the percent", async () => {
  await withProject(async (dir) => {
    await writeProjectConfig(dir, { autoHandoff: { enabled: false } });
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: false, percent: 70 });
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(950) });
    await hooks.event({ event: idleEvent });
    assert.deepEqual(calls, []);
  });
});

test("the saved lit-handoff auto off and LITOPENCODE_AUTO_HANDOFF=0 still win over the default", async () => {
  await withProject(async (dir) => {
    await fs.mkdir(path.join(dir, ".litopencode"), { recursive: true });
    await fs.writeFile(path.join(dir, ".litopencode", "auto-handoff.json"), JSON.stringify({ enabled: false, percent: 70 }) + "\n");
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(950) });
    await hooks.event({ event: idleEvent });
    assert.deepEqual(calls, [], "the saved setting turns it off");
  });
  await withProject(async (dir) => {
    const { client, calls } = recordingClient();
    const hooks = await startPlugin(dir, client);
    await hooks.event({ event: assistant(950) });
    await hooks.event({ event: idleEvent });
    assert.deepEqual(calls, [], "the switch turns it off");
  }, { LITOPENCODE_AUTO_HANDOFF: "0" });
});

test("the old shipped block { enabled: false, percent: null } records no choice, so the default applies", async () => {
  await withProject(async (dir) => {
    const legacy = { enabled: false, percent: null };
    const merged = mergeConfigs(defaultGlobalConfigFile(), { autoHandoff: legacy });
    assert.deepEqual(merged.autoHandoff, { enabled: true, percent: 70 });
    // Earlier installs wrote that block into the global file; the project file can carry it too.
    await fs.mkdir(path.join(dir, "xdg-config", "opencode"), { recursive: true });
    await fs.writeFile(path.join(dir, "xdg-config", "opencode", "litopencode.json"), JSON.stringify({ autoHandoff: legacy }));
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: true, percent: 70 });
    await writeProjectConfig(dir, { autoHandoff: legacy });
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: true, percent: 70 });
    // A user who turned it off by name stays off.
    await writeProjectConfig(dir, { autoHandoff: { enabled: false, percent: 50 } });
    assert.deepEqual((await loadConfig(dir)).config.autoHandoff, { enabled: false, percent: 50 });
  });
});

test("doctor reports ON at 70 from the default, with no warnings", async () => {
  await withTempDir(async (dir) => {
    const result = runCli(["doctor", "--root", dir, "--no-auto-update"], {
      cwd: dir,
      env: { ...process.env, XDG_CONFIG_HOME: path.join(dir, "xdg-config"), LITOPENCODE_AUTO_HANDOFF: "", LITOPENCODE_AUTO_HANDOFF_PERCENT: "" }
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout).autoHandoff;
    assert.equal(report.enabled, true);
    assert.equal(report.percent, 70);
    assert.deepEqual(report.sources, { enabled: "default", percent: "default" });
    assert.deepEqual(report.warnings, []);
  });
});
