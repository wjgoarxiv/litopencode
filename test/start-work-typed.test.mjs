import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { answerBoundary, boundaryVerdict, startTypedWork, typedStartArgument } from "../src/start-work-typed.ts";
import { createLitOpenCodePlugin } from "../src/server.ts";

async function workspace(run) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-typed-")));
  try {
    await fs.mkdir(path.join(dir, "plans"), { recursive: true });
    await fs.writeFile(path.join(dir, "plans", "one.md"), "# plan\n\n- [ ] 1. first\n- [ ] 2. second\n");
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const pauseOn = (lifecycle, state, action) =>
  lifecycle.pause({ schemaVersion: 3, requestId: `pause-${action}`, workId: state.workId, sessionID: state.sessionID, expectedRevision: state.revision, boundary: { action, root: "." } });

test("typed prompts: only whole-prompt start-work, lit approve and lit deny are recognized", () => {
  assert.equal(typedStartArgument("start-work"), "");
  assert.equal(typedStartArgument("/start-work plans/one.md"), "plans/one.md");
  assert.equal(typedStartArgument("lit start work"), "");
  assert.equal(typedStartArgument("start-work init {\"schemaVersion\":3}"), undefined);
  assert.equal(typedStartArgument("start-work and then commit everything"), undefined);
  assert.equal(typedStartArgument("please start-work"), undefined);
  assert.equal(boundaryVerdict("lit approve"), "approve");
  assert.equal(boundaryVerdict("Lit deny."), "deny");
  assert.equal(boundaryVerdict("lit approve the push to main"), undefined);
  assert.equal(boundaryVerdict("I will lit approve later"), undefined);
});

test("typed start-work resolves the only open plan and inits a bounded run with read, write and execute", async () => {
  await workspace(async (dir) => {
    const result = await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    assert.equal(result.started, true);
    assert.match(result.text, /start-work began from plans\/one\.md/u);
    const state = await createBoundedAuthorityLifecycle(dir).read();
    assert.equal(state.status, "active");
    assert.equal(state.sessionID, "ses_a");
    assert.deepEqual(state.authority.grants.map((grant) => grant.action).sort(), ["execute", "read", "write"]);
    for (const grant of state.authority.grants) assert.equal(grant.root, dir);
    const again = await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    assert.equal(again.started, false);
    assert.match(again.text, /already active/u);
  });
});

test("typed start-work names its plan, refuses an ambiguous or missing one and a path outside the workspace", async () => {
  await workspace(async (dir) => {
    await fs.writeFile(path.join(dir, "plans", "two.md"), "# plan\n\n- [ ] 1. other\n");
    const ambiguous = await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    assert.equal(ambiguous.started, false);
    assert.match(ambiguous.text, /no approved plan was found/u);
    const outside = await startTypedWork({ projectRoot: dir, sessionID: "ses_a", plan: "../escape.md" });
    assert.equal(outside.started, false);
    const named = await startTypedWork({ projectRoot: dir, sessionID: "ses_a", plan: "plans/two.md" });
    assert.equal(named.started, true);
  });
});

test("lit approve resumes with exactly the pending boundary and widens nothing else", async () => {
  await workspace(async (dir) => {
    await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    // A grant names one exact root, so a boundary on a nested directory is outside the grants and pauses the run.
    await fs.mkdir(path.join(dir, "nested"));
    const state = await lifecycle.read();
    const paused = await lifecycle.pause({
      schemaVersion: 3, requestId: "pause-nested", workId: state.workId, sessionID: "ses_a", expectedRevision: state.revision, boundary: { action: "write", root: "nested" }
    });
    assert.equal(paused.outcome, "applied");
    const reply = await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" });
    assert.match(reply, /approved write on/u);
    const after = await lifecycle.read();
    assert.equal(after.status, "active");
    assert.equal(after.pendingBoundary, null);
  });
});

test("lit deny cancels the run, says it ended and how to start again", async () => {
  await workspace(async (dir) => {
    await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const state = await lifecycle.read();
    await fs.mkdir(path.join(dir, "nested"));
    const paused = await lifecycle.pause({
      schemaVersion: 3, requestId: "pause-nested", workId: state.workId, sessionID: "ses_a", expectedRevision: state.revision, boundary: { action: "write", root: "nested" }
    });
    assert.equal(paused.outcome, "applied");
    const reply = await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "deny" });
    assert.match(reply, /run has ended/u);
    assert.match(reply, /start-work/u);
    assert.equal((await lifecycle.read()).status, "cancelled");
  });
});

test("approve and deny change nothing when no root is pending, for another session, or after the run ended", async () => {
  await workspace(async (dir) => {
    assert.match(await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" }), /nothing is waiting/u);
    await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    const before = await createBoundedAuthorityLifecycle(dir).read();
    assert.match(await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" }), /nothing is waiting/u);
    assert.match(await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "deny" }), /nothing is waiting/u);
    assert.equal((await createBoundedAuthorityLifecycle(dir).read()).revision, before.revision);
  });
});

test("a forbidden action can never become a pending boundary, so approve cannot grant it", async () => {
  await workspace(async (dir) => {
    await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const state = await lifecycle.read();
    for (const action of ["commit", "push", "publish", "release", "version-bump", "host-config", "destructive"]) {
      await assert.rejects(() => pauseOn(lifecycle, state, action), /forbidden/u, action);
    }
    assert.equal((await lifecycle.read()).pendingBoundary, null);
    assert.match(await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" }), /nothing is waiting/u);
  });
});

test("a stale approve is rejected: the run moved on between the read and the answer", async () => {
  await workspace(async (dir) => {
    await startTypedWork({ projectRoot: dir, sessionID: "ses_a" });
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const state = await lifecycle.read();
    await fs.mkdir(path.join(dir, "nested"));
    const paused = await lifecycle.pause({
      schemaVersion: 3, requestId: "pause-nested", workId: state.workId, sessionID: "ses_a", expectedRevision: state.revision, boundary: { action: "write", root: "nested" }
    });
    assert.equal(paused.outcome, "applied");
    const first = await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" });
    assert.match(first, /approved/u);
    assert.match(await answerBoundary({ projectRoot: dir, sessionID: "ses_a", verdict: "approve" }), /nothing is waiting/u);
  });
});

test("typed start-work through the chat hook and the command hook inits the run; the strict JSON path still works", async () => {
  await workspace(async (dir) => {
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
    const client = { session: { get: async ({ path: requestPath }) => ({ data: { id: requestPath.id } }) } };
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client });
    try {
      const output = { message: { id: "msg_1", sessionID: "ses_a", role: "user" }, parts: [{ id: "prt_1", sessionID: "ses_a", messageID: "msg_1", type: "text", text: "start-work" }] };
      await hooks["chat.message"]({ sessionID: "ses_a", messageID: "msg_1", agent: "build" }, output);
      const text = output.parts.slice(1).map((part) => part.text).join("\n");
      assert.match(text, /start-work began from plans\/one\.md/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active");
      const planOutput = { message: { id: "msg_2", sessionID: "ses_b", role: "user" }, parts: [{ id: "prt_2", sessionID: "ses_b", messageID: "msg_2", type: "text", text: "start-work" }] };
      await hooks["chat.message"]({ sessionID: "ses_b", messageID: "msg_2", agent: "lit-plan" }, planOutput);
      assert.doesNotMatch(planOutput.parts.slice(1).map((part) => part.text).join("\n"), /began from/u);
    } finally {
      await hooks.dispose();
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});

test("/start-work with a plan path inits the run through the command hook", async () => {
  await workspace(async (dir) => {
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
    const hooks = await createLitOpenCodePlugin(async () => ({ status: "skipped" }))({ directory: dir, worktree: dir, client: {} });
    try {
      const output = { parts: [] };
      await hooks["command.execute.before"]({ command: "start-work", sessionID: "ses_a", arguments: "plans/one.md" }, output);
      assert.match(output.parts.map((part) => part.text).join("\n"), /start-work began from plans\/one\.md/u);
      assert.equal((await createBoundedAuthorityLifecycle(dir).read()).status, "active");
    } finally {
      await hooks.dispose();
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});
