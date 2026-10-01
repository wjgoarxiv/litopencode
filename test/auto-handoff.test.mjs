import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assistantTokenTotal,
  autoHandoffEnvEnabled,
  autoHandoffEnvPercent,
  createAutoHandoffSettings,
  isValidAutoHandoffPercent,
  parseAutoHandoffRoute,
  readFreshHandoff,
  resolveAutoHandoff
} from "../src/auto-handoff.ts";
import { createAutoHandoff } from "../src/auto-handoff-hooks.ts";
import { detectChatActivationMode } from "../src/activation-routing.ts";
import { createRuntimePaths } from "../src/state.ts";

const off = Object.freeze({ enabled: false, percent: null });

async function withProject(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-auto-handoff-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---- resolution: OFF by default, strict percent, env and command precedence ----

test("auto-handoff is OFF by default and never invents a percent", () => {
  const resolved = resolveAutoHandoff({ config: off, state: undefined, env: {} });
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.percent, null);
  assert.deepEqual(resolved.warnings, []);
});

test("only whole numbers from 1 to 99 are valid percents", () => {
  for (const good of [1, 50, 99]) assert.equal(isValidAutoHandoffPercent(good), true, String(good));
  for (const bad of [0, 100, -5, 50.5, Number.NaN, "50", null, undefined]) {
    assert.equal(isValidAutoHandoffPercent(bad), false, String(bad));
  }
});

test("the environment variables switch it on with the user's own percent", () => {
  const resolved = resolveAutoHandoff({
    config: off,
    state: undefined,
    env: { [autoHandoffEnvEnabled]: "1", [autoHandoffEnvPercent]: "62" }
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.percent, 62);
  assert.equal(resolved.sources.enabled, "env");
  assert.equal(resolved.sources.percent, "env");
});

test("an invalid percent turns it OFF and names the source in a warning", () => {
  for (const raw of ["0", "100", "abc", "50.5", "-3", "1e2"]) {
    const resolved = resolveAutoHandoff({
      config: off,
      state: undefined,
      env: { [autoHandoffEnvEnabled]: "1", [autoHandoffEnvPercent]: raw }
    });
    assert.equal(resolved.enabled, false, raw);
    assert.equal(resolved.percent, null, raw);
    assert.equal(resolved.warnings.length, 1, raw);
    assert.match(resolved.warnings[0], /LITOPENCODE_AUTO_HANDOFF_PERCENT/, raw);
  }
  const fromConfig = resolveAutoHandoff({ config: { enabled: true, percent: 150 }, state: undefined, env: {} });
  assert.equal(fromConfig.enabled, false);
  assert.match(fromConfig.warnings[0], /config/);
});

test("switching on without any percent stays OFF and warns", () => {
  const resolved = resolveAutoHandoff({
    config: off,
    state: undefined,
    env: { [autoHandoffEnvEnabled]: "1" }
  });
  assert.equal(resolved.enabled, false);
  assert.match(resolved.warnings.join("\n"), /no percent/i);
});

test("an unrecognised switch value turns it OFF with a warning", () => {
  const resolved = resolveAutoHandoff({
    config: { enabled: true, percent: 70 },
    state: undefined,
    env: { [autoHandoffEnvEnabled]: "maybe" }
  });
  assert.equal(resolved.enabled, false);
  assert.match(resolved.warnings.join("\n"), /LITOPENCODE_AUTO_HANDOFF\b/);
});

test("command state beats the config file and the environment beats command state", () => {
  const config = { enabled: true, percent: 60 };
  const commandOff = resolveAutoHandoff({ config, state: { enabled: false, percent: 70 }, env: {} });
  assert.equal(commandOff.enabled, false);
  assert.equal(commandOff.percent, 70);
  assert.equal(commandOff.lastPercent, 70);

  const envWins = resolveAutoHandoff({
    config,
    state: { enabled: false, percent: 70 },
    env: { [autoHandoffEnvEnabled]: "1", [autoHandoffEnvPercent]: "40" }
  });
  assert.equal(envWins.enabled, true);
  assert.equal(envWins.percent, 40);
});

// ---- the command route ----

test("the route parser accepts exactly the documented spellings", () => {
  assert.deepEqual(parseAutoHandoffRoute("auto on 70", "command"), { action: "on", percent: "70" });
  assert.deepEqual(parseAutoHandoffRoute("auto on", "command"), { action: "on", percent: undefined });
  assert.deepEqual(parseAutoHandoffRoute("auto off", "command"), { action: "off" });
  assert.deepEqual(parseAutoHandoffRoute("  AUTO  Status ", "command"), { action: "status" });
  assert.deepEqual(parseAutoHandoffRoute("lit-handoff auto on 55", "chat"), { action: "on", percent: "55" });
  assert.deepEqual(parseAutoHandoffRoute("lit-handoff auto off", "chat"), { action: "off" });
  assert.equal(parseAutoHandoffRoute("auto on 70", "chat"), undefined);
  assert.equal(parseAutoHandoffRoute("please lit-handoff auto on 70", "chat"), undefined);
  assert.equal(parseAutoHandoffRoute("", "command"), undefined);
  assert.equal(parseAutoHandoffRoute("notes about automation", "command"), undefined);
  assert.equal(parseAutoHandoffRoute("automatic notes", "command"), undefined);
  assert.equal(parseAutoHandoffRoute("auto", "command").action, "invalid");
  assert.equal(parseAutoHandoffRoute("auto banana", "command").action, "invalid");
  assert.equal(parseAutoHandoffRoute("auto off 5", "command").action, "invalid");
});

test("route on sets the percent, off keeps it, and on without a number reuses it", async () => {
  await withProject(async (dir) => {
    const paths = createRuntimePaths(dir);
    const settings = createAutoHandoffSettings({ stateFile: paths.autoHandoffFile, config: off, env: {} });

    const on = await settings.route("auto on 70", "command");
    assert.match(on, /ON at 70%/);
    assert.deepEqual(JSON.parse(await fs.readFile(paths.autoHandoffFile, "utf8")), { enabled: true, percent: 70 });
    assert.equal((await settings.resolve()).enabled, true);

    const offReply = await settings.route("auto off", "command");
    assert.match(offReply, /OFF/);
    assert.match(offReply, /70%/);
    assert.deepEqual(JSON.parse(await fs.readFile(paths.autoHandoffFile, "utf8")), { enabled: false, percent: 70 });
    assert.equal((await settings.resolve()).enabled, false);

    const again = await settings.route("auto on", "command");
    assert.match(again, /ON at 70%/);
    assert.equal((await settings.resolve()).percent, 70);
  });
});

test("route on without a number asks when no percent was ever set", async () => {
  await withProject(async (dir) => {
    const paths = createRuntimePaths(dir);
    const settings = createAutoHandoffSettings({ stateFile: paths.autoHandoffFile, config: off, env: {} });
    const reply = await settings.route("auto on", "command");
    assert.match(reply, /percent/i);
    assert.match(reply, /1 to 99/);
    assert.equal((await settings.resolve()).enabled, false);
    await assert.rejects(fs.readFile(paths.autoHandoffFile, "utf8"), { code: "ENOENT" });
  });
});

test("route rejects an invalid percent and leaves the saved state alone", async () => {
  await withProject(async (dir) => {
    const paths = createRuntimePaths(dir);
    const settings = createAutoHandoffSettings({ stateFile: paths.autoHandoffFile, config: off, env: {} });
    await settings.route("auto on 70", "command");
    const before = await fs.readFile(paths.autoHandoffFile, "utf8");
    for (const bad of ["0", "100", "abc", "5.5", "-1"]) {
      const reply = await settings.route(`auto on ${bad}`, "command");
      assert.match(reply, /1 to 99/, bad);
    }
    assert.equal(await fs.readFile(paths.autoHandoffFile, "utf8"), before);
  });
});

test("route status reports the state and says when the environment overrides a command", async () => {
  await withProject(async (dir) => {
    const paths = createRuntimePaths(dir);
    const env = { [autoHandoffEnvEnabled]: "0" };
    const settings = createAutoHandoffSettings({ stateFile: paths.autoHandoffFile, config: off, env });
    const reply = await settings.route("auto on 70", "command");
    assert.match(reply, /LITOPENCODE_AUTO_HANDOFF/);
    assert.match(reply, /OFF/);
    const status = await settings.route("auto status", "command");
    assert.match(status, /OFF/);
    assert.match(status, /LITOPENCODE_AUTO_HANDOFF/);
  });
});

// ---- token accounting ----

test("token total follows the host's own count", () => {
  assert.equal(assistantTokenTotal({ tokens: { input: 10, output: 5, reasoning: 99, cache: { read: 3, write: 2 } } }), 20);
  assert.equal(assistantTokenTotal({ tokens: { total: 77, input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }), 77);
  assert.equal(assistantTokenTotal({ tokens: { input: -1, output: 5, cache: { read: 0, write: 0 } } }), 0);
  assert.equal(assistantTokenTotal({}), 0);
});

// ---- the controller: crossing, handoff, compaction, reload ----

const SESSION = "ses_root";

function assistantUpdate(sessionID, total, overrides = {}) {
  return {
    type: "message.updated",
    properties: {
      info: {
        id: `msg_${Math.random().toString(36).slice(2)}`,
        sessionID,
        role: "assistant",
        providerID: "prov",
        modelID: "mod",
        mode: "lit-loop",
        parentID: "msg_user",
        path: { cwd: "/", root: "/" },
        cost: 0,
        time: { created: Date.now(), completed: Date.now() },
        tokens: { input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        ...overrides
      }
    }
  };
}

const idleEvent = (sessionID) => ({ type: "session.idle", properties: { sessionID } });
const busyEvent = (sessionID) => ({ type: "session.status", properties: { sessionID, status: { type: "busy" } } });
const compactedEvent = (sessionID) => ({ type: "session.compacted", properties: { sessionID } });

function fakeClient({ window = 1000, status = "idle", children = new Set(), summarize } = {}) {
  const calls = [];
  const state = { status };
  const client = {
    session: {
      get: async ({ path: requestPath }) => ({
        data: { id: requestPath.id, ...(children.has(requestPath.id) ? { parentID: "ses_parent" } : {}) }
      }),
      promptAsync: async (request) => {
        calls.push({ kind: "promptAsync", request });
        return { data: undefined };
      },
      summarize: async (request) => {
        calls.push({ kind: "summarize", request });
        return summarize === undefined ? { data: true } : summarize(request);
      },
      status: async () => ({ data: { [SESSION]: { type: state.status } } })
    },
    config: {
      providers: async () => ({
        data: {
          providers: [{ id: "prov", models: { mod: { id: "mod", limit: { context: window, output: 100 } } } }],
          default: {}
        }
      })
    },
    tui: {
      showToast: async (request) => {
        calls.push({ kind: "toast", body: request.body });
        return { data: true };
      }
    }
  };
  return { client, calls, state };
}

function build(dir, client, env) {
  return createAutoHandoff({
    projectRoot: dir,
    paths: createRuntimePaths(dir),
    client,
    config: off,
    env
  });
}

const on50 = Object.freeze({ [autoHandoffEnvEnabled]: "1", [autoHandoffEnvPercent]: "50" });
const kinds = (calls, kind) => calls.filter((call) => call.kind === kind);

function markerFrom(calls) {
  const prompt = kinds(calls, "promptAsync")[0];
  const text = prompt.request.body.parts.map((part) => part.text).join("\n");
  const match = /Auto-handoff marker: (\S+ \S+)/.exec(text);
  assert.ok(match, "the directive carries a marker line");
  return `Auto-handoff marker: ${match[1]}`;
}

async function cross(autoHandoff) {
  await autoHandoff.event({ event: assistantUpdate(SESSION, 600) });
  await autoHandoff.event({ event: idleEvent(SESSION) });
}

test("nothing happens while it is OFF, even far above any percent", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, {});
    await cross(autoHandoff);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 990) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.deepEqual(calls, []);
  });
});

test("below the percent nothing is sent", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 499) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.deepEqual(calls, []);
  });
});

test("crossing waits for the session to go idle, then sends one handoff request", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 600) });
    assert.equal(kinds(calls, "promptAsync").length, 0, "never during a turn");
    await autoHandoff.event({ event: idleEvent(SESSION) });
    const prompts = kinds(calls, "promptAsync");
    assert.equal(prompts.length, 1);
    const request = prompts[0].request;
    assert.equal(request.path.id, SESSION);
    assert.equal(request.query.directory, dir);
    assert.equal(request.body.agent, "lit-loop");
    assert.deepEqual(request.body.model, { providerID: "prov", modelID: "mod" });
    assert.match(request.body.system, /LIT IGNITED · lit-handoff/);
    assert.match(request.body.system, /templates\/HANDOFF\.md|Required Sections|HANDOFF\.md/);
    const text = request.body.parts.map((part) => part.text).join("\n");
    assert.match(text, /60%/);
    assert.match(text, /Auto-handoff marker: ses_root \d{4}-\d{2}-\d{2}T/);
    assert.equal(detectChatActivationMode(text), undefined, "the request must not trigger another lit route");
  });
});

test("events the host delivers back to back are handled in arrival order", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const providers = client.config.providers;
    client.config.providers = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return providers(request);
    };
    const autoHandoff = build(dir, client, on50);
    // The real host publishes the final usage update and the idle event in the same millisecond.
    await Promise.all([
      autoHandoff.event({ event: assistantUpdate(SESSION, 600) }),
      autoHandoff.event({ event: idleEvent(SESSION) })
    ]);
    assert.equal(kinds(calls, "promptAsync").length, 1);
  });
});

test("it fires once per crossing and never loops", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    for (let i = 0; i < 5; i += 1) {
      await autoHandoff.event({ event: assistantUpdate(SESSION, 700 + i) });
      await autoHandoff.event({ event: idleEvent(SESSION) });
      await autoHandoff.event({ event: { type: "session.status", properties: { sessionID: SESSION, status: { type: "idle" } } } });
    }
    assert.equal(kinds(calls, "promptAsync").length, 1);
    assert.equal(kinds(calls, "summarize").length, 0, "no compaction without a verified handoff");
  });
});

test("a stale idle before the handoff reply starts does not trigger compaction", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 0);
  });
});

test("compaction starts only after the handoff reply, in that order, and only once", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `# Handoff\n${markerFrom(calls)}\n\nWork so far.\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    const order = calls.filter((call) => call.kind === "promptAsync" || call.kind === "summarize").map((call) => call.kind);
    assert.deepEqual(order, ["promptAsync", "summarize"]);
    const summarize = kinds(calls, "summarize")[0].request;
    assert.equal(summarize.path.id, SESSION);
    assert.deepEqual(summarize.body, { providerID: "prov", modelID: "mod" });
  });
});

test("the handoff may live under .handoff as well as at the root", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.mkdir(path.join(dir, ".handoff"));
    await fs.writeFile(path.join(dir, ".handoff", "HANDOFF.md"), `# Handoff\n${markerFrom(calls)}\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 1);
  });
});

test("no compaction when the model did not write a handoff carrying this session's marker", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    await fs.writeFile(path.join(dir, "HANDOFF.md"), "# Old handoff\nAuto-handoff marker: ses_root 2020-01-01T00:00:00.000Z\n");
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 0);
    const toast = kinds(calls, "toast").map((call) => call.body.message).join("\n");
    assert.match(toast, /no handoff|not found|was not written/i);
  });
});

test("a busy session is never asked to compact", async () => {
  await withProject(async (dir) => {
    const { client, calls, state } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `${markerFrom(calls)}\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    state.status = "busy";
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 0);
    state.status = "idle";
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 1);
  });
});

test("a failed compaction request leaves exactly one plain reminder", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient({ summarize: async () => ({ error: { name: "BadRequest" } }) });
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `${markerFrom(calls)}\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    await new Promise((resolve) => setImmediate(resolve));
    const messages = kinds(calls, "toast").map((call) => call.body.message);
    assert.equal(messages.filter((message) => message === "Handoff saved. Run /compact now.").length, 1);
  });
});

test("after compaction the fresh handoff comes back exactly once", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `# Handoff\n${markerFrom(calls)}\n\nNext step: ship the parser.\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    await autoHandoff.event({ event: compactedEvent(SESSION) });

    const first = { system: ["base"] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, first);
    assert.equal(first.system.length, 2);
    assert.match(first.system[1], /Next step: ship the parser\./);
    assert.match(first.system[1], /HANDOFF\.md/);

    const second = { system: ["base"] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, second);
    assert.deepEqual(second.system, ["base"]);
  });
});

test("a user-run compaction after the handoff also brings it back", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `${markerFrom(calls)}\nResume here.\n`);
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    const output = { system: [] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, output);
    assert.match(output.system.join("\n"), /Resume here\./);
  });
});

test("a stale or foreign handoff is refused on reload", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    const marker = markerFrom(calls);

    // foreign: another session's marker at the same path
    await fs.writeFile(path.join(dir, "HANDOFF.md"), "Auto-handoff marker: ses_other 2099-01-01T00:00:00.000Z\nforeign\n");
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    const foreign = { system: [] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, foreign);
    assert.deepEqual(foreign.system, []);
  });

  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    const marker = markerFrom(calls);
    // stale: right marker, but the file is older than the trigger
    const file = path.join(dir, "HANDOFF.md");
    await fs.writeFile(file, `${marker}\nstale\n`);
    const past = new Date(Date.now() - 3_600_000);
    await fs.utimes(file, past, past);
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    const stale = { system: [] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, stale);
    assert.deepEqual(stale.system, []);
  });

  await withProject(async (dir) => {
    const { client } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    // a compaction the feature never asked for injects nothing
    await fs.writeFile(path.join(dir, "HANDOFF.md"), "Auto-handoff marker: ses_root 2099-01-01T00:00:00.000Z\n");
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    const untouched = { system: [] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, untouched);
    assert.deepEqual(untouched.system, []);
  });
});

// ---- the reload matcher reads each line with its Markdown decoration removed ----

const matrixSession = "ses_root";
const matrixFiredAt = Date.parse("2026-10-01T09:00:00.000Z");
const matrixValue = `${matrixSession} ${new Date(matrixFiredAt).toISOString()}`;
const matrixMarker = `Auto-handoff marker: ${matrixValue}`;

async function matrixFinds(body, { mtimeMs } = {}) {
  let found;
  await withProject(async (dir) => {
    const file = path.join(dir, "HANDOFF.md");
    await fs.writeFile(file, body);
    const when = new Date(mtimeMs ?? matrixFiredAt + 60_000);
    await fs.utimes(file, when, when);
    found = await readFreshHandoff(dir, matrixMarker, matrixFiredAt);
  });
  return found !== undefined;
}

const decoratedLines = {
  "bare line": matrixMarker,
  "dash bullet": `- ${matrixMarker}`,
  "star bullet": `* ${matrixMarker}`,
  "plus bullet": `+ ${matrixMarker}`,
  "numbered item": `1. ${matrixMarker}`,
  "numbered item with paren": `2) ${matrixMarker}`,
  "blockquote": `> ${matrixMarker}`,
  "blockquote holding a bullet": `> - ${matrixMarker}`,
  "indented bullet": `    - ${matrixMarker}`,
  "bold label": `**Auto-handoff marker:** ${matrixValue}`,
  "bold label with the colon outside": `**Auto-handoff marker**: ${matrixValue}`,
  "underscore bold label": `__Auto-handoff marker:__ ${matrixValue}`,
  "italic label": `*Auto-handoff marker:* ${matrixValue}`,
  "underscore italic label": `_Auto-handoff marker:_ ${matrixValue}`,
  "bold value": `Auto-handoff marker: **${matrixValue}**`,
  "italic value": `Auto-handoff marker: *${matrixValue}*`,
  "underscore italic value": `Auto-handoff marker: _${matrixValue}_`,
  "underscore bold value": `Auto-handoff marker: __${matrixValue}__`,
  "bold session id only": `Auto-handoff marker: **${matrixSession}** ${new Date(matrixFiredAt).toISOString()}`,
  "backticked label": `\`Auto-handoff marker:\` ${matrixValue}`,
  "backticked value": `Auto-handoff marker: \`${matrixValue}\``,
  "backticked whole marker": `\`${matrixMarker}\``,
  "bullet around a backticked marker": `- \`${matrixMarker}\``,
  "bold whole marker": `**${matrixMarker}**`,
  "bold label and backticked value in a bullet": `- **Auto-handoff marker:** \`${matrixValue}\``,
  "leading label before the marker": `Marker: ${matrixMarker}`,
  "bullet with a leading label and a backticked marker": `- Auto-handoff marker: \`${matrixMarker}\``,
  "html comment": `<!-- ${matrixMarker} -->`,
  "html comment without inner spaces": `<!--${matrixMarker}-->`,
  "extra spaces": "Auto-handoff marker:   ses_root    2026-10-01T09:00:00.000Z",
  "a tab between the parts": "Auto-handoff marker:\tses_root\t2026-10-01T09:00:00.000Z",
  "trailing period": `${matrixMarker}.`,
  "trailing prose": `${matrixMarker} (written by the model)`,
  "trailing spaces": `${matrixMarker}   `
};

for (const [name, line] of Object.entries(decoratedLines)) {
  test(`a decorated marker is found: ${name}`, async () => {
    assert.equal(await matrixFinds(`# Handoff\n${line}\n\n## Task\nShip it.\n`), true);
  });
}

test("a decorated marker is found with CRLF line endings", async () => {
  assert.equal(await matrixFinds(`# Handoff\r\n- **Auto-handoff marker:** \`${matrixValue}\`\r\n\r\nBody\r\n`), true);
});

test("a marker inside a fenced code block is still accepted, as before", async () => {
  assert.equal(await matrixFinds(`# Handoff\n\`\`\`\n${matrixMarker}\n\`\`\`\n`), true);
});

test("the live failure shape is found: a bullet label around a backticked marker", async () => {
  const body = [
    "# HANDOFF: Finish full-content display",
    "",
    "## What Was Done",
    "",
    "- Checked the workspace: git root is the current directory.",
    `- Auto-handoff marker: \`${matrixMarker}\``,
    "",
    "### Dead Ends",
    ""
  ].join("\n");
  assert.equal(await matrixFinds(body), true);
});

const refusedLines = {
  "another session": "- **Auto-handoff marker:** `ses_other 2026-10-01T09:00:00.000Z`",
  "a session id with this one as a prefix": "- Auto-handoff marker: `ses_rootx 2026-10-01T09:00:00.000Z`",
  "this id glued behind other characters": "Auto-handoff marker: xses_root 2026-10-01T09:00:00.000Z",
  "an id that differs only by its underscore": "Auto-handoff marker: sesroot 2026-10-01T09:00:00.000Z",
  "another trigger time": "- Auto-handoff marker: `ses_root 2026-10-01T09:00:01.000Z`",
  "a time with more characters glued on": "- Auto-handoff marker: `ses_root 2026-10-01T09:00:00.000Zx`",
  "a bare marker with a letter glued behind the time": "Auto-handoff marker: ses_root 2026-10-01T09:00:00.000Zx",
  "a bare marker with a digit glued behind the time": "Auto-handoff marker: ses_root 2026-10-01T09:00:00.000Z9",
  "a bulleted marker with letters glued behind the time": "- Auto-handoff marker: ses_root 2026-10-01T09:00:00.000Zabc",
  "a bare marker with a letter glued before the label": "xAuto-handoff marker: ses_root 2026-10-01T09:00:00.000Z",
  "the label alone": "- **Auto-handoff marker:**",
  "the value without its label": "- ses_root 2026-10-01T09:00:00.000Z",
  "prose that merely mentions the session": "See ses_root, fired at 2026-10-01T09:00:00.000Z.",
  "a marker with a different label": "Auto-handoff id: ses_root 2026-10-01T09:00:00.000Z"
};

for (const [name, line] of Object.entries(refusedLines)) {
  test(`a look-alike marker is refused: ${name}`, async () => {
    assert.equal(await matrixFinds(`# Handoff\n${line}\n`), false);
  });
}

test("a decorated marker split across two lines is refused", async () => {
  assert.equal(await matrixFinds(`# Handoff\n- **Auto-handoff marker:**\n\`${matrixValue}\`\n`), false);
});

test("a decorated marker in a file older than the trigger is refused", async () => {
  const body = `# Handoff\n- Auto-handoff marker: \`${matrixMarker}\`\n`;
  assert.equal(await matrixFinds(body, { mtimeMs: matrixFiredAt - 3_600_000 }), false);
});

test("a decorated marker reloads through the controller after a compaction", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    const marker = markerFrom(calls);
    await fs.writeFile(
      path.join(dir, "HANDOFF.md"),
      `# Handoff\n\n## What Was Done\n\n- **Auto-handoff marker:** \`${marker.replace(/^Auto-handoff marker: /, "")}\`\n\nNext step: ship the parser.\n`
    );
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "summarize").length, 1, "the decorated marker lets compaction go ahead");
    await autoHandoff.event({ event: compactedEvent(SESSION) });

    const output = { system: ["base"] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, output);
    assert.equal(output.system.length, 2);
    assert.match(output.system[1], /Next step: ship the parser\./);
  });
});

test("a compaction that frees the context before the request cancels the pending crossing", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 600) });
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.deepEqual(calls, []);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 100) });
    await autoHandoff.event({ event: assistantUpdate(SESSION, 700) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "promptAsync").length, 1, "a later real crossing still fires");
  });
});

test("the reload digest is bounded and framed as data", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    const filler = "가나다라 ".repeat(8000);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `${markerFrom(calls)}\n${filler}\nTAIL-SENTINEL\n`);
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    const output = { system: [] };
    await autoHandoff.systemTransform({ sessionID: SESSION }, output);
    const text = output.system.join("\n");
    assert.ok(Buffer.byteLength(text) < 9000, `digest is ${Buffer.byteLength(text)} bytes`);
    assert.doesNotMatch(text, /TAIL-SENTINEL/);
    assert.doesNotMatch(text, /�/);
    assert.match(text, /data/i);
  });
});

test("the feature rearms once usage drops below the percent, then fires again", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await fs.writeFile(path.join(dir, "HANDOFF.md"), `${markerFrom(calls)}\n`);
    await autoHandoff.event({ event: busyEvent(SESSION) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    await autoHandoff.event({ event: compactedEvent(SESSION) });
    await autoHandoff.systemTransform({ sessionID: SESSION }, { system: [] });

    await autoHandoff.event({ event: assistantUpdate(SESSION, 100) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "promptAsync").length, 1);

    await autoHandoff.event({ event: assistantUpdate(SESSION, 800) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "promptAsync").length, 2);
  });
});

test("compaction summaries and failed calls do not count as usage", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 900, { summary: true }) });
    await autoHandoff.event({ event: assistantUpdate(SESSION, 900, { error: { name: "APIError", data: { message: "x", isRetryable: false } } }) });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.deepEqual(calls, []);
  });
});

test("child sessions are left alone", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient({ children: new Set(["ses_child"]) });
    const autoHandoff = build(dir, client, on50);
    await autoHandoff.event({ event: assistantUpdate("ses_child", 900) });
    await autoHandoff.event({ event: idleEvent("ses_child") });
    assert.deepEqual(calls, []);
  });
});

test("an unknown model window means no percent and no action", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient({ window: 0 });
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    assert.deepEqual(calls, []);
  });
});

test("turning it off between the crossing and the idle cancels the request", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const env = { ...on50 };
    const autoHandoff = build(dir, client, env);
    await autoHandoff.event({ event: assistantUpdate(SESSION, 600) });
    env[autoHandoffEnvEnabled] = "0";
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.deepEqual(calls, []);
  });
});

test("a deleted session forgets its state", async () => {
  await withProject(async (dir) => {
    const { client, calls } = fakeClient();
    const autoHandoff = build(dir, client, on50);
    await cross(autoHandoff);
    await autoHandoff.event({ event: { type: "session.deleted", properties: { info: { id: SESSION } } } });
    await autoHandoff.event({ event: idleEvent(SESSION) });
    assert.equal(kinds(calls, "promptAsync").length, 1);
  });
});
