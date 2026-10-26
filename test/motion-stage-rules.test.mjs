import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { limits } from "../skills/lit-typographic-motion/engine/constants.mjs";
import { checkStageRun, stageGate } from "../skills/lit-typographic-motion/engine/stage/gate.mjs";
import { TEXT_QA, judgeStyle, qaSamples } from "../skills/lit-typographic-motion/engine/stage/qa.mjs";
import { readStyle } from "../skills/lit-typographic-motion/engine/styles.mjs";
import { fixtureStageTreatment } from "../test-support/motion-treatment.mjs";

// ---- FLAT-FRAME and DEAD-AIR: the empty-frame rules read the per-frame record of the master ----
const FPS = 30;
function gateRows(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-rules-"));
  try {
    const count = FPS * 6;
    const frames = Array.from({ length: count }, (_, frame) => ({ frame, rgbaSha256: String(frame), p995L: 0.5, p005L: 0.05, busy: 0.4, transitions: { up: 0, down: 0, redUp: 0, redDown: 0 } }));
    mutate(frames);
    fs.mkdirSync(path.join(dir, ".run"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".run", "stage-frames.jsonl"), frames.map((line) => JSON.stringify(line)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ path: "stage", format: "16:9", resolution: [1920, 1080], fps: FPS, frameCount: count, durationSec: 6, targetDurationSec: 6, webgl: {} }));
    return checkStageRun(dir).checks;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const flatten = (from, to, low, high) => (frames) => { for (let f = from; f < to; f++) Object.assign(frames[f], { p005L: low, p995L: high }); };
const emptyAir = (from, to) => (frames) => { for (let f = from; f < to; f++) frames[f].busy = 0.01; };

test("a drawn film passes FLAT-FRAME and DEAD-AIR", () => {
  const rows = gateRows(() => {});
  assert.equal(rows["FLAT-FRAME"].pass, true, JSON.stringify(rows["FLAT-FRAME"]));
  assert.equal(rows["DEAD-AIR"].pass, true, JSON.stringify(rows["DEAD-AIR"]));
});

test("FLAT-FRAME fails an empty dark frame and an empty light frame held past 1 s", () => {
  assert.equal(gateRows(flatten(60, 120, 0.01, 0.012))["FLAT-FRAME"].pass, false, "dark");
  assert.equal(gateRows(flatten(60, 120, 0.88, 0.89))["FLAT-FRAME"].pass, false, "light");
  assert.equal(gateRows(flatten(60, 80, 0.88, 0.89))["FLAT-FRAME"].pass, true, "under 1 s is a beat, not a hole");
  assert.equal(gateRows(flatten(0, 40, 0.88, 0.89))["FLAT-FRAME"].pass, true, "the opening may build from a blank for a second more");
  assert.equal(gateRows(flatten(0, 80, 0.88, 0.89))["FLAT-FRAME"].pass, false);
});

test("DEAD-AIR fails a near-empty frame held past 0.5 s, with a grace at the open and the close", () => {
  assert.equal(gateRows(emptyAir(60, 90))["DEAD-AIR"].pass, false);
  assert.equal(gateRows(emptyAir(60, 70))["DEAD-AIR"].pass, true);
  assert.equal(gateRows(emptyAir(0, 25))["DEAD-AIR"].pass, true, "0.5 s + 0.4 s open grace");
  assert.equal(gateRows(emptyAir(0, 40))["DEAD-AIR"].pass, false);
  assert.equal(gateRows(emptyAir(150, 180))["DEAD-AIR"].pass, true, "0.5 s + 0.6 s close grace");
  assert.equal(gateRows(emptyAir(130, 180))["DEAD-AIR"].pass, false);
});

test("a film recorded before the empty-frame rules reports them as not measured, never as a pass of nothing", () => {
  const rows = gateRows((frames) => { for (const f of frames) { delete f.p005L; delete f.busy; } });
  assert.equal(rows["FLAT-FRAME"].na, true);
  assert.equal(rows["DEAD-AIR"].na, true);
});

// ---- the flash audit is untouched ----
test("the flash audit keeps its thresholds and its code", () => {
  assert.equal(limits.flashLimitGeneral, 3);
  assert.equal(limits.flashLimitRed, 3);
  assert.equal(limits.fullFrameStepDelta, 0.1);
  assert.equal(limits.fullFrameStepArea, 0.25);
  const source = fs.readFileSync(path.resolve("skills", "lit-typographic-motion", "engine", "flash.mjs"), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), "81eb8d42b118570854aa00b8e83d471d989fad8c4c9eaf152fc8e59f6a3b0ee2", "engine/flash.mjs is byte-identical to the shipped flash audit");
  assert.equal(stageGate.flatSpread, 0.02);
});

// ---- the text rules against the house style ----
const base = fixtureStageTreatment({ durationSec: 4.2, fps: 30 });
const style = readStyle("swiss-signal");
const run = (patch = {}) => ({ text: "지붕의 비가 사흘을 버틴다", kind: "dom", copy: true, decor: false, settled: true, color: "rgb(233, 235, 228)", family: "Archivo", fontSizePx: style.scale["16:9"].headline, gradient: false, box: [158, 810, 1760, 880], ...patch });
const sample = (runs, patch = {}) => ({ frame: 60, beat: 0, cut: false, runs, ...patch });
const rows = (samples, treatment = base) => judgeStyle({ treatment, width: 1920, height: 1080, samples });

test("TEXT-OVERLAP fails two visible runs sharing space, including across a cut", () => {
  const a = run(), b = run({ text: "자갈 턱이 넘침을 막는다", box: [158, 830, 1760, 900] });
  assert.equal(rows([sample([a])])["TEXT-OVERLAP"].pass, true);
  assert.equal(rows([sample([a, b])])["TEXT-OVERLAP"].pass, false);
  const apart = run({ text: "자갈 턱이 넘침을 막는다", box: [158, 200, 900, 260] });
  assert.equal(rows([sample([a, apart])])["TEXT-OVERLAP"].pass, true);
  // An outgoing and an incoming line that cross at 0.3 s after a cut: only the cut window sees it.
  const crossing = sample([a, b], { frame: 69, beat: 1, cut: true });
  assert.equal(rows([sample([a]), crossing])["TEXT-OVERLAP"].pass, false);
  assert.match(rows([crossing])["TEXT-OVERLAP"].detail, /cut/u);
  // Decor text sits behind the film and never counts.
  assert.equal(rows([sample([a, { ...b, decor: true }])])["TEXT-OVERLAP"].pass, true);
});

test("the cut window samples every shot change within 0.4 s on both sides", () => {
  const beats = [{ t0: 0, t1: 2 }, { t0: 2, t1: 4 }];
  const frames = qaSamples({ beats, fps: 60, frameCount: 240 });
  const cuts = frames.filter((s) => s.cut);
  assert.ok(cuts.length >= 10, `${cuts.length} cut samples`);
  assert.ok(cuts.every((s) => s.frame >= 120 - 24 && s.frame <= 120 + 24));
  assert.ok(cuts.some((s) => s.frame < 120) && cuts.some((s) => s.frame > 120));
  assert.ok(frames.filter((s) => s.mid).length === 2);
  assert.equal(TEXT_QA.cutWindowSec, 0.4);
});

test("TEXT-ON-STYLE fails copy in an off-style colour, face or size", () => {
  assert.equal(rows([sample([run()])])["TEXT-ON-STYLE"].pass, true);
  assert.equal(rows([sample([run({ color: "rgb(255, 0, 128)" })])])["TEXT-ON-STYLE"].pass, false, "colour");
  assert.equal(rows([sample([run({ family: "Comic Sans MS" })])])["TEXT-ON-STYLE"].pass, false, "face");
  assert.equal(rows([sample([run({ fontSizePx: 90 })])])["TEXT-ON-STYLE"].pass, false, "size");
  // Decor text off the scale is a warning row; it never fails the film.
  const decor = rows([sample([run(), run({ copy: false, decor: true, fontSizePx: 9, box: [100, 100, 200, 120] })])])["TEXT-ON-STYLE"];
  assert.equal(decor.warn, true);
  assert.equal(decor.pass, false);
});

test("TEXT-ZONE fails copy outside the shot's type zone and copy in a full shot", () => {
  // beat 0 is the stage layout: the type zone is the bottom band.
  assert.equal(rows([sample([run()])])["TEXT-ZONE"].pass, true);
  assert.equal(rows([sample([run({ box: [158, 300, 1760, 370] })])])["TEXT-ZONE"].pass, false);
  const full = fixtureStageTreatment({ durationSec: 4.2, fps: 30 });
  full.beats[0].layout = "full";
  assert.equal(rows([sample([run()])], full)["TEXT-ZONE"].pass, false);
  // A line crossing a cut is mid-transition and is not judged for its zone.
  assert.equal(rows([sample([run({ box: [158, 300, 1760, 370] })], { cut: true })])["TEXT-ZONE"].pass, true);
});
