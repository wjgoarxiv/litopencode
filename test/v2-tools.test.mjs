import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { adaptTool } from "../src/v2/tools.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// OpenCode 2 takes tools as { name, description, input (JSON Schema), execute(input, context) } and its
// tool context carries no directory, so the project comes from the plugin's location.
const toolIds = ["lit", "litwork", "start-work", "review-work", "wikify"];

async function withTools(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-v2-tools-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  const fake = createFakeV2Context({ directory: dir });
  const cleanup = await setupLitOpenCodeServer(fake.context);
  try {
    await fn(dir, fake.applyTools().tools);
  } finally {
    await cleanup();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const toolContext = { sessionID: "ses_v2", agent: "lit-loop", messageID: "msg_v2", id: "call_1", signal: new AbortController().signal, progress: async () => undefined };

test("the five LitOpenCode tools are added with closed JSON Schema inputs", async () => {
  await withTools(async (_dir, tools) => {
    assert.deepEqual([...tools.keys()].sort(), [...toolIds].sort());
    for (const id of toolIds) {
      const tool = tools.get(id);
      assert.equal(tool.name, id);
      assert.match(tool.description, /\S/u);
      assert.equal(tool.input.type, "object", id);
      assert.equal(tool.input.additionalProperties, false, id);
      assert.equal(tool.input.properties.action.type, "string", id);
      assert.equal(typeof tool.execute, "function", id);
    }
  });
});

test("a tool writes to the project ledger from the plugin location and returns content with metadata", async () => {
  await withTools(async (dir, tools) => {
    const result = await tools.get("lit").execute({ action: "activate" }, toolContext);
    assert.equal(typeof result.content, "string");
    assert.match(result.content, /Ledger initialized and activation recorded\./u);
    assert.equal(result.metadata.command, "lit");
    assert.equal(result.metadata.action, "activate");
    assert.equal(result.metadata.title, "LitOpenCode activated");
    const ledger = await fs.readFile(path.join(dir, ".litopencode", "litgoal", "lit-loop", "ledger.jsonl"), "utf8");
    assert.match(ledger, /tool\.lit\.activated/u);
    assert.match(ledger, /ses_v2/u);
  });
});

test("a tool call with an unknown argument is refused before it runs", async () => {
  await withTools(async (_dir, tools) => {
    await assert.rejects(() => tools.get("lit").execute({ action: "status", extra: 1 }, toolContext), /extra|Unrecognized/u);
  });
});

test("review M2: the five tools sit on the model's own tool list, outside Code Mode, so lit-plan keeps them without `execute`", async () => {
  await withTools(async (_dir, tools) => {
    for (const id of toolIds) assert.equal(tools.get(id).options?.codemode, false, id);
  });
});

test("review L5: a tool body that asks for permission fails on OpenCode 2 instead of being silently approved", async () => {
  const asking = adaptTool("asking", {
    description: "asks first",
    args: {},
    async execute(_args, context) {
      await context.ask({ permission: "edit", patterns: ["*"], always: [], metadata: {} });
      return "done without asking";
    }
  }, "/tmp/project");
  await assert.rejects(() => asking.execute({}, toolContext), /not supported on OpenCode 2/u);
});
