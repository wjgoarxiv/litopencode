import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { createIgnitionState, ignitionMark } from "../src/ignition.ts";
import { showActivationToast } from "../src/activation.ts";
import { litOpenCodeCommands } from "../src/commands.ts";
import { activationDiscipline } from "../src/activation-probe.ts";
import { micro, supportsMarkGlyphs } from "../src/lit-mark.ts";
import { withMarkTerminal } from "../test-support/lit-mark-fixture.mjs";

for (const command of litOpenCodeCommands) {
  test(`${command.id} prompt requires exactly one discipline probe as the first model-emitted line`, () => {
    const discipline = activationDiscipline(command.id);
    const banner = `🔥 LIT IGNITED · ${discipline} 🔥`;
    const probe = `🔥 **LIT IGNITED · ${discipline}** 🔥`;
    assert.equal(command.banner, banner);
    assert.equal(command.activationText.split("\n")[0], banner);
    assert.match(command.activationText, /Your first reply line MUST be exactly:/u);
    assert.match(command.activationText, /Emit it once/u);
    const activationHeader = command.activationText.split("\n# Installed skill body\n", 1)[0];
    const probes = activationHeader.split("\n").filter((line) => line.startsWith("🔥 **LIT IGNITED · "));
    assert.deepEqual(probes, [probe]);
  });
}

test("completion marks preserve the model probe and isolate first/later/deleted session state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-ignition-"));
  const plugin = createLitOpenCodePlugin(async () => ({ status: "skipped" }));
  let hooks;
  try {
    hooks = await plugin({ directory: root, worktree: root });
    const activation = { parts: [] };
    await hooks["command.execute.before"]({ command: "/lit-code", sessionID: "one", arguments: "" }, activation);
    assert.equal(activation.parts[0].metadata.litopencode.command, "lit-code");
    const complete = async (sessionID, partID, text) => {
      const output = { text };
      await hooks["experimental.text.complete"]({ sessionID, messageID: `message-${partID}`, partID }, output);
      return output.text;
    };
    const modelReply = "🔥 **LIT IGNITED · lit-code** 🔥\nImplementation ready.";
    const first = await complete("one", "first", modelReply);
    assert.equal(first, `${ignitionMark(true, "lit-code")}\n\n${modelReply}`);
    assert.equal(first.split("\n").filter((line) => line === "🔥 **LIT IGNITED · lit-code** 🔥").length, 1);
    assert.doesNotMatch(first, /🔥 LIT IGNITED · lit-code 🔥/u);
    const later = await complete("one", "later", modelReply);
    assert.equal(later, `${ignitionMark(false, "lit-code")}\n\n${modelReply}`);
    assert.doesNotMatch(later, /🔥 LIT IGNITED · lit-code 🔥/u);
    assert.equal(await complete("two", "other", "No probe"), `${ignitionMark(true, "lit-loop")}\n\nNo probe`);
    await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "one" } } } });
    assert.equal(await complete("one", "recreated", "New session"), `${ignitionMark(true, "lit-loop")}\n\nNew session`);
    await hooks.dispose();
    assert.equal(await complete("one", "disposed", "After disposal"), "After disposal");
  } finally {
    await hooks?.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Markdown ignition always has no ANSI and uses plain LIT for non-UTF-8 hosts", async () => {
  const coloredTerminalMark = withMarkTerminal(() => ignitionMark(false, "lit-handoff"));
  assert.doesNotMatch(coloredTerminalMark, /\u001b/u);
  assert.equal(coloredTerminalMark.split("\n").length, 7);
  assert.equal(ignitionMark(true, "lit-plan", { LANG: "C" }), "```text\nLIT\n```");
  const state = createIgnitionState();
  const output = { text: "🔥 **LIT IGNITED · lit-plan** 🔥\nAnswer" };
  state.activate("id", "lit-plan");
  await state.complete({ sessionID: "id", messageID: "msg", partID: "part" }, output);
  assert.equal(output.text.split("\n").filter((line) => line === "🔥 **LIT IGNITED · lit-plan** 🔥").length, 1);
  state.dispose();
});

test("activation toast uses a color-free multi-line micro mark or label-only fallback", () => {
  const calls = [];
  const client = { tui: { showToast: (options) => { calls.push(options); } } };
  const label = "🔥 LIT IGNITED · lit-loop 🔥";

  showActivationToast(client, "lit-loop", { LANG: "en_US.UTF-8", TERM: "xterm-256color" });
  const message = [...micro.map((row) => row.replace(/ +$/u, "")), label].join("\n");
  assert.deepEqual(calls, [{ body: {
    title: "🔥 LIT IGNITED",
    message,
    variant: "warning",
    duration: 6000
  } }]);
  assert.doesNotMatch(calls[0].body.message, /\u001b/u);

  calls.length = 0;
  showActivationToast(client, "lit-loop", { LANG: "C", TERM: "xterm-256color" });
  assert.deepEqual(calls, [{ body: {
    title: "🔥 LIT IGNITED",
    message: label,
    variant: "warning",
    duration: 6000
  } }]);
  assert.doesNotMatch(calls[0].body.message, /\u001b/u);
});

test("shipped activation prose distinguishes model probes from harness banners", async () => {
  const { litOpenCodeFeatures } = await import("../src/features.ts");
  const stale = /emit(?: the)?(?: exact)?(?: activation)? banner|(?:lit-handoff|lit-scientific-visualization) banner|workflow banner|feature banner/iu;
  for (const command of litOpenCodeCommands) {
    assert.doesNotMatch(command.activationText, stale, command.id);
    assert.doesNotMatch(command.description, stale, command.id);
  }
  assert.doesNotMatch(JSON.stringify(litOpenCodeFeatures), stale);
});

test("successful direct activation tools select the later micro discipline while status and blocked results stay inert", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-tool-ignition-"));
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: root, worktree: root });
  const context = { directory: root, worktree: root, sessionID: "tools", messageID: "msg", agent: "lit-loop" };
  try {
    const first = { text: "First answer" };
    await hooks["experimental.text.complete"]({ sessionID: "tools", messageID: "first", partID: "first" }, first);
    const review = await hooks.tool["review-work"].execute({ action: "review" }, context);
    await hooks["tool.execute.after"]({ tool: "review-work", sessionID: "tools", callID: "review", args: { action: "review" } }, review);
    const modelReply = "🔥 **LIT IGNITED · review-work** 🔥\nReview complete.";
    const later = { text: modelReply };
    await hooks["experimental.text.complete"]({ sessionID: "tools", messageID: "later", partID: "later" }, later);
    assert.equal(later.text, `${ignitionMark(false, "review-work")}\n\n${modelReply}`);
    for (const [tool, action, agent] of [["lit", "status", "lit-loop"], ["start-work", "start", "lit-plan"]]) {
      const result = await hooks.tool[tool].execute({ action }, { ...context, agent });
      await hooks["tool.execute.after"]({ tool, sessionID: "tools", callID: action, args: { action } }, result);
      const output = { text: "Unchanged discipline" };
      await hooks["experimental.text.complete"]({ sessionID: "tools", messageID: action, partID: action }, output);
      assert.equal(output.text, `${ignitionMark(false, "review-work")}\n\nUnchanged discipline`);
    }
  } finally {
    await hooks.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("chat activation shows the OpenCode ignition toast through the plugin client", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-ignition-toast-"));
  const calls = [];
  const client = {
    session: { get: async () => ({ data: {} }) },
    tui: { showToast: async (options) => { calls.push(options); } }
  };
  let hooks;
  try {
    hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({
      directory: root,
      worktree: root,
      client
    });
    const output = {
      message: { id: "message-toast", sessionID: "session-toast", role: "user" },
      parts: [{ id: "part-toast", sessionID: "session-toast", messageID: "message-toast", type: "text", text: "lit" }]
    };
    await hooks["chat.message"]({ sessionID: "session-toast", messageID: "message-toast", agent: "lit-loop" }, output);

    const label = "🔥 LIT IGNITED · lit-task 🔥";
    const message = [...(supportsMarkGlyphs() ? micro.map((row) => row.replace(/ +$/u, "")) : []), label].join("\n");
    assert.deepEqual(calls, [{ body: { title: "🔥 LIT IGNITED", message, variant: "warning", duration: 6000 } }]);
    assert.doesNotMatch(calls[0].body.message, /\u001b/u);
    assert.equal(output.parts.at(-1).text.startsWith("🔥 LIT IGNITED · lit-task 🔥\n"), true);
  } finally {
    await hooks?.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a lit slash command shows the ignition toast once across the command and its chat message", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-command-toast-"));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  const calls = [];
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({
    directory: root,
    worktree: root,
    client: {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: async (options) => { calls.push(options); } }
    }
  });
  try {
    const command = { parts: [] };
    await hooks["command.execute.before"]({ command: "/lit-code", sessionID: "session-command-toast", arguments: "" }, command);
    const hostParts = command.parts.map((part) => ({ ...part }));
    await hooks["chat.message"](
      { sessionID: "session-command-toast", messageID: "message-command-toast" },
      { message: { id: "message-command-toast", sessionID: "session-command-toast", role: "user" }, parts: hostParts }
    );
    const ignited = calls.filter((call) => call.body.title === "🔥 LIT IGNITED");
    assert.equal(ignited.length, 1, JSON.stringify(calls));
    assert.match(ignited[0].body.message, /LIT IGNITED · lit-code/u);
  } finally {
    await hooks.dispose();
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a task with appended lit keeps the answer clean while the activation toast remains", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-plain-completion-"));
  const calls = [];
  const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({
    directory: root,
    worktree: root,
    client: {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: async (options) => { calls.push(options); } }
    }
  });
  try {
    const output = {
      message: { id: "message-bounded", sessionID: "bounded", role: "user" },
      parts: [{ id: "part-bounded", sessionID: "bounded", messageID: "message-bounded", type: "text", text: "작은 도구 만들어줘 lit" }]
    };
    await hooks["chat.message"]({ sessionID: "bounded", messageID: "message-bounded", agent: "build" }, output);
    assert.equal(calls.length, 1);
    const answer = { text: "작은 도구를 만들고 테스트했습니다." };
    await hooks["experimental.text.complete"]({ sessionID: "bounded", messageID: "reply", partID: "reply" }, answer);
    assert.equal(answer.text, "작은 도구를 만들고 테스트했습니다.");
  } finally {
    await hooks.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("missing or failing toast clients never block chat activation", async () => {
  const clients = [
    undefined,
    {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: () => { throw new Error("toast unavailable"); } }
    },
    {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: () => Promise.reject(new Error("toast unavailable")) }
    }
  ];

  for (const client of clients) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-ignition-toast-failure-"));
    let hooks;
    try {
      hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({
        directory: root,
        worktree: root,
        ...(client === undefined ? {} : { client })
      });
      const output = {
        message: { id: "message-toast-failure", sessionID: "session-toast-failure", role: "user" },
        parts: [{ id: "part-toast-failure", sessionID: "session-toast-failure", messageID: "message-toast-failure", type: "text", text: "lit" }]
      };
      await assert.doesNotReject(hooks["chat.message"](
        { sessionID: "session-toast-failure", messageID: "message-toast-failure", agent: "lit-loop" },
        output
      ));
      assert.equal(output.parts.at(-1).text.startsWith("🔥 LIT IGNITED · lit-task 🔥\n"), true);
    } finally {
      await hooks?.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});
