import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView, idleMission } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { footerBudget, footerStatus } from "../src/v2/tui-footer.ts";

// The line OpenCode 2 gives us beside the host's own spinner and figures (prompt.footer.status) must never be
// clipped mid-word. It steps down by the room it has: ignition mark plus the whole stage chip, the chip at a
// smaller size, the chip as `🔥 1/3`, the bare 🔥, then nothing.
const palette = paletteFromTheme(undefined);
const text = (line) => line.map((segment) => segment.text).join("");
const now = Date.now();
const ledger = {
  version: 1,
  activeGoalId: "g1",
  goals: [{ id: "g1", sessionId: "s", objective: "o", title: "Ship", status: "active", createdAt: new Date(now - 300_000).toISOString(), updatedAt: "", criteria: ["C1", "C2", "C3"].map((id, index) => ({ id, scenario: `${id} works`, qaChannel: "tui", testRef: "t", status: index === 0 ? "pass" : "pending", evidence: [] })), checkpoints: [], steering: [], reviewBlockers: [] }]
};
const working = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-loop" }], todos: [], ledger, now });
const idle = idleMission;
const draw = (budget, view = working, name = "lit-loop") => footerStatus({ name, view, frame: restingFrameFor(view), palette, budget });

test("the room left for our line comes from the width, the sidebar and what the host draws around it", () => {
  assert.equal(footerBudget({ columns: 100, sidebar: false, busy: true }), 38);
  assert.equal(footerBudget({ columns: 130, sidebar: true, busy: true }), 26, "the sidebar takes 42 columns");
  assert.equal(footerBudget({ columns: 70, sidebar: false, busy: true }), 8);
  assert.equal(footerBudget({ columns: 100, sidebar: false, busy: false }), 40, "an idle footer has fewer host figures on the left but more on the right");
  assert.equal(footerBudget({ columns: 20, sidebar: false, busy: true }), 0, "never negative");
});

test("with room, the ignition mark and the whole chip show", () => {
  const wide = text(draw(200));
  assert.match(wide, /^🔥 LIT IGNITED · lit-loop {3}🔥 LIT {2}plan – › {2}WORK {2}› review$/u);
});

test("squeezed, the chip gets smaller before the mark goes, and the mark's words go before the chip does", () => {
  assert.equal(text(draw(45)), "🔥 LIT IGNITED · lit-loop  🔥  WORK  › review", "mark plus the middle chip");
  assert.equal(text(draw(36)), "🔥 LIT IGNITED · lit-loop  🔥  WORK ", "mark plus the small chip");
  assert.equal(text(draw(35)), "🔥  WORK  › review", "the mark's words go once they would crowd the chip; the chip stays");
  assert.equal(text(draw(20)), "🔥  WORK  › review");
  assert.equal(text(draw(12)), "🔥  WORK ", "the small chip alone");
  assert.equal(text(draw(8)), "🔥", "when not even the small chip fits, only the flame");
  assert.equal(text(draw(2)), "🔥");
  assert.deepEqual(draw(1), [], "and below two cells, nothing");
  assert.deepEqual(draw(0), []);
});

test("every budget gets a line that fits it, and the line only ever loses things as the budget falls", () => {
  let previous = Number.POSITIVE_INFINITY;
  for (let budget = 160; budget >= 0; budget -= 1) {
    const line = draw(budget);
    const width = lineWidth(line);
    assert.ok(width <= budget, `budget ${budget} got width ${width}: ${text(line)}`);
    const plain = text(line);
    assert.doesNotMatch(plain, /lit-loo\b|IGNITE\b|IGNIT\b/u, `no word is cut at ${budget}`);
    const rank = width;
    assert.ok(rank <= previous || previous === Number.POSITIVE_INFINITY || rank - previous <= 40, "no sudden growth when the room shrinks");
    previous = rank;
  }
});

test("an idle session has no chip: the mark steps from full to short to the flame to nothing", () => {
  assert.equal(text(draw(80, idle)), "🔥 LIT IGNITED · lit-loop");
  assert.equal(text(draw(20, idle)), "🔥 lit-loop");
  assert.equal(text(draw(6, idle)), "🔥");
  assert.equal(text(draw(10, idle)), "🔥", "a name that does not fit whole is dropped, not cut");
  assert.deepEqual(draw(1, idle), []);
  assert.equal(text(footerStatus({ name: "lit-loop", view: undefined, frame: restingFrameFor(idle), palette, budget: 80 })), "🔥 LIT IGNITED · lit-loop", "no view at all is the same as idle");
});

test("a long discipline name is dropped whole when it does not fit", () => {
  const line = draw(14, idle, "a-very-long-discipline-name");
  assert.equal(text(line), "🔥", "dropped whole rather than cut");
});
