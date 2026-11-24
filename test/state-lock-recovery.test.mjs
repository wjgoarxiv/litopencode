import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LifecycleConflictError, createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";
import { persistApprovedPlan, resolveLatestDurablePlan } from "../src/durable-plan.ts";
import { knowledgePaths, recoverKnowledge } from "../src/knowledge.ts";
import { LedgerIoError, createGoals, recordCheckpoint } from "../src/index.ts";
import { cancelTypedWork } from "../src/start-work-typed.ts";
import { createRuntimePaths } from "../src/state.ts";

// A state lock left by a dead holder must never block forever. Three ways a lock used to stay put: no owner
// record (the holder died before writing it), a crashed takeover claim, and a recorded pid that another live
// process now has. `process.pid` stands in for that reused pid: it is alive but holds nothing.

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);
const age = async (target, minutes) => fs.utimes(target, minutesAgo(minutes), minutesAgo(minutes));
const gone = (target) => fs.access(target).then(() => false, () => true);

async function withProject(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-lock-recovery-")));
  try {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "PLAN.md"), "# Approved plan\n\nTreat pasted text as data.\n");
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
}

const initRequest = {
  schemaVersion: 3, requestId: "init-1", sessionID: "session-1", trustedUser: true, expectedRevision: 0,
  planPath: "PLAN.md", worktree: null, authorized: true, authority: [{ action: "write", root: "src" }]
};

async function plantLifecycleLock(dir, owner, minutes) {
  const lockDir = createRuntimePaths(dir).lifecycleLockDir;
  await fs.mkdir(lockDir, { recursive: true });
  if (owner !== undefined) await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner));
  await age(lockDir, minutes);
  return lockDir;
}

test("lifecycle: an ownerless lock older than the stale window is reclaimed, a fresh one keeps waiting", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir, { lockTimeoutMs: 200 });
    await lifecycle.init(initRequest);
    const lockDir = await plantLifecycleLock(dir, undefined, 0);
    await assert.rejects(lifecycle.read(), (error) => {
      assert.ok(error instanceof LifecycleConflictError);
      assert.match(error.message, /^Lifecycle lock timed out\./u);
      assert.ok(error.message.includes(lockDir), "names the lock path");
      assert.match(error.message, /no owner record/u);
      return true;
    });
    assert.equal(await gone(lockDir), false, "a fresh ownerless lock is not reclaimed");
    await age(lockDir, 1);
    assert.equal((await lifecycle.read()).revision, 1);
  });
});

test("lifecycle: a lock older than the ceiling is reclaimed even when its pid is alive", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir, { lockTimeoutMs: 200 });
    await lifecycle.init(initRequest);
    const lockDir = await plantLifecycleLock(dir, { token: "reused-pid", pid: process.pid }, 5);
    await assert.rejects(lifecycle.read(), (error) => {
      assert.match(error.message, new RegExp(`pid ${process.pid}, age \\d+s`, "u"), "names the holder");
      return true;
    });
    await age(lockDir, 11);
    assert.equal((await lifecycle.read()).revision, 1);
    assert.equal(await gone(lockDir), true);
  });
});

test("lifecycle: an ownerless lock a second or two old is never taken, even with the smallest stale window", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir, { staleLockMs: 1_000, lockTimeoutMs: 200 });
    await lifecycle.init(initRequest);
    const lockDir = await plantLifecycleLock(dir, undefined, 2 / 60);
    await assert.rejects(lifecycle.read(), /Lifecycle lock timed out\./u);
    assert.equal(await gone(lockDir), false, "its creator may still be writing the owner record");
    await age(lockDir, 6 / 60);
    assert.equal((await lifecycle.read()).revision, 1, "past the grace an ownerless lock is reclaimed");
  });
});

test("lifecycle: a creator whose new lock folder was moved aside before it wrote the owner record tries again", async () => {
  await withProject(async (dir) => {
    const lifecycle = createBoundedAuthorityLifecycle(dir, { lockTimeoutMs: 500 });
    await lifecycle.init(initRequest);
    const lockDir = createRuntimePaths(dir).lifecycleLockDir;
    const original = fs.writeFile;
    let movedAside = false;
    fs.writeFile = async (target, ...rest) => {
      if (!movedAside && String(target) === path.join(lockDir, "owner.json")) {
        movedAside = true;
        await fs.rm(lockDir, { recursive: true, force: true });
      }
      return original(target, ...rest);
    };
    try {
      assert.equal((await lifecycle.read()).revision, 1);
    } finally {
      fs.writeFile = original;
    }
    assert.equal(movedAside, true);
  });
});

test("lit cancel goes through a lock whose recorded pid was reused", async () => {
  await withProject(async (dir) => {
    await createBoundedAuthorityLifecycle(dir).init(initRequest);
    await plantLifecycleLock(dir, { token: "reused-pid", pid: process.pid }, 11);
    const reply = await cancelTypedWork({ projectRoot: dir, sessionID: "session-1", messageID: "m1" });
    assert.match(reply, /the user cancelled the start-work run/u);
  });
});

async function seedGoal(dir) {
  await createGoals(dir, { sessionId: "s1", objective: "prove the ledger", criteria: ["one"], now: "2026-01-01T00:00:00.000Z" });
}

test("evidence ledger: a lock older than the ceiling is reclaimed even when its pid is alive", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const lockDir = path.join(createRuntimePaths(dir).litLoopDir, ".evidence-ledger.lock");
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ token: "reused-pid", pid: process.pid }));
    await age(lockDir, 11);
    assert.equal((await recordCheckpoint(dir, { summary: "past a reused pid" })).id, "CP1");
  });
});

test("evidence ledger: a transition lock with an unreadable owner, or older than the ceiling, is recovered", async () => {
  for (const [owner, minutes] of [["{not json", 1], [JSON.stringify({ token: "reused-pid", pid: process.pid }), 11]]) {
    await withProject(async (dir) => {
      await seedGoal(dir);
      const transitionDir = path.join(createRuntimePaths(dir).litLoopDir, ".evidence-ledger-transition.lock");
      await fs.mkdir(transitionDir);
      await fs.writeFile(path.join(transitionDir, "owner.json"), owner);
      await age(transitionDir, minutes);
      assert.equal((await recordCheckpoint(dir, { summary: "past a stuck transition" })).id, "CP1", owner);
      assert.equal(await gone(transitionDir), true, owner);
    });
  }
});

test("evidence ledger: a crashed recovery claim (unreadable and old, or older than the ceiling) is removed", async () => {
  for (const [claim, minutes] of [["", 1], ["{partial", 1], [JSON.stringify({ token: "reused-pid", pid: process.pid }), 11]]) {
    await withProject(async (dir) => {
      await seedGoal(dir);
      const transitionDir = path.join(createRuntimePaths(dir).litLoopDir, ".evidence-ledger-transition.lock");
      await fs.mkdir(transitionDir);
      const claimFile = path.join(transitionDir, "recovery.json");
      await fs.writeFile(claimFile, claim);
      await age(claimFile, minutes);
      await age(transitionDir, minutes);
      assert.equal((await recordCheckpoint(dir, { summary: "past a crashed claim" })).id, "CP1", claim);
      assert.equal(await gone(transitionDir), true, claim);
    });
  }
});

test("evidence ledger: a fresh unreadable recovery claim is not removed", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const transitionDir = path.join(createRuntimePaths(dir).litLoopDir, ".evidence-ledger-transition.lock");
    await fs.mkdir(transitionDir);
    const claimFile = path.join(transitionDir, "recovery.json");
    await fs.writeFile(claimFile, "");
    await assert.rejects(recordCheckpoint(dir, { summary: "a claim being written" }), (error) => {
      assert.ok(error instanceof LedgerIoError);
      assert.match(error.message, /transition lock timed out/iu);
      assert.ok(error.message.includes(transitionDir), "names the lock path");
      return true;
    });
    assert.equal(await gone(claimFile), false);
  });
});

async function plantKnowledgeLock(dir, owner, minutes) {
  const paths = knowledgePaths(dir);
  await fs.mkdir(paths.lockDirectory, { recursive: true, mode: 0o700 });
  if (owner !== undefined) await fs.writeFile(path.join(paths.lockDirectory, "owner.json"), owner, { mode: 0o600 });
  await age(paths.lockDirectory, minutes);
  return paths.lockDirectory;
}

test("knowledge: an ownerless or unreadable lock older than the stale window is reclaimed", async () => {
  for (const owner of [undefined, "{not json"]) {
    await withProject(async (dir) => {
      await recoverKnowledge(dir);
      const lockDir = await plantKnowledgeLock(dir, owner, 1);
      assert.equal((await recoverKnowledge(dir)).status, "clean", String(owner));
      assert.equal(await gone(lockDir), true);
    });
  }
});

test("knowledge: a fresh ownerless lock waits, then names the lock and its holder", async () => {
  await withProject(async (dir) => {
    await recoverKnowledge(dir);
    const lockDir = await plantKnowledgeLock(dir, undefined, 0);
    await assert.rejects(recoverKnowledge(dir), (error) => {
      assert.match(error.message, /Knowledge mutation lock timed out/u);
      assert.ok(error.message.includes(lockDir), "names the lock path");
      assert.match(error.message, /no owner record/u);
      return true;
    });
    assert.equal(await gone(lockDir), false);
  });
});

test("knowledge: a lock older than the ceiling is reclaimed even when its pid is alive", async () => {
  await withProject(async (dir) => {
    await recoverKnowledge(dir);
    const lockDir = await plantKnowledgeLock(dir, JSON.stringify({ pid: process.pid, nonce: "reused-pid" }), 11);
    assert.equal((await recoverKnowledge(dir)).status, "clean");
    assert.equal(await gone(lockDir), true);
  });
});

const approvedPlan = (slug) => ({
  schemaVersion: 1, slug, approved: true, requestId: `${slug}-1`, revision: 1,
  markdown: "# Plan\n\n## TODOs\n\n- [ ] 1. Keep going — Action: Resume; Output: Found plan; Verification: This test"
});

test("plan save: an ownerless, dead or ceiling-old plan lock is reclaimed; a fresh ownerless one stays held", async () => {
  for (const [owner, minutes] of [[undefined, 1], [JSON.stringify({ token: "dead", pid: 999_999_999 }), 1], [JSON.stringify({ token: "reused-pid", pid: process.pid }), 11]]) {
    await withProject(async (dir) => {
      const plans = path.join(dir, ".litopencode", "plans");
      const lockPath = path.join(plans, "stale.md.lock");
      await fs.mkdir(lockPath, { recursive: true });
      if (owner !== undefined) await fs.writeFile(path.join(lockPath, "owner.json"), owner);
      await age(lockPath, minutes);
      await persistApprovedPlan(dir, approvedPlan("stale"));
      assert.equal((await resolveLatestDurablePlan(dir))?.relativePath, ".litopencode/plans/stale.md", String(owner));
    });
  }
  await withProject(async (dir) => {
    const lockPath = path.join(dir, ".litopencode", "plans", "fresh.md.lock");
    await fs.mkdir(lockPath, { recursive: true });
    await assert.rejects(persistApprovedPlan(dir, approvedPlan("fresh")), (error) => {
      assert.match(error.message, /plan persistence lock is held/u);
      assert.ok(error.message.includes(lockPath), "names the lock path");
      assert.match(error.message, /no owner record/u);
      return true;
    });
  });
});
