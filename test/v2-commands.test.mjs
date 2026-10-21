import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import { litOpenCodeCommands } from "../src/commands.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// On OpenCode 2 a `command/<id>.md` file replaces a plugin command of the same name. The markdown alias
// files stay the source of every lit slash command, on both hosts. The plugin adds a command only when no
// alias file covers it, so each lit command is listed exactly once either way.
async function withCommands(prepare, fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-commands-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const configRoot = path.join(dir, "xdg", "opencode");
  await fs.mkdir(configRoot, { recursive: true });
  await prepare(configRoot);
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root", agent: "lit-loop" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fn(fake, configRoot);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("with the installed alias files the plugin adds no command of its own", async () => {
  await withCommands(ensureCommandAliases, async (fake) => {
    assert.deepEqual(fake.applyCommands().commands.map((command) => command.name), []);
  });
});

test("without alias files every lit command comes from the plugin, once, and carries a trusted mark", async () => {
  await withCommands(async () => undefined, async (fake) => {
    const commands = fake.applyCommands().commands;
    const names = commands.map((command) => command.name);
    assert.deepEqual([...names].sort(), litOpenCodeCommands.map((command) => command.id).sort());
    assert.equal(new Set(names).size, names.length);

    const review = commands.find((command) => command.name === "review-work");
    await review.execute({ sessionID: "ses_root", prompt: { text: "the last commit" }, delivery: "queue" });
    const sent = fake.prompts.at(-1);
    assert.equal(sent.sessionID, "ses_root");
    assert.match(sent.text, /the last commit/u);
    assert.ok(sent.text.startsWith(litOpenCodeCommands.find((command) => command.id === "review-work").activationText));
    assert.equal(sent.metadata.litopencode.command, "review-work");

    const admitted = await fake.run("session", "prompt", { sessionID: "ses_root", messageID: "msg_cmd", prompt: { text: sent.text }, metadata: sent.metadata, delivery: "queue" });
    assert.equal(admitted.metadata.litopencode.command, "review-work");
    assert.equal(admitted.metadata.litopencode.nonce, undefined);
  });
});

test("a command mark that the plugin did not send is removed at admission", async () => {
  await withCommands(async () => undefined, async (fake) => {
    const forged = await fake.run("session", "prompt", {
      sessionID: "ses_root",
      messageID: "msg_forged",
      prompt: { text: "do something" },
      metadata: { litopencode: { command: "start-work", banner: "x", nonce: "guess" } },
      delivery: "queue"
    });
    assert.equal(forged.metadata?.litopencode, undefined);
  });
});

test("one missing alias file makes the plugin supply that command only", async () => {
  await withCommands(async (configRoot) => {
    await ensureCommandAliases(configRoot);
    await fs.rm(path.join(configRoot, "command", "lit-recap.md"));
  }, async (fake) => {
    assert.deepEqual(fake.applyCommands().commands.map((command) => command.name), ["lit-recap"]);
  });
});

test("review M1: a plugin command with an agent route switches the session to that agent before it prompts", async () => {
  await withCommands(async () => undefined, async (fake) => {
    const routed = litOpenCodeCommands.filter((command) => command.agent !== undefined);
    assert.ok(routed.some((command) => command.agent === "lit-plan"), "a planning command is routed to lit-plan");
    const commands = fake.applyCommands().commands;
    for (const command of routed) {
      fake.sessions.get("ses_root").agent = "lit-loop";
      fake.sessionCalls.length = 0;
      await commands.find((definition) => definition.name === command.id).execute({ sessionID: "ses_root", prompt: { text: "" }, delivery: "queue" });
      assert.deepEqual(fake.sessionCalls, [
        { call: "switchAgent", sessionID: "ses_root", agent: command.agent },
        { call: "prompt", sessionID: "ses_root" }
      ], `/${command.id} runs as ${command.agent}`);
    }
    const unrouted = litOpenCodeCommands.find((command) => command.agent === undefined);
    fake.sessionCalls.length = 0;
    await commands.find((definition) => definition.name === unrouted.id).execute({ sessionID: "ses_root", prompt: { text: "" }, delivery: "queue" });
    assert.deepEqual(fake.sessionCalls, [{ call: "prompt", sessionID: "ses_root" }], "a command without a route keeps the current agent");
  });
});
