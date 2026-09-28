import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  detectChatActivationMode,
  litOpenCodeCommands,
  pluginModule,
  readLedgerEvents
} from "../src/index.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-start-work-trigger-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function rootSessionClient() {
  return {
    session: {
      get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } })
    }
  };
}

function chatOutput(text, suffix) {
  return {
    message: {
      id: `msg_${suffix}`,
      sessionID: `session_${suffix}`,
      role: "user"
    },
    parts: [
      {
        id: `part_${suffix}`,
        sessionID: `session_${suffix}`,
        messageID: `msg_${suffix}`,
        type: "text",
        text
      }
    ]
  };
}

test("start-work chat activation requires an explicit leading invocation", () => {
  for (const accepted of [
    "start-work",
    "start-work on the approved plan",
    "lit start work",
    "lit start work on the approved plan"
  ]) {
    assert.equal(detectChatActivationMode(accepted), "start-work", `${accepted} should activate start-work`);
  }

  for (const rejected of [
    "I found an issue with start-work and want a diagnosis",
    "> copied issue: start-work routed incorrectly",
    "copied issue: start-work routed incorrectly",
    '"start-work" is only quoted documentation',
    "Please explain why lit start work is blocked",
    "please start-work the approved plan",
    "$start-work is the Codex-native spelling"
  ]) {
    assert.equal(detectChatActivationMode(rejected), undefined, `${rejected} should stay inert`);
  }

  assert.equal(detectChatActivationMode("/start-work approved-plan"), undefined);
  assert.equal(detectChatActivationMode("lit plan how start-work handoff works"), "lit-plan");
  assert.equal(detectChatActivationMode("lit review the start-work handoff"), "review-work");
  assert.equal(
    detectChatActivationMode("I found an issue with start-work and want a diagnosis. lit"),
    "lit-task"
  );
  assert.equal(
    detectChatActivationMode("The Codex spelling is $start-work; diagnose the mismatch. lit"),
    "lit-task"
  );
});

test("inert start-work mentions append neither a prompt nor a ledger event", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const rejected = [
      "I found an issue with start-work and want a diagnosis",
      "> copied issue: start-work routed incorrectly",
      "Please explain why lit start work is blocked"
    ];

    for (const [index, text] of rejected.entries()) {
      const output = chatOutput(text, `rejected_${index}`);
      await hooks["chat.message"](
        {
          sessionID: output.message.sessionID,
          messageID: output.message.id,
          agent: "lit-loop"
        },
        output
      );
      assert.equal(output.parts.length, 1, `${text} should not inject a workflow prompt`);
    }

    assert.deepEqual(await readLedgerEvents(dir), []);

    const valid = chatOutput("start-work on the approved plan", "valid");
    await hooks["chat.message"](
      {
        sessionID: valid.message.sessionID,
        messageID: valid.message.id,
        agent: "lit-loop"
      },
      valid
    );
    assert.equal(valid.parts.length, 2);
    assert.equal(valid.parts[1].metadata.litopencode.mode, "start-work");
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => [event.type, event.mode]),
      [["prompt.activated", "start-work"]]
    );
  });
});

test("the native /start-work route remains assigned to lit-implement", async () => {
  const command = litOpenCodeCommands.find((entry) => entry.id === "start-work");
  assert.equal(command?.slash, "/start-work");
  assert.equal(command?.agent, "lit-implement");

  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = { parts: [] };
    await hooks["command.execute.before"](
      { command: "/start-work", sessionID: "session-command", arguments: "approved-plan" },
      output
    );

    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].metadata.litopencode.mode, "start-work");
    assert.match(output.parts[0].text, /<start-work-mode>/);
  });
});

test("a final standalone lit stays a bounded task activation despite a diagnostic start-work mention", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: rootSessionClient(),
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = chatOutput(
      "I found an issue with start-work and want a diagnosis. lit",
      "diagnostic_final_lit"
    );

    await hooks["chat.message"](
      {
        sessionID: output.message.sessionID,
        messageID: output.message.id,
        agent: "lit-loop"
      },
      output
    );

    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-task");
    assert.deepEqual((await readLedgerEvents(dir)).map((event) => [event.type, event.mode]), []);
  });
});
