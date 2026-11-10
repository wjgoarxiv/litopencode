import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";
import { createRuntimePaths } from "../src/state.ts";
import { cancelTypedWork } from "../src/start-work-typed.ts";
import { setupLitOpenCodeServer } from "../src/v2/server.ts";
import { createFakeV2Context } from "../test-support/opencode-v2-fake.mjs";

// `lit cancel` typed by the user ends the project's start-work run from whichever window it was typed in,
// including a nested folder or a linked worktree of the checkout that holds the run.

async function withDir(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-cancel-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function startRun(root, sessionID = "ses_owner") {
  await fs.writeFile(path.join(root, "PLAN.md"), "# p\n\n- [ ] 1. a\n");
  return (await createBoundedAuthorityLifecycle(root).init({
    schemaVersion: 3, requestId: `init-${sessionID}`, sessionID, trustedUser: true, expectedRevision: 0, planPath: "PLAN.md", worktree: null, authorized: true,
    authority: [{ action: "write", root: "." }]
  })).state;
}

const bytes = async (file) => fs.readFile(file).then((raw) => createHash("sha256").update(raw).digest("hex"), () => "absent");

test("a run in the main checkout is cancelled from a linked worktree and from a nested folder", async () => {
  await withDir(async (dir) => {
    const main = path.join(dir, "main");
    await fs.mkdir(path.join(main, "nested"), { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: main, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
    git("init", "-q");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
    const linked = path.join(dir, "linked");
    git("worktree", "add", "-q", linked);
    assert.match(await fs.readFile(path.join(linked, ".git"), "utf8"), /^gitdir:/u);
    // A finished run in the linked worktree does not shadow the live one in the main checkout.
    await startRun(linked, "ses_linked");
    const linkedLifecycle = createBoundedAuthorityLifecycle(linked);
    const finished = await linkedLifecycle.read();
    await linkedLifecycle.cancel({ schemaVersion: 3, requestId: "done", workId: finished.workId, sessionID: "ses_linked", expectedRevision: finished.revision, trustedUser: true });
    await startRun(main);
    const fromLinked = await cancelTypedWork({ projectRoot: linked, sessionID: "ses_other", messageID: "m1" });
    assert.match(fromLinked, /the user cancelled the start-work run on PLAN\.md/u);
    assert.equal((await createBoundedAuthorityLifecycle(main).read()).status, "cancelled");

    const second = await createBoundedAuthorityLifecycle(main).read();
    await createBoundedAuthorityLifecycle(main).init({
      schemaVersion: 3, requestId: "init-again", sessionID: "ses_owner", trustedUser: true, expectedRevision: second.revision, planPath: "PLAN.md", worktree: null, authorized: true,
      authority: [{ action: "write", root: "." }]
    });
    const fromNested = await cancelTypedWork({ projectRoot: path.join(main, "nested"), directory: main, sessionID: "ses_other", messageID: "m2" });
    assert.match(fromNested, /cancelled the start-work run/u);
    assert.equal((await createBoundedAuthorityLifecycle(main).read()).status, "cancelled");
  });
});

test("no run means no write; a busy lock gets a retry line; the same message twice cancels once", async () => {
  await withDir(async (dir) => {
    const paths = createRuntimePaths(dir);
    const none = await cancelTypedWork({ projectRoot: dir, sessionID: "s", messageID: "m0" });
    assert.match(none, /no start-work run is active here/u);
    assert.equal(await bytes(paths.lifecycleStateFile), "absent");
    const state = await startRun(dir);
    const before = [await bytes(paths.lifecycleStateFile), await bytes(paths.lifecycleEventsFile)];
    await fs.mkdir(paths.lifecycleLockDir, { recursive: true });
    await fs.writeFile(path.join(paths.lifecycleLockDir, "owner.json"), JSON.stringify({ token: "live", pid: process.pid }));
    const busy = await cancelTypedWork({ projectRoot: dir, sessionID: "s", messageID: "m1", options: { staleLockMs: 60_000, lockTimeoutMs: 100 } });
    assert.match(busy, /busy writing its state; send lit cancel again/u);
    assert.deepEqual([await bytes(paths.lifecycleStateFile), await bytes(paths.lifecycleEventsFile)], before);
    await fs.rm(paths.lifecycleLockDir, { recursive: true, force: true });
    await cancelTypedWork({ projectRoot: dir, sessionID: "ses_owner", messageID: "m2" });
    await cancelTypedWork({ projectRoot: dir, sessionID: "ses_owner", messageID: "m2" });
    const after = await createBoundedAuthorityLifecycle(dir).read();
    assert.equal(after.history.filter((entry) => entry.type === "work.user-cancelled").length, 1);
    assert.equal(after.workId, state.workId);
  });
});

test("v1 chat: lit cancel from another window ends the run and the owner hears it once; a child session is ignored", async () => {
  await withDir(async (dir) => {
    await startRun(dir);
    const sessions = { ses_owner: {}, ses_other: {}, ses_child: { parentID: "ses_owner" } };
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id, ...sessions[requestPath.id] } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    const send = async (sessionID, text, id) => {
      const output = { message: { id, sessionID, role: "user" }, parts: [{ id: `p_${id}`, sessionID, messageID: id, type: "text", text }] };
      await hooks["chat.message"]({ sessionID, messageID: id, agent: "build" }, output);
      return output.parts.slice(1).map((part) => part.text).join("\n");
    };
    try {
      assert.equal(await send("ses_child", "lit cancel", "c1"), "");
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active");
      assert.match(await send("ses_other", "lit cancel", "c2"), /the user cancelled the start-work run/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "cancelled");
      assert.match(await send("ses_owner", "how is it going", "c3"), /from another window/u);
      assert.doesNotMatch(await send("ses_owner", "and now", "c4"), /from another window/u);
      const paths = createRuntimePaths(dir);
      const stack = await fs.readdir(paths.workflowStackDir).catch(() => []);
      assert.equal(stack.some((name) => name.includes("ses_other")), false, "cancel pushes no workflow");
    } finally {
      await hooks.dispose();
    }
  });
});

test("v2 prompt: lit cancel reaches the model, the owner's next prompt carries the notice past the turn reset, one toast is queued", async () => {
  await withDir(async (dir) => {
    await startRun(dir, "ses_root");
    const sessions = { ses_root: { id: "ses_root", agent: "build" }, ses_other: { id: "ses_other", agent: "build" } };
    const fake = createFakeV2Context({ directory: dir, sessions });
    const cleanup = await setupLitOpenCodeServer(fake.context);
    const prompt = (sessionID, text, messageID) => fake.run("session", "prompt", { sessionID, messageID, prompt: { text }, delivery: "queue" });
    const system = async (sessionID) => (await fake.run("session", "context", { sessionID, agent: "build", model: { providerID: "openai", id: "gpt-test" }, system: [], messages: [], options: {}, tools: {} })).system.map((part) => part.text).join("\n");
    try {
      await prompt("ses_other", "lit cancel", "v1");
      assert.match(await system("ses_other"), /the user cancelled the start-work run/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "cancelled");
      await prompt("ses_root", "status?", "v2");
      assert.match(await system("ses_root"), /from another window/u);
      await prompt("ses_root", "again", "v3");
      assert.doesNotMatch(await system("ses_root"), /from another window/u);
      const lines = (await fs.readFile(createRuntimePaths(dir).noticesFile, "utf8")).trim().split("\n").filter((line) => /start-work run cancelled/u.test(line));
      assert.equal(lines.length, 1);
    } finally {
      await cleanup();
    }
  });
});
