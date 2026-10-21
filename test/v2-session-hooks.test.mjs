import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Message } from "@opencode/ai";
import { detectChatActivationMode, promptForChatActivationMode } from "../src/activation-routing.ts";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { captureKnowledgeEvent, reviewKnowledgeRecord } from "../src/knowledge.ts";
import { readerFacingCommunicationContract } from "../src/reader-facing-output.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// OpenCode 2 has no message parts to append to. A lit prompt is marked in the user message metadata at
// admission (`prompt` hook), and the activation instructions reach the model through the `context` hook
// as one system part per request.
async function withSession(fn, before = async () => undefined) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-session-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const sessions = { ses_root: { id: "ses_root", agent: "lit-loop" }, ses_child: { id: "ses_child", parentID: "ses_root" }, ...(await before(dir)) };
  const fake = createFakeV2Context({ directory: dir, sessions });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fn(dir, fake);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const prompt = (text, sessionID = "ses_root", messageID = "msg_1") => ({ sessionID, messageID, prompt: { text }, delivery: "queue" });
const context = (sessionID = "ses_root", agent = "lit-loop") => ({
  sessionID,
  agent,
  model: { providerID: "openai", id: "gpt-test" },
  system: [],
  messages: [],
  options: {},
  tools: {}
});

test("a lit prompt is marked at admission and its activation reaches every request exactly once", async () => {
  await withSession(async (_dir, fake) => {
    const text = "lit fix the failing test";
    const mode = detectChatActivationMode(text, "lit-loop");
    const admitted = await fake.run("session", "prompt", prompt(text));
    assert.deepEqual(admitted.metadata?.litopencode, { mode, trigger: "lit", source: "prompt" });
    assert.equal(admitted.prompt.text, text);
    const activation = promptForChatActivationMode(mode, text);
    for (let request = 0; request < 2; request += 1) {
      const event = await fake.run("session", "context", context());
      assert.equal(event.system.filter((part) => part.text === activation).length, 1, `request ${request}`);
      for (const part of event.system) assert.equal(part.type, "text");
    }
  });
});

test("a plain prompt gets no mark and no activation, but the static rules and the reader contract still arrive", async () => {
  await withSession(async (_dir, fake) => {
    const admitted = await fake.run("session", "prompt", prompt("what does this function return?"));
    assert.equal(admitted.metadata, undefined);
    const event = await fake.run("session", "context", context());
    assert.ok(event.system.length >= 1);
    assert.equal(event.system.at(-1).text, readerFacingCommunicationContract);
    assert.ok(!event.system.some((part) => /LIT IGNITED|lit-task/u.test(part.text) && part.text !== readerFacingCommunicationContract));
  });
});

test("a delegated child session never re-enters a lit workflow", async () => {
  await withSession(async (_dir, fake) => {
    const admitted = await fake.run("session", "prompt", prompt("lit fix it", "ses_child"));
    assert.equal(admitted.metadata, undefined);
    const event = await fake.run("session", "context", context("ses_child", "lit-explore"));
    assert.ok(!event.system.some((part) => part.text === promptForChatActivationMode("lit-task", "lit fix it")));
  });
});

test("compaction keeps rule-derived constraints and re-arms rule delivery", async () => {
  await withSession(async (_dir, fake) => {
    const event = await fake.run("session", "compaction", context());
    assert.ok(event.system.some((part) => /repository rules will be re-delivered after this compaction/u.test(part.text)));
  });
});

test("agent request settings that OpenCode 2 does not send yet ride the context hook", async () => {
  await withSession(async (_dir, fake) => {
    const event = await fake.run("session", "context", context("ses_root", "lit-loop"));
    assert.equal(typeof event.options.reasoningEffort, "string");
    const preset = await fake.run("session", "context", { ...context("ses_root", "lit-loop"), options: { reasoningEffort: "low" } });
    assert.equal(preset.options.reasoningEffort, "low");
  });
});

test("a prompt sent with `opencode2 run \"lit …\"` is unwrapped from the quotes run adds, while quoted text inside a prompt stays inactive", async () => {
  await withSession(async (_dir, fake) => {
    const wrapped = await fake.run("session", "prompt", prompt('"lit loop add a greeting line to README"'));
    assert.equal(wrapped.metadata?.litopencode?.mode, "lit-loop");
    assert.equal(wrapped.prompt.text, '"lit loop add a greeting line to README"');
    const escaped = await fake.run("session", "prompt", prompt('"lit fix the \\"login\\" test"', "ses_root", "msg_2"));
    assert.equal(escaped.metadata?.litopencode?.mode, "lit-task");
    const inner = await fake.run("session", "prompt", prompt('please do not "lit fix it" yet', "ses_root", "msg_3"));
    assert.equal(inner.metadata?.litopencode, undefined);
  });
});

// Text that comes from the project or from a lifecycle file, not from LitOpenCode's own instructions,
// rides the user channel as on OpenCode 1, where it was a part of the user message. OpenCode 2's system
// parts are operator instructions, so only the activation text, the rules and the reader contract go there.
const userTurn = (text) => ({ ...context(), messages: [Message.user("earlier"), Message.system("host note"), Message.user(text)] });
const lastUserText = (event) => event.messages.findLast((message) => message.role === "user").content.map((part) => part.text);

test("local knowledge records reach the model in the user message, not as system text", async () => {
  await withSession(async (_dir, fake) => {
    const text = "where is the knowledge authority file kept?";
    await fake.run("session", "prompt", prompt(text));
    const event = await fake.run("session", "context", userTurn(text));
    const parts = lastUserText(event);
    assert.equal(parts[0], text);
    assert.ok(parts.slice(1).some((part) => part.includes("claims.jsonl")), "knowledge appended to the user message");
    assert.ok(event.messages.at(-1) instanceof Message, "the host's own message class is kept");
    assert.ok(!event.system.some((part) => part.text.includes("claims.jsonl")), "no knowledge in system parts");
    assert.deepEqual(event.messages[0].content.map((part) => part.text), ["earlier"], "older messages untouched");
  }, async (dir) => {
    const captured = await captureKnowledgeEvent(dir, { kind: "decision", text: "Use claims.jsonl as the only knowledge authority file.", evidenceRef: "docs/architecture.md:42", source: "wikify-tool" }, { surface: "tool.wikify" });
    await reviewKnowledgeRecord(dir, { id: captured.record.id, state: "accepted", surface: "tool.wikify.save" });
    return {};
  });
});

test("the auto-handoff setting reply reaches the model in the user message, not as system text", async () => {
  await withSession(async (_dir, fake) => {
    await fake.run("session", "prompt", prompt("lit-handoff auto status"));
    const event = await fake.run("session", "context", userTurn("lit-handoff auto status"));
    assert.ok(lastUserText(event).some((part) => part.includes("<lit-handoff-auto-setting>")));
    assert.ok(!event.system.some((part) => part.text.includes("<lit-handoff-auto-setting>")));
  });
});

test("a chat start-work resume puts the lifecycle receipt in the user message and keeps the start-work instructions in system", async () => {
  let resume;
  await withSession(async (_dir, fake) => {
    const text = `start-work resume ${JSON.stringify(resume)}`;
    await fake.run("session", "prompt", prompt(text, "session-hook"));
    const event = await fake.run("session", "context", { ...userTurn(text), sessionID: "session-hook", agent: "lit-implement" });
    assert.ok(lastUserText(event).some((part) => part.includes("<bounded-authority-lifecycle>")), "receipt in the user message");
    assert.ok(!event.system.some((part) => part.text.includes("<bounded-authority-lifecycle>")), "no receipt in system parts");
    assert.ok(event.system.some((part) => part.text.includes("<start-work-mode>")), "start-work instructions stay in system");
  }, async (dir) => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Plan\n");
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const { state } = await lifecycle.init({ schemaVersion: 3, requestId: "init-v2", sessionID: "session-hook", trustedUser: true, expectedRevision: 0, planPath: "PLAN.md", worktree: null, authorized: true, authority: [{ action: "write", root: "src" }] });
    const paused = await lifecycle.pause({ schemaVersion: 3, requestId: "pause-v2", workId: state.workId, sessionID: state.sessionID, expectedRevision: state.revision, boundary: { action: "execute", root: dir } });
    resume = { schemaVersion: 3, requestId: "resume-v2", workId: state.workId, expectedRevision: paused.state.revision, grant: { action: "execute", root: dir } };
    return { "session-hook": { id: "session-hook", agent: "lit-implement" } };
  });
});
