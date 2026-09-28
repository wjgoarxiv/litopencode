import { ignitionMark } from "../src/ignition.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectChatActivationMode, pluginModule } from "../src/index.ts";

const skillId = "lit-scientific-visualization";
const banner = "🔥 LIT IGNITED · lit-scientific-visualization 🔥";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-sciviz-invocation-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function userTextOutput(sessionID, messageID, texts) {
  return {
    message: { id: messageID, sessionID, role: "user" },
    parts: texts.map((text, index) => ({
      id: `part-${index}`,
      sessionID,
      messageID,
      type: "text",
      text
    }))
  };
}

test("exact bare scientific visualization id is the only new chat trigger", () => {
  assert.equal(detectChatActivationMode(skillId), skillId);
  assert.equal(detectChatActivationMode(`  ${skillId}\n`), skillId);
  assert.equal(detectChatActivationMode(skillId.toUpperCase()), skillId);

  for (const text of [
    "visualization",
    "scientific visualization",
    "scientific-visualization",
    `please ${skillId}`,
    `${skillId} now`,
    `\`${skillId}\``,
    `\"${skillId}\"`,
    `> ${skillId}`,
    `\`\`\`\n${skillId}\n\`\`\``,
    `/${skillId}`
  ]) {
    assert.equal(detectChatActivationMode(text), undefined, text);
  }
});

test("exact bare chat activation injects the skill and renders session marks without fabricating the model probe", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    try {
      const activation = userTextOutput("session-sciviz-bare", "message-sciviz-bare", [skillId]);
      await hooks["chat.message"](
        { sessionID: "session-sciviz-bare", messageID: "message-sciviz-bare", agent: "lit-loop" },
        activation
      );

      assert.equal(activation.parts.length, 2);
      assert.equal(activation.parts[1].metadata.litopencode.mode, skillId);
      assert.equal(activation.parts[1].text.startsWith(`${banner}\n`), true);

      const otherSession = { text: "unrelated answer" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-other", messageID: "message-other", partID: "part-other" },
        otherSession
      );
      assert.equal(otherSession.text, `${ignitionMark(true, "lit-loop")}\n\nunrelated answer`);

      const firstCompletion = { text: "Figure plan" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-bare", messageID: "assistant-sciviz-bare", partID: "answer-1" },
        firstCompletion
      );
      assert.equal(firstCompletion.text, `${ignitionMark(true, skillId)}\n\nFigure plan`);
      assert.doesNotMatch(firstCompletion.text, /🔥 \*\*LIT IGNITED ·/u);

      const secondCompletion = { text: "Second text part" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-bare", messageID: "assistant-sciviz-bare", partID: "answer-2" },
        secondCompletion
      );
      assert.equal(secondCompletion.text, `${ignitionMark(false, skillId)}\n\nSecond text part`);
    } finally {
      await hooks.dispose();
    }
  });
});

test("mixed multipart chat stays inert and cannot arm a later banner", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    try {
      const activation = userTextOutput("session-sciviz-mixed", "message-sciviz-mixed", [skillId, "other text"]);
      await hooks["chat.message"](
        { sessionID: "session-sciviz-mixed", messageID: "message-sciviz-mixed", agent: "lit-loop" },
        activation
      );
      assert.equal(activation.parts.length, 2);

      const completion = { text: "ordinary answer" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-mixed", messageID: "assistant-sciviz-mixed", partID: "answer-mixed" },
        completion
      );
      assert.equal(completion.text, `${ignitionMark(true, "lit-loop")}\n\nordinary answer`);
    } finally {
      await hooks.dispose();
    }
  });
});

test("slash command selects the discipline for the harness mark", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    try {
      const activation = { parts: [] };
      await hooks["command.execute.before"](
        { command: `/${skillId}`, sessionID: "session-sciviz-command", arguments: "" },
        activation
      );
      assert.equal(activation.parts[0].metadata.litopencode.mode, skillId);

      const completion = { text: "Figure plan" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-command", messageID: "assistant-sciviz-command", partID: "answer-command" },
        completion
      );
      assert.equal(completion.text, `${ignitionMark(true, skillId)}\n\nFigure plan`);
    } finally {
      await hooks.dispose();
    }
  });
});

test("plugin dispose clears an unconsumed scientific banner activation", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    const activation = { parts: [] };
    await hooks["command.execute.before"](
      { command: `/${skillId}`, sessionID: "session-sciviz-disposed", arguments: "" },
      activation
    );

    await hooks.dispose();

    const completion = { text: "ordinary answer" };
    await hooks["experimental.text.complete"](
      { sessionID: "session-sciviz-disposed", messageID: "assistant-sciviz-disposed", partID: "answer-disposed" },
      completion
    );
    assert.equal(completion.text, "ordinary answer");
  });
});

test("harness mark does not add a trailing blank line to an empty completion", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    try {
      await hooks["command.execute.before"](
        { command: `/${skillId}`, sessionID: "session-sciviz-empty", arguments: "" },
        { parts: [] }
      );
      const completion = { text: "" };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-empty", messageID: "assistant-sciviz-empty", partID: "answer-empty" },
        completion
      );
      assert.equal(completion.text, ignitionMark(true, skillId));
    } finally {
      await hooks.dispose();
    }
  });
});

test("a malformed model probe is preserved as evidence, not repaired by the harness", async () => {
  await withTempDir(async (dir) => {
    const hooks = await pluginModule.server({ directory: dir, worktree: dir });
    try {
      await hooks["command.execute.before"](
        { command: `/${skillId}`, sessionID: "session-sciviz-prefix", arguments: "" },
        { parts: [] }
      );
      const completion = { text: `${banner} extra` };
      await hooks["experimental.text.complete"](
        { sessionID: "session-sciviz-prefix", messageID: "assistant-sciviz-prefix", partID: "answer-prefix" },
        completion
      );
      assert.equal(completion.text, `${ignitionMark(true, skillId)}\n\n${banner} extra`);
    } finally {
      await hooks.dispose();
    }
  });
});

test("a preserved user-owned slash alias is not intercepted or banner-armed", async () => {
  await withTempDir(async (dir) => {
    const previousConfigHome = process.env.XDG_CONFIG_HOME;
    const configHome = path.join(dir, "xdg");
    const alias = path.join(configHome, "opencode", "command", `${skillId}.md`);
    await fs.mkdir(path.dirname(alias), { recursive: true });
    await fs.writeFile(alias, "---\ndescription: user route\n---\nUser-owned command.\n");
    process.env.XDG_CONFIG_HOME = configHome;
    try {
      const hooks = await pluginModule.server({ directory: dir, worktree: dir });
      try {
        const activation = { parts: [] };
        await hooks["command.execute.before"](
          { command: `/${skillId}`, sessionID: "session-sciviz-user-alias", arguments: "" },
          activation
        );
        assert.deepEqual(activation.parts, []);

        const completion = { text: "user route answer" };
        await hooks["experimental.text.complete"](
          { sessionID: "session-sciviz-user-alias", messageID: "assistant-user-alias", partID: "answer-user-alias" },
          completion
        );
        assert.equal(completion.text, `${ignitionMark(true, "lit-loop")}\n\nuser route answer`);
      } finally {
        await hooks.dispose();
      }
    } finally {
      if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
  });
});
