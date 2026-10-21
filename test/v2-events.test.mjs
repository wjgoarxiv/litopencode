import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createV2Events } from "../src/v2/events.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context, settle } from "../test-support/opencode-v2-fake.mjs";

// OpenCode 2 has no plugin `event` hook; the plugin reads the event stream itself and stops reading when
// its instance is cleaned up. Event names changed: a deleted session, step usage, status, idle and the
// end of a compaction drive the same state machines the OpenCode 1 events did.
async function withEvents(projectConfig, fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-events-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  if (projectConfig !== undefined) {
    await fs.mkdir(path.join(dir, ".litopencode"), { recursive: true });
    await fs.writeFile(path.join(dir, ".litopencode", "config.json"), JSON.stringify(projectConfig));
  }
  const fake = createFakeV2Context({
    directory: dir,
    sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } },
    models: [{ id: "openai/gpt-test", modelID: "gpt-test", providerID: "openai", name: "test", limit: { context: 1000 } }]
  });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  let cleaned = false;
  try {
    await fn(dir, fake, async () => {
      cleaned = true;
      await cleanup();
    });
  } finally {
    if (!cleaned) await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const event = (type, data) => ({ id: `evt_${type}`, created: Date.now(), type, data });
const context = () => ({ sessionID: "ses_root", agent: "lit-loop", system: [], messages: [], options: {}, tools: {} });

test("the plugin subscribes once and stops reading the stream on cleanup", async () => {
  await withEvents(undefined, async (_dir, fake, cleanup) => {
    assert.equal(fake.subscriptions(), 1);
    await cleanup();
    assert.equal(fake.aborted(), 1);
  });
});

test("a deleted session drops its activation", async () => {
  await withEvents(undefined, async (_dir, fake) => {
    await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "msg_1", prompt: { text: "lit fix it" }, delivery: "queue" });
    const activation = promptForChatActivationMode("lit-task", "lit fix it");
    assert.ok((await fake.run("session", "context", context())).system.some((part) => part.text === activation));
    fake.emit(event("session.deleted", { sessionID: "ses_root" }));
    await settle();
    assert.ok(!(await fake.run("session", "context", context())).system.some((part) => part.text === activation));
  });
});

test("crossing the handoff percent asks for a handoff when the turn goes idle", async () => {
  await withEvents({ autoHandoff: { enabled: true, percent: 50 } }, async (_dir, fake) => {
    fake.emit(event("session.step.started", { sessionID: "ses_root", assistantMessageID: "msg_a1", agent: "lit-loop", model: { providerID: "openai", id: "gpt-test" }, started: Date.now() }));
    fake.emit(event("session.step.ended", { sessionID: "ses_root", assistantMessageID: "msg_a1", finish: "stop", cost: 0, tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }));
    fake.emit(event("session.status", { sessionID: "ses_root", status: { type: "idle" } }));
    await settle(20);
    const sent = fake.prompts.at(-1);
    assert.ok(sent, "a handoff request was sent");
    assert.equal(sent.sessionID, "ses_root");
    assert.match(sent.text, /Auto-handoff marker: ses_root/u);
  });
});

test("an assistant progress fence is read from the finished text without throwing", async () => {
  await withEvents(undefined, async (_dir, fake) => {
    fake.emit(event("session.text.ended", { sessionID: "ses_root", assistantMessageID: "msg_a2", ordinal: 0, text: "```bounded-progress\n{}\n```" }));
    fake.emit(event("session.text.ended", { sessionID: "ses_root", assistantMessageID: "msg_a3", ordinal: 0, text: "plain text" }));
    await settle();
    assert.equal(fake.prompts.length, 0);
  });
});

async function withLifecycle(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-continuation-")));
  try {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Plan\n");
    const initialized = await createBoundedAuthorityLifecycle(dir).init({
      schemaVersion: 3,
      requestId: "init-v2",
      sessionID: "ses_root",
      trustedUser: true,
      expectedRevision: 0,
      planPath: "PLAN.md",
      worktree: null,
      authorized: true,
      authority: [{ action: "write", root: "src" }]
    });
    const prompts = [];
    const events = createV2Events({
      projectRoot: dir,
      paths: { autoHandoffFile: path.join(dir, "auto-handoff.json") },
      autoHandoffConfig: { enabled: false, percent: null },
      boundedAuthority: {},
      getSession: async (id) => ({ id, agent: "lit-loop" }),
      session: { prompt: async (input) => { prompts.push(input); }, compact: async () => undefined },
      model: { list: async () => [] },
      onSessionDeleted: () => undefined
    });
    await fn(events, initialized.state, prompts);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const progressFence = (state, progressId) => ["```litopencode-progress", JSON.stringify({ schemaVersion: 3, workId: state.workId, revision: state.revision, progressId, summary: "step done" }), "```"].join("\n");

test("review M3: a bounded-authority continuation carries its message id, so a replayed text end cannot send it twice", async () => {
  await withLifecycle(async (events, state, prompts) => {
    await events.handle(event("session.text.ended", { sessionID: "ses_root", assistantMessageID: "msg_a1", ordinal: 0, text: progressFence(state, "progress-1") }));
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].id ?? "", /^msg_litopencode_continue_[0-9a-f]{32}$/u);
  });
});

test("review L6: a step that never ends is forgotten when its session is deleted", async () => {
  await withLifecycle(async (events) => {
    await events.handle(event("session.step.started", { sessionID: "ses_root", assistantMessageID: "msg_open", agent: "lit-loop", model: { providerID: "openai", id: "gpt-test" }, started: Date.now() }));
    assert.equal(events.pendingSteps(), 1);
    await events.handle(event("session.deleted", { sessionID: "ses_root" }));
    assert.equal(events.pendingSteps(), 0);
  });
});
