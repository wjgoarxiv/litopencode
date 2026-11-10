import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LifecycleConflictError, LifecycleSafetyError, createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { createRuntimePaths } from "../src/state.ts";

// The autopilot shape of the start-work lifecycle: a step outside the grants is parked and the run keeps
// going, the user settles the queue or cancels the run from any window, and the revision a continuation
// names stays usable after the bookkeeping writes that follow it.

async function withProject(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-autopilot-")));
  try {
    await fs.mkdir(path.join(dir, "src"));
    await fs.mkdir(path.join(dir, "docs"));
    await fs.mkdir(path.join(dir, "tools"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Plan\n\n- [ ] 1. one\n");
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const init = (lifecycle, overrides = {}) => lifecycle.init({
  schemaVersion: 3, requestId: "init-1", sessionID: "owner", trustedUser: true, expectedRevision: 0, planPath: "PLAN.md",
  worktree: null, authorized: true, authority: [{ action: "write", root: "src" }], ...overrides
});

let counter = 0;
function fence(state, overrides = {}) {
  counter += 1;
  return { schemaVersion: 3, workId: state.workId, sessionID: state.sessionID, revision: state.revision, progressId: `p-${counter}`, messageID: `m-${counter}`, partID: `pt-${counter}`, summary: `step ${counter}`, ...overrides };
}

const continuationRevision = (text) => Number(/"revision":(\d+)/u.exec(text)[1]);
const ack = (lifecycle, result, request) => lifecycle.markContinuationSent({ workId: result.state.workId, sessionID: result.state.sessionID, revision: result.state.revision, messageID: request.messageID, partID: request.partID });

async function progressAndAck(lifecycle, state, overrides = {}) {
  const request = fence(state, overrides);
  const result = await lifecycle.recordProgress(request);
  const acked = result.dispatchRequired ? await ack(lifecycle, result, request) : result.state;
  return { result, acked };
}

test("a fence carrying the continuation's revision is accepted after the acknowledgement", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const { result, acked } = await progressAndAck(lifecycle, started);
    const named = continuationRevision(result.continuation);
    assert.equal(acked.revision, named + 1, "the acknowledgement moved the revision past the one the continuation names");
    const next = await lifecycle.recordProgress(fence(acked, { revision: named }));
    assert.equal(next.outcome, "continued");
    // After a park and after a settle the same revision rule holds.
    const parkedRequest = fence(next.state, { boundary: { action: "write", root: "docs" } });
    const parked = await lifecycle.recordProgress(parkedRequest);
    assert.equal(parked.outcome, "parked");
    const afterPark = await ack(lifecycle, parked, parkedRequest);
    const settled = await lifecycle.settleParked({ schemaVersion: 3, requestId: "settle-1", workId: started.workId, sessionID: "owner", trustedUser: true, verdict: "approve" });
    assert.ok(settled.state.revision > afterPark.revision);
    const later = await lifecycle.recordProgress(fence(settled.state, { revision: continuationRevision(parked.continuation) }));
    assert.equal(later.outcome, "continued");
  });
});

test("an old revision stays stale after resume, cancel, newer progress or history compaction", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const first = await progressAndAck(lifecycle, started);
    const named = continuationRevision(first.result.continuation);
    const newer = await progressAndAck(lifecycle, first.acked, { revision: named });
    assert.equal((await lifecycle.recordProgress(fence(newer.acked, { revision: named }))).outcome, "stale", "a newer progress makes it stale");
    const parked = await lifecycle.pause({ schemaVersion: 3, requestId: "park-r", workId: started.workId, sessionID: "owner", expectedRevision: newer.acked.revision, boundary: { action: "write", root: "docs" } });
    const resumed = await lifecycle.resume({ schemaVersion: 3, requestId: "resume-r", workId: started.workId, sessionID: "owner", expectedRevision: parked.state.revision, trustedUser: true, grant: { action: "write", root: "docs" } });
    assert.equal((await lifecycle.recordProgress(fence(resumed.state, { revision: continuationRevision(newer.result.continuation) }))).outcome, "stale", "a resume makes it stale");
  });
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir, { maxHistory: 1 });
    const started = (await init(lifecycle)).state;
    const first = await progressAndAck(lifecycle, started);
    assert.equal((await lifecycle.recordProgress(fence(first.acked, { revision: continuationRevision(first.result.continuation) }))).outcome, "stale", "compacted history fails closed");
  });
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const first = await progressAndAck(lifecycle, started);
    const cancelled = await lifecycle.cancel({ schemaVersion: 3, requestId: "cancel-r", workId: started.workId, sessionID: "owner", expectedRevision: first.acked.revision, trustedUser: true });
    assert.equal((await lifecycle.recordProgress(fence(cancelled.state, { revision: continuationRevision(first.result.continuation) }))).outcome, "stale");
  });
});

test("an uncovered boundary is parked, the run stays active and keeps going; repeats raise hits; the 17th overflows", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    let state = (await init(lifecycle)).state;
    const first = await lifecycle.recordProgress(fence(state, { boundary: { action: "write", root: "docs" } }));
    assert.equal(first.outcome, "parked");
    assert.equal(first.state.status, "active");
    assert.equal(first.dispatchRequired, true);
    assert.equal(first.state.pendingBoundary, null);
    assert.deepEqual(first.state.parkedBoundaries.map((entry) => [entry.action, path.basename(entry.root), entry.hits, entry.sessionID]), [["write", "docs", 1, "owner"]]);
    assert.match(first.continuation, /"parked":\[\{"id":"[a-f0-9]+","action":"write","root":"[^"]+docs","hits":1\}\]/u);
    assert.match(first.continuation, /lit cancel/u);
    const second = await lifecycle.recordProgress(fence(first.state, { boundary: { action: "execute", root: "tools" } }));
    const third = await lifecycle.recordProgress(fence(second.state, { boundary: { action: "write", root: "docs" } }));
    const fourth = await lifecycle.recordProgress(fence(third.state, { boundary: { action: "write", root: "docs" }, summary: "again" }));
    assert.deepEqual(fourth.state.parkedBoundaries.map((entry) => [path.basename(entry.root), entry.hits]), [["docs", 3], ["tools", 1]], "queue keeps first-sighting order");
    assert.match(fourth.continuation, /"hits":3/u);
    const covered = await lifecycle.recordProgress(fence(fourth.state, { boundary: { action: "write", root: "src" } }));
    assert.equal(covered.outcome, "continued", "a covered boundary is ordinary progress");
    state = covered.state;
    for (let index = 0; index < 14; index += 1) {
      await fs.mkdir(path.join(dir, `d${index}`));
      state = (await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root: `d${index}` } }))).state;
    }
    assert.equal(state.parkedBoundaries.length, 16);
    await fs.mkdir(path.join(dir, "d-over"));
    const over = await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root: "d-over" } }));
    assert.equal(over.outcome, "continued");
    assert.equal(over.state.parkedBoundaries.length, 16);
    assert.match(over.continuation, /"refused":\[\{"id":"[a-f0-9]+","reason":"too many parked steps/u);
  });
});

test("the park op keeps the run active, and forbidden actions still throw in every state", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const forbidden = ["commit", "push", "publish", "release", "version-bump", "host-config", "destructive"];
    const tryAll = async (state) => {
      for (const action of forbidden) {
        await assert.rejects(lifecycle.recordProgress(fence(state, { boundary: { action, root: "src" } })), LifecycleSafetyError, action);
        await assert.rejects(lifecycle.pause({ schemaVersion: 3, requestId: `p-${action}-${state.revision}`, workId: state.workId, sessionID: "owner", expectedRevision: state.revision, boundary: { action, root: dir } }), LifecycleSafetyError, action);
      }
    };
    await tryAll(started);
    const parked = await lifecycle.pause({ schemaVersion: 3, requestId: "park-1", workId: started.workId, sessionID: "owner", expectedRevision: 1, boundary: { action: "execute", root: dir } });
    assert.equal(parked.outcome, "applied");
    assert.equal(parked.state.status, "active");
    assert.equal(parked.state.parkedBoundaries.length, 1);
    assert.equal(parked.state.history.at(-1).type, "work.boundary-parked");
    await tryAll(parked.state);
    const approved = await lifecycle.settleParked({ schemaVersion: 3, requestId: "s-1", workId: started.workId, sessionID: "owner", trustedUser: true, verdict: "approve" });
    await tryAll(approved.state);
  });
});

test("a legacy paused snapshot and journal open as an active run with that step parked", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const paths = createRuntimePaths(dir);
    const legacy = { ...started, revision: 2, status: "paused", pendingBoundary: { action: "execute", root: dir, id: "abc123" } };
    delete legacy.parkedBoundaries;
    delete legacy.deniedBoundaries;
    const initEvent = JSON.parse((await fs.readFile(paths.lifecycleEventsFile, "utf8")).trim());
    delete initEvent.state.parkedBoundaries;
    delete initEvent.state.deniedBoundaries;
    await fs.writeFile(paths.lifecycleEventsFile, [JSON.stringify(initEvent), JSON.stringify({ schemaVersion: 3, type: "work.paused", revision: 2, requestId: "old", state: legacy })].join("\n") + "\n");
    await fs.writeFile(paths.lifecycleStateFile, JSON.stringify(legacy, null, 2));
    const before = await fs.readFile(paths.lifecycleStateFile, "utf8");
    const loaded = await lifecycle.read();
    assert.equal(loaded.status, "active");
    assert.equal(loaded.pendingBoundary, null);
    assert.deepEqual(loaded.parkedBoundaries.map((entry) => [entry.id, entry.action, entry.sessionID, entry.hits]), [["abc123", "execute", "owner", 1]]);
    assert.deepEqual(loaded.deniedBoundaries, []);
    assert.equal(await fs.readFile(paths.lifecycleStateFile, "utf8"), before, "reading rewrites nothing");
    const next = await lifecycle.recordProgress(fence(loaded));
    assert.equal(next.outcome, "continued");
    const written = JSON.parse(await fs.readFile(paths.lifecycleStateFile, "utf8"));
    assert.equal(written.status, "active");
    assert.equal(written.parkedBoundaries.length, 1);
  });
});

test("complete waits for an empty queue; deny settles it and the run stays active", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    let state = (await lifecycle.recordProgress(fence(started, { boundary: { action: "write", root: "docs" } }))).state;
    state = (await lifecycle.recordProgress(fence(state, { boundary: { action: "execute", root: "tools" } }))).state;
    await assert.rejects(lifecycle.complete({ schemaVersion: 3, requestId: "c-1", workId: state.workId, sessionID: "owner", expectedRevision: state.revision, trustedUser: true }), /2 parked steps/u);
    const denied = await lifecycle.settleParked({ schemaVersion: 3, requestId: "d-1", workId: state.workId, sessionID: "owner", trustedUser: true, verdict: "deny" });
    assert.equal(denied.state.status, "active");
    assert.equal(denied.state.parkedBoundaries.length, 0);
    assert.equal(denied.state.deniedBoundaries.length, 2);
    assert.equal(denied.state.history.at(-1).type, "work.parked-denied");
    const again = await lifecycle.recordProgress(fence(denied.state, { boundary: { action: "write", root: "docs" } }));
    assert.equal(again.state.parkedBoundaries.length, 0, "a denied step is not parked again");
    assert.match(again.continuation, /"refused":\[\{"id":"[a-f0-9]+","reason":"the user refused this step/u);
    const done = await lifecycle.complete({ schemaVersion: 3, requestId: "c-2", workId: state.workId, sessionID: "owner", expectedRevision: again.state.revision, trustedUser: true });
    assert.equal(done.state.status, "completed");
  });
});

test("approve grants every parked step in one revision; resume removes only the matching entry; settle is owner-only", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    let state = (await lifecycle.recordProgress(fence(started, { boundary: { action: "write", root: "docs" } }))).state;
    state = (await lifecycle.recordProgress(fence(state, { boundary: { action: "execute", root: "tools" } }))).state;
    const resumed = await lifecycle.resume({ schemaVersion: 3, requestId: "r-2", workId: state.workId, sessionID: "owner", expectedRevision: state.revision, trustedUser: true, grant: { action: "execute", root: "tools" } });
    assert.deepEqual(resumed.state.parkedBoundaries.map((entry) => path.basename(entry.root)), ["docs"]);
    assert.equal(resumed.state.status, "active");
    await assert.rejects(lifecycle.settleParked({ schemaVersion: 3, requestId: "x", workId: state.workId, sessionID: "intruder", trustedUser: true, verdict: "approve" }), LifecycleConflictError);
    await assert.rejects(lifecycle.settleParked({ schemaVersion: 3, requestId: "y", workId: "other-work", sessionID: "owner", trustedUser: true, verdict: "approve" }), LifecycleConflictError);
    state = (await lifecycle.recordProgress(fence(resumed.state, { boundary: { action: "read", root: "tools" } }))).state;
    const approved = await lifecycle.settleParked({ schemaVersion: 3, requestId: "a-1", workId: state.workId, sessionID: "owner", trustedUser: true, verdict: "approve" });
    assert.equal(approved.state.revision, state.revision + 1);
    assert.equal(approved.state.parkedBoundaries.length, 0);
    assert.equal(approved.settled.length, 2);
    assert.ok(approved.state.authority.grants.some((grant) => grant.action === "write" && grant.root.endsWith("docs")));
    assert.ok(approved.state.authority.grants.some((grant) => grant.action === "read" && grant.root.endsWith("tools")));
    assert.equal(approved.state.history.at(-1).type, "work.parked-approved");
  });
});

test("approve stops at 64 grants and leaves the rest parked", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const roots = [];
    for (let index = 0; index < 62; index += 1) {
      await fs.mkdir(path.join(dir, `g${index}`));
      roots.push({ action: "read", root: `g${index}` });
    }
    let state = (await lifecycle.init({ schemaVersion: 3, requestId: "init-big", sessionID: "owner", trustedUser: true, expectedRevision: 0, planPath: "PLAN.md", worktree: null, authorized: true, authority: [{ action: "write", root: "src" }, ...roots.slice(0, 31)] })).state;
    const extra = await lifecycle.settleParked({ schemaVersion: 3, requestId: "noop", workId: state.workId, sessionID: "owner", trustedUser: true, verdict: "approve" }).catch((error) => error);
    assert.ok(extra instanceof LifecycleConflictError, "nothing parked: nothing to settle");
    const approveAll = async (id) => lifecycle.settleParked({ schemaVersion: 3, requestId: id, workId: state.workId, sessionID: "owner", trustedUser: true, verdict: "approve" });
    for (const root of roots.slice(31, 47)) state = (await lifecycle.recordProgress(fence(state, { boundary: root }))).state;
    const firstBatch = await approveAll("a-big-1");
    assert.equal(firstBatch.state.authority.grants.length, 48);
    assert.equal(firstBatch.remaining.length, 0);
    state = firstBatch.state;
    for (const root of roots.slice(47)) state = (await lifecycle.recordProgress(fence(state, { boundary: root }))).state;
    await fs.mkdir(path.join(dir, "last-a"));
    await fs.mkdir(path.join(dir, "last-b"));
    state = (await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root: "last-a" } }))).state;
    state = (await approveAll("a-big-2")).state;
    assert.equal(state.authority.grants.length, 64);
    state = (await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root: "last-b" } }))).state;
    const capped = await approveAll("a-big-3");
    assert.equal(capped.state.authority.grants.length, 64);
    assert.equal(capped.remaining.length, 1);
    assert.equal(capped.state.parkedBoundaries.length, 1);
  });
});

test("harness reads need no boundary; protected, missing and symlinked roots get a refused note", async () => {
  await withProject(async (dir) => {
    const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
    const config = path.join(dir, "..", `cfg-${path.basename(dir)}`);
    process.env.XDG_CONFIG_HOME = config;
    try {
      await fs.mkdir(path.join(config, "opencode", "skills", "x"), { recursive: true });
      await fs.writeFile(path.join(dir, ".env"), "A=1\n");
      await fs.symlink(path.join(dir, "src"), path.join(dir, "linked"));
      const lifecycle = createBoundedAuthorityLifecycle(dir);
      let state = (await init(lifecycle)).state;
      const harness = await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root: path.join(config, "opencode", "skills", "x") } }));
      assert.equal(harness.outcome, "continued");
      assert.equal(harness.state.parkedBoundaries.length, 0);
      assert.equal(harness.state.authority.grants.length, 1, "no grant is written for a harness read");
      const writeHarness = await lifecycle.recordProgress(fence(harness.state, { boundary: { action: "write", root: path.join(config, "opencode", "skills", "x") } }));
      assert.equal(writeHarness.state.parkedBoundaries.length, 1, "only reads of harness folders pass");
      state = writeHarness.state;
      for (const [root, reason] of [[".env", /protected for this run/u], ["missing-folder", /path does not exist/u], ["linked", /symbolic link/u]]) {
        const result = await lifecycle.recordProgress(fence(state, { boundary: { action: "read", root } }));
        assert.equal(result.outcome, "continued", root);
        assert.equal(result.state.parkedBoundaries.length, 1, root);
        assert.match(result.continuation, reason, root);
        assert.match(result.continuation, /BLOCKED:/u, root);
        state = result.state;
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(config, { recursive: true, force: true });
    }
  });
});

test("a forbidden action name throws before any path is classified", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const state = (await init(lifecycle)).state;
    await fs.writeFile(path.join(dir, ".env"), "A=1\n");
    const before = createHash("sha256").update(await fs.readFile(createRuntimePaths(dir).lifecycleStateFile)).digest("hex");
    for (const boundary of [{ action: "push", root: ".env" }, { action: "publish", root: path.join(os.homedir(), ".config", "opencode", "skills") }, { action: "commit", root: "/does/not/exist" }]) {
      await assert.rejects(lifecycle.recordProgress(fence(state, { boundary })), LifecycleSafetyError, boundary.action);
    }
    assert.equal(createHash("sha256").update(await fs.readFile(createRuntimePaths(dir).lifecycleStateFile)).digest("hex"), before, "no progress, no note, no park");
  });
});

test("userCancel ends the run from any session, tells another owner once, and does nothing without a run", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const paths = createRuntimePaths(dir);
    const none = await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-0", sessionID: "anyone", trustedUser: true });
    assert.equal(none.outcome, "nothing");
    await assert.rejects(fs.stat(paths.lifecycleStateFile), "nothing is written without a run");
    const started = (await init(lifecycle)).state;
    const own = await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-1", sessionID: "owner", trustedUser: true });
    assert.equal(own.outcome, "applied");
    assert.equal(own.state.status, "cancelled");
    assert.equal(own.state.history.at(-1).type, "work.user-cancelled");
    assert.equal(await lifecycle.consumeCancelNotice("owner"), undefined, "the owner cancelled it, so no notice");
    const replay = await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-1", sessionID: "owner", trustedUser: true });
    assert.equal(replay.outcome, "replayed");
    const terminalBytes = await fs.readFile(paths.lifecycleStateFile, "utf8");
    assert.equal((await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-2", sessionID: "owner", trustedUser: true })).outcome, "nothing");
    assert.equal(await fs.readFile(paths.lifecycleStateFile, "utf8"), terminalBytes);
    const second = (await init(lifecycle, { requestId: "init-2", expectedRevision: own.state.revision })).state;
    const parked = await lifecycle.recordProgress(fence(second, { boundary: { action: "write", root: "docs" } }));
    const other = await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-3", sessionID: "second-window", trustedUser: true });
    assert.equal(other.state.status, "cancelled");
    assert.equal(other.state.parkedBoundaries.length, 0);
    assert.ok(other.state.revision > parked.state.revision);
    const notice = await lifecycle.consumeCancelNotice("owner");
    assert.equal(notice?.workId, second.workId);
    assert.match(notice?.plan ?? "", /PLAN\.md$/u);
    assert.equal(await lifecycle.consumeCancelNotice("owner"), undefined, "a notice is read once");
    void started;
  });
});

test("userCancel ends a legacy paused run", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir);
    const started = (await init(lifecycle)).state;
    const paths = createRuntimePaths(dir);
    const legacy = { ...started, revision: 2, status: "paused", pendingBoundary: { action: "execute", root: dir, id: "abc" } };
    delete legacy.parkedBoundaries;
    delete legacy.deniedBoundaries;
    await fs.writeFile(paths.lifecycleStateFile, JSON.stringify(legacy));
    await fs.rm(paths.lifecycleEventsFile);
    const result = await lifecycle.userCancel({ schemaVersion: 3, requestId: "uc-legacy", sessionID: "owner", trustedUser: true });
    assert.equal(result.state.status, "cancelled");
  });
});

test("the runtime paths name the cancel notice file next to the lifecycle state", () => {
  const paths = createRuntimePaths("/tmp/project");
  assert.equal(paths.cancelNoticesFile, path.join("/tmp/project", ".litopencode", "litgoal", "lit-loop", "cancel-notices.json"));
});
