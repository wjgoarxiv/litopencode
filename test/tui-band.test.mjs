import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { bandCard, readBandOptions } from "../src/tui/mission-band.ts";

// The band's switches and its opt-in detail card. The status card itself is covered in
// tui-card.test.mjs.
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
