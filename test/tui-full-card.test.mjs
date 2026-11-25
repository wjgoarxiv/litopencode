import assert from "node:assert/strict";
import { test } from "node:test";
import { fullCardMinimum, missionCard } from "../src/tui/mission-card.ts";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { rainbowAt, relativeLuminance } from "../src/tui/mission-rainbow.ts";
import { cellWidth, chipLine, gauge, lineWidth, missionPanel, paletteFromTheme, roundPills } from "../src/tui/mission-text.ts";
import { threadsOf } from "../src/tui/mission-threads.ts";
import { footerStatus } from "../src/v2/tui-footer.ts";

// The full card, in both forms: round where the caps are drawn, square elsewhere.
process.env.LITOPENCODE_GLYPHS = "basic";
const now = Date.parse("2026-11-25T09:00:00.000Z");
const square = { ...paletteFromTheme({ background: "#0a0a0a", backgroundPanel: "#141414", backgroundElement: "#1e1e1e" }, "dark"), synthwave: true };
const round = { ...square, round: true };
const hostile = "\u001b[31mred\u001b[0m 한국어 문서 정리 ＡＢＣ éà 👩‍👩‍👧 ⚑️ ‮abc‬ tab\there \u0007bell 日本語 ".repeat(3);
const ledger = (status, states, title = "Spanish greeting") => ({ version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title, status, createdAt: new Date(now - 180_000).toISOString(), updatedAt: "", criteria: states.map((state, index) => ({ id: `C${index + 1}`, scenario: `${title} ${index}`, qaChannel: "", testRef: "", status: state, evidence: [] })), checkpoints: [], steering: [], reviewBlockers: [] }] });
const marks = (mode) => [{ at: now - 180_000, mode }];
const todos = (word) => [[`Write ${word}`, "completed"], [`Add ${word}`, "in_progress"], ["Run npm test", "pending"]].map(([content, status]) => ({ content, status }));
const build = (options) => buildMissionView({ todos: [], now, ...options });
const lane = (name, more = {}) => ({ kind: "task", name, status: "working", startedAt: now - 34_000, touchedAt: now, ...more });
const states = (word) => ({
  working: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "busy", live: { tool: "edit", start: now - 9000 } }), busy: true, chips: ["lit-task"] },
  loop: { view: build({ marks: marks("lit-loop"), agent: "lit-loop", ledger: ledger("active", ["pass", "pending", "pending"], word), sessionStatus: "busy", live: { tool: word, start: now - 9000 } }), busy: true, chips: ["lit-loop", "lit-plan", word] },
  lanes: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "busy" }), busy: true, chips: ["lit-task"], threads: threadsOf([{ kind: "stack", name: "lit-task", status: "working", touchedAt: now, done: 1, total: 3 }, lane(word, { done: 1, total: 3 }), lane("lit-prover"), lane("문서 정리", { status: "done", doneAt: now - 9000 })], now) },
  many: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "busy" }), busy: true, chips: ["lit-task"], threads: threadsOf(["a", word, "c", "d", "e"].map((name) => lane(name)), now) },
  held: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "busy" }), busy: true, chips: ["lit-task"], reserve: 4 },
  turn: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "idle", pendingQuestions: 1 }), busy: false, chips: ["lit-task"], turn: { glow: 0.4 } },
  warning: { view: build({ marks: marks("lit-loop"), agent: "lit-loop", ledger: ledger("active", ["pass", "pending"], word), sessionStatus: "retry", retryMessage: word }), busy: true, chips: ["lit-loop"] },
  review: { view: build({ marks: marks("review-work"), sessionStatus: "busy" }), busy: true, chips: ["review-work"], lanes: { scope: "pass", tests: "fail" } },
  rewind: { view: build({ marks: marks("lit-adhd"), sessionStatus: "busy" }), busy: true, chips: ["lit-adhd"], rainbow: rainbowAt(now) },
  done: { view: build({ marks: marks("lit-loop"), agent: "lit-loop", ledger: ledger("complete", ["pass", "pass"], word), sessionStatus: "idle" }), busy: false, chips: ["lit-loop"] },
  resting: { view: build({ marks: marks("lit-task"), todos: todos(word), sessionStatus: "idle" }), busy: false, chips: ["lit-task"] },
  idle: { view: build({ marks: [] }), busy: false, chips: [] },
  last: { view: build({ marks: [] }), busy: false, chips: [], last: { title: word, passed: 3, total: 3, complete: true }, earlier: true }
});
const plain = states("Spanish greeting");
const draw = (state, width, palette, more = {}) => missionCard({
  frame: restingFrameFor(state.view, now), motion: true, figures: { contextPercent: 10, branch: "main", inLane: false }, scene: state.busy ? { t: 1003.4 } : {},
  ...state, chips: state.chips.map((name, index) => ({ name, current: index === 0 && state.busy })), ...more
}, palette, width);
const text = (line) => line.map((segment) => segment.text).join("");
const sunRows = (lines) => lines.filter((line) => /[▁▂▃▄▅▆▇█]{10,}/u.test(text(line))).length;
const cells = (line) => line.flatMap((segment) => [...segment.text].flatMap((char) => (cellWidth(char) === 0 ? [] : [{ ...segment, text: char }, ...Array.from({ length: cellWidth(char) - 1 }, () => ({ ...segment, text: "" }))])));

/** Every run of filled cells that is not the sun, with the cells on both sides of it. */
function fills(line) {
  const row = cells(line);
  const out = [];
  for (let at = 0; at < row.length; ) {
    if (row[at].bg === undefined || /[▁▂▃▄▅▆▇█]/u.test(row[at].text)) { at += 1; continue; }
    let end = at;
    while (end < row.length && row[end].bg !== undefined && !/[▁▂▃▄▅▆▇█]/u.test(row[end].text)) end += 1;
    out.push({ before: row[at - 1]?.text, after: row[end]?.text, words: row.slice(at, end).map((cell) => cell.text).join("") });
    at = end;
  }
  return out;
}

function checkRound(lines, label) {
  for (const line of lines) {
    for (const fill of fills(line)) assert.deepEqual([fill.before, fill.after], ["", ""], `${label}: square "${fill.words}" in ${text(line)}`);
    assert.doesNotMatch(text(line), /\[[▉ ░▒▓]|[░▒▓▰▱▯]/u, `${label}: a bracket or textured gauge in ${text(line)}`);
  }
}

function checkSquare(lines, label) {
  for (const line of lines) assert.doesNotMatch(text(line), /[]/u, `${label}: a cap in ${text(line)}`);
}

test("every state and width: round form has round ends on every fill, square form has no cap, and both hold the same words in the same cells", () => {
  for (const [name, state] of Object.entries(plain)) {
    for (let width = fullCardMinimum - 4; width <= 200; width += width < 124 ? 1 : 19) {
      const [a, b] = [draw(state, width, round), draw(state, width, square)];
      checkRound(a, `${name} ${width}`);
      checkSquare(b, `${name} ${width}`);
      if (width < fullCardMinimum) continue;
      assert.deepEqual(a.map((line) => text(line).replace(/[]/gu, " ")), b.map(text), `${name} ${width}`);
    }
  }
});

test("the sidebar panel, the prompt chip and the footer line follow the same form", () => {
  for (const [name, state] of Object.entries(plain)) {
    const frame = restingFrameFor(state.view, now);
    for (const [palette, check] of [[round, checkRound], [square, checkSquare]]) {
      check(missionPanel(state.view, frame, palette)?.rows ?? [], `panel ${name}`);
      for (const tier of ["full", "medium", "tight"]) for (const room of [12, 30, 60, 90]) check([chipLine(state.view, frame, palette, room, tier)], `chip ${name} ${tier} ${room}`);
      for (const budget of [10, 24, 40, 80, 140]) check([footerStatus({ name: "lit-loop", view: state.view, frame, palette, budget })], `footer ${name} ${budget}`);
    }
  }
});

test("a gauge and a pill keep their width in both forms", () => {
  for (let ratio = 0; ratio <= 1; ratio += 0.05) for (const palette of [round, square]) assert.equal(lineWidth(gauge(ratio, 8, () => "#ff8f3c", palette)), 8);
  const row = [{ text: " A ", fg: "#000000", bg: "#ff0000" }, { text: " ", fg: "#ffffff" }, { text: " 한", fg: "#000000", bg: "#00ff00" }, { text: "국 ", fg: "#000000", bg: "#0000ff" }];
  assert.equal(text(roundPills(row, round)), "A 한국");
  assert.deepEqual(roundPills(row, round).filter((segment) => /[]/u.test(segment.text)).map((segment) => [segment.fg, segment.bg]), [["#ff0000", undefined], ["#ff0000", undefined], ["#00ff00", undefined], ["#0000ff", undefined]]);
  assert.deepEqual(roundPills(row, square), row);
});

test("the frame's edges stay in their columns at every width, whatever the text holds", () => {
  for (const [name, state] of Object.entries(states(hostile))) {
    for (let width = fullCardMinimum; width <= 200; width += width < 124 ? 1 : 19) {
      const lines = draw(state, width, round, { figures: { contextPercent: 81, branch: hostile, inLane: true, restartTo: hostile, limits: [{ label: "5h", percent: 99, limited: true }, { label: "1w", percent: 53, limited: false }] } });
      lines.forEach((line, row) => {
        const label = `${name} ${width} row ${row}: ${text(line)}`;
        assert.equal(lineWidth(line), width, label);
        assert.match(text(line), row === 0 ? /^╭.*╮$/u : row === lines.length - 1 ? /^╰.*╯$/u : /^│ .* │$/u, label);
        assert.doesNotMatch(text(line), /[\u0000-\u001f\u007f-\u009f]/u, label);
      });
    }
  }
});

test("the card has the same anatomy in every state, at most nine rows, and shrinks at rest", () => {
  const heights = Object.fromEntries(Object.entries(plain).map(([name, state]) => [name, draw(state, 100, round).length]));
  assert.deepEqual(heights, { working: 7, loop: 7, lanes: 9, many: 9, held: 9, turn: 6, warning: 7, review: 7, rewind: 7, done: 6, resting: 6, idle: 5, last: 6 });
  for (const [name, state] of Object.entries(plain)) {
    const lines = draw(state, 100, round);
    assert.match(text(lines[0]), /^╭─ 🔥 LIT · [a-z-]+ /u, name);
    assert.match(text(lines[1]), /interview|plan/u, name);
    assert.match(text(lines.at(-1)), /^╰─ ctx 10%  {4} · ⎇ main /u, name);
  }
  assert.match(text(draw(plain.working, 100, round)[0]), / WORK ● ─╮$/u);
  assert.match(text(draw(plain.working, 100, round)[1]), /WORK.* 3m │$/u);
  assert.match(text(draw(plain.working, 100, round)[2]), /└ task 1\/3 .*next ▸ Add Spanish greeting .* edit · 0:09 │$/u);
  assert.match(text(draw(plain.working, 100, round)[3]), /● lit-task {2}WORK .*1\/3 running/u);
  assert.match(text(draw(plain.turn, 100, round)[0]), / YOUR TURN ◆ ─╮$/u);
  assert.match(text(draw(plain.turn, 100, round)[2]), /⚑ waiting for your answer/u);
  assert.match(text(draw(plain.review, 100, round)[2]), /scope ✓ tests ✗ package · security · surface ·/u);
  assert.match(text(draw(plain.done, 100, round)[0]), / COMPLETE ✓ ─╮$/u);
});

test("lanes are aligned columns with real counts only, three at most, the rest counted", () => {
  const lines = draw(plain.lanes, 100, round).map(text);
  assert.match(lines[3], /┬ 3 lanes in parallel/u);
  const at = lines.slice(4, 7).map((line) => line.search(/running|done/u));
  assert.equal(new Set(at.map((_, index) => cellWidth(lines[4 + index].slice(0, at[index])))).size, 1, lines.slice(4, 7).join("\n"));
  assert.match(lines[4], /1\/3 running/u);
  assert.doesNotMatch(lines[5], /\d\/\d/u, "no count is made up");
  assert.match(lines[6], /└─ ✓ 문서 정리/u);
  assert.match(draw(plain.many, 100, round).map(text).join("\n"), /5 lanes in parallel · \+2 more/u);
});

test("the sun stands three rows tall in every state of a card 100 wide, and a short window gives up the blank row", () => {
  for (const [name, state] of Object.entries(plain)) {
    const lines = draw(state, 100, round, { rows: 40 });
    assert.equal(sunRows(lines), 3, `${name}\n${lines.map(text).join("\n")}`);
    const short = draw(state, 100, round, { rows: 20 });
    assert.ok(short.length <= lines.length, name);
    assert.ok(sunRows(short) >= 1, `${name} keeps a sun in a short window`);
  }
  assert.equal(draw(plain.working, 100, round, { rows: 20 }).length, 6);
  assert.equal(draw(plain.idle, 100, round, { rows: 20 }).length, 4);
  const ink = (state) => draw(state, 100, round).flat().find((segment) => /▇{4,}/u.test(segment.text))?.fg;
  for (const name of ["idle", "last", "resting"]) assert.ok(relativeLuminance(ink(plain[name])) < relativeLuminance(ink(plain.working)), `${name} draws it dim`);
});

test("the height of a running card does not follow its words", () => {
  for (const width of [72, 80, 100, 140]) {
    const heights = ["x", "a longer task name", hostile].map((word) => draw(states(word).working, width, round).length);
    assert.deepEqual(new Set(heights).size, 1);
  }
});

test("a narrow card, a light theme and fewer colours keep the plain card", () => {
  const state = plain.working;
  assert.match(text(draw(state, 71, square)[0]), /● WORK ─╮$/u);
  assert.match(text(draw(state, 100, { ...square, synthwave: undefined })[0]), /● WORK ─╮$/u);
  assert.match(text(draw(state, 100, square, { scene: undefined })[0]), /● WORK ─╮$/u);
});

test("a frame stays within the element budget and few cells change between two frames", () => {
  for (const [name, state] of Object.entries(plain)) for (const width of [80, 120, 200]) {
    const spans = draw(state, width, round).flat().length;
    assert.ok(spans <= 260, `${name} at ${width}: ${spans} spans`);
  }
});
