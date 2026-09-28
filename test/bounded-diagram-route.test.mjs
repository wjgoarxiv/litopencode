import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createChatMessageActivationHook, detectChatActivationMode } from "../src/activation.ts";

async function activate(text, agent = "lit-loop") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-diagram-route-"));
  try {
    const hook = createChatMessageActivationHook(root, { getSession: async () => ({ id: "session-diagram" }) });
    const output = {
      message: { id: "message-diagram", role: "user", sessionID: "session-diagram" },
      parts: [{ type: "text", text }]
    };
    await hook({ sessionID: "session-diagram", messageID: "message-diagram", agent }, output);
    const injection = output.parts.find((part) => part.metadata?.litopencode);
    if (injection?.metadata.litopencode.mode === "lit-task") {
      await assert.rejects(fs.access(path.join(root, ".litopencode/litgoal/lit-loop/ledger.jsonl")), { code: "ENOENT" });
    }
    return injection;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("bounded diagram creation hands off to the native diagram skill before authoring", async () => {
  for (const text of [
    "Create an architecture diagram of a message queue and its consumers. lit",
    "Please draw a data-flow diagram for warehouse operators.\n\nlit",
    "# Request\n\nMake a workflow diagram with editable SVG.\n\nlit",
    "워크플로 다이어그램을 그려 주세요.\n\nlit",
    "주문-결제-배송 서비스 구조도 그려줘 lit",
    "고객 데이터의 ER 다이어그램 그려줘 lit",
    "Draw a deployment flow diagram for a web service. lit"
  ]) {
    assert.equal(detectChatActivationMode(text), "lit-task");
    const injection = await activate(text, "build");
    assert.match(injection?.text ?? "", /native skill tool to load lit-diagram-drawer before authoring/u, text);
    assert.match(injection.text, /skill location returned by OpenCode/u);
    assert.equal(injection.metadata.litopencode.mode, "lit-task");
    assert.ok(Buffer.byteLength(injection.text) <= 4352);
  }
});

test("diagram handoff does not capture quoted, read-only, UI, planning, or unrelated work", async () => {
  for (const [text, agent] of [
    ["Review the existing architecture diagram. lit"],
    ["Please explain how to create a diagram. lit"],
    ["다이어그램을 만드는 방법을 설명해 주세요. lit"],
    ["Fix the heading in README. lit"],
    ['"Create a workflow diagram" is a quoted example. lit'],
    ["`Create a workflow diagram` is an example. lit"],
    ["```\nCreate a workflow diagram\n```\nlit"],
    ["> Create a workflow diagram\n\nlit"],
    ["Create a diagram editor UI. lit"],
    ["Create a scatter plot from measured data. lit"],
    ["Create an architecture diagram. lit", "lit-plan"],
    ["Create an architecture diagram for this long-running task across turns. lit"],
    ["Create an architecture diagram."],
    ["lit-diagram-drawer"],
    ["/lit-diagram-drawer"]
  ]) {
    const injection = await activate(text, agent);
    assert.doesNotMatch(injection?.text ?? "", /native skill tool to load lit-diagram-drawer before authoring/u, text);
  }
});

test("OpenCode run's own JSON quotes retain an explicit trailing lit request", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-run-route-"));
  try {
    for (const request of [
      "주문-결제-배송 서비스 구조도 그려줘 lit",
      "고객 데이터의 ER 다이어그램 그려줘 lit",
      "Draw a deployment flow diagram for a web service. lit"
    ]) {
      for (const [argv, expected] of [
        [["bun", "opencode", "run", request], "lit-task"],
        [["bun", "opencode", "run", '"' + request + '"'], undefined],
        [["bun", "opencode", "run", "unrelated"], undefined]
      ]) {
        const hook = createChatMessageActivationHook(root, {
          getSession: async () => ({ id: "session-run" }), hostArgv: argv
        });
        const output = {
          message: { id: "message-run", role: "user", sessionID: "session-run" },
          parts: [{ type: "text", text: JSON.stringify(request) }]
        };
        await hook({ sessionID: "session-run", messageID: "message-run", agent: "lit-loop" }, output);
        const injection = output.parts.find((part) => part.metadata?.litopencode);
        assert.equal(injection?.metadata.litopencode.mode, expected);
        assert.equal(/native skill tool to load lit-diagram-drawer before authoring/u.test(injection?.text ?? ""), expected === "lit-task");
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
