import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litRecapPromptInjection } from "../src/activation.ts";
import { ensureCommandAliases } from "../src/cli/command-aliases.ts";
import {
  createCommandActivationHook,
  findLitOpenCodeCommand,
  litOpenCodeCommands
} from "../src/commands.ts";
import {
  detectChatActivationMode,
  findLitOpenCodeFeature,
  findLitOpenCodeRuntimeSkill,
  pluginModule,
  readLedgerEvents
} from "../src/index.ts";

const htmlCommentPattern = /<!--[\s\S]*?-->/;

function assertNoHtmlCommentArtifact(text, label) {
  assert.doesNotMatch(text, htmlCommentPattern, `${label} should not expose HTML comments or blank <!-- --> artifacts`);
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-lit-recap-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("routes bounded recap triggers to lit-recap and rejects lookalikes", () => {
  // Given/When/Then: bounded recap tokens route while substrings, code, and slash mentions do not.
  for (const accepted of [
    "lit recap",
    "litrecap",
    "recap",
    "recap this session",
    "리캡",
    "please 리캡 해줘",
    "lit-recap",
    "/litrecap now"
  ]) {
    assert.equal(detectChatActivationMode(accepted), "lit-recap", `${accepted} should route to lit-recap`);
  }
  for (const rejected of [
    "recapture the flag",
    "recapitalize it",
    "리캡처 해줘",
    "리캡션",
    "`recap`",
    "```\nrecap\n```"
  ]) {
    assert.notEqual(detectChatActivationMode(rejected), "lit-recap", `${rejected} should not route to lit-recap`);
  }
  assert.equal(detectChatActivationMode("/lit-recap please"), undefined);
});

test("lit-recap template locks the five-section Korean recap contract", () => {
  // Given: the exported injection and the registered command surface.
  const command = findLitOpenCodeCommand("lit-recap");

  // When/Then: both carry the exact headers, switches, data sources, and read-only wording.
  assert.equal(command?.slash, "/lit-recap");
  assert.ok(litOpenCodeCommands.some((entry) => entry.id === "lit-recap"));
  for (const text of [litRecapPromptInjection, command?.activationText ?? ""]) {
    assertNoHtmlCommentArtifact(text, "lit-recap prompt template");
    assert.ok(text.includes("# 작업 리캡 (lit-recap)"));
    assert.ok(text.includes("## ✅ 완료된 작업"));
    assert.ok(text.includes("## 🔄 진행 중"));
    assert.ok(text.includes("## ⛔ 블로커"));
    assert.ok(text.includes("## 📁 증거 경로"));
    assert.ok(text.includes("## ➡️ 다음 단계"));
    assert.ok(text.includes("## ⚡ 요약"));
    assert.ok(text.includes("--brief"));
    assert.ok(text.includes("짧게"));
    assert.ok(text.includes("--en"));
    assert.ok(text.includes(".litopencode/litgoal/lit-loop"));
    assert.ok(text.includes("ledger.jsonl"));
    assert.ok(text.includes("<lit-loop-mode>"));
    assert.match(text, /Do not edit files/);
    assert.match(text, /Korean/);
    assert.match(text, /English/);
  }
});

test("activates /lit-recap read-only without ledger writes or state creation", async () => {
  await withTempDir(async (dir) => {
    // Given: OpenCode runs the /lit-recap command in an empty worktree.
    const hook = createCommandActivationHook(dir);
    const output = { parts: [] };

    // When: command activation receives the recap request with a brief switch.
    await hook({ command: "/lit-recap", sessionID: "session-recap", arguments: "--brief" }, output);

    // Then: guidance is injected while durable state stays untouched.
    assert.equal(output.parts.length, 1);
    assert.equal(output.parts[0].type, "text");
    assertNoHtmlCommentArtifact(output.parts[0].text, "/lit-recap command output");
    assert.ok(output.parts[0].text.includes("# 작업 리캡 (lit-recap)"));
    assert.equal(output.parts[0].metadata.litopencode.command, "lit-recap");
    assert.equal(output.parts[0].metadata.litopencode.mode, "lit-recap");
    assert.deepEqual(await readLedgerEvents(dir), []);
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("routes recap chat messages read-only without durable state writes", async () => {
  await withTempDir(async (dir) => {
    // Given: the plugin server delivers a natural-language recap request.
    const hooks = await pluginModule.server({
      directory: dir,
      worktree: dir,
      project: {},
      client: {
        session: {
          async get() {
            return { data: { id: "session-recap-chat" } };
          }
        }
      },
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: {}
    });
    const output = {
      message: {
        id: "msg_recap",
        sessionID: "session-recap-chat",
        role: "user"
      },
      parts: [
        {
          id: "part-user-recap",
          sessionID: "session-recap-chat",
          messageID: "msg_recap",
          type: "text",
          text: "recap this session"
        }
      ]
    };

    // When: OpenCode delivers the message to the plugin.
    await hooks["chat.message"]({ sessionID: "session-recap-chat", messageID: "msg_recap" }, output);

    // Then: the recap injection appears and no durable state is created.
    assert.equal(output.parts.length, 2);
    assertNoHtmlCommentArtifact(output.parts[1].text, "lit-recap chat output");
    assert.ok(output.parts[1].text.includes("# 작업 리캡 (lit-recap)"));
    assert.equal(output.parts[1].metadata.litopencode.mode, "lit-recap");
    assert.deepEqual(await readLedgerEvents(dir), []);
    await assert.rejects(fs.stat(path.join(dir, ".litopencode")), { code: "ENOENT" });
  });
});

test("exposes lit recap as an installed command alias", async () => {
  await withTempDir(async (dir) => {
    // Given: LitOpenCode command metadata and an empty OpenCode root.
    // When: the installer writes command aliases.
    await ensureCommandAliases(dir);
    const aliasText = await fs.readFile(path.join(dir, "command", "lit-recap.md"), "utf8");

    // Then: OpenCode shows a concrete /lit-recap command carrying the recap template.
    assert.match(aliasText, /^litopencodeGenerated: true$/m);
    assertNoHtmlCommentArtifact(aliasText, "/lit-recap alias");
    assert.ok(aliasText.includes("# 작업 리캡 (lit-recap)"));
  });
});

test("registers lit-recap feature and runtime skill catalog entries", () => {
  // Given/When/Then: catalog parity mirrors the lit-korean architecture.
  assert.notEqual(findLitOpenCodeFeature("lit-recap"), undefined);
  assert.notEqual(findLitOpenCodeRuntimeSkill("lit-recap"), undefined);
});
