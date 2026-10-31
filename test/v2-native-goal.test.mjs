import assert from "node:assert/strict";
import { test } from "node:test";
import { decideNativeGoal, nativeGoalLine, nativeGoalObjective, nativeGoalRoute } from "../src/v2/native-goal.ts";

// OpenCode 2.2.x has a native /goal. LitOpenCode sets one only for lit-loop, start-work and litwork, only
// when none exists, and manages (resume, clear) only the goal it created. Done needs OpenCode's verdict
// and LitOpenCode's ledger. These cases pin the policy; the wiring tests live in v2-native-goal-wiring.

const owned = { id: "goal_mine", objective: "ship it", status: "active" };
const base = { route: "lit-loop", supported: true, goal: null, ownedGoalID: undefined, ledgerDone: false, resumes: 0 };
const decide = (patch) => decideNativeGoal({ ...base, ...patch });

test("routes: lit-loop, start-work and litwork qualify; chat modes map by mode and trigger word", () => {
  assert.equal(nativeGoalRoute("lit-loop", "lit loop fix it"), "lit-loop");
  assert.equal(nativeGoalRoute("start-work", "start-work plan.md"), "start-work");
  assert.equal(nativeGoalRoute("lit-task", "litwork fix the parser"), "litwork");
  assert.equal(nativeGoalRoute("lit-task", "lit-work fix the parser"), "litwork");
  assert.equal(nativeGoalRoute("litwork", ""), "litwork");
  assert.equal(nativeGoalRoute("lit-work", ""), "litwork");
});

test("routes: bare lit and every read-only or planning route never qualify", () => {
  assert.equal(nativeGoalRoute("lit-task", "lit fix the parser"), undefined);
  for (const mode of ["lit-plan", "lit-research", "review-work", "lit-recap", "lit-adhd", "lit-brainstorm", "litgoal", "lit-crucible", "lit-handoff", "lit-init", "lit-humanizer", "lit"]) {
    assert.equal(nativeGoalRoute(mode, `${mode} something`), undefined, mode);
  }
});

test("a read-only route takes no action, even without /goal or with a goal present", () => {
  assert.deepEqual(decide({ route: undefined }), { kind: "none" });
  assert.deepEqual(decide({ route: "lit-plan" }), { kind: "none" });
  assert.deepEqual(decide({ route: "lit-plan", supported: false }), { kind: "none" });
  assert.deepEqual(decide({ route: "review-work", goal: { id: "x", objective: "y", status: "active" } }), { kind: "none" });
});

test("no goal on a qualifying route: create; on idle (no route): nothing", () => {
  for (const route of ["lit-loop", "start-work", "litwork"]) assert.deepEqual(decide({ route }), { kind: "create" }, route);
  assert.deepEqual(decide({ route: undefined }), { kind: "none" });
});

test("a host without /goal is recorded as unavailable on a qualifying route only", () => {
  assert.deepEqual(decide({ supported: false }), { kind: "unavailable" });
  assert.deepEqual(decide({ supported: false, route: undefined }), { kind: "none" });
});

test("an unreadable goal state fails closed: report, never create over it", () => {
  const action = decide({ goal: "unreadable" });
  assert.equal(action.kind, "report-conflict");
  assert.deepEqual(decide({ goal: "unreadable", route: undefined }), { kind: "none" });
});

test("a goal the user made is only reported: never kept as ours, resumed, cleared or overwritten", () => {
  for (const status of ["active", "paused", "complete"]) {
    const goal = { id: "goal_user", objective: "mine", status, reason: "Paused by the user" };
    assert.deepEqual(decide({ goal, ownedGoalID: undefined }), { kind: "report-user-goal" }, status);
    assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine", ledgerDone: true }), { kind: "report-user-goal" }, `${status} replaced`);
    assert.deepEqual(decide({ goal, route: undefined, ledgerDone: true }), { kind: "none" }, `${status} idle`);
  }
});

test("our active goal is kept", () => {
  assert.deepEqual(decide({ goal: owned, ownedGoalID: "goal_mine" }), { kind: "keep" });
  assert.deepEqual(decide({ goal: owned, ownedGoalID: "goal_mine", ledgerDone: true }), { kind: "keep" });
  assert.deepEqual(decide({ goal: owned, ownedGoalID: "goal_mine", route: undefined }), { kind: "keep" });
});

test("our goal paused by a server restart is resumed on activation, at most twice", () => {
  const goal = { ...owned, status: "paused", reason: "The server restarted while the goal was active" };
  assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine" }), { kind: "resume" });
  assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine", resumes: 1 }), { kind: "resume" });
  assert.equal(decide({ goal, ownedGoalID: "goal_mine", resumes: 2 }).kind, "report-conflict");
  assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine", route: undefined }), { kind: "none" });
});

test("our goal paused for any other reason is reported, never resumed (a person must decide)", () => {
  for (const reason of ["Paused by the user", "Reached the limit of 50 rounds", "Not making progress: same step", "The goal reviewer gave no usable verdict", "waiting on credentials", undefined]) {
    const goal = { ...owned, status: "paused", ...(reason === undefined ? {} : { reason }) };
    assert.equal(decide({ goal, ownedGoalID: "goal_mine" }).kind, "report-conflict", String(reason));
  }
});

test("our goal OpenCode judged met: cleared only when the ledger is done too", () => {
  const goal = { ...owned, status: "complete", reason: "all criteria pass" };
  assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine", ledgerDone: true }), { kind: "clear" });
  assert.deepEqual(decide({ goal, ownedGoalID: "goal_mine", ledgerDone: true, route: undefined }), { kind: "clear" });
});

test("OpenCode says met but the ledger is open: a conflict, never done", () => {
  const goal = { ...owned, status: "complete", reason: "all criteria pass" };
  const action = decide({ goal, ownedGoalID: "goal_mine", ledgerDone: false });
  assert.equal(action.kind, "report-conflict");
  assert.match(action.reason, /ledger/u);
  assert.equal(decide({ goal, ownedGoalID: "goal_mine", ledgerDone: false, route: undefined }).kind, "report-conflict");
});

test("the objective carries the work and the completion conditions, within the host limit", () => {
  const objective = nativeGoalObjective("fix the parser so the tests pass");
  assert.match(objective, /fix the parser so the tests pass/u);
  assert.match(objective, /tests/u);
  assert.match(objective, /real[- ]surface/iu);
  assert.match(objective, /cleanup/iu);
  assert.match(objective, /ledger/iu);
  assert.ok(objective.length <= 4000);
  const long = nativeGoalObjective("x".repeat(10_000));
  assert.ok(long.length <= 4000);
  assert.match(long, /ledger/iu);
});

test("the objective names the OpenCode session id for the ledger goal, only when it is a plain id", () => {
  assert.match(nativeGoalObjective("fix it", "ses_abc123"), /--session-id ses_abc123/u);
  assert.doesNotMatch(nativeGoalObjective("fix it", "ses abc; rm"), /--session-id/u);
  assert.doesNotMatch(nativeGoalObjective("fix it"), /--session-id/u);
  assert.ok(nativeGoalObjective("x".repeat(9000), "ses_abc123").length <= 4000);
});

test("the objective never repeats a pause, resume or clear control word or a secret", () => {
  for (const word of ["pause", "resume", "clear", "  Clear  "]) {
    const objective = nativeGoalObjective(word);
    assert.notEqual(objective.trim().toLowerCase(), word.trim().toLowerCase());
  }
  const secret = nativeGoalObjective("deploy with api_key=abcdef1234567890abcdef");
  assert.doesNotMatch(secret, /abcdef1234567890/u);
  assert.match(secret, /ledger/iu);
});

test("every action prints one short line that starts with the product prefix", () => {
  const goal = { id: "goal_1234567890", objective: "ship it", status: "active" };
  for (const action of [
    { kind: "create" },
    { kind: "resume" },
    { kind: "clear" },
    { kind: "report-user-goal" },
    { kind: "report-conflict", reason: "OpenCode says met, the ledger is open" },
    { kind: "unavailable" }
  ]) {
    const line = nativeGoalLine(action, { route: "lit-loop", goal });
    assert.match(line, /^LitOpenCode goal: /u, action.kind);
    assert.equal(line.includes("\n"), false, action.kind);
    assert.ok(line.length <= 200, action.kind);
  }
  assert.match(nativeGoalLine({ kind: "report-user-goal" }, { route: "lit-loop", goal }), /left yours alone/u);
  assert.match(nativeGoalLine({ kind: "unavailable" }, { route: "lit-loop" }), /native-goal-unavailable/u);
  assert.equal(nativeGoalLine({ kind: "keep" }, { route: "lit-loop", goal }), "");
  assert.equal(nativeGoalLine({ kind: "none" }, { route: "lit-plan" }), "");
});
