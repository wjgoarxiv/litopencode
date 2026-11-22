import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as litOpenCode from "../src/index.ts";
import { brainstormNudgePrefix, createBrainstormRun } from "../src/brainstorm-run.ts";
import { createRuntimePaths } from "../src/state.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, until } from "../test-support/opencode-v2-fake.mjs";

// The ultra-brainstorm run guard: once the user approved N lanes, an early stop of the parent model is met
// with a continuation that carries the authoritative counts, until N lanes ran and the judge scored them.

async function withDir(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-brainstorm-run-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sessions = { ses_root: {}, ses_child: { parentID: "ses_root" } };

function harness(dir) {
  const sent = [];
  const notices = [];
  const options = {
    dir: createRuntimePaths(dir).brainstormRunsDir,
    getSession: async (id) => sessions[id],
    send: async (sessionID, text) => { sent.push({ sessionID, text }); },
    notify: (message) => { notices.push(message); }
  };
  return { sent, notices, options, run: createBrainstormRun(options) };
}

const estimateCall = (lanes, sessionID = "ses_root") => ({
  sessionID,
  tool: "bash",
  args: { command: "node /x/skills/ultra-brainstorm/scripts/estimate.mjs --answer <<'LIT_REPLY_END_9Q7'\n" + lanes + "\nLIT_REPLY_END_9Q7" },
  output: `{"answer":"launch","lanes":${lanes}}\n`
});
const lane = (agent = "lit-ideator", sessionID = "ses_root") => ({ sessionID, tool: "task", args: { subagent_type: agent, prompt: "TASK: idea lane", description: "lane" }, output: "[]" });

async function lanes(run, count) {
  for (let index = 0; index < count; index += 1) await run.toolDone(lane());
}

test("arms from the estimator's launch answer and nudges on idle with the next lane index", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(500));
    await lanes(run, 40);
    await run.idle("ses_root");
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.startsWith(brainstormNudgePrefix));
    assert.match(sent[0].text, /Lanes 0\.\.39 were sent/u);
    assert.match(sent[0].text, /next lane is 40/u);
    assert.match(sent[0].text, /500 lanes were approved/u);
    assert.match(sent[0].text, /lanes\.jsonl/u);
    assert.match(sent[0].text, /clusters\.jsonl/u);
    assert.match(sent[0].text, /not a reason to stop/u);
    assert.match(sent[0].text, /Only the user can stop/u);
  });
});

test("does not arm on a stop answer, a plain estimate or a non-estimator command", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone({ ...estimateCall(100), output: '{"answer":"stop"}\n' });
    await run.toolDone({ ...estimateCall(100), args: { command: "node /x/skills/ultra-brainstorm/scripts/estimate.mjs 100" } });
    await run.toolDone({ ...estimateCall(100), args: { command: "echo '{\"answer\":\"launch\",\"lanes\":100}'" } });
    await run.idle("ses_root");
    assert.equal(sent.length, 0);
  });
});

test("counts only lit-ideator tasks as lanes", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(30));
    await lanes(run, 5);
    await run.toolDone(lane("lit-explorer"));
    await run.toolDone(lane("general"));
    await run.toolDone({ sessionID: "ses_root", tool: "read", args: { subagent_type: "lit-ideator" }, output: "" });
    await run.toolDone({ sessionID: "ses_root", tool: "task", args: { agent: "lit-ideator" }, output: "" });
    await run.idle("ses_root");
    assert.match(sent[0].text, /next lane is 6/u);
  });
});

test("never arms or nudges a child session", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(30, "ses_child"));
    await run.toolDone(lane("lit-ideator", "ses_child"));
    await run.idle("ses_child");
    assert.equal(sent.length, 0);
    assert.deepEqual(await fs.readdir(createRuntimePaths(dir).brainstormRunsDir).catch(() => []), []);
  });
});

test("pauses with one notice after two idles in a row with no new lanes", async () => {
  await withDir(async (dir) => {
    const { run, sent, notices } = harness(dir);
    await run.toolDone(estimateCall(100));
    await lanes(run, 20);
    await run.idle("ses_root");
    await run.idle("ses_root");
    await run.idle("ses_root");
    await run.idle("ses_root");
    assert.equal(sent.length, 2, "one nudge after progress, one more after the first idle with no new lanes");
    assert.equal(notices.length, 1);
    assert.match(notices[0], /20 of 100/u);
  });
});

test("a continue word resumes a paused run; any other user message clears it", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(100));
    await lanes(run, 20);
    for (let index = 0; index < 3; index += 1) await run.idle("ses_root");
    assert.equal(sent.length, 2);
    await run.userText("ses_root", "계속");
    await run.idle("ses_root");
    assert.equal(sent.length, 3, "resumed");
    for (const word of ["continue", "go", "ㄱ", "Continue."]) {
      await run.userText("ses_root", word);
      assert.ok(await run.active("ses_root"), word);
    }
    await run.userText("ses_root", `${brainstormNudgePrefix} lanes 0..19 were sent`);
    assert.ok(await run.active("ses_root"), "the guard's own prompt is not a user message");
    await run.userText("ses_root", "make me a sandwich instead");
    assert.equal(await run.active("ses_root"), false);
    await run.idle("ses_root");
    assert.equal(sent.length, 3);
  });
});

test("a cancel word clears the run", async () => {
  await withDir(async (dir) => {
    for (const word of ["stop", "cancel", "취소", "아니", "멈춰"]) {
      const { run, sent } = harness(dir);
      await run.toolDone(estimateCall(100));
      await run.userText("ses_root", word);
      await run.idle("ses_root");
      assert.equal(sent.length, 0, word);
    }
  });
});

test("an interrupted turn pauses the run instead of nudging", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(100));
    await lanes(run, 10);
    await run.interrupt("ses_root");
    await run.idle("ses_root");
    assert.equal(sent.length, 0);
  });
});

test("after every lane, nudges once to finish the reducers and the judge, then the judge ends the run", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(30));
    await lanes(run, 30);
    await run.idle("ses_root");
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /all 30 approved lanes were sent/u);
    assert.match(sent[0].text, /lit-oracle/u);
    assert.match(sent[0].text, /0 of 1 reducers/u);
    await run.idle("ses_root");
    assert.equal(sent.length, 1, "the judge nudge is sent once");
    await run.toolDone(lane("lit-explorer"));
    await run.toolDone(lane("lit-oracle"));
    assert.equal(await run.active("ses_root"), false);
  });
});

test("a judge that runs before every lane was sent does not end the run", async () => {
  await withDir(async (dir) => {
    const { run, sent } = harness(dir);
    await run.toolDone(estimateCall(60));
    await lanes(run, 30);
    await run.toolDone(lane("lit-oracle"));
    await run.idle("ses_root");
    assert.match(sent[0].text, /next lane is 30/u);
  });
});

test("the run survives a plugin restart", async () => {
  await withDir(async (dir) => {
    const first = harness(dir);
    await first.run.toolDone(estimateCall(100));
    await lanes(first.run, 12);
    const second = harness(dir);
    await second.run.idle("ses_root");
    assert.match(second.sent[0].text, /next lane is 12/u);
  });
});

// ---- host wiring ----

test("OpenCode 1: the plugin arms from tool.execute.after, counts lanes and nudges on session.idle", async () => {
  await withDir(async (dir) => {
    const calls = [];
    const client = {
      session: {
        get: async ({ path: requestPath }) => ({ data: { id: requestPath.id, ...(requestPath.id === "ses_child" ? { parentID: "ses_root" } : {}) } }),
        promptAsync: async (request) => { calls.push({ kind: "promptAsync", request }); return { data: undefined }; },
        status: async () => ({ data: {} })
      },
      config: { providers: async () => ({ data: { providers: [] } }) },
      tui: { showToast: async (request) => { calls.push({ kind: "toast", body: request.body }); return { data: true }; } }
    };
    const hooks = await litOpenCode.pluginModule.server({
      directory: dir, worktree: dir, project: {}, client, experimental_workspace: { register() {} }, serverUrl: new URL("http://localhost:4096"), $: {}
    });
    await hooks["chat.message"]({ sessionID: "ses_root", messageID: "msg_u", agent: "lit-loop", model: { providerID: "xai", modelID: "grok-4.7" } }, {
      message: {}, parts: [{ type: "text", text: "300" }]
    });
    const call = estimateCall(300);
    await hooks["tool.execute.after"]({ tool: call.tool, sessionID: call.sessionID, callID: "c0", args: call.args }, { title: "", output: call.output, metadata: {} });
    for (let index = 0; index < 3; index += 1) {
      await hooks["tool.execute.after"]({ tool: "task", sessionID: "ses_root", callID: `c${index + 1}`, args: lane().args }, { title: "", output: "[]", metadata: {} });
    }
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_root" } } });
    const prompts = calls.filter((entry) => entry.kind === "promptAsync");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].request.path.id, "ses_root");
    assert.equal(prompts[0].request.body.agent, "lit-loop");
    assert.deepEqual(prompts[0].request.body.model, { providerID: "xai", modelID: "grok-4.7" });
    assert.match(prompts[0].request.body.parts[0].text, /next lane is 3/u);
  });
});

test("OpenCode 2: the server arms from execute.after, counts subagent lanes and prompts the session on idle", async () => {
  await withDir(async (dir) => {
    const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" }, ses_child: { id: "ses_child", parentID: "ses_root" } } });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    try {
      const after = (tool, input, content, sessionID = "ses_root") => fake.run("tool", "execute.after", { tool, sessionID, agent: "lit-loop", messageID: "msg_a", id: `call_${Math.random()}`, input, status: "completed", result: { content } });
      await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "msg_u", prompt: { text: "300" } });
      await after("shell", estimateCall(300).args, '{"answer":"launch","lanes":300}\n');
      await after("subagent", { agent: "lit-ideator", description: "lane", prompt: "TASK: idea lane 0" }, [{ type: "text", text: "[]" }]);
      await after("subagent", { agent: "lit-ideator", description: "lane", prompt: "TASK: idea lane 1" }, "[]");
      fake.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_root" } });
      await until(() => fake.prompts.some((entry) => entry.text.startsWith(brainstormNudgePrefix)));
      const nudge = fake.prompts.find((entry) => entry.text.startsWith(brainstormNudgePrefix));
      assert.equal(nudge.sessionID, "ses_root");
      assert.match(nudge.text, /next lane is 2/u);
    } finally {
      await cleanup();
    }
  });
});
