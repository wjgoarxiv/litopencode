import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { emptyStack, readStack, startSpine, writeStack } from "../src/workflow-stack.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

async function plantGoal(dir, passed, total) {
  const file = path.join(dir, ".litopencode", "litgoal", "lit-loop", "goals.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const criteria = Array.from({ length: total }, (_, index) => ({ id: `C${index + 1}`, scenario: `criterion ${index + 1}`, status: index < passed ? "pass" : "pending", evidence: [] }));
  await fs.writeFile(file, JSON.stringify({ title: "migrate", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), criteria }));
}

async function withPlugin(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-interleave-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
  let counter = 0;
  const send = async (text, sessionID = "ses_a", agent = "lit-loop") => {
    counter += 1;
    const messageID = `msg_${counter}`;
    const output = { message: { id: messageID, sessionID, role: "user" }, parts: [{ id: `prt_${counter}`, sessionID, messageID, type: "text", text }] };
    await hooks["chat.message"]({ sessionID, messageID, agent }, output);
    return output.parts.slice(1).map((part) => part.text).join("\n");
  };
  try {
    await run({ dir, hooks, send });
  } finally {
    await hooks.dispose();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withV2(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-interleave-v2-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_a: { id: "ses_a", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  const ask = async (text, sessionID = "ses_a") => {
    await fake.run("session", "prompt", { sessionID, messageID: `msg_${Math.random()}`, prompt: { text }, delivery: "queue" });
    const event = await fake.run("session", "context", {
      sessionID, agent: "lit-loop", model: { providerID: "openai", id: "gpt-test" }, system: [], messages: [], options: {}, tools: {}
    });
    return event.system.map((part) => part.text).filter((part) => part.includes("<lit-") || part.includes("LitOpenCode:")).join("\n");
  };
  try {
    await run({ dir, fake, ask });
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("an interjected brainstorm pauses lit-loop with its count and lit continue returns to it", async () => {
  await withPlugin(async ({ dir, send }) => {
    assert.match(await send("lit loop the migration"), /<lit-loop-mode>/u);
    await plantGoal(dir, 2, 5);
    const side = await send("lit brainstorm names for the rollout");
    assert.match(side, /<lit-brainstorm-mode>/u);
    assert.match(side, /lit-loop is paused at work 2\/5/u);
    assert.match(side, /lit continue/u);
    const stack = await readStack(dir, "ses_a");
    assert.deepEqual(stack?.frames.map((frame) => [frame.skill, frame.status, frame.done, frame.total]), [["lit-loop", "paused", 2, 5], ["lit-brainstorm", "active", undefined, undefined]]);
    const back = await send("lit continue");
    assert.match(back, /back in lit-loop at work 2\/5/u);
    assert.doesNotMatch(back, /<lit-loop-mode>|<lit-brainstorm-mode>/u);
    assert.deepEqual((await readStack(dir, "ses_a"))?.frames.map((frame) => [frame.skill, frame.status]), [["lit-loop", "active"]]);
    assert.match(await send("lit loop the second step"), /already active/u);
  });
});

test("the paused spine survives a compaction and a plain turn", async () => {
  await withPlugin(async ({ dir, hooks, send }) => {
    await send("lit loop the migration");
    await plantGoal(dir, 1, 4);
    await send("lit recap");
    assert.equal(await send("thanks"), "");
    await hooks["experimental.session.compacting"]({ sessionID: "ses_a" }, { context: [] });
    assert.match(await send("lit continue"), /back in lit-loop at work 1\/4/u);
  });
});

test("an unknown total is not printed as a count", async () => {
  await withPlugin(async ({ send }) => {
    await send("lit loop the migration");
    const side = await send("lit brainstorm names");
    assert.match(side, /lit-loop is paused\./u);
    assert.doesNotMatch(side, /\d+\/\d+|\?/u);
    assert.match(await send("lit continue"), /back in lit-loop\b(?! at work \d)/u);
  });
});

test("a side skill alone shows no paused line, and a new spine skill ends the old stack", async () => {
  await withPlugin(async ({ dir, send }) => {
    const alone = await send("lit brainstorm names");
    assert.doesNotMatch(alone, /is paused/u);
    await send("lit loop the migration");
    await send("lit brainstorm names again");
    assert.match(await send("lit plan the rollout"), /<lit-plan-mode>/u);
    assert.deepEqual((await readStack(dir, "ses_a"))?.frames.map((frame) => frame.skill), ["lit-plan"]);
    const note = await send("lit continue");
    assert.match(note, /already active/u);
    assert.doesNotMatch(note, /lit-loop/u);
  });
});

test("a stale spine is not paused by a later side skill", async () => {
  await withPlugin(async ({ dir, send }) => {
    await writeStack(dir, startSpine(emptyStack("ses_a"), "lit-loop", Date.now() - 24 * 3_600_000));
    assert.doesNotMatch(await send("lit brainstorm names"), /is paused/u);
  });
});

test("another session's stack is untouched", async () => {
  await withPlugin(async ({ dir, send }) => {
    await send("lit loop the migration", "ses_a");
    await send("lit brainstorm names", "ses_b");
    assert.deepEqual((await readStack(dir, "ses_a"))?.frames.map((frame) => frame.status), ["active"]);
  });
});

test("OpenCode 2: the same interleave through the prompt and context hooks", async () => {
  await withV2(async ({ dir, ask }) => {
    assert.match(await ask("lit loop the migration"), /<lit-loop-mode>/u);
    await plantGoal(dir, 3, 6);
    const side = await ask("lit brainstorm names");
    assert.match(side, /lit-loop is paused at work 3\/6/u);
    assert.match(await ask("lit continue"), /back in lit-loop at work 3\/6/u);
    assert.match(await ask("lit loop a step"), /already active/u);
  });
});
