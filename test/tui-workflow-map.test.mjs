import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildMissionView, lastMission, missionRowKeys, planChecklist, readWorkState, stepName } from "../src/tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { chipLine, lineWidth, linkColor, liveSegments, missionPanel, paletteFromTheme, panelInnerWidth } from "../src/tui/mission-text.ts";
import { createWorkReader, readLatestResearchRun, readLiveStep, readMissionInput, readResearchRun } from "../src/tui/mission-source.ts";
import { readNotifyOptions, statusCard } from "../src/tui/mission-band.ts";

// The workflow map: where the session is in the LIT workflow (interview › plan › work n/m › review ›
// done, a litresearch run's decompose › wave n › expand › verify › synthesis, or lit-loop's
// criterion loop), the tool running right now, and the opt-in finish alert.
const now = Date.parse("2026-10-12T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const text = (line) => line.map((segment) => segment.text).join("");
const marks = [{ at: now - 5 * 60_000, mode: "lit-loop" }];

function ledger(goal) {
  return { version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "parser", status: "active", createdAt: "2026-10-12T11:56:00.000Z", updatedAt: "", criteria: [], checkpoints: [], steering: [], reviewBlockers: [], ...goal }] };
}
const criterion = (id, status) => ({ id, scenario: `${id} parser handles empty input`, qaChannel: "tui", testRef: "t", status, evidence: [] });
const plan = { done: 2, total: 7, next: "3. wire the parser" };

test("a deep interview is the first stage, and stages the session never visited read as skipped", () => {
  const interview = buildMissionView({ marks: [{ at: 1, mode: "deep-interview" }], todos: [], now });
  assert.equal(interview.phase, "interview");
  assert.deepEqual(interview.steps.map((step) => [step.id, step.state]), [["interview", "now"], ["plan", "todo"], ["work", "todo"], ["review", "todo"], ["done", "todo"]]);
  const planning = buildMissionView({ marks: [{ at: 1, mode: "deep-interview" }, { at: 2, mode: "lit-plan" }], todos: [], now });
  assert.deepEqual(planning.steps.map((step) => step.state), ["done", "now", "todo", "todo", "todo"]);
});

test("finishing every todo without a review never claims one: review reads skipped while a completed goal's review stays done", () => {
  const todos = buildMissionView({ marks: [{ at: 1, mode: "lit-task" }], todos: [{ content: "a", status: "completed" }], now });
  assert.equal(todos.complete, true);
  assert.deepEqual(todos.steps.map((step) => step.state), ["skip", "skip", "done", "skip", "done"]);
  assert.match(text(chipLine(todos, restingFrameFor(todos), palette, 80)), /work 1\/1 ✓ › review – › done ✓/u);
  const reviewed = buildMissionView({ marks: [{ at: 1, mode: "lit-task" }, { at: 2, command: "review-work" }], todos: [{ content: "a", status: "completed" }], now });
  assert.equal(reviewed.steps[3].state, "done");
  const goal = buildMissionView({ marks, todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass")] }), now });
  assert.equal(goal.steps[3].state, "done", "the goal ledger's completion gate includes its review");
});

test("the plan checklist counts column-zero checkbox rows and names the first open one", () => {
  const body = ["# Plan", "- [x] 1. read — Action: a", "- [ ] 2. wire the parser — Action: b", "  - [ ] nested is not a task", "- [X] 3. done too", "- [ ] F1. audit"].join("\n");
  assert.deepEqual(planChecklist(body), { done: 2, total: 4, next: "2. wire the parser" });
  assert.equal(planChecklist("no rows"), undefined);
});

test("work-schema-3 belongs to one session; cancelled or foreign work is left out", () => {
  const raw = { schemaVersion: 3, sessionID: "s1", status: "active", plan: { path: "/repo/.litopencode/plans/p.md" }, history: [{ type: "work.initialized" }, { type: "work.progressed" }, { type: "work.progressed" }] };
  assert.deepEqual(readWorkState(raw, "s1"), { status: "active", iterations: 2, planPath: "/repo/.litopencode/plans/p.md" });
  assert.equal(readWorkState(raw, "s2"), undefined);
  assert.equal(readWorkState({ ...raw, status: "cancelled" }, "s1"), undefined);
  assert.equal(readWorkState({ ...raw, schemaVersion: 2 }, "s1"), undefined);
});

test("bounded work fills the map: the plan is behind with its task count, work counts plan tasks with the iteration, and the detail line names the task", () => {
  const view = buildMissionView({ marks: [{ at: 1, command: "start-work", mode: "bounded-authority-lifecycle" }], todos: [], work: { status: "active", iterations: 2, plan }, now });
  assert.equal(view.family, "main");
  assert.deepEqual(view.steps.map((step) => step.state), ["skip", "done", "now", "todo", "todo"]);
  assert.deepEqual(view.progress, { done: 2, total: 7 });
  assert.equal(view.iteration, 2);
  assert.equal(view.planTasks, 7);
  assert.equal(view.detail, "task 3");
  assert.equal(view.next, "3. wire the parser");
  const rows = missionPanel(view, restingFrameFor(view), palette).rows.map(text);
  assert.ok(rows.some((row) => /^◆ plan +7 tasks$/u.test(row)), rows.join("\n"));
  assert.ok(rows.some((row) => /^◉ work 2\/7 +iter 2$/u.test(row)), rows.join("\n"));
  assert.ok(rows.includes("└ task 3 · next ▸ 3. wire the p…"), rows.join("\n"));
  for (const row of rows) assert.ok(cellFits(row), row);
});

function cellFits(row) {
  return lineWidth([{ text: row, fg: "#000000" }]) <= panelInnerWidth;
}

test("lit-loop counting criteria is the loop family: the work stage reads criterion n/m and checkpoints are its iterations", () => {
  const view = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending")], checkpoints: [{ id: "k1", at: "2026-10-12T11:58:00.000Z", summary: "red", activeCriterion: "C2" }, { id: "k2", at: "2026-10-12T11:59:00.000Z", summary: "green", activeCriterion: "C2" }] }), now });
  assert.equal(view.family, "loop");
  assert.equal(stepName("work", view), "criterion");
  assert.equal(view.iteration, 2);
  assert.match(text(chipLine(view, restingFrameFor(view), palette, 80)), / CRITERION .* 1\/2 › review/u);
  const tasks = buildMissionView({ marks, todos: [{ content: "a", status: "pending" }], ledger: ledger({ criteria: [criterion("C1", "pass")] }), now });
  assert.equal(tasks.family, "main", "todos count tasks, so the session stays on the main chain");
});

test("in the criterion loop the card counts criteria once, on the stage, and keeps the room for the live step", () => {
  const view = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending"), criterion("C3", "pending")] }), sessionStatus: "busy", live: { tool: "bash", start: now - 8_000 }, now });
  assert.equal(view.family, "loop");
  const row = text(statusCard({ view, frame: restingFrameFor(view, now), chips: [], busy: true, figures: { contextPercent: 4, branch: "main", inLane: false } }, palette, 98)[1]);
  assert.match(row, / CRITERION  1\/3 /u);
  assert.doesNotMatch(row, /criteria/u, "the stage already reads 1/3, so the card does not repeat it");
  assert.match(row, /bash · 0:08/u);
  const main = buildMissionView({ marks, todos: [{ content: "a", status: "pending" }], ledger: ledger({ criteria: [criterion("C1", "pass")] }), now });
  assert.match(text(statusCard({ view: main, frame: restingFrameFor(main, now), chips: [], busy: true, figures: { contextPercent: 4, branch: "main", inLane: false } }, palette, 98)[1]), /1\/1 criteria/u, "tasks on the stage leave the criteria count beside them");
});

test("a goals.json the agent writes by hand, one goal with its criteria, still drives the criterion loop", () => {
  // The shape a real lit-loop turn left in OpenCode 1.18.35: no goals list, no activeGoalId, and
  // `completed` where the ledger CLI writes `pass` / `complete`.
  const handWritten = (criteria, status = "active") => ({ goalId: "greet-spanish", title: "Add the --lang es greeting option", status, criteria, updatedAt: "2026-10-12T11:59:00Z" });
  const row = (id, status) => ({ id, scenario: `node greet.js ${id}`, surface: "CLI", evidencePath: `evidence/${id}.txt`, status });
  const running = buildMissionView({ marks, todos: [], ledger: handWritten([row("criterion-1", "completed"), row("criterion-2", "pending"), row("criterion-3", "pending")]), now });
  assert.equal(running.family, "loop");
  assert.deepEqual(running.progress, { done: 1, total: 3 });
  assert.equal(running.goal?.title, "Add the --lang es greeting option");
  assert.match(text(chipLine(running, restingFrameFor(running), palette, 80)), / CRITERION .* 1\/3 › review/u);
  const finished = buildMissionView({ marks, todos: [], ledger: handWritten([row("criterion-1", "completed"), row("criterion-2", "passed"), row("criterion-3", "completed")], "completed"), now });
  assert.equal(finished.complete, true);
  assert.equal(finished.phase, "done");
  assert.equal(finished.steps[3].state, "skip", "a hand-written `completed` passed no completion gate, so it claims no review");
  const gated = buildMissionView({ marks, todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass")] }), now });
  assert.equal(gated.steps[3].state, "done", "the ledger CLI's completion gate still counts as the review");
  assert.equal(lastMission(handWritten([row("criterion-1", "completed")], "completed"))?.complete, true);
  // A second real turn nested the goal under `goal`; a goals list without activeGoalId reads its last goal.
  const wrapped = buildMissionView({ marks, todos: [], ledger: { schemaVersion: 1, workflow: "lit-loop", goal: handWritten([row("criterion-1", "completed"), row("criterion-2", "pending")]) }, now });
  assert.deepEqual(wrapped.progress, { done: 1, total: 2 });
  const listed = buildMissionView({ marks, todos: [], ledger: { goals: [handWritten([row("old", "completed")], "completed"), handWritten([row("criterion-1", "pending")])] }, now });
  assert.deepEqual(listed.progress, { done: 0, total: 1 });
  assert.equal(buildMissionView({ marks, todos: [], ledger: { title: "no criteria list" }, now }).goal, undefined, "an object without a criteria list is not a goal");
});

test("a litresearch run reads its stage from the journal, the claim graph and the report", () => {
  assert.equal(readResearchRun("", "", false, 0).stage, "decompose");
  const wave = readResearchRun("# Run\n## Wave 1\n## Wave 2\n", '{"id":"c1","wave":1}\n{"id":"c2","wave":2}\n', false, 0);
  assert.deepEqual([wave.stage, wave.waves, wave.claims], ["wave", 2, 2]);
  assert.equal(readResearchRun("## Wave 1\n## EXPAND\n", '{"id":"c1"}\n', false, 0).stage, "expand");
  const verify = readResearchRun("## Wave 1\n", '{"id":"c1","gate":"verified"}\n{"id":"c2","gate":"abstained"}\nnot json\n', false, 0);
  assert.deepEqual([verify.stage, verify.claims, verify.verified], ["verify", 2, 1]);
  assert.equal(readResearchRun("", "", true, 0).stage, "synthesis");
});

test("research stage names drive the map, a written report completes it, and an older run is earlier work", () => {
  const research = { stage: "wave", waves: 2, claims: 14, verified: 3, reported: false, touchedAt: now };
  const view = buildMissionView({ marks: [{ at: now - 60_000, mode: "litresearch" }], todos: [], research, now });
  assert.equal(view.family, "research");
  assert.deepEqual(view.steps.map((step) => [step.id, step.state]), [["decompose", "done"], ["wave", "now"], ["expand", "todo"], ["verify", "todo"], ["synthesis", "todo"]]);
  assert.equal(stepName("wave", view), "wave 2");
  assert.equal(view.detail, "14 claims · 3 verified");
  assert.match(text(chipLine(view, restingFrameFor(view), palette, 80)), /decompose ✓ ›  WAVE 2  › expand/u);
  assert.equal(missionPanel(view, restingFrameFor(view), palette).title, " 🔥 LIT ▸ WAVE 2 ");

  const reported = buildMissionView({ marks: [{ at: now - 60_000, mode: "litresearch" }], todos: [], research: { ...research, stage: "synthesis", reported: true }, now });
  assert.equal(reported.complete, true);
  assert.ok(reported.steps.every((step) => step.state === "done"));

  const stale = buildMissionView({ marks: [{ at: now, mode: "litresearch" }], todos: [], research: { ...research, touchedAt: now - 3_600_000 }, now });
  assert.equal(stale.phase, "decompose", "a new litresearch turn without its own run starts at decompose");
  const elsewhere = buildMissionView({ marks: [{ at: now, mode: "lit-task" }], todos: [], research: { ...research, touchedAt: now - 3_600_000 }, now });
  assert.equal(elsewhere.family, "main");
});

test("the live step is the running tool's name and start, never its input, and only while the turn runs", () => {
  const state = {
    path: { worktree: "/repo" },
    provider: [],
    session: {
      messages: () => [{ id: "u1", role: "user", time: { created: 1 } }, { id: "a1", role: "assistant" }],
      todo: () => [],
      status: () => ({ type: "busy" }),
      permission: () => [],
      question: () => []
    },
    part: (id) => id === "u1"
      ? [{ type: "text", metadata: { litopencode: { mode: "lit-loop" } } }]
      : [
          { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/secret" }, time: { start: 5, end: 6 } } },
          { type: "tool", tool: "bash", state: { status: "running", input: { command: "rm -rf /tmp/x" }, time: { start: now - 48_000 } } }
        ]
  };
  assert.deepEqual(readLiveStep(state, state.session.messages()), { tool: "bash", start: now - 48_000 });
  const input = readMissionInput(state, "s1", undefined, now);
  const view = buildMissionView(input);
  assert.deepEqual(view.live, { tool: "bash", start: now - 48_000 });
  const live = text(liveSegments(view, restingFrameFor(view, now), palette, 32));
  assert.equal(live, "⠇ bash · 0:48");
  assert.doesNotMatch(JSON.stringify(view), /rm -rf|secret/u, "no tool input reaches the view");
  assert.equal(buildMissionView({ ...input, sessionStatus: "idle" }).live, undefined, "an ended turn shows no live step");

  const rows = missionPanel(view, restingFrameFor(view, now), palette).rows.map(text);
  assert.ok(rows.includes("⠇ bash · 0:48"), rows.join("\n"));
  assert.match(text(chipLine(view, restingFrameFor(view, now), palette, 90)), /⠇ bash · 0:48$/u, "a wide chip carries the live step");
  assert.doesNotMatch(text(chipLine(view, restingFrameFor(view, now), palette, 40)), /bash/u, "a narrow chip drops it first");
  const track = text(statusCard({ view, frame: restingFrameFor(view, now), chips: [], busy: true, figures: { contextPercent: null, inLane: false } }, palette, 120)[1]);
  assert.match(track, /⠇ bash · 0:48/u);
  assert.equal(liveSegments(view, restingFrameFor(view, now + 1000), palette, 32)[0].text, "⠏ ", "the spinner advances only with the elapsed second");
});

test("the live row appears in place: a new tool never replays the panel's slide-in", () => {
  const base = { marks, todos: [{ content: "a", status: "pending" }], sessionStatus: "busy", now };
  const before = buildMissionView({ ...base, live: { tool: "read", start: now } });
  const after = buildMissionView({ ...base, live: { tool: "bash", start: now + 10 } });
  const quiet = buildMissionView(base);
  assert.ok(missionRowKeys(after).includes("live"));
  const settled = planMotion(undefined, quiet, 0, idleMotion);
  assert.deepEqual(sampleMotion(planMotion(quiet, after, 10_000, settled), 10_000).entering, []);
  assert.deepEqual(sampleMotion(planMotion(before, after, 10_000, settled), 10_000).entering, []);
});

test("moving forward fills the connectors in turn and flashes the chip once, then stays still", () => {
  const planning = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }], todos: [], now });
  const working = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }, { at: 2, command: "lit-plan", operation: "save-plan" }], todos: [{ content: "a", status: "pending" }], now });
  const settled = planMotion(undefined, planning, 0, idleMotion);
  const moved = planMotion(planning, working, 10_000, settled);
  assert.equal(moved.stageFrom, 1);
  const start = sampleMotion(moved, 10_000);
  const lit = linkColor(working, 2, restingFrameFor(working), palette, palette.borderSubtle);
  assert.equal(linkColor(working, 2, start, palette, palette.borderSubtle), palette.borderSubtle, "the connector starts unlit");
  assert.equal(linkColor(working, 2, sampleMotion(moved, 10_000 + motionTiming.entry), palette, palette.borderSubtle), lit, "and fills within one entry");
  const flashing = chipLine(working, sampleMotion(moved, 10_000 + motionTiming.shimmer / 2), palette, 80);
  assert.ok(flashing.length > chipLine(working, restingFrameFor(working), palette, 80).length, "the running pill is lit cell by cell while it flashes");
  const end = sampleMotion(moved, 10_000 + motionTiming.shimmer + 1);
  assert.equal(end.moving, false);
  assert.equal(end.stageFrom, undefined);
  assert.equal(planMotion(working, working, 20_000, moved).stageFrom, undefined, "no change, no motion");
});

test("the finish alert is off unless tui.json opts in", () => {
  assert.deepEqual(readNotifyOptions(undefined), { enabled: false, desktop: false, sound: false });
  assert.deepEqual(readNotifyOptions({ band: false }), { enabled: false, desktop: false, sound: false });
  assert.deepEqual(readNotifyOptions({ notify: true }), { enabled: true, desktop: true, sound: true });
  assert.deepEqual(readNotifyOptions({ notify: { sound: false } }), { enabled: true, desktop: true, sound: false });
  assert.deepEqual(readNotifyOptions({ notify: { sound: false, desktop: false } }), { enabled: false, desktop: false, sound: false });
  assert.deepEqual(readNotifyOptions({ notify: "yes" }), { enabled: false, desktop: false, sound: false });
});

test("the work reader keeps to the project: a plan outside the root or behind a symbolic link is left out", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-map-"));
  try {
    const dir = path.join(root, ".litopencode", "litgoal", "lit-loop");
    await fs.mkdir(path.join(root, ".litopencode", "plans"), { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    const planFile = path.join(root, ".litopencode", "plans", "p.md");
    await fs.writeFile(planFile, "- [x] 1. a\n- [ ] 2. b — Action: x\n");
    const write = (planPath) => fs.writeFile(path.join(dir, "work-schema-3.json"), JSON.stringify({ schemaVersion: 3, sessionID: "s1", status: "active", plan: { path: planPath }, history: [{ type: "work.progressed" }] }));
    await write(planFile);
    assert.deepEqual(createWorkReader()(root, "s1"), { status: "active", iterations: 1, plan: { done: 1, total: 2, next: "2. b" } });
    assert.equal(createWorkReader()(root, "other"), undefined);

    const outside = path.join(os.tmpdir(), `litopencode-outside-${process.pid}.md`);
    await fs.writeFile(outside, "- [ ] 1. outside\n");
    await write(outside);
    assert.deepEqual(createWorkReader()(root, "s1"), { status: "active", iterations: 1 });
    await fs.rm(outside, { force: true });

    const linked = path.join(root, ".litopencode", "plans", "linked.md");
    await fs.symlink(planFile, linked);
    await write(linked);
    assert.deepEqual(createWorkReader()(root, "s1"), { status: "active", iterations: 1 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the research reader follows the most recently written run folder", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-research-"));
  try {
    assert.equal(readLatestResearchRun(root), undefined);
    const base = path.join(root, ".litopencode", "litgoal", "lit-loop", "research");
    await fs.mkdir(path.join(base, "old"), { recursive: true });
    await fs.writeFile(path.join(base, "old", "report.md"), "done");
    const past = new Date(Date.now() - 3_600_000);
    await fs.utimes(path.join(base, "old", "report.md"), past, past);
    await fs.utimes(path.join(base, "old"), past, past);
    await fs.mkdir(path.join(base, "new"));
    await fs.writeFile(path.join(base, "new", "journal.md"), "## Wave 1\n");
    await fs.writeFile(path.join(base, "new", "claim-graph.jsonl"), '{"id":"c1"}\n');
    const run = readLatestResearchRun(root);
    assert.deepEqual([run.stage, run.claims, run.reported], ["wave", 1, false]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
