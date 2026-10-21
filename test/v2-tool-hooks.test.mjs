import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// OpenCode 2 runs `execute.before` with a mutable `input`; a throw there fails only that call with a
// tool error. `execute.after` gets a mutable `result` (or an `error`) and must never throw, because
// the host treats a throw there as a crash.
async function withHooks(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-hooks-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir, sessions: { ses_root: { id: "ses_root" }, ses_child: { id: "ses_child", parentID: "ses_root" } } });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fn(dir, fake);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const call = (tool, input, sessionID = "ses_root") => ({ tool, sessionID, agent: "lit-loop", messageID: "msg_1", id: "call_1", input });

test("execute.before blocks templated reader-facing text in a write and lets plain text through", async () => {
  await withHooks(async (_dir, fake) => {
    await assert.rejects(
      fake.run("tool", "execute.before", call("write", { path: "deliverable.md", content: "Source: unrequested report\n" })),
      /LIT_HUMANIZER_BLOCKED/u
    );
    const plain = call("write", { path: "notes.md", content: "The build passed on the second run.\n" });
    await fake.run("tool", "execute.before", plain);
    assert.deepEqual(plain.input, { path: "notes.md", content: "The build passed on the second run.\n" });
  });
});

test("execute.before keeps subagents to the root session", async () => {
  await withHooks(async (_dir, fake) => {
    await assert.rejects(fake.run("tool", "execute.before", call("subagent", { agent: "lit-explore", description: "look", prompt: "x" }, "ses_child")), /recursion guard/u);
    await fake.run("tool", "execute.before", call("subagent", { agent: "lit-explore", description: "look", prompt: "x" }, "ses_root"));
  });
});

test("execute.after appends post-edit routes to the result content and merges metadata", async () => {
  await withHooks(async (_dir, fake) => {
    const event = { ...call("edit", { path: "src/app.ts", oldString: "a", newString: "b" }), status: "completed", result: { content: "Edited src/app.ts", metadata: { lines: 1 } } };
    await fake.run("tool", "execute.after", event);
    assert.match(event.result.content, /^Edited src\/app\.ts\n\nSkill\(/u);
    assert.equal(event.result.metadata.lines, 1);
    assert.ok(Array.isArray(event.result.metadata.litopencodePostEditSkills));
  });
});

test("execute.after leaves an error result alone and never throws", async () => {
  await withHooks(async (_dir, fake) => {
    const error = new Error("tool failed");
    const event = { ...call("edit", { path: "src/app.ts", oldString: "a", newString: "b" }), status: "error", error };
    await fake.run("tool", "execute.after", event);
    assert.equal(event.error, error);
    assert.equal(event.result, undefined);
    const odd = { ...call("write", { path: "x.md", content: "y" }), status: "completed", result: { content: [{ type: "file", uri: "file:///x", mime: "text/plain" }] } };
    await fake.run("tool", "execute.after", odd);
  });
});
