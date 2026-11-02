import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { paletteFromTheme } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { createUsageLimits, limitWindows } from "../src/v2/usage-limits.ts";

// OpenCode 2 publishes one usage source to plugins: client.usage.limits(), the OpenCode Go allowance of the
// Console workspace the location is signed in to (rolling = 5 hours, weekly, monthly), or null when it is not
// signed in. The card shows 5h and 1w from it, only for a Go session, and shows nothing when there is no source.
const meter = (percent, limited = false) => ({ percent, limited, resetsAt: 1 });
const go = (rolling, weekly, monthly) => ({ workspace: { id: "wrk_1", usageURL: "https://x" }, go: { rolling, weekly, monthly }, budgets: [] });

test("no allowance means no windows: null, a missing go block, a signed-out reply and junk all draw nothing", () => {
  assert.deepEqual(limitWindows(undefined), []);
  assert.deepEqual(limitWindows(null), []);
  assert.deepEqual(limitWindows({ location: {}, data: null }), []);
  assert.deepEqual(limitWindows({ data: { workspace: {}, budgets: [] } }), []);
  assert.deepEqual(limitWindows("42%"), []);
  assert.deepEqual(limitWindows({ data: { go: { rolling: { percent: "a lot" } } } }), []);
});

test("the rolling and weekly windows become 5h and 1w; the monthly one appears only when it is nearly spent or refusing", () => {
  assert.deepEqual(limitWindows({ data: go(meter(42.4), meter(18), meter(5)) }), [
    { label: "5h", percent: 42, limited: false },
    { label: "1w", percent: 18, limited: false }
  ]);
  assert.deepEqual(limitWindows(go(meter(42), meter(18), meter(91))).map((window) => window.label), ["5h", "1w", "1mo"], "a bare Info works too");
  assert.deepEqual(limitWindows(go(meter(100, true), meter(60), meter(10, true))).map((window) => [window.label, window.limited]), [["5h", true], ["1w", false], ["1mo", true]]);
  assert.deepEqual(limitWindows(go(meter(180), meter(-4), meter(1))), [{ label: "5h", percent: 100, limited: false }, { label: "1w", percent: 0, limited: false }], "clamped to 0-100");
});

test("a window with a bad number is skipped; the others still draw", () => {
  assert.deepEqual(limitWindows(go(meter(Number.NaN), meter(7), meter(1))), [{ label: "1w", percent: 7, limited: false }]);
});

test("the reader asks at most once per interval, keeps the last answer on a slow reply, and clears on an error or a null", async () => {
  let clock = 1_000;
  let calls = 0;
  let answer = { data: go(meter(10), meter(20), meter(1)) };
  let changes = 0;
  const limits = createUsageLimits({ read: async () => { calls += 1; if (answer instanceof Error) throw answer; return answer; }, now: () => clock, intervalMs: 60_000, onChange: () => { changes += 1; } });
  assert.deepEqual(limits.windows(), []);
  await limits.poll();
  await limits.poll();
  assert.equal(calls, 1, "the second poll falls inside the interval");
  assert.deepEqual(limits.windows().map((window) => window.percent), [10, 20]);
  assert.equal(changes, 1);
  clock += 60_001;
  answer = { data: go(meter(10), meter(20), meter(1)) };
  await limits.poll();
  assert.equal(calls, 2);
  assert.equal(changes, 1, "an identical answer is not a change");
  clock += 60_001;
  answer = new Error("offline");
  await limits.poll();
  assert.deepEqual(limits.windows(), []);
  assert.equal(changes, 2);
  clock += 60_001;
  answer = { data: null };
  await limits.poll();
  assert.deepEqual(limits.windows(), []);
});

test("a reader with no source never calls anything and never throws", async () => {
  const limits = createUsageLimits({ read: undefined, now: () => 0, intervalMs: 1, onChange: () => assert.fail("nothing changed") });
  await limits.poll();
  assert.deepEqual(limits.windows(), []);
});

test("the card's bottom border carries 5h and 1w after the context figure, warns near the cap, and sheds the branch before them when narrow", () => {
  const palette = paletteFromTheme(undefined);
  const text = (line) => line.map((segment) => segment.text).join("");
  const view = buildMissionView({ marks: [{ at: Date.now() - 60_000, mode: "lit-task" }], todos: [], ledger: undefined, now: Date.now() });
  const draw = (limitsList, width) => statusCard({ view, frame: restingFrameFor(view), chips: [], figures: { contextPercent: 34, branch: "main", inLane: false, ...(limitsList === undefined ? {} : { limits: limitsList }) } }, palette, width);
  const bottom = (lines) => text(lines.at(-1));
  const both = [{ label: "5h", percent: 42, limited: false }, { label: "1w", percent: 18, limited: false }];
  assert.match(bottom(draw(both, 120)), /ctx 34% · 5h 42% · 1w 18% · ⟳ .*⎇ main/u);
  assert.doesNotMatch(bottom(draw(undefined, 120)), /5h|1w/u, "no source, no figure");
  assert.doesNotMatch(bottom(draw([], 120)), /5h|1w/u);
  const hot = draw([{ label: "5h", percent: 96, limited: false }, { label: "1w", percent: 100, limited: true }], 120).at(-1);
  const hotText = text(hot);
  assert.match(hotText, /5h 96%/u);
  assert.match(hotText, /1w 100% limited/u);
  const warn = palette.warning;
  assert.equal(hot.find((segment) => segment.text === "5h 96%")?.fg, warn);
  assert.equal(draw(both, 120).at(-1).find((segment) => segment.text === "5h 42%")?.fg, palette.muted);
  const narrow = bottom(draw(both, 40));
  assert.ok(narrow.length > 0 && !/⎇/u.test(narrow), "the branch goes first when room runs out");
  for (const width of [30, 40, 60, 80, 120]) for (const line of draw(both, width)) assert.equal(line.reduce((sum, segment) => sum + [...segment.text].length, 0) > 0, true);
});
