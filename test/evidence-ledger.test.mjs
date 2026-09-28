import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";
import {
  completeGoals,
  countRecordedEvidence,
  createGoals,
  criterionStatuses,
  evaluateGoalGate,
  evidenceKinds,
  EvidenceLedgerError,
  goalStatuses,
  LedgerIoError,
  readEvidenceLedger,
  readEvidenceLedgerStatus,
  renderEvidenceBrief,
  recordCheckpoint,
  recordEvidence,
  recordReviewBlocker,
  recordSteering,
  steeringWeakeningReason
} from "../src/index.ts";
import { createRuntimePaths } from "../src/state.ts";

async function withProject(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-evidence-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function seedGoal(dir, sessionId = "s1") {
  return await createGoals(dir, {
    sessionId,
    objective: "prove the ledger",
    criteria: ["the CLI writes goals.json", "a retry keeps prior evidence"],
    now: "2026-01-01T00:00:00.000Z"
  });
}

test("evidence ledger publishes the status, kind, and steering vocabularies", () => {
  assert.deepEqual([...criterionStatuses], ["pending", "in_progress", "blocked", "pass", "fail"]);
  assert.deepEqual([...evidenceKinds], ["red", "green", "scenario", "cleanup", "note"]);
  // review_blocked and needs_user_decision are the two the plan requires to be distinguishable.
  assert.ok(goalStatuses.includes("review_blocked"));
  assert.ok(goalStatuses.includes("needs_user_decision"));
});

test("create-goals writes goals.json, brief.md, and an audit line the recap path can read", async () => {
  await withProject(async (dir) => {
    const goal = await seedGoal(dir);
    const paths = createRuntimePaths(dir);

    // The four sources skills/lit-recap/SKILL.md names must all exist once a goal is opened.
    for (const file of [paths.goalsFile, paths.briefFile, paths.ledgerFile, paths.evidenceDir]) {
      assert.ok(await fs.stat(file), `${file} should exist`);
    }
    assert.equal(goal.id, "G1");
    assert.equal(goal.status, "active");
    assert.equal(goal.criteria.length, 2);
    assert.match(await fs.readFile(paths.briefFile, "utf8"), /prove the ledger/);
    assert.match(await fs.readFile(paths.ledgerFile, "utf8"), /"type":"goal\.created"/);
  });
});

test("status reads legacy root-shaped goals without rewriting their files", async () => {
  await withProject(async (dir) => {
    const paths = createRuntimePaths(dir);
    await fs.mkdir(paths.litLoopDir, { recursive: true });
    const legacyState = {
      goals: [
        {
          id: "legacy-blocked",
          status: "blocked",
          criteria: [{ id: "legacy-failure", status: "failed", evidence: "old failure receipt" }]
        },
        {
          id: "legacy-complete",
          status: "completed",
          criteria: [{ id: "legacy-pass", status: "passed", evidence: "old pass receipt" }]
        }
      ]
    };
    await fs.writeFile(paths.goalsFile, `${JSON.stringify(legacyState, null, 2)}\n`, "utf8");
    await fs.writeFile(paths.briefFile, "legacy brief\n", "utf8");
    await fs.writeFile(paths.ledgerFile, '{"type":"legacy.event"}\n', "utf8");
    const before = await Promise.all(
      [paths.goalsFile, paths.briefFile, paths.ledgerFile].map((file) => fs.readFile(file, "utf8"))
    );

    const result = await runCli(["status", "--project", dir, "--json"]);

    assert.equal(result.exitCode, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.goals[0].criteria[0].status, "fail");
    assert.deepEqual(status.goals[0].criteria[0].evidence, [
      { kind: "note", ref: "old failure receipt", detail: "", at: "" }
    ]);
    assert.equal(status.goals[1].status, "complete");
    assert.equal(status.goals[1].criteria[0].status, "pass");
    const after = await Promise.all(
      [paths.goalsFile, paths.briefFile, paths.ledgerFile].map((file) => fs.readFile(file, "utf8"))
    );
    assert.deepEqual(after, before);
  });
});

test("retrying a criterion appends evidence and never overwrites a prior entry", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    await recordEvidence(dir, { criterionId: "C1", kind: "red", ref: "run-1", status: "fail" });
    await recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "attempt-1", detail: "did not hold" });
    const criterion = await recordEvidence(dir, { criterionId: "C1", kind: "green", ref: "run-2", status: "pass" });

    assert.deepEqual(criterion.evidence.map((entry) => entry.kind), ["red", "note", "green"]);
    assert.deepEqual(criterion.evidence.map((entry) => entry.ref), ["run-1", "attempt-1", "run-2"]);
    assert.equal(criterion.status, "pass");
    // The failing attempt survives the successful retry.
    assert.ok(criterion.evidence.some((entry) => entry.ref === "attempt-1"));
  });
});

test("lock publication atomically renames only generations with complete owner metadata", async () => {
  await withProject(async (dir) => {
    const originalRename = fs.rename;
    const published = new Set();
    fs.rename = async (source, destination) => {
      const name = path.basename(String(destination));
      if (name === ".evidence-ledger.lock" || name === ".evidence-ledger-transition.lock") {
        const owner = JSON.parse(await fs.readFile(path.join(String(source), "owner.json"), "utf8"));
        assert.equal(typeof owner.token, "string");
        assert.ok(owner.token.length > 0);
        assert.equal(owner.pid, process.pid);
        published.add(name);
      }
      return originalRename(source, destination);
    };

    try {
      await seedGoal(dir);
    } finally {
      fs.rename = originalRename;
    }

    assert.deepEqual(
      published,
      new Set([".evidence-ledger-transition.lock", ".evidence-ledger.lock"])
    );
  });
});

test("stale takeover serializes two contenders without admitting a second live owner", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const lockDir = path.join(paths.litLoopDir, ".evidence-ledger.lock");
    const ownerFile = path.join(lockDir, "owner.json");
    await fs.mkdir(lockDir);
    await fs.writeFile(ownerFile, JSON.stringify({ token: "dead", pid: 999_999_999 }));
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, stale, stale);

    const originalRename = fs.rename;
    const originalWriteFile = fs.writeFile;
    const takeoverPaused = deferred();
    const resumeTakeover = deferred();
    const secondMutationEntered = deferred();
    let paused = false;
    fs.rename = async (source, destination) => {
      if (!paused && String(source) === lockDir && String(destination).includes(".abandoned-")) {
        paused = true;
        takeoverPaused.resolve();
        await resumeTakeover.promise;
      }
      return originalRename(source, destination);
    };
    fs.writeFile = async (...args) => {
      if (String(args[0]).includes("evidence-transaction.json.tmp-") && String(args[1]).includes("contender-b")) {
        secondMutationEntered.resolve();
      }
      return originalWriteFile(...args);
    };

    let first;
    let second;
    try {
      first = recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "contender-a" });
      await takeoverPaused.promise;
      second = recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "contender-b" });

      const enteredWhileTakeoverPaused = await Promise.race([
        secondMutationEntered.promise.then(() => true),
        delay(150).then(() => false)
      ]);
      assert.equal(enteredWhileTakeoverPaused, false, "the transition owner must exclude a second live lock owner");

      resumeTakeover.resolve();
      await Promise.all([first, second]);
      const state = await readEvidenceLedger(dir);
      assert.deepEqual(
        new Set(state.goals[0].criteria[0].evidence.map((entry) => entry.ref)),
        new Set(["contender-a", "contender-b"])
      );
      await assert.rejects(fs.access(lockDir), { code: "ENOENT" });
    } finally {
      resumeTakeover.resolve();
      await Promise.allSettled([first, second].filter(Boolean));
      fs.rename = originalRename;
      fs.writeFile = originalWriteFile;
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });
});

test("the next mutation recovers an interrupted state-and-audit transaction exactly once", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const state = await readEvidenceLedger(dir);
    const recoveredEntry = { kind: "note", ref: "recovered-evidence", detail: "", at: "2026-01-01T00:00:01.000Z" };
    const recoveredCriterion = {
      ...state.goals[0].criteria[0],
      evidence: [...state.goals[0].criteria[0].evidence, recoveredEntry]
    };
    const recoveredGoal = {
      ...state.goals[0],
      criteria: state.goals[0].criteria.map((criterion) => criterion.id === recoveredCriterion.id ? recoveredCriterion : criterion)
    };
    const recoveredState = {
      ...state,
      updatedAt: recoveredEntry.at,
      goals: state.goals.map((goal) => goal.id === recoveredGoal.id ? recoveredGoal : goal)
    };
    await fs.writeFile(path.join(paths.litLoopDir, "evidence-transaction.json"), JSON.stringify({
      version: 1,
      mutationId: "interrupted-mutation",
      state: recoveredState,
      event: {
        type: "evidence.recorded",
        goalId: "G1",
        criterionId: "C1",
        evidenceKind: "note",
        ref: recoveredEntry.ref,
        criterionStatus: "pending",
        timestamp: recoveredEntry.at
      }
    }, null, 2));

    await recordCheckpoint(dir, { summary: "continues after recovery" });

    const after = await readEvidenceLedger(dir);
    assert.equal(after.goals[0].criteria[0].evidence.some((entry) => entry.ref === recoveredEntry.ref), true);
    assert.equal(after.goals[0].checkpoints.length, 1);
    const events = (await fs.readFile(paths.ledgerFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.mutationId === "interrupted-mutation").length, 1);
    await assert.rejects(fs.access(path.join(paths.litLoopDir, "evidence-transaction.json")), { code: "ENOENT" });
  });
});

test("status refuses every pending transaction crash point without writing and the next mutation recovers", async () => {
  for (const crashPoint of ["journal-only", "state-written", "audit-written"]) {
    await withProject(async (dir) => {
      await seedGoal(dir);
      const paths = createRuntimePaths(dir);
      const state = await readEvidenceLedger(dir);
      const recoveredEntry = { kind: "note", ref: `recovered-${crashPoint}`, detail: "", at: "2026-01-01T00:00:01.000Z" };
      const recoveredCriterion = {
        ...state.goals[0].criteria[0],
        evidence: [...state.goals[0].criteria[0].evidence, recoveredEntry]
      };
      const recoveredGoal = {
        ...state.goals[0],
        criteria: state.goals[0].criteria.map((criterion) => criterion.id === recoveredCriterion.id ? recoveredCriterion : criterion)
      };
      const recoveredState = {
        ...state,
        updatedAt: recoveredEntry.at,
        goals: state.goals.map((goal) => goal.id === recoveredGoal.id ? recoveredGoal : goal)
      };
      const mutationId = `crash-${crashPoint}`;
      const event = {
        type: "evidence.recorded",
        goalId: "G1",
        criterionId: "C1",
        evidenceKind: "note",
        ref: recoveredEntry.ref,
        criterionStatus: "pending",
        timestamp: recoveredEntry.at
      };
      if (crashPoint !== "journal-only") {
        await fs.writeFile(paths.goalsFile, `${JSON.stringify(recoveredState, null, 2)}\n`, "utf8");
        await fs.writeFile(paths.briefFile, renderEvidenceBrief(recoveredState), "utf8");
      }
      if (crashPoint === "audit-written") {
        await fs.appendFile(paths.ledgerFile, `${JSON.stringify({ ...event, mutationId })}\n`, "utf8");
      }
      const transactionFile = path.join(paths.litLoopDir, "evidence-transaction.json");
      await fs.writeFile(transactionFile, `${JSON.stringify({
        version: 1,
        mutationId,
        state: recoveredState,
        event
      }, null, 2)}\n`, "utf8");
      const files = [paths.goalsFile, paths.briefFile, paths.ledgerFile, transactionFile];
      const before = await Promise.all(files.map((file) => fs.readFile(file, "utf8")));

      const status = await runCli(["status", "--project", dir, "--json"]);

      assert.equal(status.exitCode, 3, `${crashPoint}: status must fail closed`);
      assert.match(status.stderr, /REFUSED \(recovery_required\).*next mutation/i);
      assert.deepEqual(await Promise.all(files.map((file) => fs.readFile(file, "utf8"))), before);

      await recordCheckpoint(dir, { summary: `recover ${crashPoint}` });
      const after = await readEvidenceLedger(dir);
      assert.equal(after.goals[0].criteria[0].evidence.some((entry) => entry.ref === recoveredEntry.ref), true);
      const events = (await fs.readFile(paths.ledgerFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(events.filter((entry) => entry.mutationId === mutationId).length, 1);
      await assert.rejects(fs.access(transactionFile), { code: "ENOENT" });
    });
  }
});

test("evidence mutation lock recovers a stale dead owner and times out on a live owner", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const lockDir = path.join(paths.litLoopDir, ".evidence-ledger.lock");
    const ownerFile = path.join(lockDir, "owner.json");
    await fs.mkdir(lockDir);
    await fs.writeFile(ownerFile, JSON.stringify({ token: "dead", pid: 999_999_999 }));
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, stale, stale);

    const checkpoint = await recordCheckpoint(dir, { summary: "stale lock recovered" });
    assert.equal(checkpoint.id, "CP1");
    await assert.rejects(fs.access(lockDir), { code: "ENOENT" });

    await fs.mkdir(lockDir);
    await fs.writeFile(ownerFile, JSON.stringify({ token: "live", pid: process.pid }));
    try {
      await assert.rejects(
        recordCheckpoint(dir, { summary: "must time out" }),
        (error) => error instanceof LedgerIoError && /timed out/i.test(error.message)
      );
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });
});

test("a symlink lock owner cannot authorize stale evidence-lock takeover", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const lockDir = path.join(paths.litLoopDir, ".evidence-ledger.lock");
    const ownerFile = path.join(lockDir, "owner.json");
    const externalOwner = path.join(dir, "external-owner.json");
    await fs.writeFile(externalOwner, JSON.stringify({ token: "dead", pid: 999_999_999 }));
    await fs.mkdir(lockDir);
    await fs.symlink(externalOwner, ownerFile);
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, stale, stale);

    await assert.rejects(
      recordCheckpoint(dir, { summary: "must reject unsafe lock metadata" }),
      (error) => error instanceof LedgerIoError && /unsafe/i.test(error.message)
    );
    assert.equal((await fs.lstat(ownerFile)).isSymbolicLink(), true);
  });
});

test("transition mutex recovers proven-dead and ownerless crash generations", async () => {
  for (const ownerKind of ["dead", "ownerless"]) {
    await withProject(async (dir) => {
      await seedGoal(dir);
      const paths = createRuntimePaths(dir);
      const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
      const ownerFile = path.join(transitionDir, "owner.json");
      await fs.mkdir(transitionDir);
      if (ownerKind === "dead") {
        await fs.writeFile(ownerFile, JSON.stringify({ token: "dead-transition", pid: 999_999_999 }));
      }

      const checkpoint = await recordCheckpoint(dir, { summary: `recover ${ownerKind} transition` });

      assert.equal(checkpoint.id, "CP1");
      await assert.rejects(fs.access(transitionDir), { code: "ENOENT" });
    });
  }
});

test("transition recovery resumes after its published recovery claim owner crashes", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
    await fs.mkdir(transitionDir);
    await fs.writeFile(
      path.join(transitionDir, "recovery.json"),
      JSON.stringify({ token: "orphaned-recovery", pid: 999_999_999 })
    );

    const checkpoint = await recordCheckpoint(dir, { summary: "recover orphaned recovery claim" });

    assert.equal(checkpoint.id, "CP1");
    await assert.rejects(fs.access(transitionDir), { code: "ENOENT" });
  });
});

test("two contenders recover one orphaned recovery claim and retain both writes", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
    await fs.mkdir(transitionDir);
    await fs.writeFile(
      path.join(transitionDir, "recovery.json"),
      JSON.stringify({ token: "orphaned-recovery", pid: 999_999_999 })
    );

    await Promise.all([
      recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "orphan-a" }),
      recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "orphan-b" })
    ]);

    const state = await readEvidenceLedger(dir);
    assert.deepEqual(
      new Set(state.goals[0].criteria[0].evidence.map((entry) => entry.ref)),
      new Set(["orphan-a", "orphan-b"])
    );
    await assert.rejects(fs.access(transitionDir), { code: "ENOENT" });
  });
});

test("stale recovery cannot age-evict or remove a newer paused live recovery-claim generation", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
    const recoveryFile = path.join(transitionDir, "recovery.json");
    await fs.mkdir(transitionDir);
    await fs.writeFile(recoveryFile, JSON.stringify({ token: "orphaned-recovery", pid: 999_999_999 }));

    const originalRename = fs.rename;
    const recoveryRetirePaused = deferred();
    const resumeRecoveryRetire = deferred();
    let paused = false;
    fs.rename = async (source, destination) => {
      if (!paused && String(source) === recoveryFile) {
        paused = true;
        recoveryRetirePaused.resolve();
        await resumeRecoveryRetire.promise;
      }
      return originalRename(source, destination);
    };

    const liveClaim = { token: "newer-live-recovery", pid: process.pid };
    let mutation;
    try {
      mutation = recordCheckpoint(dir, { summary: "stale recovery must stand down" });
      const reachedRetire = await Promise.race([
        recoveryRetirePaused.promise.then(() => true),
        delay(250).then(() => false)
      ]);
      assert.equal(reachedRetire, true, "the dead recovery claim should enter generation-fenced retirement");

      await fs.rm(recoveryFile);
      await fs.writeFile(recoveryFile, JSON.stringify(liveClaim));
      const old = new Date(Date.now() - 3_600_000);
      await fs.utimes(recoveryFile, old, old);
      await fs.utimes(transitionDir, old, old);
      resumeRecoveryRetire.resolve();

      await assert.rejects(
        mutation,
        (error) => error instanceof LedgerIoError && /transition lock timed out/i.test(error.message)
      );
      assert.deepEqual(JSON.parse(await fs.readFile(recoveryFile, "utf8")), liveClaim);
    } finally {
      resumeRecoveryRetire.resolve();
      await Promise.allSettled([mutation].filter(Boolean));
      fs.rename = originalRename;
      await fs.rm(transitionDir, { recursive: true, force: true });
    }
  });
});

test("two transition-recovery contenders serialize and retain both writes", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
    await fs.mkdir(transitionDir);
    await fs.writeFile(
      path.join(transitionDir, "owner.json"),
      JSON.stringify({ token: "dead-transition", pid: 999_999_999 })
    );

    await Promise.all([
      recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "recovery-a" }),
      recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "recovery-b" })
    ]);

    const state = await readEvidenceLedger(dir);
    assert.deepEqual(
      new Set(state.goals[0].criteria[0].evidence.map((entry) => entry.ref)),
      new Set(["recovery-a", "recovery-b"])
    );
    await assert.rejects(fs.access(transitionDir), { code: "ENOENT" });
  });
});

test("a paused live transition owner is never age-evicted and remains after timeout", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const paths = createRuntimePaths(dir);
    const transitionDir = path.join(paths.litLoopDir, ".evidence-ledger-transition.lock");
    const ownerFile = path.join(transitionDir, "owner.json");
    await fs.mkdir(transitionDir);
    await fs.writeFile(ownerFile, JSON.stringify({ token: "paused-live", pid: process.pid }));
    const old = new Date(Date.now() - 3_600_000);
    await fs.utimes(transitionDir, old, old);

    await assert.rejects(
      recordCheckpoint(dir, { summary: "must not evict paused live transition" }),
      (error) => error instanceof LedgerIoError && /transition lock timed out/i.test(error.message)
    );
    assert.deepEqual(JSON.parse(await fs.readFile(ownerFile, "utf8")), { token: "paused-live", pid: process.pid });
  });
});

test("a fresh session opens new state beside the old and re-running one refuses without --force", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir, "session-a");
    await recordEvidence(dir, { criterionId: "C1", kind: "green", ref: "proof" });

    await assert.rejects(
      () => createGoals(dir, { sessionId: "session-a", objective: "restart" }),
      /evidence/i,
      "re-running a session with recorded evidence must refuse"
    );

    // A fresh session id opens new state; the prior goal and its evidence are untouched.
    const second = await createGoals(dir, { sessionId: "session-b", objective: "second" });
    const state = await readEvidenceLedger(dir);
    assert.equal(second.id, "G2");
    assert.equal(state.goals.length, 2);
    assert.equal(countRecordedEvidence(state.goals[0]), 1);

    // --force is the deliberate overwrite, and it is the only path that discards evidence.
    const forced = await createGoals(dir, { sessionId: "session-a", objective: "restart", force: true });
    assert.equal(forced.id, "G1");
    assert.equal(countRecordedEvidence(forced), 0);
  });
});

test("a review-blocked goal is distinguishable from an active one by status alone", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const before = await readEvidenceLedgerStatus(dir);
    assert.equal(before.goals[0].status, "active");

    await recordReviewBlocker(dir, { detail: "reviewer wants more" });
    const blocked = await readEvidenceLedgerStatus(dir);
    assert.equal(blocked.goals[0].status, "review_blocked");

    await recordReviewBlocker(dir, { detail: "user must choose", needsUserDecision: true });
    const decision = await readEvidenceLedgerStatus(dir);
    assert.equal(decision.goals[0].status, "needs_user_decision");
  });
});

test("steering may redirect a goal but never weaken the completion gate", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const steering = await recordSteering(dir, { directive: "cover the retry case too", kind: "add_criterion" });
    assert.equal(steering.kind, "add_criterion");

    for (const directive of [
      "just skip the tests",
      "mark it as done",
      "auto-complete this goal",
      "ignore the failures",
      "bypass the review"
    ]) {
      assert.ok(steeringWeakeningReason(directive), `${directive} should be recognised as weakening`);
      await assert.rejects(() => recordSteering(dir, { directive }), /weaken the completion gate/);
    }
  });
});

test("add_criterion extends the completion gate and complete goals reject every mutating verb", async () => {
  await withProject(async (dir) => {
    await seedGoal(dir);
    const steering = await recordSteering(dir, { directive: "a newly discovered scenario must pass", kind: "add_criterion" });
    const extended = await readEvidenceLedger(dir);
    const added = extended.goals[0].criteria[2];
    assert.ok(added, "add_criterion should append a real criterion");
    assert.equal(added.id, "C3");
    assert.equal(added.scenario, "a newly discovered scenario must pass");
    assert.equal(added.status, "pending");
    assert.deepEqual(added.evidence, []);
    assert.equal(steering.criterionId, "C3");

    for (const criterionId of ["C1", "C2"]) {
      await recordEvidence(dir, { criterionId, kind: "green", ref: "focused test" });
      await recordEvidence(dir, { criterionId, kind: "scenario", ref: "real surface", status: "pass" });
    }
    const held = await completeGoals(dir);
    assert.equal(held.completed, false);
    assert.ok(held.reasons.some((reason) => reason.includes("C3")));

    await recordEvidence(dir, { criterionId: "C3", kind: "green", ref: "added test" });
    await recordEvidence(dir, { criterionId: "C3", kind: "scenario", ref: "added real surface", status: "pass" });
    assert.equal((await completeGoals(dir)).completed, true);

    const { resolveReviewBlocker } = await import("../src/ledger.ts");
    const mutations = [
      () => recordEvidence(dir, { criterionId: "C1", kind: "note", ref: "reopen" }),
      () => recordCheckpoint(dir, { summary: "reopen" }),
      () => recordSteering(dir, { directive: "reopen", kind: "redirect" }),
      () => recordReviewBlocker(dir, { detail: "reopen" }),
      () => resolveReviewBlocker(dir, { blockerId: "B1" }),
      () => completeGoals(dir),
      () => createGoals(dir, { sessionId: "s1", objective: "reopen", force: true })
    ];
    for (const mutate of mutations) {
      await assert.rejects(
        mutate,
        (error) => error instanceof EvidenceLedgerError && error.code === "goal_already_complete"
      );
    }

    const fresh = await createGoals(dir, { sessionId: "s2", objective: "new goal", criteria: ["new criterion"] });
    const finalState = await readEvidenceLedger(dir);
    assert.equal(fresh.id, "G2");
    assert.equal(finalState.goals.find((goal) => goal.id === "G1").status, "complete");
    assert.equal(finalState.goals.find((goal) => goal.id === "G2").status, "active");
  });
});

test("the completion gate requires pass plus green plus scenario on every criterion", async () => {
  await withProject(async (dir) => {
    const goal = await seedGoal(dir);
    assert.equal(evaluateGoalGate(goal).passed, false);

    const refused = await completeGoals(dir);
    assert.equal(refused.completed, false);
    assert.ok(refused.reasons.length > 0);

    for (const criterionId of ["C1", "C2"]) {
      await recordEvidence(dir, { criterionId, kind: "green", ref: "npm test" });
      await recordEvidence(dir, { criterionId, kind: "scenario", ref: "real surface", status: "pass" });
    }
    await recordCheckpoint(dir, { summary: "both proven", activeCriterion: "C2" });

    // An open blocker still holds the gate shut even when every criterion passes.
    await recordReviewBlocker(dir, { detail: "one more look" });
    assert.equal((await completeGoals(dir)).completed, false);

    const { resolveReviewBlocker } = await import("../src/ledger.ts");
    await resolveReviewBlocker(dir, { blockerId: "B1" });
    const completed = await completeGoals(dir);
    assert.equal(completed.completed, true);
    assert.equal((await readEvidenceLedgerStatus(dir)).goals[0].status, "complete");
  });
});

test("every loop verb is reachable through the real CLI with distinct exit codes", async () => {
  await withProject(async (dir) => {
    const cli = (...argv) => runCli([...argv, "--project", dir]);

    assert.equal((await cli("create-goals", "--session-id", "s1", "--objective", "o", "--criterion", "c")).exitCode, 0);
    assert.equal((await cli("status")).exitCode, 0);
    assert.equal((await cli("record-evidence", "--criterion-id", "C1", "--kind", "green", "--ref", "r")).exitCode, 0);
    assert.equal((await cli("checkpoint", "--summary", "s")).exitCode, 0);
    assert.equal((await cli("steer", "--directive", "go left")).exitCode, 0);
    assert.equal((await cli("record-review-blockers", "--detail", "d")).exitCode, 0);

    // 1 is a gate that did not pass, 2 is a usage error, 3 is a deliberate ledger refusal.
    assert.equal((await cli("complete-goals")).exitCode, 1);
    assert.equal((await cli("record-evidence", "--kind", "green", "--ref", "r")).exitCode, 2);
    assert.equal((await cli("steer", "--directive", "skip the tests")).exitCode, 3);
    assert.equal((await cli("record-evidence", "--criterion-id", "C1", "--kind", "bogus", "--ref", "r")).exitCode, 3);

    const json = await cli("status", "--json");
    assert.equal(json.exitCode, 0);
    assert.equal(JSON.parse(json.stdout).goals[0].status, "review_blocked");
  });
});

test("CLI help and transitions describe read-only status, atomic add_criterion, and blocker resolution", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /status is read-only/i);
  assert.match(help.stdout, /mutating verbs write goals\.json and brief\.md, then append one ledger\.jsonl audit event/i);
  assert.match(help.stdout, /add_criterion appends a pending criterion with the next safe C-number/i);
  assert.match(help.stdout, /record-review-blockers --resolve <id>/);

  await withProject(async (dir) => {
    const cli = (...argv) => runCli([...argv, "--project", dir]);
    assert.equal((await cli("create-goals", "--session-id", "cli-state", "--objective", "o", "--criterion", "base")).exitCode, 0);
    const added = await cli("steer", "--directive", "new CLI criterion", "--kind", "add_criterion", "--json");
    assert.equal(added.exitCode, 0);
    assert.equal(JSON.parse(added.stdout).steering.criterionId, "C2");
    const status = JSON.parse((await cli("status", "--json")).stdout);
    assert.equal(status.goals[0].criteria[1].status, "pending");
    assert.equal((await cli("complete-goals")).exitCode, 1);

    const blocked = JSON.parse((await cli("record-review-blockers", "--detail", "review", "--json")).stdout);
    const resolved = await cli("record-review-blockers", "--resolve", blocked.blocker.id, "--json");
    assert.equal(resolved.exitCode, 0);
    assert.equal(JSON.parse(resolved.stdout).blocker.resolved, true);
  });
});
