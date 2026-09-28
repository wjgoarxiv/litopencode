import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkRun, runGate } from "../skills/lit-typographic-motion/gate.mjs";
import { auditSequence } from "../skills/lit-typographic-motion/engine/flash.mjs";
import { FPS, FRAMES, baseBox, fixtureMp4, samplePng, tempDir, writeRun } from "../test-support/motion-fixture.mjs";

const hasFfmpeg = fixtureMp4() !== null;

function gate(mutate) {
  const dir = tempDir();
  try {
    writeRun(dir, mutate);
    return checkRun(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function failsOnly(result, id) {
  assert.equal(result.checks[id]?.pass, false, `${id} should FAIL: ${JSON.stringify(result.checks[id])}`);
}

test("baseline fixture passes every gate rule", { skip: hasFfmpeg ? false : "ffmpeg is absent, so the MP4 fixture cannot be encoded" }, () => {
  const result = gate();
  assert.deepEqual(result.failed, [], JSON.stringify(Object.fromEntries(result.failed.map((id) => [id, result.checks[id]]))));
});

const frameEdit = (from, to, edit) => (model) => { for (let f = from; f < to; f++) edit(model.frameLines[f], f, model); };

const cases = [
  ["MO-C-01", "a frame range with no pass lines (a GLSL gap)", (m) => { m.passLines = m.manifest.passRanges.flatMap((r) => { const out = []; for (let f = r.frameStart; f <= r.frameEnd; f++) if (!(f >= 50 && f < 60)) out.push({ frame: f, pass: r.pass, draws: 1, uniforms: r.pass === "dither" ? { u_seed: r.seed } : { u_showGuides: false } }); return out; }); }],
  ["MO-C-01", "passes that logged draws: 0", (m) => { m.passLines = m.manifest.passRanges.flatMap((r) => { const out = []; for (let f = r.frameStart; f <= r.frameEnd; f++) out.push({ frame: f, pass: r.pass, draws: f === 90 ? 0 : 1, uniforms: r.pass === "dither" ? { u_seed: r.seed } : { u_showGuides: false } }); return out; }); }],
  ["MO-C-02", "an unlabelled software renderer", (m) => { m.manifest.renderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)"; m.manifest.softwareRenderer = true; m.manifest.samples = 1; for (const line of m.frameLines) line.sampleTimes = [line.frame / FPS]; m.perf.renderer = m.manifest.renderer; }],
  ["MO-SH-09", "a software renderer without the downgrade formula", (m) => { m.manifest.renderer = "Google SwiftShader"; m.manifest.softwareRenderer = true; m.manifest.samples = 1; m.manifest.warnings = ["software-rendered, --samples lowered to 1"]; for (const line of m.frameLines) line.sampleTimes = [line.frame / FPS]; m.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 71, sceneId: "title-slam", shotIndex: 0, seed: 1, params: { flickerAmpRealized: 0.03, persistenceEnabled: true }, downgraded: false }); }],
  ["MO-A-04", "software GL kept at four samples", (m) => { m.manifest.renderer = "llvmpipe (LLVM 15)"; m.manifest.softwareRenderer = true; m.manifest.warnings = ["software-rendered, --samples lowered to 1"]; }],
  ["MO-C-04", "a glyph bbox over the title-safe edge", frameEdit(10, 20, (line) => { line.textBoxes[0].bbox = [80, 480, 900, 600]; })],
  ["MO-C-05", "a non-glyph element over the action-safe edge", frameEdit(10, 11, (line) => { line.graphics.push({ elementId: "rule", kind: "swiss-grid", bbox: [20, 500, 400, 502] }); })],
  ["MO-C-06", "body type under 4.5:1", (m) => { m.sample = samplePng([60, 62, 66]); for (const line of m.frameLines) line.textBoxes[0] = { ...baseBox(), fontSizePx: 20, weight: 400, capHeightPx: 14 }; }],
  ["MO-C-06", "large type under 3:1 with a gradient fill", (m) => { m.sample = samplePng([40, 44, 50], [12, 14, 19], [300, 480, 900, 600], true); for (const line of m.frameLines) line.textBoxes[0] = { ...baseBox(), fill: "gradient", fillStops: ["#0C0E13", "#2A2C30"] }; }],
  ["MO-C-07/08", "a hold under its reading floor", (m) => { m.manifest.timeline[0].text = "a much longer opening title that needs several seconds to read"; }],
  ["MO-C-09", "a re-render whose rgbaSha256 differs", (m) => { m.determinism = { seeked: true, frames: [{ frame: 71, master: m.frameLines[71].rgbaSha256, rerender: "0".repeat(64) }] }; }],
  ["MO-A-25", "a determinism record without a seeked re-render", (m) => { m.determinism = { seeked: false, frames: [71, 72].map((frame) => ({ frame, master: m.frameLines[frame].rgbaSha256, rerender: m.frameLines[frame].rgbaSha256 })) }; }],
  ["MO-C-10/11/12", "an MP4 without the BT.709 tags", (m) => { m.exports["film.mp4"] = fixtureMp4({ tagged: false }); }, !hasFfmpeg],
  ["MO-A-03", "an MP4 encoded without the pinned BT.709 tags", (m) => { m.exports["film.mp4"] = fixtureMp4({ tagged: false }); }, !hasFfmpeg],
  ["MO-C-10/11/12", "an MP4 under 1920x1080", (m) => { m.exports["film.mp4"] = fixtureMp4({ width: 1280, height: 720 }); }, !hasFfmpeg],
  ["MO-C-10/11/12", "an MP4 at 24 fps", (m) => { m.exports["film.mp4"] = fixtureMp4({ fps: 24 }); }, !hasFfmpeg],
  ["MO-C-10/11/12", "a film shorter than 3 s", (m) => { m.manifest.durationSec = 2; }, !hasFfmpeg],
  ["MO-C-13", "a preview over 3 MB", (m) => { m.exports["preview.webp"] = Buffer.alloc(3_000_001, 1); }],
  ["MO-C-13", "a poster over 1 MB", (m) => { m.exports["poster.png"] = Buffer.alloc(1_000_001, 1); }],
  ["MO-C-14", "an unsettled reduced-motion still", (m) => { m.still.inkPixels = 1000; }],
  ["MO-SH-10", "showGuides true in an export", (m) => { m.manifest.passRanges[0].params.showGuides = true; }],
  ["MO-A-05", "CRT persistence on a non-stateful scene", (m) => { m.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 71, sceneId: "title-slam", shotIndex: 0, seed: 7, params: { flickerAmpRealized: 0.03, persistenceEnabled: true }, downgraded: false }); m.passLines = null; }],
  ["MO-C-29", "a third saturated cluster", frameEdit(0, 30, (line) => { line.fills.push({ color: "#0F7A82", bbox: [200, 200, 260, 260] }, { color: "#D9A441", bbox: [300, 200, 360, 260] }, { color: "#8E2BD9", bbox: [400, 200, 460, 260] }); })],
  ["MO-C-29", "the accent in two timeline entries", (m) => { for (const f of [10, 200]) m.frameLines[f].fills.push({ color: "#D9A441", bbox: [300, 200, 360, 260] }); }],
  ["MO-C-29", "the accent on more than 10% of frames", frameEdit(100, 200, (line) => { line.fills.push({ color: "#D9A441", bbox: [300, 200, 360, 260] }); })],
  ["MO-D-02", "a frame-time p95 over the ceiling", (m) => { m.perf.frameTimeMs = Array.from({ length: 120 }, () => 55); }],
  ["MO-D-03", "a near-black empty run", frameEdit(72, 300, (line) => { line.inkPixels = 0; line.p995L = 0.01; line.textBoxes = []; })],
  ["MO-D-04", "a missing glyph", (m) => { m.preflight.missingGlyphs = ["ŉ@Archivo-100-900.ttf in title-slam#0"]; }],
  ["MO-C-25", "display tracking past -0.04em", frameEdit(5, 6, (line) => { line.textBoxes[0].runs[0].trackingEm = -0.06; })],
  ["MO-C-25", "negative tracking on the machine voice", frameEdit(5, 6, (line) => { line.textBoxes.push({ ...baseBox(), voice: "machine", runs: [{ script: "latin", text: "01", font: "MesloLGS-NF-Regular.ttf", weight: 400, widthPct: 100, trackingEm: -0.01, scaleX: 1 }] }); })],
  ["MO-FT-04", "tracking motion on a Hangul run", frameEdit(5, 6, (line) => { line.textBoxes.push({ ...baseBox(), text: "새 시즌", runs: [{ script: "hangul", text: "새 시즌", font: "LitOpenCodeSans-Bold.otf", weight: 700, widthPct: 100, trackingEm: -0.02, scaleX: 1 }] }); })],
  ["MO-A-33", "a synthesized Hangul weight", frameEdit(5, 6, (line) => { line.textBoxes.push({ ...baseBox(), text: "새 시즌", runs: [{ script: "hangul", text: "새 시즌", font: "LitOpenCodeSans-Bold.otf", weight: 500, widthPct: 100, trackingEm: 0, scaleX: 0.9 }] }); })],
  ["MO-A-35", "outlined type", frameEdit(5, 6, (line) => { line.textBoxes[0].outline = true; })],
  ["MO-C-26", "a multi-line block under its line-height floor", frameEdit(5, 6, (line) => { line.textBoxes.push({ ...baseBox(), elementId: "list", lineCount: 2, lineHeight: 1.2, lines: ["One", "Two"] }); })],
  ["MO-C-27", "a Latin paragraph card outside 60-75ch", frameEdit(250, 251, (line) => { line.textBoxes.push({ ...baseBox(), elementId: "end-paragraph", role: "paragraph", lineCount: 2, lineHeight: 1.5, measureCh: 40, lines: ["short", "lines"] }); })],
  ["MO-A-15", "a cut more than one frame off the beat", (m) => { m.manifest.timeline[1].start = 1.25; m.manifest.timeline[1].holdSec = 4.75; m.manifest.timeline[0].end = 1.25; m.manifest.timeline[0].holdSec = 1.25; }],
  ["MO-A-16", "a scene held under two beats", (m) => { Object.assign(m.manifest.timeline[0], { end: 0.6, holdSec: 0.6, text: "Go" }); Object.assign(m.manifest.timeline[1], { start: 0.6, beatSec: 0.6, holdSec: 5.4 }); }],
  ["MO-A-13", "a reveal step that splits a 어절", (m) => { m.manifest.timeline.splice(1, 0, { id: "title-slam#0/r0", sceneId: "title-slam", shotIndex: 0, start: 0, end: 1.2, holdSec: 1.2, kind: "reveal", text: "Te", script: "latin", beatSec: 0 }); }],
  ["MO-SH-03", "three events inside one second of a shot", (m) => { for (const f of [100, 120, 140]) m.frameLines[f].events.push({ kind: "glitch", sceneId: "end-card", shotIndex: 0, time: f / FPS, areaPct: 5 }); }],
  ["MO-SH-04a", "a full-frame luminance step", frameEdit(150, 151, (line) => { line.fullStep = true; })],
  ["MO-SH-05", "a glitch rate over 2.0 hits per second", (m) => { m.manifest.passRanges.push({ pass: "glitch", frameStart: 72, frameEnd: 359, sceneId: "end-card", shotIndex: 0, seed: 1, params: { intensity: 0.3, hitRatePerSecRealized: 2.5, areaCapPct: 12, maxAreaPctRealized: 10 }, downgraded: false }); }],
  ["MO-SH-05", "a glitch hit over 20% area", (m) => { m.manifest.passRanges.push({ pass: "glitch", frameStart: 72, frameEnd: 359, sceneId: "end-card", shotIndex: 0, seed: 1, params: { intensity: 0.3, hitRatePerSecRealized: 0.5, areaCapPct: 25, maxAreaPctRealized: 25 }, downgraded: false }); }],
  ["MO-SH-06", "a surge attack under 0.1 s", (m) => { m.manifest.passRanges.push({ pass: "tidal-gradient", frameStart: 72, frameEnd: 359, sceneId: "end-card", shotIndex: 0, seed: 1, params: { surgeAttackSec: 0.05, surgeDecaySec: 0.25, surgeCapPerSec: 2, octaves: 4 }, downgraded: false }); }],
  ["MO-SH-06", "surges faster than 2 per second", (m) => { m.manifest.passRanges.push({ pass: "tidal-gradient", frameStart: 72, frameEnd: 359, sceneId: "end-card", shotIndex: 0, seed: 1, params: { surgeAttackSec: 0.15, surgeDecaySec: 0.25, surgeCapPerSec: 3, octaves: 4 }, downgraded: false }); }],
  ["MO-SH-07", "CRT flicker over 0.06", (m) => { m.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 71, sceneId: "title-slam", shotIndex: 0, seed: 1, params: { flickerAmpRealized: 0.08, persistenceEnabled: false }, downgraded: false }); m.passLines = null; }],
  ["MO-SH-08", "a dither reseed inside a shot", (m) => { m.passLines = m.manifest.passRanges.flatMap((r) => { const out = []; for (let f = r.frameStart; f <= r.frameEnd; f++) out.push({ frame: f, pass: r.pass, draws: 1, uniforms: r.pass === "dither" ? { u_seed: f > 100 && r.sceneId === "end-card" ? r.seed + 1 : r.seed } : { u_showGuides: false } }); return out; }); }],
  ["MO-SH-01", "a pass seed that ignores the run seed", (m) => { m.manifest.passRanges[1].seed = 12345; }],
  ["MO-A-58", "an invert change off a cut", frameEdit(30, FRAMES, (line) => { line.post.invert = true; })],
  ["MO-A-58", "an override outside its range", frameEdit(30, 31, (line) => { line.post.bloom = 1.5; })],
  ["MO-A-28", "sample times that do not follow the pinned formula", frameEdit(40, 41, (line) => { line.sampleTimes = [0.1, 0.2, 0.3, 0.4]; })],
  ["MO-A-51", "chrome flags that are not a ladder rung", (m) => { m.manifest.chromeFlags = ["--no-sandbox"]; }],
  ["MO-A-41a", "a malformed timeline entry", (m) => { delete m.manifest.timeline[0].beatSec; }],
  ["MO-A-37-41", "a missing export", (m) => { m.exports["reduced-motion.png"] = null; }],
  ["MO-B-00", "a preset that contradicts the keyword table", (m) => { m.brief.sourceText = "a terminal boot log"; }],
  ["MO-C-15/16", "a fourth craft round", (m) => { m.manifest.craftRound = 4; }]
];

for (const [id, label, mutate, skip] of cases) {
  test(`gate fixture: ${label} fails ${id}`, { skip: skip ? "ffmpeg is absent, so the MP4 fixture cannot be encoded" : false }, () => {
    failsOnly(gate(mutate), id);
  });
}

// A real flash sequence (fixture i: a full-frame 0.05 <-> 0.55 linear pulse, 6-frame attack and
// decay, 4 per second) run through the same detector the renderer uses, then fed to the gate.
function pulseTransitions() {
  const toByte = (linear) => Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));
  const frames = [];
  for (let f = 0; f < 60; f++) {
    const phase = f % 15;
    const level = phase < 6 ? 0.05 + (0.5 * phase) / 6 : phase < 12 ? 0.55 - (0.5 * (phase - 6)) / 6 : 0.05;
    frames.push(Buffer.alloc(320 * 180 * 4, toByte(level)));
  }
  return auditSequence(frames, 320, 180, FPS, false).records;
}

test("gate fixture: a flash sequence fails MO-C-03 and the exports are withheld, never delivered", () => {
  const dir = tempDir();
  try {
    const records = pulseTransitions();
    writeRun(dir, (m) => { records.forEach((record, i) => { m.frameLines[120 + i].transitions = { up: record.up, down: record.down, redUp: record.redUp, redDown: record.redDown }; }); });
    const result = runGate(dir);
    assert.equal(result.checks["MO-C-03"].pass, false);
    assert.equal(result.exitCode, 13);
    for (const name of ["film.mp4", "preview.webp", "poster.png"]) {
      assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} must not sit at its deliverable name`);
    }
    assert.equal(fs.existsSync(path.join(dir, "withheld", "preview.webp")), true);
    assert.match(fs.readFileSync(path.join(dir, "gate-report.txt"), "utf8"), /export state: withheld/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gate fixture: a frame-time failure alone still delivers the film", () => {
  const dir = tempDir();
  try {
    writeRun(dir, (m) => { m.perf.frameTimeMs = Array.from({ length: 120 }, () => 80); });
    const result = runGate(dir);
    assert.equal(result.checks["MO-D-02"].pass, false);
    assert.equal(fs.existsSync(path.join(dir, "preview.webp")), true);
    assert.match(fs.readFileSync(path.join(dir, "gate-report.txt"), "utf8"), /export state: delivered/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a gate re-run without --viewed keeps the count recorded earlier in the same craft round", { skip: hasFfmpeg ? false : "ffmpeg is absent, so the MP4 fixture cannot be encoded" }, () => {
  const dir = tempDir();
  try {
    writeRun(dir);
    runGate(dir, { viewed: 7 });
    assert.match(runGate(dir).report, /frames actually viewed this run: 7 /u);
    assert.match(runGate(dir, { viewed: 9 }).report, /frames actually viewed this run: 9 /u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
