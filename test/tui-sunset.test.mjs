import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { statusCard } from "../src/tui/mission-band.ts";
import { buildMissionView } from "../src/tui/mission-model.ts";
import { idleMotion, planMotion, restingFrameFor, sampleMotion } from "../src/tui/mission-motion.ts";
import { rainbowAt, relativeLuminance } from "../src/tui/mission-rainbow.ts";
import { paintSky, roundGauges, sceneTickMs, sunColumn, sunWidth } from "../src/tui/mission-sunset.ts";
import { cellWidth, lineWidth, paletteFromTheme, progressBar, synthwavePill } from "../src/tui/mission-text.ts";
import { setupLitOpenCodeTui } from "../src/v2/tui.ts";

// The sunset behind the status card: drawn only where the card is blank, moving only with a clock.
const now = Date.parse("2026-11-25T09:00:00.000Z");
const palette = { ...paletteFromTheme(undefined), synthwave: true };
const criterion = (id, status) => ({ id, scenario: `${id} README links hello.txt`, qaChannel: "", testRef: "", status, evidence: [] });
const ledger = (status, states) => ({ version: 1, activeGoalId: "g1", goals: [{ id: "g1", sessionId: "s", objective: "o", title: "hello.txt 인사말 만들기", status, createdAt: "2026-11-25T08:59:00.000Z", updatedAt: "", criteria: states.map((state, index) => criterion(`C${index + 1}`, state)), checkpoints: [], steering: [], reviewBlockers: [] }] });
const marks = (mode) => [{ at: now - 60_000, mode }];
const views = {
  idle: buildMissionView({ marks: [], todos: [], now }),
  task: buildMissionView({ marks: marks("lit-task"), todos: [], now }),
  loop: buildMissionView({ marks: marks("lit-loop"), todos: [], ledger: ledger("active", ["pass", "pending", "pending"]), live: { tool: "bash", start: now - 9000 }, now, agent: "lit-loop" })
};
const lane = (key, extra) => ({ key, name: `lane ${key} 한국어`, status: "working", facts: "12m", ...extra });
const threads = (count) => Array.from({ length: count }, (_, index) => lane(String(index), index % 2 === 0 ? { done: 1, total: 3 } : {}));
const scenes = {
  idle: { view: views.idle, busy: false },
  task: { view: views.task, busy: true },
  loop: { view: views.loop, busy: true },
  lanes: { view: views.loop, busy: true, threads: threads(3) },
  many: { view: views.task, busy: true, threads: threads(6) },
  held: { view: views.task, busy: true, reserve: 4 },
  turn: { view: views.task, busy: false, turn: { glow: 0.4 } },
  rewind: { view: views.task, busy: true, rainbow: rainbowAt(now) },
  review: { view: views.task, busy: true, lanes: { scope: "pass", tests: "fail" } }
};
const draw = (input, width, scene, colors = palette) => statusCard({ frame: restingFrameFor(input.view, now), chips: [{ name: "lit-task", current: input.busy }], figures: { contextPercent: 34, branch: "main", inLane: false }, ...input, ...(scene === undefined ? {} : { scene }) }, colors, width);
const text = (line) => line.map((segment) => segment.text).join("");
// One entry per terminal cell; a wide character's second cell is empty.
const cells = (line) => line.flatMap((segment) => [...segment.text].flatMap((char) => [{ ...segment, text: char }, ...Array.from({ length: cellWidth(char) - 1 }, () => ({ text: "" }))]));
const sunRows = (lines) => lines.filter((line) => /[▁▂▃▄▅▆▇█]{10,}/u.test(text(line))).length;
const ticks = [0, 0.1, 1, 2.35, 4.4, 8.9, 9.05, 9.6, 17.5, 1795537173.602];

test("the scene never covers a word and never changes a row's width or the row count", () => {
  for (const [name, input] of Object.entries(scenes)) {
    for (let width = 1; width <= 220; width += width < 130 ? 1 : 7) {
      const plain = draw(input, width, undefined);
      for (const t of [undefined, ...ticks]) {
        const lines = draw(input, width, t === undefined ? {} : { t });
        assert.equal(lines.length, plain.length, `${name} ${width}`);
        lines.forEach((line, row) => {
          assert.equal(lineWidth(line), width, `${name} ${width} row ${row}`);
          const [before, after] = [cells(plain[row]), cells(line)];
          // The border takes the first and last two cells; the words end somewhere between them.
          let words = -1;
          before.slice(2, -2).forEach((cell, x) => {
            if (cell.text.trim() !== "" || cell.text === "" || cell.bg !== undefined) words = x + 2;
          });
          before.forEach((cell, x) => {
            if (cell.text !== " " || x < 2 || x >= width - 2 || (words >= 0 && x <= words + 3)) assert.equal(after[x].text, cell.text, `${name} ${width} row ${row} cell ${x}: ${text(line)}`);
          });
        });
      }
    }
  }
});

test("the sun is eighteen cells wide and as tall as the blank rows let it be: three with lanes, two, one, none", () => {
  const width = 120;
  assert.equal(sunRows(draw(scenes.lanes, width, {})), 3);
  assert.equal(sunRows(draw(scenes.task, width, {})), 2);
  assert.equal(sunRows(draw(scenes.loop, width, {})), 1, "a full track row lowers the sun to the skill row");
  assert.equal(sunRows(draw(scenes.task, 60, {})), 0, "a narrow card has no room");
  assert.match(text(draw(scenes.task, width, {})[2]), /▅▆{16}▅/u);
  assert.equal(sunWidth, 18);
  const long = [[{ text: "x".repeat(110).padEnd(116), fg: "#ffffff" }]];
  const sky = paintSky(long, 116, { t: 3, dim: false });
  assert.equal(sky.sun, 0, "long text in the last row hides it");
  assert.match(text(sky.rows[0]), /^x{110} {3}[ .~-]{3}$/u);
  for (let x = 0; x < 20; x += 1) assert.equal(text(draw(scenes.task, width, { t: x * 0.4 })[2]).indexOf("▅▆"), sunColumn(width - 4) + 2, "the sun stands still");
});

test("the completion moment has the card to itself", () => {
  const before = buildMissionView({ marks: marks("lit-loop"), todos: [], ledger: ledger("active", ["pass"]), now });
  const done = buildMissionView({ marks: marks("lit-loop"), todos: [], ledger: ledger("complete", ["pass"]), now });
  const motion = planMotion(before, done, 0, planMotion(undefined, before, -10_000, idleMotion));
  const input = { view: done, frame: sampleMotion(motion, 500), busy: true };
  assert.deepEqual(draw(input, 140, { t: 3 }).slice(1), draw(input, 140, undefined).slice(1));
});

test("while it moves the sun changes by colour alone, the sky and sea in ASCII, and the same clock draws the same card", () => {
  for (const name of ["task", "lanes", "turn"]) {
    const frames = ticks.map((t) => draw(scenes[name], 120, { t }));
    assert.deepEqual(draw(scenes[name], 120, { t: ticks[3] }), frames[3]);
    assert.ok(new Set(frames.map((lines) => JSON.stringify(lines))).size >= ticks.length - 1, `${name} moves`);
    const still = draw(scenes[name], 120, undefined);
    for (const lines of frames) {
      lines.forEach((line, row) => cells(line).forEach((cell, x) => {
        const base = cells(still[row])[x].text;
        if (cell.text !== base) assert.match(cell.text, /^[.+*~\-▁▂▃▄▅▆▇█]$/u);
      }));
      assert.deepEqual(lines.map((line) => text(line).replace(/[^▁▂▃▄▅▆▇█]/gu, " ")), frames[0].map((line) => text(line).replace(/[^▁▂▃▄▅▆▇█]/gu, " ")), "block glyphs never change");
    }
  }
});

test("without a clock the scene holds still, dimmed at rest", () => {
  const at = (ms) => draw({ ...scenes.task, frame: restingFrameFor(views.task, now + ms) }, 120, {});
  assert.deepEqual(at(0), at(1234));
  const sun = (lines) => lines[2].find((segment) => /▆{2,}/u.test(segment.text));
  const rested = draw({ ...scenes.task, busy: false }, 120, {});
  assert.ok(relativeLuminance(sun(rested).fg) < relativeLuminance(sun(at(0)).fg), "an idle card draws it dimmer");
  assert.equal(sunRows(rested), 2);
});

test("the border is neon from pink to the accent with sunset light on the rule under the sun; warnings and looks keep their own", () => {
  const lines = draw(scenes.task, 120, { t: 2 });
  const edge = (line) => line.filter((segment) => /^[─╭╮╰╯]+$/u.test(segment.text)).map((segment) => segment.fg);
  assert.equal(draw(scenes.task, 120, {})[0][0].fg, "#ff2d95", "pink on the left");
  assert.ok(new Set(edge(lines[0])).size >= 6);
  assert.notDeepEqual(edge(lines.at(-1)), edge(draw(scenes.task, 120, { t: 2.6 }).at(-1)), "the light runs along the rule");
  const sunless = draw(scenes.task, 60, { t: 2 });
  assert.equal(sunless[1][0].fg, sunless[2][0].fg);
  for (const name of ["turn", "rewind", "review"]) assert.deepEqual(draw(scenes[name], 120, { t: 2 }).at(-1), draw(scenes[name], 120, undefined).at(-1), `${name} keeps its border`);
  const blocked = buildMissionView({ marks: marks("lit-loop"), todos: [], ledger: { ...ledger("active", ["pass"]), goals: [{ ...ledger("active", ["pass"]).goals[0], reviewBlockers: [{ id: "B1", detail: "README", resolved: false, needsUserDecision: false }] }] }, now });
  assert.equal(blocked.warnings.length, 1);
  assert.deepEqual(draw({ view: blocked, busy: true }, 120, { t: 2 }).at(-1), draw({ view: blocked, busy: true }, 120, undefined).at(-1), "a warning keeps its border");
});

test("the brand pill runs orange to pink and the running stage violet to the accent, with readable dark ink", () => {
  const contrast = (a, b) => { const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const t of ticks) {
    const lines = draw(scenes.task, 120, { t });
    const brand = lines[0].filter((segment) => segment.bg !== undefined);
    assert.equal(brand.map((segment) => segment.text).join(""), text(synthwavePill()));
    const stage = lines[1].filter((segment) => segment.bg !== undefined);
    assert.equal(stage.map((segment) => segment.text).join(""), " WORK ");
    assert.equal(stage.at(-1).bg, palette.fill);
    assert.notEqual(stage[0].bg, palette.fill);
    for (const segment of [...brand, ...stage]) assert.ok(contrast(segment.fg, segment.bg) >= 4.5, `${segment.text} ${segment.fg} on ${segment.bg}`);
  }
});

test("gauges get round ends only where the terminal draws them, in the same cells", () => {
  assert.equal(roundGauges({ WT_SESSION: "x" }), true);
  assert.equal(roundGauges({ TERM_PROGRAM: "vscode" }), true);
  for (const env of [{}, { WT_SESSION: "" }, { TERM_PROGRAM: "Apple_Terminal" }, { TERM_PROGRAM: "tmux" }]) assert.equal(roundGauges(env), false);
  for (const cellsWide of [2, 8, 16]) {
    for (let ratio = 0; ratio <= 1; ratio += 0.1) {
      const bar = progressBar(ratio, cellsWide, { ...palette, roundGauges: true });
      assert.equal(lineWidth(bar), cellsWide);
      assert.match(text(bar), /^ *$/u);
    }
  }
  for (const width of [80, 120, 160]) {
    const lines = draw(scenes.lanes, width, { t: 1, rounded: true });
    assert.ok(lines.some((line) => / {8} 1\/3/u.test(text(line))), "a lane's brackets become its round ends");
    for (const line of lines) assert.equal(lineWidth(line), width);
    assert.ok(!draw(scenes.lanes, width, { t: 1 }).some((line) => /[]/u.test(text(line))));
  }
});

test("a frame stays within the element budget", () => {
  for (const [name, input] of Object.entries(scenes)) {
    for (const width of [80, 120, 200]) {
      const spans = draw(input, width, { t: 4.4 }).flat().length;
      assert.ok(spans <= 230, `${name} at ${width}: ${spans} spans`);
    }
  }
});

test("few cells change between two frames, so the terminal gets a light stream", () => {
  assert.ok(sceneTickMs >= 150);
  for (const name of ["task", "loop", "lanes"]) {
    const frames = Array.from({ length: 91 }, (_, index) => draw(scenes[name], 120, { t: 1000 + (index * sceneTickMs) / 1000 }).map(cells));
    let runs = 0;
    frames.slice(1).forEach((rows, index) => rows.forEach((row, y) => {
      let style;
      row.forEach((cell, x) => {
        const before = frames[index][y][x];
        const key = `${cell.fg}${cell.bg}${cell.bold}`;
        if (cell.text === before.text && key === `${before.fg}${before.bg}${before.bold}`) style = undefined;
        else if (key !== style) { runs += 1; style = key; }
      });
    }));
    assert.ok(runs / 90 <= 40, `${name}: ${(runs / 90).toFixed(1)} runs of changed cells per frame`);
  }
});

// The OpenCode 2 host, with a stand-in runtime and recorded intervals.
async function host({ env = {}, status = "idle", options = {}, themeMode = "dark", motion = true }, run) {
  const saved = { COLORTERM: process.env.COLORTERM, NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM };
  const apply = (values) => { for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  apply({ COLORTERM: "truecolor", NO_COLOR: undefined, TERM: "xterm-256color", ...env });
  const real = { set: globalThis.setInterval, clear: globalThis.clearInterval };
  const timers = new Map();
  let ids = 0;
  globalThis.setInterval = (fn, ms) => { ids += 1; timers.set(ids, { fn, ms }); return ids; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const state = { status };
  const claims = [];
  const listeners = [];
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "litopencode-sunset-"));
  const messages = [{ id: "m1", type: "user", text: "lit fix it", time: { created: Date.now() }, metadata: { litopencode: { mode: "lit-task", trigger: "lit", source: "prompt" } } }];
  const context = {
    options,
    location: { directory: project },
    themeMode,
    theme: {},
    ui: { slot: (claim) => { claims.push(claim); return () => undefined; }, toast: { show: () => undefined }, router: { current: () => ({ type: "session", sessionID: "s1" }) } },
    storage: { store: () => [{ motion }, async () => undefined] },
    data: {
      listen: (handler) => { listeners.push(handler); return () => undefined; },
      session: { get: (id) => ({ id, time: { created: 0 } }), status: () => state.status, message: { list: () => messages }, permission: { list: () => [] }, form: { list: () => [] } },
      location: { default: () => ({ directory: project }), vcs: { info: () => undefined }, model: { list: () => [] } }
    }
  };
  const runtime = {
    jsx: (type, props) => ({ type, props }),
    createRoot: (fn) => fn(() => undefined),
    createEffect: (fn) => fn(),
    createSignal(value) { let current = value; return [() => current, (next) => (current = next)]; },
    useTerminalDimensions: () => () => ({ width: 140, height: 40 })
  };
  try {
    const cleanup = await setupLitOpenCodeTui(context, runtime);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
    const band = () => claims.find((claim) => claim.append === "app")?.render({})();
    const rows = () => band().props.children.map((row) => row.props.children.map((span) => `${span.props.children}${span.props.style.fg}`).join(""));
    band();
    await settle();
    const bandTimers = () => [...timers.values()].filter((timer) => timer.ms === sceneTickMs || timer.ms === 250);
    const setStatus = async (next) => { state.status = next; listeners.forEach((handler) => handler({ details: { type: "session.status" } })); await settle(); };
    await run({ rows, bandTimers, setStatus, readsDuring: async (fn) => { let reads = 0; const list = context.data.session.message.list; context.data.session.message.list = (...args) => { reads += 1; return list(...args); }; await fn(); context.data.session.message.list = list; return reads; } });
    await cleanup();
    assert.equal(bandTimers().length, 0, "cleanup leaves no band timer");
  } finally {
    globalThis.setInterval = real.set;
    globalThis.clearInterval = real.clear;
    apply(saved);
    fs.rmSync(project, { recursive: true, force: true });
  }
}

test("a running turn moves the card on one timer that reads no session state, and the end of the turn stops it", async () => {
  await host({ status: "running" }, async ({ rows, bandTimers, setStatus, readsDuring }) => {
    assert.deepEqual(bandTimers().map((timer) => timer.ms), [sceneTickMs]);
    const before = rows();
    let after;
    const reads = await readsDuring(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      bandTimers()[0].fn();
      after = rows();
    });
    assert.equal(reads, 0);
    assert.notDeepEqual(after, before);
    await setStatus("idle");
    assert.equal(bandTimers().length, 0, "an idle card has no timer");
    const still = rows();
    assert.match(still.join("\n"), /▆/u, "the still scene stays");
    assert.deepEqual(rows(), still);
  });
});

test("motion off, NO_COLOR, fewer colours, a light theme or no band run no scene timer", async () => {
  for (const [setup, drawn] of [
    [{ motion: false }, true],
    [{ env: { NO_COLOR: "1" } }, false],
    [{ env: { COLORTERM: undefined } }, false],
    [{ themeMode: "light" }, false],
    [{ options: { band: false } }, undefined]
  ]) {
    await host({ status: "running", ...setup }, async ({ rows, bandTimers }) => {
      assert.equal(bandTimers().length, 0, JSON.stringify(setup));
      if (drawn !== undefined) assert.equal(/▆/u.test(rows().join("\n")), drawn, JSON.stringify(setup));
    });
  }
});
