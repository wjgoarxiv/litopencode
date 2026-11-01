import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { decodePng, encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { formatStageReport } from "../skills/lit-typographic-motion/engine/stage/gate.mjs";
import { clipLimits, clipsScript, scanClips, scanStage } from "../skills/lit-typographic-motion/engine/stage/scan.mjs";
import { fixtureStageTreatment, stageRun } from "../test-support/motion-treatment.mjs";

// Declared keyed overlay clips on the stage path (references/stage.md, Clips). Frames inside a folder that
// stage/clips/clips.json declares are held to the clip limits and are not page rasters; every other
// raster keeps its flipbook and count limits. Renders need a pre-warmed test cache, never the real one.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const fixtures = path.resolve("test", "fixtures", "stage");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const needsWarm = warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch the stage";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const frameName = (i) => `frame_${String(i).padStart(4, "0")}.png`;

/** An RGBA frame whose first pixel is transparent (a keyed frame); `opaque` makes every pixel solid. */
const keyed = (w, h, { opaque = false, shade = 90 } = {}) => {
  const pixels = Buffer.alloc(w * h * 4, shade);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  if (!opaque) pixels[3] = 0;
  return encodePng(w, h, pixels, 4);
};

/** A stage folder with index.html, clips/<dir>/frame_NNNN.png for each clip and clips/clips.json. */
function stageWith(clips, { declare = clips, extra = () => {} } = {}) {
  const stage = path.join(tmp("ltm-clips-"), "stage");
  fs.mkdirSync(path.join(stage, "clips"), { recursive: true });
  fs.writeFileSync(path.join(stage, "index.html"), "<!doctype html><title>clips</title>");
  for (const clip of clips) {
    fs.mkdirSync(path.join(stage, "clips", clip.dir), { recursive: true });
    const png = clip.png ?? keyed(clip.w ?? 8, clip.h ?? 6);
    for (let i = 1; i <= (clip.files ?? clip.count); i++) fs.writeFileSync(path.join(stage, "clips", clip.dir, frameName(i)), png);
  }
  fs.writeFileSync(path.join(stage, "clips", "clips.json"), JSON.stringify({ clips: declare.map(({ id, dir, count, fps }) => ({ id, dir, count, fps })) }));
  extra(stage);
  return stage;
}
const dispose = (stage) => fs.rmSync(path.dirname(stage), { recursive: true, force: true });
const refusal = (fn) => {
  try { fn(); } catch (error) { return error; }
  return null;
};
const A = { id: "boom", dir: "01-boom", count: 12, fps: 30 };
const B = { id: "cat", dir: "10-cat", count: 30, fps: 30 };

test("a declared clip set is exempt from the flipbook and count rule and is listed in the scan", () => {
  const stage = stageWith([A, B]);
  try {
    const scan = scanStage(stage);
    assert.equal(scan.rasters.length, 0, "clip frames are not page rasters");
    assert.deepEqual(scan.clips.map((c) => [c.id, c.count, c.fps, c.width, c.height]), [["boom", 12, 30, 8, 6], ["cat", 30, 30, 8, 6]]);
    assert.ok(scan.clips.every((c) => c.bytes > 0 && c.frames.length === c.count));
  } finally { dispose(stage); }
});

test("an undeclared frame sequence is still a flipbook, also beside a declared clip", () => {
  const stage = stageWith([A], {
    extra: (dir) => {
      fs.mkdirSync(path.join(dir, "flip"));
      for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(dir, "flip", frameName(i)), keyed(8, 6));
    }
  });
  try { assert.throws(() => scanStage(stage), (error) => error.exitCode === 17 && /flipbook/u.test(error.message)); } finally { dispose(stage); }
});

test("a clip folder missing from clips.json is a flipbook, and a stage without clips.json keeps today's limits", () => {
  const undeclared = stageWith([A], { declare: [] });
  const bare = stageWith([A]);
  try {
    assert.throws(() => scanStage(undeclared), (error) => error.exitCode === 17 && /flipbook/u.test(error.message));
    fs.rmSync(path.join(bare, "clips", "clips.json"));
    assert.throws(() => scanStage(bare), (error) => error.exitCode === 17 && /flipbook/u.test(error.message));
  } finally { dispose(undeclared); dispose(bare); }
});

test("cover mode takes no clips", () => {
  const stage = stageWith([A]);
  try { assert.throws(() => scanStage(stage, { clips: false }), (error) => error.exitCode === 17 && /flipbook/u.test(error.message)); } finally { dispose(stage); }
});

const refused = [
  ["more frames than a clip may have", { ...A, count: 361 }, /clip "boom".*361 frames/u],
  ["a frame missing from the run", { ...A, files: 11 }, /frame_0012\.png/u],
  ["a stray frame beyond the declared count", { ...A, files: 13 }, /frame_0013\.png/u],
  ["frames with no alpha channel", { ...A, png: encodePng(8, 6, Buffer.alloc(8 * 6, 90), 1) }, /RGBA/u],
  ["RGBA frames with no transparent pixel", { ...A, png: keyed(8, 6, { opaque: true }) }, /transparen/u],
  ["a frame larger than the overlay cap", { ...A, w: 721, h: 20 }, /clip "boom".*721/u],
  ["frames of mixed sizes", { ...A, mixed: true }, /one size per clip/u],
  ["a frame rate above 30", { ...A, fps: 60 }, /fps/u],
  ["a folder name that climbs out", { ...A, climb: true }, /dir/u],
  ["an id that is not a plain token", { ...A, id: "a b" }, /id/u]
];
for (const [name, clip, message] of refused) {
  test(`refuses ${name} with exit 17`, () => {
    const stage = stageWith([clip], {
      extra: (dir) => {
        if (clip.climb) fs.writeFileSync(path.join(dir, "clips", "clips.json"), JSON.stringify({ clips: [{ id: clip.id, dir: "..", count: clip.count, fps: clip.fps }] }));
        if (clip.mixed) fs.writeFileSync(path.join(dir, "clips", clip.dir, frameName(5)), keyed(9, 6));
      }
    });
    try {
      const failure = refusal(() => scanStage(stage));
      assert.ok(failure, "the scan must refuse it");
      assert.equal(failure.exitCode, 17, failure.message);
      assert.match(failure.message, message);
    } finally { dispose(stage); }
  });
}

test("refuses a duplicate id, a malformed clips.json and more than the clip cap", () => {
  const twice = stageWith([A, { ...B, dir: "other", id: "boom" }]);
  const bad = stageWith([A]);
  const many = stageWith(Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, dir: `d${i}`, count: 2, fps: 30 })));
  try {
    assert.throws(() => scanStage(twice), (error) => error.exitCode === 17 && /duplicate.*boom/u.test(error.message));
    fs.writeFileSync(path.join(bad, "clips", "clips.json"), "{ not json");
    assert.throws(() => scanStage(bad), (error) => error.exitCode === 17 && /clips\.json/u.test(error.message));
    assert.throws(() => scanStage(many), (error) => error.exitCode === 17 && /at most 12 clips/u.test(error.message));
  } finally { dispose(twice); dispose(bad); dispose(many); }
});

test("holds per-clip and total bytes and frames to the exported caps", () => {
  assert.deepEqual(Object.keys(clipLimits).sort(), ["bytesPerClip", "bytesTotal", "clips", "fps", "framesPerClip", "framesTotal", "side"]);
  assert.deepEqual({ ...clipLimits }, { clips: 12, framesPerClip: 360, framesTotal: 1500, bytesPerClip: 40 * 1024 * 1024, bytesTotal: 128 * 1024 * 1024, side: 720, fps: 30 });
  const stage = stageWith([A, B]);
  try {
    const run = (limits) => refusal(() => scanClips(stage, { limits: { ...clipLimits, ...limits } }))?.exitCode ?? 0;
    assert.equal(run({}), 0);
    assert.equal(run({ bytesPerClip: 100 }), 17, "per-clip bytes");
    assert.equal(run({ bytesTotal: 100 }), 17, "total bytes");
    assert.equal(run({ framesTotal: 41 }), 17, "total frames");
  } finally { dispose(stage); }
});

test("clipsScript writes window.LitClips from clips.json and the first frame, and is null without clips", () => {
  const stage = stageWith([A]);
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(clipsScript(stage), sandbox);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.LitClips)), { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 8, height: 6 } });
    fs.rmSync(path.join(stage, "clips"), { recursive: true });
    assert.equal(clipsScript(stage), null);
  } finally { dispose(stage); }
});

test("the cover render scans its page without clips, and the stage report lists each clip", () => {
  assert.match(fs.readFileSync(path.join(skillRoot, "engine", "cover", "render.mjs"), "utf8"), /scanStage\(coverDir, \{ clips: false \}\)/u);
  const manifest = { fps: 30, format: "16:9", resolution: [1920, 1080], durationSec: 4.2, targetDurationSec: 4.2, rung: "swiftshader", chromeFlags: [], craftRound: 2, clips: [{ id: "boom", frames: 12, fps: 30 }, { id: "cat", frames: 30, fps: 24 }] };
  const report = formatStageReport({ manifest, checks: {}, passed: true, warnings: [] }, { exportDir: "out", viewed: 0 });
  assert.match(report, /^clips: boom 12 frames at 30 fps, cat 30 frames at 24 fps \(keyed overlays, chosen from film time\)$/mu);
});

// ---- LitStage.clip: the frame is a function of film time alone ----
function kit(clips) {
  const element = (tag) => ({ tag, style: {}, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(child) { this.children.push(child); child.parent = this; }, replaceWith(next) { this.parent.children[this.parent.children.indexOf(this)] = next; next.parent = this.parent; } });
  const document = { createElement: element, images: [], fonts: { ready: Promise.resolve() } };
  const sandbox = { document, performance: { now: () => 0 }, console, Element: class {}, Math, LitClips: clips };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(skillRoot, "engine", "stage", "stage-kit.js"), "utf8"), sandbox);
  return { LitStage: sandbox.LitStage, parent: element("div") };
}
const data = { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 520, height: 511 } };
const box = { x: 10, y: 20, w: 300, h: 300 };
const shown = (parent) => parent.children[0].children[0]?.src;

test("LitStage.clip maps film time to a 1-based frame: floor((t - start) * fps) + 1", () => {
  const { LitStage, parent } = kit(data);
  const show = LitStage.clip({ parent, id: "boom", box });
  assert.equal(show(1.0, { start: 1.0 }), parent.children[0]);
  assert.match(shown(parent), /^clips\/01-boom\/frame_0001\.png$/u);
  show(1.0 + 4 / 30, { start: 1.0 });
  assert.match(shown(parent), /frame_0005\.png$/u);
  show(1.0 + 11 / 30, { start: 1.0 });
  assert.match(shown(parent), /frame_0012\.png$/u);
});

test("LitStage.clip is hidden before its cue and after its last frame unless it loops or holds", () => {
  const { LitStage, parent } = kit(data);
  const show = LitStage.clip({ parent, id: "boom", box });
  assert.equal(show(0.5, { start: 1.0 }), null, "before the cue");
  assert.equal(parent.children[0].style.display, "none");
  assert.equal(show(1.0 + 12 / 30, { start: 1.0 }), null, "past the last frame");
  show(1.0 + 13 / 30, { start: 1.0, hold: true });
  assert.match(shown(parent), /frame_0012\.png$/u, "hold keeps the last frame");
  show(1.0 + 13 / 30, { start: 1.0, loop: true });
  assert.match(shown(parent), /frame_0002\.png$/u, "loop wraps by frame index");
});

test("LitStage.clip plays a frame range and gives the same frame for the same t in any order", () => {
  const { LitStage, parent } = kit(data);
  const show = LitStage.clip({ parent, id: "boom", box });
  const options = { start: 0, from: 4, to: 6 };
  show(2 / 30, options);
  assert.match(shown(parent), /frame_0006\.png$/u);
  assert.equal(show(3 / 30, options), null, "past the range");
  show(0, options);
  assert.match(shown(parent), /frame_0004\.png$/u);
  show(2 / 30, options);
  assert.match(shown(parent), /frame_0006\.png$/u, "same t, same frame");
  assert.throws(() => show(0, { from: 0 }), /from\.\.to/u);
  assert.throws(() => show(0, { to: 13 }), /from\.\.to/u);
});

test("LitStage.clip keeps one wrapper at the box and refuses an unknown clip, a bad box or a missing script", () => {
  const { LitStage, parent } = kit(data);
  const show = LitStage.clip({ parent, id: "boom", box });
  show(0, { start: 0 });
  show(0.1, { start: 0 });
  assert.equal(parent.children.length, 1, "one wrapper, never one per frame");
  const wrapper = parent.children[0];
  assert.deepEqual([wrapper.style.left, wrapper.style.top, wrapper.style.width, wrapper.style.height], ["10px", "20px", "300px", "300px"]);
  assert.equal(wrapper.attrs["data-lit-clip"], "boom");
  assert.throws(() => LitStage.clip({ parent, id: "nope", box }), /nope/u);
  assert.throws(() => LitStage.clip({ parent, id: "boom" }), /box/u);
  assert.throws(() => kit(undefined).LitStage.clip({ parent, id: "boom", box }), /clips\.js/u);
});

test("LitStage.clip is still the mask namespace: circle, wipe and iris keep working beside the keyed clip call", () => {
  const { LitStage } = kit(data);
  for (const name of ["circle", "wipe", "iris"]) assert.equal(typeof LitStage.clip[name], "function", name);
  const el = { style: {} };
  LitStage.clip.wipe(el, 0.5, "left");
  assert.equal(el.style.clipPath, "inset(0 50% 0 0)");
});

// ---- real renders (Chrome + pre-warmed cache) ----
function pixel(file, x, y) {
  const image = decodePng(fs.readFileSync(file));
  const i = (y * image.width + x) * image.channels;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}
const near = (got, want) => got.every((value, i) => Math.abs(value - want[i]) <= 3);
/** Frame k of clip "swatch" is solid (20k, 0, 0) with one transparent pixel. */
function swatchFiles() {
  const files = { "clips/clips.json": JSON.stringify({ clips: [{ id: "swatch", dir: "swatch", count: 8, fps: 30 }] }) };
  for (let k = 1; k <= 8; k++) {
    const pixels = Buffer.alloc(8 * 6 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([20 * k, 0, 0, 255], i);
    pixels[3] = 0;
    files[`clips/swatch/${frameName(k)}`] = encodePng(8, 6, pixels, 4);
  }
  return files;
}
function renderStage(out, args) {
  return spawnSync(process.execPath, [render, "stage", "--out", out, ...args], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed }, timeout: 600_000 });
}

test("a declared clip shows the frame film time picks, holds its last frame, then hides", { skip: needsWarm }, () => {
  const dir = tmp("ltm-clip-render-");
  try {
    const out = stageRun(path.join(dir, "out"), fs.readFileSync(path.join(fixtures, "clip-overlay.html"), "utf8"), { files: swatchFiles() });
    const result = renderStage(out, ["--stills-only"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const centre = (still) => pixel(path.join(out, "stills", still), 800, 450);
    assert.ok(near(centre("beat-01-mid.png"), [140, 0, 0]), `t = 0.7 s is clip frame 7: ${centre("beat-01-mid.png")}`);
    assert.ok(near(centre("beat-02-mid.png"), [160, 0, 0]), `t = 2.1 s holds frame 8, which ended at 0.767 s: ${centre("beat-02-mid.png")}`);
    assert.ok(near(centre("beat-03-mid.png"), [0, 0, 0]), `t = 3.5 s is past the hold: ${centre("beat-03-mid.png")}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a clip does not slip past the flash audit: a full-frame white and black clip fails MO-C-03 and withholds the film", { skip: needsWarm }, () => {
  const dir = tmp("ltm-clip-strobe-");
  try {
    const files = { "clips/clips.json": JSON.stringify({ clips: [{ id: "strobe", dir: "strobe", count: 8, fps: 30 }] }) };
    for (let k = 1; k <= 8; k++) {
      const pixels = Buffer.alloc(8 * 6 * 4, Math.floor((k - 1) / 2) % 2 ? 0 : 255);
      pixels[3] = 0;
      for (let i = 7; i < pixels.length; i += 4) pixels[i] = 255;
      files[`clips/strobe/${frameName(k)}`] = encodePng(8, 6, pixels, 4);
    }
    const out = stageRun(path.join(dir, "out"), fs.readFileSync(path.join(fixtures, "clip-strobe.html"), "utf8"), { files, treatment: fixtureStageTreatment() });
    const result = renderStage(out, ["--round", "2"]);
    assert.equal(result.status, 13, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /MO-C-03 FAIL/u);
    assert.equal(fs.existsSync(path.join(out, "film.mp4")), false, "a flash-audit FAIL withholds the film");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
