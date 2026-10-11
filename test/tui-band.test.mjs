import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { idleMotion, motionTiming, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { bandCard, bandRibbon, readBandOptions } from "../src/tui/mission-band.ts";

// The band is LitOpenCode's one-row ribbon in OpenCode's full-width app_bottom slot: the mission on
// the main screen, warnings inline, an opt-in card, and the shared completion moment.
const now = Date.parse("2026-10-11T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const text = (line) => line.map((segment) => segment.text).join("");

function ledger(goal) {
  return { version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "hello.txt 인사말 만들기", status: "active", createdAt: "2026-10-11T11:55:00.000Z", updatedAt: "", criteria: [], checkpoints: [], steering: [], reviewBlockers: [], ...goal }] };
}
const criterion = (id, status) => ({ id, scenario: `${id} README links hello.txt`, qaChannel: "tui", testRef: "t", status, evidence: [] });
const marks = [{ at: now - 7 * 60_000, mode: "lit-task" }];
const working = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending"), criterion("C3", "pending")] }), now });
const blocked = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pending")], reviewBlockers: [{ id: "B1", detail: "README 링크가 깨졌어요", resolved: false, needsUserDecision: false }] }), now });

test("band options: on by default with the card off; band:false turns it off; band:{card:true} opts into the card", () => {
  assert.deepEqual(readBandOptions(undefined), { enabled: true, card: false });
  assert.deepEqual(readBandOptions({ motion: false }), { enabled: true, card: false });
  assert.deepEqual(readBandOptions({ band: false }), { enabled: false, card: false });
  assert.deepEqual(readBandOptions({ band: true }), { enabled: true, card: false });
  assert.deepEqual(readBandOptions({ band: { card: true } }), { enabled: true, card: true });
  assert.deepEqual(readBandOptions({ band: { card: "yes" } }), { enabled: true, card: false });
});

test("the ribbon fills one row exactly: pills, bar, next task and elapsed time; idle sessions draw nothing", () => {
  assert.equal(working.elapsedMinutes, 7);
  const line = bandRibbon(working, restingFrameFor(working), palette, 166, { inLane: false });
  assert.equal(lineWidth(line), 166);
  assert.match(text(line), /^ 🔥 LIT   PLAN –  ›  WORK 1\/3  ›  REVIEW  +█+─+  ▸ C2 C2 README links hello\.txt +⟳ 7m$/u);
  const idle = buildMissionView({ marks: [], todos: [], now });
  assert.deepEqual(bandRibbon(idle, restingFrameFor(idle), palette, 166, { inLane: false }), []);
});

test("a warning takes the place of the next task inside the ribbon, with ⚑ and words", () => {
  const line = text(bandRibbon(blocked, restingFrameFor(blocked), palette, 166, { inLane: false }));
  assert.match(line, /⚑ B1 README 링크가 깨졌어요/u);
  assert.doesNotMatch(line, /▸/u);
});

test("narrow widths shed labels, then the next text, then bar width, then the time, and never wrap", () => {
  const frame = restingFrameFor(working);
  const at = (width) => text(bandRibbon(working, frame, palette, width, { inLane: false }));
  const lastWidthWith = (pattern) => {
    for (let width = 12; width <= 166; width += 1) if (pattern.test(at(width))) return width;
    return Number.POSITIVE_INFINITY;
  };
  for (let width = 12; width <= 166; width += 1) {
    assert.ok(lineWidth(bandRibbon(working, frame, palette, width, { inLane: false })) <= width, `width ${width}: ${at(width)}`);
  }
  const labels = lastWidthWith(/PLAN/u);
  const next = lastWidthWith(/▸/u);
  const wideBar = lastWidthWith(/[█─]{18}/u);
  const anyBar = lastWidthWith(/[█─]/u);
  const time = lastWidthWith(/⟳/u);
  assert.ok(labels > next && next > wideBar && wideBar > anyBar && anyBar > time, JSON.stringify({ labels, next, wideBar, anyBar, time }));
  assert.match(at(100), /▸ C2/u);
  assert.match(at(40), /⟳ 7m$/u);
});

test("a child session shows the parent mission marked as a lane", () => {
  assert.match(text(bandRibbon(working, restingFrameFor(working), palette, 166, { inLane: true })), /⟳ 7m · in lane$/u);
});

test("the completion moment plays in the band on the shared clock: sparks and COMPLETE within 1.2 s, then still", () => {
  const before = buildMissionView({ marks, todos: [], ledger: ledger({ criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const done = buildMissionView({ marks, todos: [], ledger: ledger({ status: "complete", criteria: [criterion("C1", "pass"), criterion("C2", "pass")] }), now });
  const motion = planMotion(before, done, 0, planMotion(undefined, before, -10_000, idleMotion));
  assert.doesNotMatch(text(bandRibbon(done, sampleMotion(motion, 100), palette, 166, { inLane: false })), /active/u);
  const mid = text(bandRibbon(done, sampleMotion(motion, 500), palette, 166, { inLane: false }));
  assert.match(mid, /✓ COMPLETE/u);
  assert.match(mid, /✓ COMPLETE +[ ·✦✧˚]*[✦✧˚·]/u, "sparks show after COMPLETE while it celebrates");
  assert.match(mid, /^ 🔥 LIT /u, "the pills do not move while the sparks play");
  const rest = sampleMotion(motion, motionTiming.complete);
  assert.equal(rest.moving, false);
  const settled = text(bandRibbon(done, rest, palette, 166, { inLane: false }));
  assert.match(settled, /✓ COMPLETE/u);
  assert.doesNotMatch(settled, /[✦✧˚]/u);
});

test("the opt-in card keeps a fixed four rows while a goal exists, warnings first, so the prompt never jumps", () => {
  const calm = bandCard(working, restingFrameFor(working), palette, 160);
  assert.equal(calm.rows.length, 4);
  assert.equal(calm.title, " 🔥 LIT ▸ WORK ");
  assert.equal(calm.border, palette.accent);
  const amber = bandCard(blocked, restingFrameFor(blocked), palette, 160);
  assert.equal(amber.rows.length, 4);
  assert.match(text(amber.rows[0]), /^⚑ B1 README/u);
  assert.equal(amber.border, palette.warning);
  for (const row of [...calm.rows, ...amber.rows]) assert.ok(lineWidth(row) <= 160);
  assert.match(text(calm.rows[1]), /^goal  hello\.txt 인사말 만들기  ✓C1 ○C2 ○C3$/u, "the criteria keep their gap after the title");
  const noGoal = buildMissionView({ marks, todos: [], now });
  assert.equal(bandCard(noGoal, restingFrameFor(noGoal), palette, 160), undefined);
});
