import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createChatMessageActivationHook } from "../src/activation.ts";
import { createCommandActivationHook } from "../src/commands.ts";
import { readLedgerEvents } from "../src/index.ts";

// OpenCode 1 has no native /goal. For lit-loop, start-work and litwork it records `native-goal-unavailable`
// in the ledger once per session and route, sets nothing, and leaves every other route untouched.

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-native-goal-v1-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const output = (text, suffix) => ({
  message: { id: `msg_${suffix}`, sessionID: "ses_v1", role: "user" },
  parts: [{ id: `part_${suffix}`, sessionID: "ses_v1", messageID: `msg_${suffix}`, type: "text", text }]
});
const chatHook = (dir) => createChatMessageActivationHook(dir, { getSession: async (id) => ({ id }) });
const unavailable = async (dir) => (await readLedgerEvents(dir)).filter((event) => event.type === "native-goal.unavailable");

test("a chat lit-loop on OpenCode 1 records native-goal-unavailable once per session and route", async () => {
  await withTempDir(async (dir) => {
    const hook = chatHook(dir);
    await hook({ sessionID: "ses_v1" }, output("lit loop fix the parser", "1"));
    await hook({ sessionID: "ses_v1" }, output("lit loop and again", "2"));
    const events = await unavailable(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionID, "ses_v1");
    assert.equal(events[0].route, "lit-loop");
    assert.equal(events[0].host, "opencode-1");
  });
});

test("start-work and litwork chat prompts record their own route", async () => {
  await withTempDir(async (dir) => {
    const hook = chatHook(dir);
    await hook({ sessionID: "ses_v1" }, output("litwork finish the migration", "1"));
    await hook({ sessionID: "ses_v1" }, output("start-work on the approved plan", "2"));
    assert.deepEqual((await unavailable(dir)).map((event) => event.route).sort(), ["litwork", "start-work"]);
  });
});

test("the /lit-loop, /litwork and /start-work commands record it too", async () => {
  await withTempDir(async (dir) => {
    const hook = createCommandActivationHook(dir);
    for (const command of ["/lit-loop", "/litwork", "/start-work"]) await hook({ command, sessionID: "ses_v1", arguments: "" }, { parts: [] });
    assert.deepEqual((await unavailable(dir)).map((event) => event.route).sort(), ["lit-loop", "litwork", "start-work"]);
  });
});

test("plan, research, review and bare lit leave no native-goal record on OpenCode 1", async () => {
  await withTempDir(async (dir) => {
    const hook = chatHook(dir);
    for (const [index, text] of ["lit plan the release", "lit research hydrates", "lit review the diff", "lit fix the typo"].entries()) {
      await hook({ sessionID: "ses_v1" }, output(text, String(index)));
    }
    const commands = createCommandActivationHook(dir);
    for (const command of ["/lit-plan", "/review-work", "/lit"]) await commands({ command, sessionID: "ses_v1", arguments: "" }, { parts: [] });
    assert.deepEqual((await readLedgerEvents(dir)).filter((event) => event.type.startsWith("native-goal.")), []);
  });
});
