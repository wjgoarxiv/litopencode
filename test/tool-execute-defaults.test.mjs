import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { litOpenCodeTools, readLedgerEvents } from "../src/index.ts";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-tool-defaults-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createToolContext(dir) {
  return {
    sessionID: "schema-hotfix-session",
    messageID: "schema-hotfix-message",
    agent: "lit-loop",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {}
  };
}

test("lit tool execution initializes the ledger when action is missing", async () => {
  await withTempDir(async (dir) => {
    const result = await litOpenCodeTools.lit.execute({}, createToolContext(dir));

    assert.match(result.output, /Ledger initialized/);
    assert.deepEqual(
      (await readLedgerEvents(dir)).map((event) => event.type),
      ["tool.lit.activated"]
    );
  });
});
