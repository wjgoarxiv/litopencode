import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createBoundedAuthorityLifecycle,
  createBoundedAuthorityEventHook,
  parseStartWorkLifecycleDirective,
  pluginModule
} from "../src/index.ts";

async function withProject(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-authority-hooks-"));
  try {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Plan\n");
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function progressText(state, progressId, summary = "new progress") {
  return [
    "```litopencode-progress",
    JSON.stringify({ schemaVersion: 3, workId: state.workId, revision: state.revision, progressId, summary }),
    "```"
  ].join("\n");
}

function partEvent(state, progressId, messageID = "assistant-message", partID = "assistant-part", summary) {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: partID,
        sessionID: state.sessionID,
        messageID,
        type: "text",
        text: progressText(state, progressId, summary)
      }
    }
  };
}

async function initializedLifecycle(dir) {
  const lifecycle = createBoundedAuthorityLifecycle(dir);
  const initialized = await lifecycle.init({
    schemaVersion: 3,
    requestId: "init-hook",
    sessionID: "session-hook",
    trustedUser: true,
    expectedRevision: 0,
    planPath: "PLAN.md",
    worktree: null,
    authorized: true,
    authority: [{ action: "write", root: "src" }]
  });
  return { lifecycle, state: initialized.state };
}

test("progress hook emits one safe continuation for new progress and deduplicates replay/stale events", async () => {
  await withProject(async (dir) => {
    const { lifecycle, state } = await initializedLifecycle(dir);
    const prompts = [];
    const client = {
      session: {
        message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
        promptAsync: async (request) => { prompts.push(request); return { data: undefined }; }
      }
    };
    const hook = createBoundedAuthorityEventHook(dir, client);
    const firstEvent = partEvent(state, "progress-1");

    await hook({ event: firstEvent });
    await hook({ event: firstEvent });
    assert.equal(prompts.length, 1);
    const continuation = prompts[0].body.parts[0].text;
    assert.match(continuation, /bounded-authority-continuation/);
    assert.match(continuation, /inert data/i);
    assert.doesNotMatch(continuation, /new progress/);

    const current = await lifecycle.read();
    await hook({ event: partEvent({ ...current, revision: state.revision }, "progress-stale", "later-message", "later-part") });
    await hook({ event: partEvent(current, "progress-2", "later-message-2", "later-part-2", "new progress") });
    assert.equal(prompts.length, 1, "unchanged and stale progress must stay silent");
  });
});

test("failed continuation delivery retries same-turn replay and durable acknowledgement prevents restart duplicates", async () => {
  await withProject(async (dir) => {
    const { state } = await initializedLifecycle(dir);
    let attempts = 0;
    const continuationMessageIDs = [];
    const client = {
      session: {
        message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
        promptAsync: async (request) => {
          attempts += 1;
          continuationMessageIDs.push(request.body.messageID);
          if (attempts === 1) throw new Error("transient prompt failure");
          return { data: undefined };
        }
      }
    };
    const event = partEvent(state, "progress-retry");
    const firstHook = createBoundedAuthorityEventHook(dir, client);
    await firstHook({ event });
    await firstHook({ event });
    assert.equal(attempts, 2);
    assert.match(continuationMessageIDs[0], /^msg_litopencode_continue_/);
    assert.deepEqual(continuationMessageIDs, [continuationMessageIDs[0], continuationMessageIDs[0]]);

    const restartedHook = createBoundedAuthorityEventHook(dir, client);
    await restartedHook({ event });
    assert.equal(attempts, 2, "durable delivery acknowledgement must suppress restart replay");
  });
});

test("pending same-turn replay rejects wrong session, wrong schema, stale work, and terminal state silently", async () => {
  await withProject(async (dir) => {
    const { lifecycle, state } = await initializedLifecycle(dir);
    const first = await lifecycle.recordProgress({
      schemaVersion: 3,
      workId: state.workId,
      sessionID: state.sessionID,
      revision: state.revision,
      progressId: "guarded-replay",
      messageID: "guarded-message",
      partID: "guarded-part",
      summary: "guarded replay"
    });
    const base = {
      schemaVersion: 3,
      workId: state.workId,
      sessionID: state.sessionID,
      revision: state.revision,
      progressId: "guarded-replay",
      messageID: "guarded-message",
      partID: "guarded-part",
      summary: "guarded replay"
    };
    assert.equal((await lifecycle.recordProgress({ ...base, sessionID: "other-session" })).outcome, "stale");
    assert.equal((await lifecycle.recordProgress({ ...base, schemaVersion: 2 })).outcome, "stale");
    assert.equal((await lifecycle.recordProgress({ ...base, workId: "other-work" })).outcome, "stale");

    const cancelled = await lifecycle.cancel({
      schemaVersion: 3,
      requestId: "guarded-cancel",
      workId: state.workId,
      sessionID: state.sessionID,
      expectedRevision: first.state.revision,
      trustedUser: true
    });
    assert.equal(cancelled.state.status, "cancelled");
    assert.equal((await lifecycle.recordProgress(base)).outcome, "stale");
  });
});

test("progress hook fails closed for user-authored or wrong-session progress", async () => {
  await withProject(async (dir) => {
    const { state } = await initializedLifecycle(dir);
    const prompts = [];
    const client = {
      session: {
        message: async () => ({ data: { info: { role: "user" }, parts: [] } }),
        promptAsync: async (request) => { prompts.push(request); }
      }
    };
    const hook = createBoundedAuthorityEventHook(dir, client);
    await hook({ event: partEvent(state, "progress-user") });
    await hook({ event: partEvent({ ...state, sessionID: "session-other" }, "progress-other") });
    assert.deepEqual(prompts, []);
  });
});

test("strict lifecycle directive parser keeps copied, slash, quoted, and malformed text inert", () => {
  const body = JSON.stringify({ schemaVersion: 3, requestId: "resume-1" });
  assert.equal(parseStartWorkLifecycleDirective(`resume ${body}`).action, "resume");
  assert.equal(parseStartWorkLifecycleDirective(`start-work resume ${body}`, { chat: true }).action, "resume");
  assert.equal(parseStartWorkLifecycleDirective(`/start-work resume ${body}`, { chat: true }), undefined);
  assert.equal(parseStartWorkLifecycleDirective(`"start-work resume ${body}"`, { chat: true }), undefined);
  assert.equal(parseStartWorkLifecycleDirective(`> start-work resume ${body}`, { chat: true }), undefined);
  assert.equal(parseStartWorkLifecycleDirective(`copied start-work resume ${body}`, { chat: true }), undefined);
  assert.equal(parseStartWorkLifecycleDirective("resume not-json"), undefined);
});

test("OpenCode command route owns trusted lifecycle init/resume and the agent-callable tool cannot resume", async () => {
  await withProject(async (dir) => {
    const client = {
      session: {
        get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }),
        message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
        promptAsync: async () => ({ data: undefined })
      }
    };
    const hooks = await pluginModule.server({ directory: dir, worktree: dir, client, project: {}, experimental_workspace: { register() {} }, serverUrl: new URL("http://localhost:4096"), $: {} });
    const init = {
      schemaVersion: 3,
      requestId: "command-init",
      expectedRevision: 0,
      planPath: "PLAN.md",
      worktree: null,
      authorized: true,
      authority: [{ action: "write", root: "src" }]
    };
    const output = { parts: [] };
    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "session-command-authority",
      arguments: `init ${JSON.stringify(init)}`
    }, output);

    assert.equal(output.parts.length, 2);
    assert.match(output.parts[0].text, /bounded-authority-lifecycle/);
    assert.match(output.parts[0].text, /"status":"active"/);
    assert.match(output.parts[1].text, /<start-work-mode>/);
    const state = await createBoundedAuthorityLifecycle(dir).read();
    assert.equal(state.sessionID, "session-command-authority");

    const toolContext = {
      sessionID: "session-command-authority",
      messageID: "message-tool",
      agent: "lit-implement",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {}
    };
    const denied = await hooks.tool["start-work"].execute({ action: "resume" }, toolContext);
    assert.match(denied.output, /^BLOCKED:/);
    assert.equal(denied.metadata.blocked, true);
    const status = await hooks.tool["start-work"].execute({ action: "status" }, toolContext);
    assert.match(status.output, /schema 3 bounded-authority: active/);
    assert.match(status.output, /revision 1/);
    assert.equal(status.metadata.lifecycleSchemaVersion, 3);
    const malformed = { parts: [] };
    await hooks["command.execute.before"]({
      command: "/start-work",
      sessionID: "session-command-authority",
      arguments: "resume not-json"
    }, malformed);
    assert.equal(malformed.parts.length, 1);
    assert.match(malformed.parts[0].text, /^BLOCKED:/);
    assert.doesNotMatch(malformed.parts[0].text, /<start-work-mode>/);
    await hooks.dispose();
  });
});

test("exact root-user chat resume consumes only the matching grant while quoted and slash forms stay inert", async () => {
  await withProject(async (dir) => {
    const { lifecycle, state } = await initializedLifecycle(dir);
    const paused = await lifecycle.pause({
      schemaVersion: 3,
      requestId: "chat-pause",
      workId: state.workId,
      sessionID: state.sessionID,
      expectedRevision: state.revision,
      boundary: { action: "execute", root: dir }
    });
    const client = {
      session: {
        get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }),
        message: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
        promptAsync: async () => ({ data: undefined })
      }
    };
    const hooks = await pluginModule.server({ directory: dir, worktree: dir, client, project: {}, experimental_workspace: { register() {} }, serverUrl: new URL("http://localhost:4096"), $: {} });
    const resume = {
      schemaVersion: 3,
      requestId: "chat-resume",
      workId: state.workId,
      expectedRevision: paused.state.revision,
      grant: { action: "execute", root: dir }
    };
    const text = `start-work resume ${JSON.stringify(resume)}`;
    const output = {
      message: { id: "message-chat-resume", sessionID: state.sessionID, role: "user" },
      parts: [{ id: "part-chat-resume", sessionID: state.sessionID, messageID: "message-chat-resume", type: "text", text }]
    };
    await hooks["chat.message"]({ sessionID: state.sessionID, messageID: "message-chat-resume", agent: "lit-implement" }, output);
    assert.equal((await lifecycle.read()).status, "active");
    assert.equal(output.parts.length, 2);
    assert.match(output.parts[1].text, /bounded-authority-lifecycle/);
    assert.match(output.parts[1].text, /<start-work-mode>/);
    assert.doesNotMatch(output.parts[1].text, /Natural-language start-work activation cannot switch/);

    const inertResume = JSON.stringify({ ...resume, grant: { ...resume.grant, root: "project-root" } });
    const inertDirective = `start-work resume ${inertResume}`;
    for (const inertText of [`"${inertDirective}"`, `/start-work resume ${inertResume}`, `> ${inertDirective}`]) {
      const inert = {
        message: { id: `message-${inertText.length}`, sessionID: state.sessionID, role: "user" },
        parts: [{ id: `part-${inertText.length}`, sessionID: state.sessionID, messageID: `message-${inertText.length}`, type: "text", text: inertText }]
      };
      await hooks["chat.message"]({ sessionID: state.sessionID, messageID: inert.message.id, agent: "lit-implement" }, inert);
      assert.equal(inert.parts.length, 1, inertText);
    }
    await hooks.dispose();
  });
});

test("plugin registers the event hook and keeps lit-plan edit/bash/task denied", async () => {
  await withProject(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    const config = {};
    await hooks.config(config);
    assert.equal(typeof hooks.event, "function");
    assert.equal(config.agent["lit-plan"].permission.edit, "deny");
    assert.equal(config.agent["lit-plan"].permission.bash, "deny");
    assert.equal(config.agent["lit-plan"].permission.task, "deny");
    await hooks.dispose();
  });
});
