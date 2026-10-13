import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildMissionView, idleMission, lastMission, leadingNotice, missionNotices, missionRowKeys, readLitMark } from "../src/tui/mission-model.ts";
import { ease, idleMotion, motionTiming, mixHex, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { cellWidth, chipLine, chipTier, colorToHex, homeLine, lineWidth, missionPanel, paletteFromTheme, panelInnerWidth, progressBar, truncateCells } from "../src/tui/mission-text.ts";
import { createLedgerReader, missionProjectRoot, readMissionInput } from "../src/tui/mission-source.ts";

// The OpenCode TUI plugin is a thin host binding over these pure parts: a view model built from the
// marks LitOpenCode already writes, a terminal layout that counts Hangul and emoji as two cells, and
// motion sampled from a clock. Each is exercised here without a running TUI.
const now = Date.parse("2026-10-10T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const resting = { t: Number.POSITIVE_INFINITY, entering: [], chipEnter: false, barRatio: 0.5, warn: 0, moving: false };
const text = (line) => line.map((segment) => segment.text).join("");

function ledger(goal) {
  return { version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "HUD를 짧게 만들기", status: "active", createdAt: "2026-10-10T11:40:00.000Z", updatedAt: "", criteria: [], checkpoints: [], steering: [], reviewBlockers: [], ...goal }] };
}

function criterion(id, status, evidence = []) {
  return { id, scenario: `${id} scenario`, qaChannel: "tui", testRef: "t", status, evidence };
}

test("a part's metadata.litopencode becomes a mark for activations and commands; other metadata does not", () => {
  assert.deepEqual(readLitMark({ litopencode: { mode: "lit-loop", trigger: "lit", source: "chat.message" } }, 5), { at: 5, mode: "lit-loop" });
  assert.deepEqual(readLitMark({ litopencode: { command: "lit-plan", operation: "save-plan", blocked: true } }, 6), { at: 6, command: "lit-plan", operation: "save-plan", blocked: true });
  assert.equal(readLitMark({ litopencodeKnowledge: { source: "chat.message" } }, 1), undefined);
  assert.equal(readLitMark(undefined, 1), undefined);
  assert.equal(readLitMark({ litopencode: { trigger: "lit" } }, 1), undefined);
});

test("a session without a lit mark is idle, even on the default lit-loop agent, so the chip and panel stay hidden", () => {
  const view = buildMissionView({ marks: [], agent: "build", todos: [{ content: "x", status: "pending" }], now });
  assert.equal(view, idleMission);
  assert.equal(buildMissionView({ marks: [], agent: "lit-loop", todos: [], ledger: ledger({ criteria: [criterion("C1", "pass")] }), now }), idleMission);
  assert.deepEqual(chipLine(view, resting, palette, 80), []);
  assert.equal(missionPanel(view, resting, palette), undefined);
});

test("phases follow the marks: planning, a saved plan, then work with todo progress and the next item", () => {
  const planning = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }], todos: [], now });
  assert.equal(planning.phase, "plan");
  assert.deepEqual(planning.steps.map((step) => step.id), ["interview", "plan", "work", "review", "done"]);
  assert.deepEqual(planning.steps.map((step) => step.state), ["skip", "now", "todo", "todo", "todo"]);

  const working = buildMissionView({
    marks: [{ at: 1, mode: "lit-plan" }, { at: 2, command: "lit-plan", operation: "save-plan" }, { at: 3, mode: "start-work" }],
    todos: [
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "dropped", status: "cancelled" },
      { content: "README 데모 GIF 교체", status: "in_progress" },
      { content: "later", status: "pending" }
    ],
    now
  });
  assert.equal(working.phase, "work");
  assert.equal(working.planSaved, true);
  assert.deepEqual(working.steps.map((step) => step.state), ["skip", "done", "now", "todo", "todo"]);
  assert.deepEqual(working.progress, { done: 2, total: 4 });
  assert.equal(working.next, "README 데모 GIF 교체");
});

test("a bounded lit-task never claims a plan it did not make", () => {
  const view = buildMissionView({ marks: [{ at: 1, mode: "lit-task" }], todos: [], now });
  assert.deepEqual(view.steps.map((step) => step.state), ["skip", "skip", "now", "todo", "todo"]);
  assert.match(text(chipLine(view, resting, palette, 80)), /plan –/u);
});

test("the ledger supplies goal, criteria progress, the next criterion and an evidence timeline", () => {
  const view = buildMissionView({
    marks: [{ at: 1, mode: "lit-loop" }],
    todos: [],
    ledger: ledger({
      criteria: [
        criterion("C1", "pass", [{ kind: "green", ref: "npm test", detail: "", at: "2026-10-10T11:58:00.000Z" }]),
        criterion("C2", "in_progress"),
        criterion("C3", "pending")
      ],
      checkpoints: [{ id: "k1", at: "2026-10-10T11:50:00.000Z", summary: "HUD v2", activeCriterion: "C2" }]
    }),
    now
  });
  assert.deepEqual(view.progress, { done: 1, total: 3 });
  assert.equal(view.next, "C2 C2 scenario");
  assert.equal(view.goal?.title, "HUD를 짧게 만들기");
  assert.deepEqual(view.goal?.criteria.map((entry) => entry.status), ["pass", "in_progress", "pending"]);
  assert.deepEqual(view.timeline.map((event) => [event.ago, event.kind]), [["2m", "green"], ["10m", "checkpoint"], ["20m", "goal"]]);
});

test("a goal last touched before this session's first lit turn is earlier work and stays out of the panel", () => {
  const stale = buildMissionView({ marks: [{ at: now, mode: "lit-loop" }], todos: [], ledger: ledger({ status: "complete", updatedAt: "2026-10-10T10:00:00.000Z", criteria: [criterion("C1", "pass")] }), now });
  assert.equal(stale.goal, undefined);
  assert.equal(stale.complete, false);
  const fresh = buildMissionView({ marks: [{ at: now, mode: "lit-loop" }], todos: [], ledger: ledger({ updatedAt: "2026-10-10T12:00:30.000Z", criteria: [criterion("C1", "pass")] }), now });
  assert.equal(fresh.goal?.passed, 1);
});

test("open review blockers, retries, pending permission and a full context turn the mission amber", () => {
  const view = buildMissionView({
    marks: [{ at: 1, mode: "lit-loop" }],
    todos: [],
    ledger: ledger({ criteria: [criterion("C1", "pass")], reviewBlockers: [{ id: "B1", detail: "화면 점검 실패", resolved: false, needsUserDecision: false }] }),
    sessionStatus: "retry",
    retryMessage: "rate limited",
    pendingPermissions: 1,
    contextPercent: 76.4,
    now
  });
  assert.equal(view.phase, "review");
  assert.deepEqual(view.steps.map((step) => step.state), ["skip", "skip", "done", "warn", "todo"]);
  assert.deepEqual(view.warnings.map((warning) => warning.kind), ["blocker", "retry", "permission", "context"]);
  assert.equal(view.warnings.at(-1)?.text, "ctx 76%");

  const unfinished = buildMissionView({
    marks: [{ at: 1, mode: "lit-loop" }],
    todos: [],
    ledger: ledger({ status: "review_blocked", criteria: [criterion("C1", "pass"), criterion("C2", "pending")], reviewBlockers: [{ id: "B1", detail: "d", resolved: false, needsUserDecision: false }] }),
    now
  });
  assert.equal(unfinished.phase, "work");
  assert.deepEqual(unfinished.steps.map((step) => step.state), ["skip", "skip", "warn", "todo", "todo"]);
});

test("a completed goal is the done phase, and the transition toasts once with the completion moment", () => {
  const before = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass")] }), now });
  const after = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass")] }), now });
  assert.equal(after.phase, "done");
  assert.equal(after.complete, true);
  assert.deepEqual(after.steps.map((step) => step.state), ["skip", "skip", "done", "done", "done"]);
  const notices = missionNotices(before, after);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].celebrate, true);
  assert.deepEqual(missionNotices(after, after), []);
});

test("gate notices: plan saved, goal set, criterion passed, blocker opened and resolved; a first view stays quiet", () => {
  const plan = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }], todos: [], now });
  const saved = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }, { at: 2, command: "lit-plan", operation: "save-plan" }], todos: [], now });
  assert.deepEqual(missionNotices(undefined, saved), []);
  assert.deepEqual(missionNotices(plan, saved).map((notice) => notice.title), ["🔥 Plan saved"]);

  const blockedPlan = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }, { at: 2, command: "lit-plan", operation: "save-plan", blocked: true }], todos: [], now });
  assert.deepEqual(missionNotices(plan, blockedPlan).map((notice) => notice.variant), ["warning"]);

  const goal = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pending")] }), now });
  const noGoal = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], now });
  assert.deepEqual(missionNotices(noGoal, goal).map((notice) => notice.title), ["🔥 Goal set"]);

  const passed = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass")] }), now });
  assert.deepEqual(missionNotices(goal, passed).map((notice) => notice.title), ["✓ C1 passed"]);

  const blocked = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass")], reviewBlockers: [{ id: "B1", detail: "d", resolved: false, needsUserDecision: true }] }), now });
  assert.deepEqual(missionNotices(passed, blocked).map((notice) => [notice.variant, notice.title]), [["warning", "⚑ Needs your decision"]]);
  assert.deepEqual(missionNotices(blocked, passed).map((notice) => notice.title), ["✓ B1 resolved"]);
});

test("several gate events in one refresh become one toast led by the most urgent", () => {
  const lead = leadingNotice([
    { variant: "info", title: "🔥 Goal set", message: "g · 3 criteria" },
    { variant: "warning", title: "⚑ Review blocker", message: "B1 d" },
    { variant: "success", title: "✓ C1 passed", message: "1/3 criteria" }
  ]);
  assert.deepEqual(lead, { variant: "warning", title: "⚑ Review blocker", message: "B1 d · +2 more" });
  assert.equal(leadingNotice([{ variant: "warning", title: "w", message: "m" }, { variant: "success", title: "🔥 Complete", message: "c", celebrate: true }]).title, "🔥 Complete");
  assert.equal(leadingNotice([]), undefined);
});

test("cell widths count Hangul and emoji as two cells and truncation never overflows", () => {
  assert.equal(cellWidth("README 데모"), 11);
  assert.equal(cellWidth("🔥 LIT"), 6);
  assert.equal(cellWidth("✓ ● ○ ⚑ ▰ ▱ █ ░"), 15);
  for (const max of [1, 2, 5, 9, 12]) {
    const cut = truncateCells("README 데모 GIF 교체 작업을 오늘 끝내기", max);
    assert.ok(cellWidth(cut) <= max, `${cut} > ${max}`);
  }
  assert.equal(truncateCells("짧음", 10), "짧음");
  assert.equal(truncateCells("가나다라마", 6), "가나…");
});

test("every panel row fits inside the rounded box, Hangul-heavy content and every motion frame included", () => {
  const view = buildMissionView({
    marks: [{ at: 1, mode: "lit-loop" }],
    todos: [{ content: "README 데모 GIF 교체하고 한국어 설명을 다시 쓰기", status: "in_progress" }, { content: "b", status: "completed" }],
    ledger: ledger({
      title: "아주 긴 목표 제목이 사이드바 폭을 넘어가도 잘려야 해요",
      criteria: [criterion("C1", "pass", [{ kind: "scenario", ref: "실제 화면 확인 스크린샷", detail: "", at: "2026-10-10T11:59:00.000Z" }]), criterion("C2", "fail"), criterion("C3", "blocked")],
      reviewBlockers: [{ id: "B1", detail: "화면 점검이 실패했고 다시 확인해야 해요", resolved: false, needsUserDecision: false }]
    }),
    contextPercent: 81,
    now
  });
  const keys = missionRowKeys(view);
  const frames = [resting, { ...resting, warn: 1 }];
  for (let t = 0; t <= 1300; t += 50) frames.push({ ...resting, t, entering: keys, chipEnter: true, moving: true }, { ...resting, t, celebrate: t, moving: true });
  for (const frame of frames) {
    const panel = missionPanel(view, frame, palette);
    assert.equal(panel.rows.length, keys.length);
    for (const row of panel.rows) assert.ok(lineWidth(row) <= panelInnerWidth, `${frame.t}: ${text(row)} (${lineWidth(row)})`);
  }
  assert.equal(panelInnerWidth, 32);
});

test("the panel box: phase title, criteria bottom title, and a border that carries the state", () => {
  const working = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending"), criterion("C3", "pending")] }), now });
  const box = missionPanel(working, restingFrameFor(working), palette);
  assert.equal(working.family, "loop", "lit-loop counting criteria is the loop family");
  assert.equal(box.title, " 🔥 LIT ▸ CRITERION ");
  assert.equal(box.bottomTitle, " 1/3 criteria ");
  assert.equal(box.border, palette.accent);
  assert.equal(box.background, undefined, "the default palette has no opaque panel token");
  assert.equal(text(box.rows[3]), "HUD를 짧게 만들기");
  assert.match(text(box.rows[0]), /^█   █ ▀█▀  lit-loop/u);
  assert.match(text(box.rows[1]), /^█▄▄ █  █   ● active/u);
  assert.deepEqual(box.rows.slice(4, 13).map(text), ["◇ interview –", "┃", "◇ plan –", "┃", "◉ criterion 1/3", "┆", "◇ review", "┆", "◇ done"]);
  assert.match(text(box.rows[13]), /^█{10}[▏▎▍▌▋▊▉]?─+$/u);

  const blocked = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass")], reviewBlockers: [{ id: "B1", detail: "d", resolved: false, needsUserDecision: false }] }), now });
  const amber = missionPanel(blocked, restingFrameFor(blocked), palette);
  assert.equal(amber.title, " 🔥 LIT ▸ REVIEW ⚑ ");
  assert.equal(amber.border, palette.warning);
  assert.match(text(amber.rows[1]), /⚑ review blocked/u, "a warning carries a glyph and words, not colour alone");

  const done = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass")] }), now });
  const green = missionPanel(done, restingFrameFor(done), palette);
  assert.equal(green.title, " 🔥 LIT ▸ COMPLETE ");
  assert.equal(green.bottomTitle, " 1/1 criteria ✓ ");
  assert.equal(green.border, palette.success);
  assert.match(text(green.rows[1]), /✓ COMPLETE/u);
});
test("the chip is the breadcrumb around the running stage with a gradient bar and sheds labels before values as it narrows", () => {
  const view = buildMissionView({ marks: [{ at: 1, mode: "lit-plan" }, { at: 2, command: "lit-plan", operation: "save-plan" }], todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }], now });
  assert.equal(text(chipLine(view, resting, palette, 80)), " 🔥 LIT  plan ✓ ›  WORK  ▰▰▰▰▱▱▱ 1/2 › review");
  assert.equal(chipTier(view, resting, palette, 80), "full");
  assert.equal(chipTier(view, resting, palette, 36), "medium");
  assert.equal(text(chipLine(view, resting, palette, 36)), "🔥  WORK  ▰▰▰▱▱ 1/2 › review");
  assert.equal(chipTier(view, resting, palette, 16), "tight");
  assert.equal(text(chipLine(view, resting, palette, 16)), "🔥  1/2 ");
  for (const budget of [16, 36, 80]) assert.ok(lineWidth(chipLine(view, resting, palette, budget)) <= budget, String(budget));
  const line = chipLine(view, resting, palette, 80);
  const plan = line.find((segment) => segment.text === "plan ✓");
  assert.equal(plan.fg, mixHex(palette.primary, palette.secondary, 0.5), "each stage takes its place on the primary-secondary-accent ramp");
  const filled = line.filter((segment) => segment.text === "▰").map((segment) => segment.fg);
  assert.equal(filled[0], palette.primary);
  assert.notEqual(filled.at(-1), palette.primary, "the bar runs along the primary-secondary-accent ramp");
  const blocked = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending")], reviewBlockers: [{ id: "B1", detail: "d", resolved: false, needsUserDecision: false }] }), now });
  assert.match(text(chipLine(blocked, restingFrameFor(blocked), palette, 80)), / CRITERION ⚑ .* 1\/2/u);
  assert.match(text(chipLine(blocked, restingFrameFor(blocked), palette, 16)), /⚑ 1\/2/u);
});

test("the home line names the last mission and sheds its labels first; no ledger, no line", () => {
  const last = lastMission(ledger({ status: "complete", title: "hello.txt 인사말 만들기", criteria: [criterion("C1", "pass"), criterion("C2", "pass"), criterion("C3", "pass")] }));
  assert.equal(text(homeLine(last, palette, 69)), "🔥 lit ready · last: hello.txt 인사말 만들기 ✓ 3/3");
  assert.equal(text(homeLine(last, palette, 40)), "🔥 lit · hello.txt 인사말 만들기 ✓ 3/3");
  assert.ok(lineWidth(homeLine(last, palette, 30)) <= 30);
  assert.deepEqual(homeLine(lastMission(undefined), palette, 69), []);
});
test("the gradient bar always spans its cell count and fills smoothly in eighths", () => {
  for (const ratio of [0, 0.01, 0.33, 0.5, 0.97, 1]) {
    assert.equal(lineWidth(progressBar(ratio, 14, palette)), 14, String(ratio));
  }
  assert.equal(progressBar(1, 4, palette).filter((segment) => segment.text === "█").length, 4);
  assert.ok(progressBar(0.53, 10, palette).some((segment) => /[▏▎▍▌▋▊▉]/u.test(segment.text)));
  assert.equal(text(progressBar(0, 6, palette)), "──────", "the empty track is a thin rule, not a dither");
  const ramp = progressBar(1, 4, palette).map((segment) => segment.fg);
  assert.equal(ramp[0], palette.primary);
  assert.equal(ramp[3], palette.accent);
});

test("easing curves start at 0, end at 1, and ease-out-back overshoots before settling", () => {
  for (const curve of Object.values(ease)) {
    assert.ok(Math.abs(curve(0)) < 1e-9);
    assert.ok(Math.abs(curve(1) - 1) < 1e-9);
  }
  assert.ok(ease.outBack(0.7) > 1);
  assert.ok(ease.inOutCubic(0.25) < 0.25 && ease.inOutCubic(0.75) > 0.75);
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#ff2d95", "#00e5ff", 0), "#ff2d95");
});

test("motion runs only around a state change and stops; idle frames are static", () => {
  const first = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }], now });
  const appear = planMotion(undefined, first, 1000, idleMotion);
  const opening = sampleMotion(appear, 1000);
  assert.equal(opening.moving, true);
  assert.equal(opening.chipEnter, true);
  assert.deepEqual(opening.entering, missionRowKeys(first));
  assert.equal(opening.barRatio, 0);
  assert.equal(missionPanel(first, opening, palette).rows.every((row) => row.length === 0), true, "rows wait for their stagger");
  const settled = sampleMotion(appear, 1000 + 2000);
  assert.equal(settled.moving, false);
  assert.equal(settled.t, Number.POSITIVE_INFINITY);
  assert.equal(settled.barRatio, 0.5);

  const second = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [{ content: "a", status: "completed" }, { content: "b", status: "completed" }, { content: "c", status: "pending" }], now });
  const moved = planMotion(first, second, 5000, appear);
  assert.deepEqual(sampleMotion(moved, 5000).entering, [], "the same rows do not replay their entry");
  const mid = sampleMotion(moved, 5000 + motionTiming.fill / 2);
  assert.ok(mid.barRatio > 0.5 && mid.barRatio < 2 / 3, String(mid.barRatio));
  assert.equal(sampleMotion(moved, 5000 + motionTiming.fill).moving, false);

  // A retarget mid-tween starts from where the bar is, never jumping back.
  const back = planMotion(second, first, 5000 + motionTiming.fill / 2, moved);
  assert.ok(Math.abs(sampleMotion(back, 5000 + motionTiming.fill / 2).barRatio - mid.barRatio) < 1e-9);

  const still = planMotion(undefined, first, 1000, idleMotion, false);
  assert.equal(sampleMotion(still, 1000).moving, false);
});

test("a warning cross-fades in 140 ms and slides its row in; the completion moment ends within 1.2 s", () => {
  const calm = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const amber = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), contextPercent: 90, now });
  const settled = planMotion(undefined, calm, 0, idleMotion);
  const fading = planMotion(calm, amber, 10_000, settled);
  const half = sampleMotion(fading, 10_000 + motionTiming.crossfade / 2).warn;
  assert.ok(half > 0.2 && half < 0.8, String(half));
  assert.equal(sampleMotion(fading, 10_000 + motionTiming.crossfade).warn, 1);
  assert.deepEqual(sampleMotion(fading, 10_000).entering, ["warn:context:ctx 90%"]);

  const done = buildMissionView({ marks: [{ at: 1, mode: "lit-loop" }], todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const party = planMotion(calm, done, 20_000, settled);
  const at = (ms) => sampleMotion(party, 20_000 + ms);
  assert.equal(at(600).celebrate, 600);
  assert.equal(at(motionTiming.complete).moving, false);
  assert.equal(at(motionTiming.complete).celebrate, undefined);
  assert.equal(motionTiming.complete <= 1200, true);
  assert.match(text(chipLine(done, at(100), palette, 80)), / CRITERION .* 2\/2 › review › done/u, "the running stage flips to done at 200 ms");
  assert.match(text(chipLine(done, at(400), palette, 80)), /criterion 2\/2 ✓ › review ✓ › done ✓/u);
  const pop = missionPanel(done, at(600), palette);
  assert.match(text(pop.rows[1]), /✓ COMPLETE/u);
  assert.ok(pop.rows[1].some((segment) => segment.bg !== undefined), "COMPLETE is a filled pill while it pops");
  const rest = missionPanel(done, at(motionTiming.complete), palette);
  assert.ok(rest.rows[1].every((segment) => segment.bg === undefined), "then it settles to plain green text");
  const embersSeen = [300, 400, 500, 600, 700].some((ms) => /[·✦✧˚]/u.test(missionPanel(done, at(ms), palette).rows.map(text).join("\n")));
  assert.ok(embersSeen, "embers rise through empty cells");
});
test("theme colours arrive as RGBA objects and become hex; missing tokens fall back", () => {
  assert.equal(colorToHex({ toInts: () => [255, 45, 149, 255] }, "#000000"), "#ff2d95");
  assert.equal(colorToHex({ r: 0, g: 0.5, b: 1 }, "#000000"), "#0080ff");
  assert.equal(colorToHex("nope", "#123456"), "#123456");
  assert.equal(paletteFromTheme({ primary: { toInts: () => [1, 2, 3, 255] } }).primary, "#010203");
});

test("the TUI state slice becomes mission input: marks from user parts, last agent, todos and context use", () => {
  const state = {
    path: { worktree: "/", directory: "/tmp/project" },
    provider: [{ id: "openai", models: { "gpt-x": { limit: { context: 1000 } } } }],
    session: {
      messages: () => [
        { id: "m1", role: "user", agent: "lit-plan", time: { created: 10 } },
        { id: "m2", role: "assistant", providerID: "openai", modelID: "gpt-x", tokens: { input: 600, output: 100, reasoning: 0, cache: { read: 50, write: 0 } } },
        { id: "m3", role: "user", agent: "lit-loop", time: { created: 20 } }
      ],
      todo: () => [{ content: "a", status: "pending" }],
      status: () => ({ type: "retry", message: "429" }),
      permission: () => [{}],
      question: () => []
    },
    part: (id) => (id === "m1" ? [{ metadata: { litopencode: { mode: "lit-plan" } } }, { metadata: {} }] : id === "m3" ? [{ metadata: { litopencode: { command: "start-work", mode: "bounded-authority-lifecycle" } } }] : [])
  };
  const input = readMissionInput(state, "s1", undefined, now);
  assert.deepEqual(input.marks, [{ at: 10, mode: "lit-plan" }, { at: 20, mode: "bounded-authority-lifecycle", command: "start-work" }]);
  assert.equal(input.agent, "lit-loop");
  assert.equal(input.sessionStatus, "retry");
  assert.equal(input.retryMessage, "429");
  assert.equal(input.pendingPermissions, 1);
  assert.equal(input.contextPercent, 75);
  assert.equal(missionProjectRoot(state.path), "/tmp/project");
  assert.equal(missionProjectRoot({ worktree: "/repo", directory: "/repo/sub" }), "/repo");
  assert.equal(buildMissionView(input).phase, "work");
});

test("the ledger reader reads goals.json, caches it, and refuses a symbolic link", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopencode-tui-"));
  try {
    const dir = path.join(root, ".litopencode", "litgoal", "lit-loop");
    await fs.mkdir(dir, { recursive: true });
    const read = createLedgerReader();
    assert.equal(read(root), undefined);
    await fs.writeFile(path.join(dir, "goals.json"), JSON.stringify(ledger({})));
    assert.equal(read(root).activeGoalId, "g1");
    assert.equal(read(root), read(root));

    const elsewhere = path.join(root, "elsewhere.json");
    await fs.writeFile(elsewhere, JSON.stringify(ledger({ title: "linked" })));
    await fs.rm(path.join(dir, "goals.json"));
    await fs.symlink(elsewhere, path.join(dir, "goals.json"));
    assert.equal(createLedgerReader()(root), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
