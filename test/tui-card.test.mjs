import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView, idleMission } from "../src/tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { cellWidth, lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { readCardInput } from "../src/tui/mission-source.ts";
import { chipShimmer, idleChipMotion, planChipMotion, readSkillUse, skillChips } from "../src/tui/mission-skills.ts";
import { skillRow, statusCard } from "../src/tui/mission-band.ts";

// The band's status card: four terminal rows that stay on screen for the whole session. A rounded
// border carries the LIT mark, the discipline and the phase; row one is the phase track with the
// goal, row two the LitOpenCode skills that fired, and the bottom border the live figures.
const now = Date.parse("2026-10-12T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const text = (line) => line.map((segment) => segment.text).join("");

function ledger(goal) {
  return { version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "hello.txt 인사말 만들기", status: "active", createdAt: "2026-10-12T11:55:00.000Z", updatedAt: "", criteria: [], checkpoints: [], steering: [], reviewBlockers: [], ...goal }] };
}
const criterion = (id, status) => ({ id, scenario: `${id} README links hello.txt`, qaChannel: "tui", testRef: "t", status, evidence: [] });
const marks = [{ at: now - 7 * 60_000, mode: "lit-task" }];
const working = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending"), criterion("C3", "pending")] }), now });
const blocked = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending")], reviewBlockers: [{ id: "B1", detail: "README 링크가 깨졌어요", resolved: false, needsUserDecision: false }] }), now });
const figures = { contextPercent: 34.4, branch: "feat/card", inLane: false };
const chips = [{ name: "lit-task", current: true }, { name: "lit-pptx", current: true }, { name: "debugging", current: false }];

function card(view, overrides = {}, width = 120) {
  return statusCard({ view, frame: restingFrameFor(view), chips, figures, ...overrides }, palette, width);
}

test("skill uses come from OpenCode's skill tool, LitOpenCode's own tools and lit marks; other skills do not count", () => {
  const skillPart = (name, status = "completed") => ({ type: "tool", tool: "skill", state: { status, input: { name }, time: { start: 50 } } });
  assert.deepEqual(readSkillUse(skillPart("lit-pptx"), 1), { name: "lit-pptx", at: 50 });
  assert.deepEqual(readSkillUse(skillPart("debugging", "running"), 1), { name: "debugging", at: 50 });
  assert.equal(readSkillUse(skillPart("someone-elses-skill"), 1), undefined, "only skills LitOpenCode ships become chips");
  assert.equal(readSkillUse(skillPart("lit-pptx", "error"), 1), undefined, "a failed load is not a firing");
  assert.deepEqual(readSkillUse({ type: "tool", tool: "lit", state: { status: "completed", input: { action: "activate" }, time: { start: 9 } } }, 1), { name: "lit-loop", at: 9 });
  assert.equal(readSkillUse({ type: "tool", tool: "litwork", state: { status: "completed", input: { action: "status" }, time: { start: 9 } } }, 1), undefined, "a status read is not a firing");
  assert.deepEqual(readSkillUse({ type: "tool", tool: "review-work", state: { status: "completed", input: {}, time: { start: 9 } } }, 1), { name: "review-work", at: 9 });
  assert.equal(readSkillUse({ type: "tool", tool: "bash", state: { status: "completed", input: {}, time: { start: 9 } } }, 1), undefined);
  assert.deepEqual(readSkillUse({ type: "text", metadata: { litopencode: { mode: "lit-loop", trigger: "lit" } } }, 7), { name: "lit-loop", at: 7 });
  assert.deepEqual(readSkillUse({ type: "text", metadata: { litopencode: { command: "start-work", mode: "bounded-authority-lifecycle" } } }, 7), { name: "start-work", at: 7 });
  assert.equal(readSkillUse({ type: "text", metadata: {} }, 7), undefined);
});

test("chips fired in the current request are bright while it runs, then dim to recent; a new firing brightens again", () => {
  const uses = [{ name: "debugging", at: 5 }, { name: "lit-loop", at: 10 }, { name: "lit-pptx", at: 12 }, { name: "lit-loop", at: 13 }];
  assert.deepEqual(skillChips(uses, { since: 10, busy: true }), [
    { name: "lit-loop", current: true },
    { name: "lit-pptx", current: true },
    { name: "debugging", current: false }
  ]);
  assert.deepEqual(skillChips(uses, { since: 10, busy: false }), [
    { name: "lit-loop", current: false },
    { name: "lit-pptx", current: false },
    { name: "debugging", current: false }
  ], "after the turn every chip is recent, newest first");
  assert.deepEqual(skillChips([...uses, { name: "debugging", at: 30 }], { since: 30, busy: true })[0], { name: "debugging", current: true });
  assert.deepEqual(skillChips([], { since: undefined, busy: true }), []);
});

test("the TUI state slice gives the card its chips, context use and branch", () => {
  const state = {
    path: { worktree: "/repo", directory: "/repo" },
    vcs: { branch: "main" },
    provider: [{ id: "openai", models: { "gpt-x": { limit: { context: 1000 } } } }],
    session: {
      messages: () => [
        { id: "m1", role: "user", time: { created: 10 } },
        { id: "m2", role: "assistant", providerID: "openai", modelID: "gpt-x", tokens: { input: 300, output: 100 } },
        { id: "m3", role: "user", time: { created: 20 } },
        { id: "m4", role: "assistant" }
      ],
      todo: () => [],
      status: () => ({ type: "busy" }),
      permission: () => [],
      question: () => []
    },
    part: (id) => id === "m1"
      ? [{ type: "text", metadata: { litopencode: { mode: "lit-loop" } } }]
      : id === "m2"
        ? [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "debugging" }, time: { start: 12 } } }]
        : id === "m4"
          ? [{ type: "tool", tool: "skill", state: { status: "running", input: { name: "lit-pptx" }, time: { start: 21 } } }]
          : []
  };
  const input = readCardInput(state, "s1");
  assert.deepEqual(input.chips, [{ name: "lit-pptx", current: true }, { name: "debugging", current: false }, { name: "lit-loop", current: false }]);
  assert.equal(input.contextPercent, 40);
  assert.equal(input.branch, "main");
});

test("the card is four rows of exactly the given width: border title, phase track, skills, figures", () => {
  const lines = card(working);
  assert.equal(lines.length, 4);
  for (const line of lines) assert.equal(lineWidth(line), 120);
  const [top, track, skills, bottom] = lines.map(text);
  assert.match(top, /^╭─ 🔥 LIT · lit-task ─+ ● WORK ─╮$/u);
  assert.match(track, /^│ interview – ━ plan – ━  WORK  1\/3 ─ review ─ done  [█▏▎▍▌▋▊▉─]{16}  1\/3 criteria  ▸ C2 C2 README links hello\.txt +│$/u);
  assert.match(skills, /^│ skills  lit-task   lit-pptx   debugging  +│$/u);
  assert.match(bottom, /^╰─+ ctx 34% · ⟳ 7m · ⎇ feat\/card ─╯$/u);
});

test("an idle session keeps the same four rows with the last goal, recent skills and the figures", () => {
  const idle = buildMissionView({ marks: [], todos: [], now });
  assert.equal(idle, idleMission);
  const last = { title: "hello.txt 인사말 만들기", passed: 2, total: 2, complete: true };
  const lines = statusCard({ view: idle, frame: restingFrameFor(idle), chips: [{ name: "lit-pptx", current: false }], figures, last }, palette, 120);
  assert.equal(lines.length, 4);
  for (const line of lines) assert.equal(lineWidth(line), 120);
  const [top, track, skills, bottom] = lines.map(text);
  assert.match(top, /^╭─ 🔥 LIT · ready ─+ ○ IDLE ─╮$/u);
  assert.match(track, /^│ interview ─ plan ─ work ─ review ─ done  last: hello\.txt 인사말 만들기 ✓ 2\/2 +│$/u);
  assert.match(skills, /^│ skills  lit-pptx  +│$/u);
  assert.match(bottom, /^╰─+ ctx 34% · ⎇ feat\/card ─╯$/u, "an idle session has no elapsed time");
  const empty = statusCard({ view: idle, frame: restingFrameFor(idle), chips: [], figures: { contextPercent: null, inLane: false } }, palette, 120).map(text);
  assert.match(empty[1], /add lit to a prompt to start/u);
  assert.match(empty[2], /^│ skills  none yet +│$/u);
  assert.match(empty[3], /^╰─+╯$/u);
});

test("a warning names itself in the title and takes the next task's place on the track", () => {
  const [top, track] = card(blocked).map(text);
  assert.match(top, /⚑ review blocked ─╮$/u);
  assert.match(track, /⚑ B1 README 링크가 깨졌어요/u);
  assert.doesNotMatch(track, /▸/u);
});

test("narrow widths shed the next text, bar width, the bar, the criteria and then the step labels; nothing wraps", () => {
  const frame = restingFrameFor(working);
  const at = (width) => statusCard({ view: working, frame, chips, figures }, palette, width).map(text);
  for (let width = 16; width <= 200; width += 1) {
    for (const line of statusCard({ view: working, frame, chips, figures }, palette, width)) assert.equal(lineWidth(line), width, `width ${width}: ${text(line)}`);
  }
  const lastWidthWith = (row, pattern) => {
    for (let width = 16; width <= 200; width += 1) if (pattern.test(at(width)[row])) return width;
    return Number.POSITIVE_INFINITY;
  };
  const next = lastWidthWith(1, /▸/u);
  const wideBar = lastWidthWith(1, /[█▏▎▍▌▋▊▉─]{16}/u);
  const anyBar = lastWidthWith(1, /[█▏▎▍▌▋▊▉]/u);
  const criteria = lastWidthWith(1, /criteria/u);
  const labels = lastWidthWith(1, /plan/u);
  assert.ok(next > wideBar && wideBar > anyBar && anyBar > criteria && criteria > labels, JSON.stringify({ next, wideBar, anyBar, criteria, labels }));
  const branch = lastWidthWith(3, /⎇/u);
  const time = lastWidthWith(3, /⟳/u);
  const ctx = lastWidthWith(3, /ctx/u);
  assert.ok(branch > time && time > ctx, JSON.stringify({ branch, time, ctx }));
  assert.match(at(60)[0], /🔥 LIT/u);
});

test("skill chips: bright pills for the current request, dim recent names, and +N when they overflow", () => {
  const many = [
    { name: "lit-plan", current: true },
    { name: "lit-pptx", current: true },
    { name: "debugging", current: false },
    { name: "review-work", current: false },
    { name: "lit-docx", current: false },
    { name: "visual-qa", current: false }
  ];
  const wide = skillRow(many, undefined, palette, 120);
  assert.equal(lineWidth(wide), 120);
  const bright = wide.find((segment) => segment.text === " lit-plan ");
  assert.equal(bright.bg, "#5fd7ff", "a current chip is a LIT accent pill");
  assert.equal(bright.fg, "#0b0f14", "with dark ink");
  assert.equal(bright.bold, true);
  const dim = wide.find((segment) => segment.text.includes("debugging"));
  assert.equal(dim.fg, palette.muted);
  assert.notEqual(dim.bg, "#5fd7ff");
  const narrow = text(skillRow(many, undefined, palette, 40));
  assert.equal(cellWidth(narrow), 40);
  assert.match(narrow, /lit-plan.*lit-pptx.*\+\d/u, "current chips stay and the rest collapse into +N");
  const hidden = many.length - many.filter((chip) => narrow.includes(chip.name)).length;
  assert.match(narrow, new RegExp(`\\+${hidden}`, "u"));
  assert.equal(lineWidth(skillRow(many, undefined, palette, 8)), 8);
});

test("a skill arriving in the current request shimmers briefly, only once, and not with motion off", () => {
  const before = [{ name: "debugging", current: false }];
  const after = [{ name: "lit-pptx", current: true }, { name: "debugging", current: false }];
  const motion = planChipMotion(before, after, 1000, idleChipMotion, true);
  assert.deepEqual(motion.arrivals, ["lit-pptx"]);
  const mid = chipShimmer(motion, 1000 + motionTiming.shimmer / 2);
  assert.ok(mid !== undefined && mid.sweep > 0 && mid.sweep < 1);
  assert.equal(chipShimmer(motion, 1000 + motionTiming.shimmer + 1), undefined);
  const lit = skillRow(after, mid, palette, 80);
  const pptxCells = lit.filter((segment) => segment.bg !== undefined && segment.bg !== palette.fill);
  assert.ok(pptxCells.length > 0, "the sweep lightens part of the new chip");
  assert.deepEqual(planChipMotion(after, after, 2000, motion, true), motion, "the same chips do not restart it");
  assert.deepEqual(planChipMotion(undefined, after, 1000, idleChipMotion, true).arrivals, ["lit-pptx"], "a new session's first chip belongs to the running request and shimmers");
  assert.deepEqual(planChipMotion(undefined, before, 1000, idleChipMotion, true).arrivals, [], "opening a session does not replay its recent history");
  assert.deepEqual(planChipMotion(before, after, 1000, idleChipMotion, false).arrivals, [], "motion off keeps chips still");
});

test("a child session marks the card as a lane, and the completion moment plays on the track", () => {
  assert.match(text(card(working, { figures: { ...figures, inLane: true } })[3]), /⟳ 7m · in lane/u);
  const before = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const done = buildMissionView({ marks, todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const motion = planMotion(before, done, 0, planMotion(undefined, before, -10_000, idleMotion));
  const mid = statusCard({ view: done, frame: sampleMotion(motion, 500), chips, figures }, palette, 160).map(text);
  assert.match(mid[1], /✓ COMPLETE +[ ·✦✧˚]*[✦✧˚·]/u, "sparks follow COMPLETE while it celebrates");
  assert.match(mid[0], /✓ COMPLETE ─╮$/u);
  const settled = statusCard({ view: done, frame: sampleMotion(motion, motionTiming.complete), chips, figures }, palette, 160).map(text);
  assert.doesNotMatch(settled[1], /[✦✧˚]/u);
});

test("the card settles to idle when the root session's turn ends, ignores a finished child, and lights WORK again on the next prompt", () => {
  // OpenCode 1.18 keeps `session_status[sessionID]` from each `session.status` event: { type: "busy" }
  // while a turn runs, { type: "idle" } once it ends, and nothing for a session it has not seen run.
  const statuses = { root: { type: "busy" }, child: { type: "idle" } };
  const state = {
    path: { worktree: "/repo", directory: "/repo" },
    vcs: { branch: "main" },
    provider: [],
    session: {
      messages: () => [{ id: "u1", role: "user", time: { created: 10 } }, { id: "a1", role: "assistant", time: { created: 11 } }],
      todo: () => [],
      status: (id) => statuses[id],
      permission: () => [],
      question: () => []
    },
    part: (id) => id === "u1"
      ? [{ type: "text", metadata: { litopencode: { mode: "lit-task" } } }]
      : [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "debugging" }, time: { start: 12 } } }]
  };
  const draw = () => {
    const input = readCardInput(state, "root");
    return { input, rows: statusCard({ view: working, frame: restingFrameFor(working), chips: input.chips, busy: input.busy, figures }, palette, 120) };
  };
  const workPill = (rows) => rows[1].find((segment) => /work/iu.test(segment.text));

  let { input, rows } = draw();
  assert.equal(input.busy, true, "a finished child leaves the root card working");
  assert.match(text(rows[0]), /● WORK ─╮$/u);
  assert.equal(workPill(rows).bg, "#5fd7ff", "the running step is lit as a LIT accent pill");

  statuses.root = { type: "idle" };
  ({ input, rows } = draw());
  assert.equal(input.busy, false);
  assert.match(text(rows[0]), /^╭─ 🔥 LIT · lit-task ─+ ○ IDLE ─╮$/u, "the title settles to idle");
  assert.notEqual(workPill(rows).bg, "#5fd7ff", "no step stays lit after the turn");
  assert.ok(input.chips.every((chip) => !chip.current), "chips dim to recent");
  assert.equal(rows[0][0].fg, palette.borderActive, "the border returns to its resting colour");

  delete statuses.root;
  assert.equal(draw().input.busy, false, "a session with no status yet is not running");

  statuses.root = { type: "busy" };
  ({ rows } = draw());
  assert.match(text(rows[0]), /● WORK ─╮$/u, "the next prompt brings WORK back");
  statuses.root = { type: "retry", attempt: 1, message: "rate limited", next: 20 };
  assert.equal(draw().input.busy, true, "a retry is still a running turn");
});
