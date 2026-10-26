import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, paletteFromTheme } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { rainbowActive, rainbowAllowed, rainbowAt, rainbowColor, rainbowTickMs, relativeLuminance } from "../src/tui/mission-rainbow.ts";

const now = Date.parse("2026-10-26T12:00:00.000Z");
const palette = paletteFromTheme(undefined);
const adhd = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-adhd" }], todos: [], now });
const rewind = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-rewind" }], todos: [], now });
const plan = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-plan" }], todos: [], now });
const idle = buildMissionView({ marks: [], todos: [], now });
const figures = { contextPercent: 3, inLane: false };

test("the rainbow plays for lit-adhd and lit-rewind while the turn runs, and for no other discipline", () => {
  assert.equal(rainbowActive(adhd, [], true), true);
  assert.equal(rainbowActive(rewind, [], undefined), true);
  assert.equal(rainbowActive(plan, [], true), false);
  assert.equal(rainbowActive(idle, [], true), false);
  assert.equal(rainbowActive(idle, [{ name: "lit-adhd", current: true }], true), true, "the skill chip of this turn is enough");
  assert.equal(rainbowActive(idle, [{ name: "lit-adhd", current: false }], true), false, "an old chip is not");
  assert.equal(rainbowActive(adhd, [], false), false, "a resting session stops");
});

test("reduced motion and NO_COLOR switch the rainbow off", () => {
  assert.equal(rainbowAllowed(true, undefined), true);
  assert.equal(rainbowAllowed(true, ""), true);
  assert.equal(rainbowAllowed(false, undefined), false);
  assert.equal(rainbowAllowed(true, "1"), false);
});

test("twelve seconds of frames never swing in brightness: lightness is fixed, only the hue steps", () => {
  const luminances = [];
  const colours = new Set();
  for (let at = 0; at < 12_000; at += rainbowTickMs) {
    const colour = rainbowColor(rainbowAt(now + at).hue);
    colours.add(colour);
    luminances.push(relativeLuminance(colour));
  }
  assert.ok(colours.size >= 40, "the colour keeps moving");
  for (let index = 1; index < luminances.length; index += 1) assert.ok(Math.abs(luminances[index] - luminances[index - 1]) <= 0.1, `step ${index}`);
  assert.ok(Math.max(...luminances) - Math.min(...luminances) <= 0.12, "the whole turn of the wheel stays within a narrow luminance band");
  const perSecond = 1000 / rainbowTickMs;
  let swings = 0;
  let worst = 0;
  for (let start = 0; start + perSecond < luminances.length; start += 1) {
    swings = 0;
    for (let index = start + 1; index <= start + perSecond; index += 1) {
      const previous = luminances[index - 1];
      if (Math.abs(luminances[index] - previous) / Math.max(previous, 0.01) >= 0.1) swings += 1;
    }
    worst = Math.max(worst, swings);
  }
  assert.ok(worst <= 3, `at most 3 flashes a second, saw ${worst}`);
  assert.ok(perSecond <= 4);
});

test("the band's border, LIT word and bar take the cycling colour; fills and backgrounds never change", () => {
  const draw = (rainbow) => statusCard({ view: adhd, frame: restingFrameFor(adhd, now), chips: [{ name: "lit-adhd", current: true }], figures, ...(rainbow === undefined ? {} : { rainbow }) }, palette, 100);
  const plain = draw();
  const first = draw({ hue: 40 });
  const second = draw({ hue: 190 });
  assert.equal(first[0].find((segment) => segment.text === "─".repeat(segment.text.length) && segment.text.length > 3).fg, rainbowColor(40));
  const litCells = (lines) => { const row = lines[0]; const at = row.findIndex((segment, index) => row.slice(index, index + 3).map((cell) => cell.text).join("") === "LIT"); return at < 0 ? [] : row.slice(at, at + 3); };
  assert.equal(new Set(litCells(first).map((cell) => cell.bg)).size, 3, "the LIT pill is drawn cell by cell, each a step round the wheel");
  assert.notEqual(litCells(second)[0].bg, litCells(first)[0].bg);
  assert.equal(first[3][0].fg, rainbowColor(40));
  assert.equal(plain[0].find((segment) => segment.text === "LIT").fg, "#ff2d95", "without the rainbow the band keeps the LIT pink");
  // Only pill cells take a rainbow fill; the card's ground never changes.
  assert.ok(first.flat().every((segment) => segment.bg === undefined || /\S/u.test(segment.text) || plain.flat().some((cell) => cell.bg === segment.bg) || segment.bold), "no fill outside a pill");
  const text = (lines) => lines.map((line) => line.map((segment) => segment.text).join(""));
  assert.deepEqual(text(first).slice(1), text(plain).slice(1), "below the top border the text is the same; only colours move");
  assert.equal([...text(first)[0]].length, [...text(plain)[0]].length, "the top border keeps its width with the REWIND mark");
  assert.match(text(first)[0], /REWIND «/u);
});

test("rainbow colours are valid hex across the whole wheel", () => {
  for (let hue = -360; hue <= 720; hue += 15) assert.match(rainbowColor(hue), /^#[0-9a-f]{6}$/u);
});

const cellsOf = (row, word) => {
  const at = row.findIndex((_, index) => row.slice(index, index + [...word].length).map((cell) => cell.text).join("") === word);
  return at < 0 ? [] : row.slice(at, at + [...word].length);
};
const contrast = (a, b) => { const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("the rewind look draws the pills cell by cell: the lit-adhd chip, the running phase, the phase labels and ctx all turn", () => {
  const working = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-adhd" }], todos: [{ content: "a", status: "in_progress" }], now });
  const draw = (hue) => statusCard({ view: working, frame: restingFrameFor(working, now), busy: true, chips: [{ name: "lit-adhd", current: true }, { name: "lit-plan", current: false }], figures: { contextPercent: 6, inLane: false }, rainbow: { hue } }, palette, 120);
  const frames = [0, 37, 81, 160].map(draw);
  const chip = (lines) => cellsOf(lines[2], "lit-adhd");
  assert.equal(chip(frames[0]).length, 8, "the chip is one span per cell");
  assert.ok(new Set(chip(frames[0]).map((cell) => cell.bg)).size >= 3, "the lit-adhd chip is a rainbow, not one tint");
  assert.ok(new Set(frames.map((lines) => chip(lines)[0].bg)).size >= 3, "and its hue moves");
  const pill = (lines) => lines[1].filter((cell) => cell.bg !== undefined && cell.bold && /\S/u.test(cell.text));
  assert.ok(new Set(pill(frames[0]).map((cell) => cell.bg)).size >= 3, "the running phase pill turns cell by cell");
  const labelInk = (lines) => lines[1].filter((cell) => cell.bg === undefined && /^(plan|review|done|work)/iu.test(cell.text.trim())).map((cell) => cell.fg).join();
  assert.ok(new Set(frames.map(labelInk)).size >= 3, "the other phase labels turn too");
  const ctx = (lines) => cellsOf(lines.at(-1), "ctx 6%");
  assert.ok(new Set(ctx(frames[0]).map((cell) => cell.fg)).size >= 3, "the context figure takes the rainbow, even at 6 %");
  for (const lines of frames) {
    for (const cell of [...chip(lines), ...pill(lines), ...cellsOf(lines[0], "LIT")]) assert.ok(contrast(cell.fg, cell.bg) >= 4.5, `${cell.text} ${cell.fg} on ${cell.bg}`);
  }
  const plainDraw = statusCard({ view: working, frame: restingFrameFor(working, now), busy: true, chips: [{ name: "lit-plan", current: true }], figures: { contextPercent: 6, inLane: false } }, palette, 120);
  assert.equal(cellsOf(plainDraw[2], "lit-plan").length, 0, "without the rainbow a chip stays one span");
});

test("every row of the rainbow card closes at the frame width, 60 to 160 columns, across 40 frames", () => {
  const working = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-adhd" }], todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }], now });
  const threads = [{ key: "a", name: "lane one", status: "working", done: 1, total: 3, facts: "3 steps" }, { key: "b", name: "레인 둘 한국어", status: "working", facts: "12m · last: Edit a.ts" }];
  for (const columns of [60, 80, 100, 120, 160]) {
    for (const [view, extra] of [[adhd, {}], [working, { busy: true, threads }], [working, { figures: { contextPercent: 63, inLane: true, branch: "port/1038" } }]]) {
      for (let index = 0; index < 40; index += 1) {
        const lines = statusCard({ view, frame: restingFrameFor(view, now + index * 97), chips: [{ name: "lit-adhd", current: true }, { name: "lit-hijack", current: false }], figures, ...extra, rainbow: rainbowAt(now + index * 97) }, palette, columns);
        lines.forEach((line, row) => assert.equal(lineWidth(line), columns, `${columns} cols, frame ${index}, row ${row}: ${line.map((cell) => cell.text).join("")}`));
      }
    }
  }
});
