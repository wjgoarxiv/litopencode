import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS, SPEC_DIGEST } from "../src/synthwave-data.ts";
import { cubeIndex, sampleStops, synthwaveChrome, synthwaveFallback, synthwaveRows, synthwaveSize, terminalSynthwave } from "../src/synthwave-mark.ts";
import { renderLitOpenCodeWordmark } from "../src/cli/install-tui.ts";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { restingFrameFor } from "../src/tui/mission-motion.ts";
import { lineWidth, missionPanel, paletteFromTheme, panelInnerWidth, synthwaveBadgeAllowed, synthwavePill, synthwavePillWidth } from "../src/tui/mission-text.ts";
import { statusCard } from "../src/tui/mission-band.ts";
import { withMarkTerminal } from "../test-support/lit-mark-fixture.mjs";

// The Synthwave mark on the install, doctor and help screens, and its badge pill in the TUI panel and band.
// The family visual spec publishes this digest; src/synthwave-data.ts is generated from that spec.
const specDigest = "f063a0cefb969db40c0fc436742240912d895d43c3013d35782320befc0a2b86";
const sizes = ["B-L", "B-M", "B-S"];
const ansi = /\u001b\[[0-9;]*m/gu;
const visible = (row) => Array.from(row.replace(ansi, "")).length;

test("the generated rows hash to the spec digest", () => {
  const rows = (map) => sizes.map((size) => map[size].join("\n")).join("\n--\n");
  const digest = createHash("sha256").update(rows(PIXEL_ROWS) + JSON.stringify(SHARED_COLOURS) + rows(MONO_ROWS)).digest("hex");
  assert.equal(digest, SPEC_DIGEST);
  assert.equal(SPEC_DIGEST, specDigest);
});

test("the size ladder follows terminal columns and an unknown width counts as 80", () => {
  assert.equal(synthwaveSize(20), undefined);
  assert.equal(synthwaveSize(23), undefined);
  assert.equal(synthwaveSize(24), "B-S");
  assert.equal(synthwaveSize(43), "B-S");
  assert.equal(synthwaveSize(44), "B-M");
  assert.equal(synthwaveSize(75), "B-M");
  assert.equal(synthwaveSize(76), "B-L");
  assert.equal(synthwaveSize(80), "B-L");
  assert.equal(synthwaveSize(200), "B-L");
  assert.equal(synthwaveSize(undefined), "B-L");
  assert.equal(synthwaveSize(Number.NaN), "B-L");
  assert.deepEqual(synthwaveRows({ cols: 20, depth: "truecolor" }), ["LIT · opencode"]);
  assert.equal(synthwaveFallback, "LIT · opencode");
  for (const [cols, size] of [[24, "B-S"], [44, "B-M"], [76, "B-L"], [80, "B-L"], [200, "B-L"]]) {
    assert.equal(synthwaveRows({ cols, depth: "truecolor" }).length, PIXEL_ROWS[size].length / 2 + 1, `${cols}`);
    assert.equal(synthwaveRows({ cols, depth: "none" }).length, MONO_ROWS[size].length + 1, `${cols}`);
  }
});

test("no row is wider than the terminal at any width from 20 to 200", () => {
  for (let cols = 20; cols <= 200; cols += 1) {
    for (const depth of ["truecolor", "256", "none"]) {
      for (const row of synthwaveRows({ cols, depth, footer: "litopencode v9.8.7" })) assert.ok(visible(row) <= cols, `${cols} ${depth}: ${visible(row)}`);
    }
  }
});

test("colour off prints the mono rows as given and a plain centred tagline, with no escape bytes", () => {
  for (const size of sizes) {
    const cols = { "B-L": 80, "B-M": 50, "B-S": 30 }[size];
    const rows = synthwaveRows({ cols, depth: "none" });
    assert.deepEqual(rows.slice(0, -1), MONO_ROWS[size]);
    const width = PIXEL_ROWS[size][0].length;
    assert.equal(rows.at(-1), " ".repeat(Math.floor((width - synthwaveFallback.length) / 2)) + synthwaveFallback);
    assert.doesNotMatch(rows.join("\n"), /\u001b/u);
  }
  assert.doesNotMatch(synthwaveRows({ cols: 20, depth: "none" }).join(""), /\u001b/u);
  assert.deepEqual(synthwaveRows({ cols: 80, depth: "truecolor", glyphs: false }), [synthwaveFallback]);
});

test("colour on draws two pixels per cell with the chrome, edge and shared colours", () => {
  const rows = synthwaveRows({ cols: 80, depth: "truecolor" });
  for (const row of rows.slice(0, -1)) assert.equal(visible(row), 76);
  const joined = rows.join("\n");
  assert.ok(joined.includes("\u001b[48;2;255;255;255m"), "edge #ffffff");
  assert.ok(joined.includes("48;2;51;17;68"), "shared 0 #331144");
  const level5 = sampleStops(synthwaveChrome, 5 / 11);
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(level5.slice(at, at + 2), 16));
  assert.ok(joined.includes(`2;${r};${g};${b}`), `chrome level f ${level5}`);
  assert.equal(sampleStops(synthwaveChrome, 0), "#ffffff");
  assert.equal(sampleStops(synthwaveChrome, 1), "#0f2a44");
  assert.equal(rows.at(-1).replace(ansi, "").trim(), synthwaveFallback);
  const cube = synthwaveRows({ cols: 80, depth: "256" }).join("\n");
  assert.doesNotMatch(cube, /[34]8;2;/u);
  assert.ok(cube.includes(`48;5;${cubeIndex("#331144")}m`));
  assert.equal(cubeIndex("#ffffff"), 231);
  assert.equal(cubeIndex("#000000"), 16);
});

test("the installer wordmark is the mark, its tagline and the product version, sized by the stream", () => {
  withMarkTerminal(() => {
    const narrow = renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7", true, { columns: 44, isTTY: true });
    assert.match(narrow, /\u001b\[48;2;/u);
    const lines = narrow.split("\n");
    assert.equal(lines.length, PIXEL_ROWS["B-M"].length / 2 + 2);
    assert.equal(lines.at(-1).trim(), "litopencode v9.8.7");
    for (const line of lines) assert.ok(visible(line) <= 44);
    const mono = renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7", false, { columns: 80, isTTY: true });
    assert.doesNotMatch(mono, /\u001b/u);
    assert.deepEqual(mono.split("\n").slice(0, MONO_ROWS["B-L"].length), MONO_ROWS["B-L"]);
    assert.deepEqual(renderLitOpenCodeWordmark("litopencode@1.0.0", true, { columns: 20, isTTY: true }).split("\n"), [synthwaveFallback, "litopencode v1.0.0"]);
  });
  withMarkTerminal(() => {
    assert.doesNotMatch(renderLitOpenCodeWordmark("litopencode@1.0.0", true, { columns: 80, isTTY: true }), /\u001b/u);
  }, { color: false });
  assert.deepEqual(terminalSynthwave({ terminal: { env: { LANG: "C" }, isTTY: true }, stream: { columns: 80 } }), [synthwaveFallback]);
  assert.equal(terminalSynthwave({ colour: false, terminal: { env: { LANG: "en_US.UTF-8", COLUMNS: "30" } }, stream: { isTTY: true } }).length, MONO_ROWS["B-S"].length + 1);
});

test("a stream that is not a TTY gets only the plain line and the version line, with or without colour", () => {
  for (const color of [true, false]) {
    withMarkTerminal(() => {
      for (const stream of [{ columns: 80, isTTY: false }, { columns: 80 }]) {
        for (const colorEnabled of [true, false]) {
          const output = renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7", colorEnabled, stream);
          assert.deepEqual(output.split("\n"), ["LIT · opencode", "litopencode v9.8.7"]);
          assert.doesNotMatch(output, /[█▀▄░]|\u001b/u);
        }
      }
      // The same call on a TTY stream still draws the art.
      assert.match(renderLitOpenCodeWordmark("@litfamily/litopencode@9.8.7", true, { columns: 80, isTTY: true }), color ? /\u001b\[48;2;/u : /█/u);
    }, { color });
  }
  assert.deepEqual(terminalSynthwave({ terminal: { env: { LANG: "en_US.UTF-8" } }, stream: { columns: 80, isTTY: false }, footer: "v1" }), [synthwaveFallback, "v1"]);
});

const now = Date.parse("2026-11-24T12:00:00.000Z");
const ledger = { version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "Synthwave 배지", status: "active", createdAt: "2026-11-24T11:50:00.000Z", updatedAt: "", criteria: [{ id: "C1", scenario: "s", qaChannel: "tui", testRef: "t", status: "pending", evidence: [] }], checkpoints: [], steering: [], reviewBlockers: [] }] };
const view = buildMissionView({ marks: [{ at: now - 60_000, mode: "lit-loop" }], todos: [], ledger, now });
const base = paletteFromTheme(undefined, "dark");
const badged = { ...base, synthwave: true };
const hasPill = (line) => line.some((segment) => segment.bg === synthwavePill()[0].bg) && line.some((segment) => segment.text === "L" && segment.fg === "#0b0e14" && segment.bold === true);

test("the badge pill is bold dark ink on the chrome's second to fifth stop", () => {
  const pill = synthwavePill();
  assert.equal(lineWidth(pill), synthwavePillWidth);
  assert.equal(pill.map((segment) => segment.text).join(""), " 🔥 LIT ");
  assert.equal(pill[0].bg, synthwaveChrome[1]);
  assert.equal(pill.at(-1).bg, synthwaveChrome[4]);
  for (const segment of pill) assert.deepEqual([segment.fg, segment.bold], ["#0b0e14", true]);
});

test("the badge shows only on a dark theme on a truecolor terminal with colour on", () => {
  assert.equal(synthwaveBadgeAllowed({ COLORTERM: "truecolor" }, "dark"), true);
  assert.equal(synthwaveBadgeAllowed({ COLORTERM: "24bit" }, "dark"), true);
  assert.equal(synthwaveBadgeAllowed({ TERM: "xterm-direct" }, "dark"), true);
  assert.equal(synthwaveBadgeAllowed({ COLORTERM: "truecolor" }, "light"), false);
  assert.equal(synthwaveBadgeAllowed({ TERM: "xterm-256color" }, "dark"), false);
  assert.equal(synthwaveBadgeAllowed({}, "dark"), false);
  assert.equal(synthwaveBadgeAllowed({ COLORTERM: "truecolor", NO_COLOR: "1" }, "dark"), false);
});

test("the sidebar panel and the band carry the pill when badged and keep their old look otherwise", () => {
  const plainPanel = missionPanel(view, restingFrameFor(view, now), base);
  const pillPanel = missionPanel(view, restingFrameFor(view, now), badged);
  assert.ok(hasPill(pillPanel.rows[0]));
  assert.ok(!plainPanel.rows.some(hasPill));
  for (const row of pillPanel.rows) assert.ok(lineWidth(row) <= panelInnerWidth);
  assert.deepEqual(pillPanel.rows.slice(1), plainPanel.rows.slice(1));
  for (const width of [40, 60, 98, 160]) {
    const input = { view, frame: restingFrameFor(view, now), chips: [], figures: { contextPercent: 20, inLane: false } };
    const plain = statusCard(input, base, width);
    const pill = statusCard(input, badged, width);
    assert.ok(hasPill(pill[0]), `${width}`);
    assert.ok(!plain.some(hasPill), `${width}`);
    for (const line of [...plain, ...pill]) assert.equal(lineWidth(line), width, `${width}`);
    assert.deepEqual(pill.slice(1), plain.slice(1));
  }
});
