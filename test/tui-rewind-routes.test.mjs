import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeCommands } from "../src/commands.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { rainbowActive } from "../src/tui/mission-rainbow.ts";
import { readCardInput, readMissionInput } from "../src/tui/mission-source.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// Every route that runs lit-adhd must switch the card to the rewind look: the hook's real output is
// replayed into the session the TUI reads, then the look is decided the way src/tui.ts decides it.
const now = Date.parse("2026-10-27T09:00:00.000Z");

function looksRewound(userParts, assistantParts = []) {
  const state = {
    session: {
      messages: () => [{ id: "u1", role: "user", time: { created: now - 2000 } }, { id: "a1", role: "assistant", time: { created: now - 1000 } }],
      todo: () => [],
      status: () => ({ type: "busy" }),
      permission: () => [],
      question: () => []
    },
    part: (id) => (id === "u1" ? userParts : assistantParts)
  };
  const view = buildMissionView(readMissionInput(state, "ses_a", undefined, now));
  const card = readCardInput(state, "ses_a");
  return rainbowActive(view, card.chips, card.busy);
}

async function workspace(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-rewind-routes-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  await fs.mkdir(path.join(dir, "xdg", "opencode"), { recursive: true });
  try {
    await run(dir, path.join(dir, "xdg", "opencode"));
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withPlugin(dir, run) {
  const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
  try {
    await run(hooks);
  } finally {
    await hooks.dispose();
  }
}

async function withV2(dir, run) {
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_a: { id: "ses_a", agent: "build" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await run(fake);
  } finally {
    await cleanup();
  }
}

for (const word of ["lit adhd", "lit rewind"]) {
  test(`the bare word '${word}' in chat switches the card to the rewind look`, async () => {
    await workspace(async (dir) => {
      await withPlugin(dir, async (hooks) => {
        const output = { message: { id: "msg_x", sessionID: "ses_a", role: "user" }, parts: [{ id: "prt_x", sessionID: "ses_a", messageID: "msg_x", type: "text", text: word }] };
        await hooks["chat.message"]({ sessionID: "ses_a", messageID: "msg_x", agent: "build" }, output);
        assert.equal(looksRewound(output.parts), true);
      });
    });
  });

  test(`the bare word '${word}' at the v2 prompt hook switches the card to the rewind look`, async () => {
    await workspace(async (dir) => {
      await withV2(dir, async (fake) => {
        const event = await fake.run("session", "prompt", { sessionID: "ses_a", messageID: "msg_w", prompt: { text: word }, delivery: "queue" });
        assert.equal(looksRewound([{ type: "text", text: word, metadata: event.metadata }]), true);
      });
    });
  });
}

for (const id of ["lit-adhd", "lit-rewind"]) {
  test(`the /${id} command switches the card to the rewind look`, async () => {
    await workspace(async (dir) => {
      await withPlugin(dir, async (hooks) => {
        const output = { parts: [] };
        await hooks["command.execute.before"]({ command: id, sessionID: "ses_a", arguments: "" }, output);
        assert.equal(looksRewound(output.parts), true);
      });
    });
  });

  test(`the v2 /${id} plugin command switches the card to the rewind look`, async () => {
    await workspace(async (dir) => {
      await withV2(dir, async (fake) => {
        const command = fake.applyCommands().commands.find((entry) => entry.name === id);
        await command.execute({ sessionID: "ses_a", prompt: { text: "" }, delivery: "queue" });
        const sent = fake.prompts.at(-1);
        const event = await fake.run("session", "prompt", { sessionID: "ses_a", messageID: "msg_c", prompt: { text: sent.text }, metadata: sent.metadata, delivery: "queue" });
        assert.equal(looksRewound([{ type: "text", text: sent.text, metadata: event.metadata }]), true);
      });
    });
  });

  test(`the v2 /${id} command from an installed alias file switches the card to the rewind look`, async () => {
    await workspace(async (dir, configRoot) => {
      await ensureCommandAliases(configRoot);
      await withV2(dir, async (fake) => {
        // With alias files the host expands the command itself: the prompt is the alias body, unmarked.
        const text = litOpenCodeCommands.find((command) => command.id === id).activationText;
        const event = await fake.run("session", "prompt", { sessionID: "ses_a", messageID: "msg_a", prompt: { text }, delivery: "queue" });
        assert.equal(looksRewound([{ type: "text", text, metadata: event.metadata }]), true);
      });
    });
  });
}

test("a native skill tool load of lit-adhd switches the card to the rewind look", () => {
  const load = { type: "tool", tool: "skill", state: { status: "completed", input: { name: "lit-adhd" }, time: { start: now - 500 } } };
  assert.equal(looksRewound([{ type: "text", text: "where was I?" }], [load]), true);
  const failed = { ...load, state: { ...load.state, status: "error" } };
  assert.equal(looksRewound([{ type: "text", text: "where was I?" }], [failed]), false, "a failed load is not a run");
});
