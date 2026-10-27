import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { bandCard, readBandOptions, statusCard } from "../src/tui/mission-band.ts";

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

test("the band's LIT word is LIT pink, deepened on light themes", () => {
  const idle = buildMissionView({ marks: [], todos: [], now });
  const word = (pal) => statusCard({ view: idle, frame: restingFrameFor(idle), chips: [], figures: { contextPercent: 4, inLane: false } }, pal, 98)[0].find((segment) => segment.text === "LIT");
  assert.equal(word(palette).fg, "#ff2d95");
  assert.equal(word(palette).bold, true);
  assert.equal(word(paletteFromTheme(undefined, "light")).fg, "#d81b78");
});

test("a newer installed version puts `restart to <v>` first in the bottom border; none otherwise", () => {
  const idle = buildMissionView({ marks: [], todos: [], now });
  const bottom = (figures, width = 98) => text(statusCard({ view: idle, frame: restingFrameFor(idle), chips: [], figures: { contextPercent: 4, inLane: false, ...figures } }, palette, width).at(-1));
  assert.match(bottom({ restartTo: "9.9.9", branch: "main" }), /restart to 9\.9\.9 · ctx 4% · ⎇ main/u);
  assert.match(bottom({ restartTo: "9.9.9", branch: "a-very-long-branch-name" }, 30), /restart to 9\.9\.9/u, "the chip is the last figure to go");
  assert.doesNotMatch(bottom({ branch: "main" }), /restart/u);
  const chip = statusCard({ view: idle, frame: restingFrameFor(idle), chips: [], figures: { contextPercent: 4, inLane: false, restartTo: "9.9.9" } }, palette, 98).at(-1).find((segment) => segment.text.startsWith("restart"));
  assert.equal(chip.fg, palette.warning);
  for (const width of [20, 40, 98]) assert.equal(lineWidth(statusCard({ view: idle, frame: restingFrameFor(idle), chips: [], figures: { contextPercent: 4, inLane: false, restartTo: "9.9.9" } }, palette, width).at(-1)), width);
});

test("text from records cannot carry terminal control sequences onto the card", async () => {
  const { truncateCells } = await import("../src/tui/mission-text.ts");
  const hostile = "fix \u001b]0;pwned\u0007 the \u001b[2Jbug\u009b31m now\u0000\u007f";
  const cut = truncateCells(hostile, 60);
  assert.doesNotMatch(cut, /[\u0000-\u001f\u007f-\u009f]/u);
  assert.match(cut, /fix .*the .*bug/u);
  const now = Date.parse("2026-10-13T08:05:00.000Z");
  const criterion = (id, scenario, status) => ({ id, scenario, qaChannel: "", testRef: "", status, evidence: [] });
  const ledger = { version: 1, activeGoalId: "G1", goals: [{ id: "G1", sessionId: "ses_demo", objective: `objective ${hostile}`, title: `title ${hostile}`, status: "active", createdAt: "2026-10-13T08:04:30.000Z", updatedAt: "2026-10-13T08:04:40.000Z", criteria: [criterion("C1", "one", "pass"), criterion("C2", `next ${hostile}`, "pending")], checkpoints: [], steering: [], reviewBlockers: [] }] };
  const view = buildMissionView({ marks: [{ at: now - 20_000, mode: "lit-loop" }], todos: [{ content: `todo ${hostile}`, status: "in_progress" }], ledger, sessionStatus: "idle", now, agent: "lit-loop" });
  const rows = statusCard({ view, frame: restingFrameFor(view, now), chips: [{ name: "lit-loop", current: false }], busy: false, figures: { contextPercent: 4, branch: `main${hostile}`, inLane: false } }, paletteFromTheme(undefined), 98);
  for (const row of rows) for (const segment of row) assert.doesNotMatch(segment.text, /[\u0000-\u001f\u007f-\u009f]/u, JSON.stringify(segment.text));
});
