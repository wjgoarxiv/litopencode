import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { livenessFile, markLiveness, readLivenessSync } from "../src/session-liveness.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";

async function workspace(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-liveness-")));
  try {
    await fs.mkdir(path.join(dir, ".litopencode"));
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const read = async (dir, sessionID) => JSON.parse(await fs.readFile(livenessFile(dir, sessionID), "utf8"));

test("alive, idle and ended each write one record with the validated herdr pane", async () => {
  await workspace(async (dir) => {
    const env = { HERDR_PANE_ID: "w2B:3" };
    const t0 = Date.parse("2026-10-28T00:00:00.000Z");
    assert.equal(await markLiveness(dir, "ses_a", "alive", { now: t0, env }), true);
    assert.deepEqual(await read(dir, "ses_a"), { version: 1, sessionId: "ses_a", state: "alive", at: "2026-10-28T00:00:00.000Z", herdrPane: "w2B:3" });
    assert.equal(await markLiveness(dir, "ses_a", "idle", { now: t0 + 1000, env }), true);
    assert.equal((await read(dir, "ses_a")).state, "idle");
    assert.equal(await markLiveness(dir, "ses_a", "ended", { now: t0 + 2000, env }), true);
    assert.equal(readLivenessSync(dir, "ses_a")?.state, "ended");
  });
});

test("the same state within 30 seconds writes nothing; after 30 seconds it refreshes", async () => {
  await workspace(async (dir) => {
    const t0 = Date.now();
    assert.equal(await markLiveness(dir, "ses_a", "alive", { now: t0, env: {} }), true);
    assert.equal(await markLiveness(dir, "ses_a", "alive", { now: t0 + 29_000, env: {} }), false);
    assert.equal((await read(dir, "ses_a")).at, new Date(t0).toISOString());
    assert.equal(await markLiveness(dir, "ses_a", "alive", { now: t0 + 30_000, env: {} }), true);
  });
});

test("a malformed pane id is dropped and an unsafe session id or state writes nothing", async () => {
  await workspace(async (dir) => {
    for (const pane of ["bad pane", "x".repeat(40), "$(id)", ""]) {
      await markLiveness(dir, "ses_p", "alive", { now: Date.now() + Math.random() * 1e9, env: { HERDR_PANE_ID: pane } });
      assert.equal((await read(dir, "ses_p")).herdrPane, null, pane);
      await fs.rm(livenessFile(dir, "ses_p"));
    }
    assert.equal(await markLiveness(dir, "../escape", "alive", { env: {} }), false);
    assert.equal(await markLiveness(dir, "ses_a", "running", { env: {} }), false);
    assert.equal(readLivenessSync(dir, "../escape"), undefined);
  });
});

test("a symlinked liveness folder or record is never written through, and a plain project gets no state", async () => {
  await workspace(async (dir) => {
    const target = path.join(dir, "elsewhere");
    await fs.mkdir(target);
    await fs.symlink(target, path.join(dir, ".litopencode", "liveness"));
    assert.equal(await markLiveness(dir, "ses_a", "alive", { env: {} }), false);
    assert.deepEqual(await fs.readdir(target), []);

    await fs.rm(path.join(dir, ".litopencode", "liveness"));
    await fs.mkdir(path.join(dir, ".litopencode", "liveness"));
    const victim = path.join(dir, "victim.json");
    await fs.writeFile(victim, "keep");
    await fs.symlink(victim, livenessFile(dir, "ses_b"));
    assert.equal(await markLiveness(dir, "ses_b", "alive", { env: {} }), false);
    assert.equal(await fs.readFile(victim, "utf8"), "keep");
    assert.equal(readLivenessSync(dir, "ses_b"), undefined);
  });
  const plain = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-liveness-plain-"));
  try {
    assert.equal(await markLiveness(plain, "ses_a", "alive", { env: {} }), false);
    assert.deepEqual(await fs.readdir(plain), []);
  } finally {
    await fs.rm(plain, { recursive: true, force: true });
  }
});

test("the plugin hooks record alive after a tool, idle on session.idle and ended on session.deleted", async () => {
  await workspace(async (dir) => {
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    try {
      await hooks["tool.execute.after"]({ tool: "read", sessionID: "ses_h", callID: "c1", args: {} }, { title: "", output: "", metadata: {} });
      assert.equal((await read(dir, "ses_h")).state, "alive");
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_h" } } });
      assert.equal((await read(dir, "ses_h")).state, "idle");
      await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ses_h" } } } });
      assert.equal((await read(dir, "ses_h")).state, "ended");
    } finally {
      await hooks.dispose();
    }
  });
});

test("a failed liveness write never breaks the tool hook", async () => {
  await workspace(async (dir) => {
    await fs.writeFile(path.join(dir, ".litopencode", "liveness"), "not a folder");
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    try {
      const output = { title: "", output: "kept", metadata: {} };
      await hooks["tool.execute.after"]({ tool: "read", sessionID: "ses_f", callID: "c1", args: {} }, output);
      assert.equal(output.output, "kept");
    } finally {
      await hooks.dispose();
    }
  });
});
