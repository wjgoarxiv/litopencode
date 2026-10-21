import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { COVER, EXIT } from "../skills/lit-typographic-motion/engine/constants.mjs";
import { decodePng, encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { findChrome, loadPlaywright, which } from "../skills/lit-typographic-motion/engine/browser.mjs";
import { validateCoverTreatment } from "../skills/lit-typographic-motion/engine/cover/treatment.mjs";
import { capHeight, coverGate, formatCoverReport, motionMetrics, onGrid } from "../skills/lit-typographic-motion/engine/cover/gate.mjs";
import { decodeCover, readGifContainer } from "../skills/lit-typographic-motion/engine/cover/decode.mjs";
import { lanczosResize, lumaGrid, ssim } from "../skills/lit-typographic-motion/engine/cover/image.mjs";
import { artCheck, generatedAssetLabels } from "../skills/lit-typographic-motion/engine/cover/assets.mjs";
import { coverEncoder, frameAt, img2webpArgs, loopTimes, maxLevelDiff, seekOrder } from "../skills/lit-typographic-motion/engine/cover/render.mjs";
import { coverChromeFlags, coverFonts, openCover } from "../skills/lit-typographic-motion/engine/cover/capture.mjs";
import { inspectWarmState, pins, skillRoot as motionRoot } from "../skills/lit-typographic-motion/runtime.mjs";
import { composeSheet } from "../skills/lit-typographic-motion/engine/cover/sheet.mjs";
import { COVER_LOOK_QUESTIONS, doneState, formatDone, needsAnotherRound, recordLook } from "../skills/lit-typographic-motion/engine/look.mjs";
import { formatProbe } from "../skills/lit-typographic-motion/probe.mjs";
import { promptForChatActivationMode } from "../src/activation-routing.ts";
import { managedSkillDefinition } from "../src/cli/managed-skill-assets.ts";
import { coverAnswers, coverTreatment, fakeCoverRun } from "../test-support/motion-cover.mjs";
import { stageTreatment } from "../test-support/motion-treatment.mjs";

// Cover mode: README cover loops gated on the decoded file (references/cover.md).
// Paths that launch Chrome need a pre-warmed test cache, never the user's real one.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const gateCli = path.join(skillRoot, "gate.mjs");
const fixtures = path.resolve("test", "fixtures", "cover");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const libwebp = Boolean(which("img2webp") && which("dwebp"));
const needsRender = !warmed ? "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch Chrome" : !libwebp ? "img2webp and dwebp are not on PATH" : false;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cli = (args, env = {}) => spawnSync(process.execPath, [render, ...args], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed ?? path.join(os.tmpdir(), "ltm-no-cache"), ...env }, timeout: 1_200_000 });

function coverRun(prefix, page, treatment = coverTreatment()) {
  const out = path.join(tmp(prefix), "out");
  fs.mkdirSync(path.join(out, "cover"), { recursive: true });
  fs.cpSync(page, path.join(out, "cover"), { recursive: true });
  fs.writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
  return out;
}
const done = (out) => fs.rmSync(path.dirname(out), { recursive: true, force: true });
const writeAnswers = (out, doc) => { const file = path.join(out, "answers.json"); fs.writeFileSync(file, JSON.stringify(doc)); return file; };
const grey = (width, height, level) => Buffer.alloc(width * height * 4, level).map((v, i) => (i % 4 === 3 ? 255 : v));

// ---- the cover treatment (exit 16 names the field) ----
test("a cover treatment validates and derives the page size, the cover size and the frame count", () => {
  const result = validateCoverTreatment(coverTreatment({ aspect: "3:2", loopSec: 8, fps: 25 }));
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual([result.cover.page, result.cover.size, result.cover.frames], [[1200, 800], [960, 640], 200]);
  assert.deepEqual(result.cover.encode, { q: 86, edgeQ: 97, edgeFrames: 15, method: 4 });
});

test("a cover treatment refuses film fields, sound, an invented tagline, a long name and an out-of-range loop", () => {
  for (const [over, field] of [
    [{ beats: [] }, "beats"], [{ copy: { source: "user", lines: ["x"] } }, "copy"], [{ sound: { mode: "generated" } }, "sound"],
    [{ motto: { text: "work that never sleeps", source: "user" } }, "motto.text"], [{ brandWord: "one two three four" }, "brandWord"],
    [{ loopSec: 4 }, "loopSec"], [{ fps: 30 }, "fps"], [{ aspect: "16:9" }, "aspect"], [{ recipe: "slides" }, "recipe"],
    [{ title: { box: [0.8, 0.1, 0.4, 0.2], kind: "live" } }, "title.box"], [{ idea: "Make a looping README cover for the loop kit test." }, "idea"],
    [{ layers: { slow: "drift", mid: "<mid layer>", beat: "flash" } }, "layers.mid"]
  ]) {
    const result = validateCoverTreatment(coverTreatment(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.field, field, `${JSON.stringify(over)}: ${result.detail}`);
  }
  assert.equal(validateCoverTreatment(coverTreatment({ motto: { text: "kept by the project", source: "project", from: "README tagline" } })).ok, true);
});

test("a film render refuses a cover treatment, and a cover render refuses a film treatment (exit 16)", () => {
  const dir = tmp("ltm-cover-route-");
  try {
    fs.writeFileSync(path.join(dir, "treatment.json"), JSON.stringify(coverTreatment()));
    const film = cli(["stage", "--out", dir]);
    assert.equal(film.status, EXIT.BLOCKED_TREATMENT_INVALID, film.stderr);
    assert.match(film.stderr, /field mode: this is a cover treatment; render it with `render\.mjs cover --out <dir>`/u);
    fs.writeFileSync(path.join(dir, "treatment.json"), JSON.stringify(stageTreatment()));
    const cover = cli(["cover", "--out", dir]);
    assert.equal(cover.status, EXIT.BLOCKED_TREATMENT_INVALID, cover.stderr);
    assert.match(cover.stderr, /field mode: this treatment is a film/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the loop kit and the cover init script ----
function loadKit() {
  const sandbox = { window: undefined, globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(skillRoot, "engine", "stage", "loop-kit.js"), "utf8"), sandbox);
  return sandbox.LitLoop;
}

test("every loop-kit helper closes the loop: noise at t = 1 equals t = 0, events wrap the seam", () => {
  const kit = loadKit();
  const noise = kit.makeNoise(7);
  for (const offset of [0, 1.3, 9.1]) assert.ok(Math.abs(kit.loopNoise(noise, 1, offset) - kit.loopNoise(noise, 0, offset)) < 1e-9, String(offset));
  assert.equal(kit.cdist(0.98, 0.02), kit.cdist(0.02, 0.98));
  assert.ok(Math.abs(kit.cdist(0.98, 0.02) - 0.04) < 1e-12);
  assert.ok(kit.window(0.02, 0.95, 0.1) > 0 && kit.window(0.5, 0.95, 0.1) === -1);
  assert.ok(Math.abs(kit.swell(0) - kit.swell(1)) < 1e-12 && Math.abs(kit.phase(1, 0.3, 2) - kit.phase(0, 0.3, 2)) < 1e-12);
  assert.equal(kit.cubicPulse(0.5, 0.1, 0.5), 1);
  assert.equal(kit.cubicPulse(0.5, 0.1, 0.61), 0);
  const a = kit.rng(42), b = kit.rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const kitSource = fs.readFileSync(path.join(skillRoot, "engine", "stage", "loop-kit.js"), "utf8");
  assert.doesNotMatch(kitSource, /Math\.random\(|Date\.now\(|performance\.now\(|new Date\(|requestAnimationFrame\(/u);
});

test("the cover init script makes every clock and entropy source throw and records each call by name", () => {
  const style = { textContent: "" };
  class Performance {}
  Performance.prototype.now = () => 1;
  const sandbox = {
    Math: Object.create(Math), Date, Performance, performance: new Performance(), crypto: { getRandomValues: () => {} },
    document: { documentElement: { appendChild: () => {} }, head: { appendChild: () => {} }, createElement: () => style, addEventListener: () => {} }
  };
  sandbox.window = sandbox;
  sandbox.requestAnimationFrame = () => 1;
  sandbox.setInterval = () => 1;
  vm.runInNewContext(fs.readFileSync(path.join(skillRoot, "engine", "stage", "cover-init.js"), "utf8"), sandbox);
  for (const call of ["Math.random()", "Date.now()", "new Date()", "performance.now()", "requestAnimationFrame(() => {})", "setInterval(() => {}, 5)", "crypto.getRandomValues(new Uint8Array(2))"]) {
    assert.throws(() => vm.runInNewContext(call, sandbox), /is not available in a cover page/u, call);
  }
  assert.equal(vm.runInNewContext("new Date(0).getTime()", sandbox), 0, "a fixed date is still allowed");
  assert.deepEqual([...sandbox.__litCover.used()].sort(), ["Date", "Date.now", "Math.random", "crypto.getRandomValues", "performance.now", "requestAnimationFrame", "setInterval"].sort());
  assert.match(style.textContent, /animation: none !important; transition: none !important/u);
});

test("the cover browser raises the device scale to 2, keeps raster on the CPU and keeps the keychain flags", () => {
  const flags = coverChromeFlags(1200, 600, 2);
  for (const flag of ["--force-device-scale-factor=2", "--disable-gpu-rasterization", "--disable-partial-raster", "--use-angle=swiftshader", "--use-mock-keychain", "--password-store=basic", "--window-size=1200,600"]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.includes("--force-device-scale-factor=1"), false);
});

// ---- gate metrics on the time grid ----
const lumas = (values) => values.map((v) => Float32Array.from({ length: 64 }, () => v));
test("a still loop is all still, and its longest hold is the whole loop, never more", () => {
  const m = motionMetrics({ lumas: lumas(Array(32).fill(80)), durations: Array(32).fill(63) });
  assert.equal(m.medianD, 0);
  assert.equal(m.movingFrac, 0);
  assert.ok(Math.abs(m.longestStillSec - 32 * 0.063) < 1e-9);
  const merged = motionMetrics({ lumas: lumas([80, 80, 80, 80]), durations: [1197, 2835, 1386, 2646] });
  assert.ok(merged.longestStillSec <= 8.064 + 1e-9, String(merged.longestStillSec));
});

test("a steady drift moves on every step with a seam like its neighbours; a reset is a seam spike", () => {
  const ramp = (n, wrap) => Array.from({ length: n }, (_, i) => (wrap ? 40 + 2 * Math.abs(((i + n / 2) % n) - n / 2) : 40 + 1.5 * i));
  const drift = motionMetrics({ lumas: lumas(ramp(64, true)), durations: Array(64).fill(63) });
  assert.equal(drift.movingFrac, 1);
  assert.ok(drift.seamLocal <= COVER.target.seamLocal && drift.seamLocal >= COVER.target.seamLocalMin, String(drift.seamLocal));
  const reset = motionMetrics({ lumas: lumas(ramp(64, false)), durations: Array(64).fill(63) });
  assert.ok(reset.seamLocal > COVER.floor.seamLocal, String(reset.seamLocal));
});

test("merged frames are resampled on the grid, so a long frame reads as a hold", () => {
  const grid = onGrid(["a", "b", "c"], [50, 500, 50], 50);
  assert.deepEqual(grid, ["a", ...Array(10).fill("b"), "c"]);
  const m = motionMetrics({ lumas: lumas([10, 60, 110]), durations: [50, 500, 50] });
  assert.ok(m.longestStillSec >= 0.45, String(m.longestStillSec));
});

test("the GIF fallback's delays and loop count come from the container", () => {
  const gif = Buffer.concat([
    Buffer.from("GIF89a", "latin1"), Buffer.from([2, 0, 1, 0, 0, 0, 0]),
    Buffer.from([0x21, 0xff, 11]), Buffer.from("NETSCAPE2.0", "latin1"), Buffer.from([3, 1, 0, 0, 0]),
    ...[7, 9].flatMap((delay) => [Buffer.from([0x21, 0xf9, 4, 0, delay, 0, 0, 0]), Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0])]),
    Buffer.from([0x3b])
  ]);
  assert.deepEqual(readGifContainer(gif), { width: 2, height: 1, loop: 0, delays: [70, 90] });
});

test("the report names every gate, INFO for an exempt one, and the strict verdict line the done check reads", () => {
  const report = formatCoverReport({ pass: true, target: false, width: 1000, height: 500, format: "webp", sourceFrames: 128, sourceDurationSec: 8.064, bytes: 2_400_000, loop: 0, gridMs: 63,
    gates: { G1: { pass: true, target: false, bytes: 2_400_000 }, G6: { pass: null, capPx: 30, reason: "painted" } } }, { strict: true });
  assert.match(report, /^COVER gate --strict: PASS\(floor\)$/mu);
  assert.match(report, /^ {2}G1 pass\(floor\) bytes=2400000$/mu);
  assert.match(report, /^ {2}G6 INFO capPx=30 reason=painted$/mu);
});

// ---- decoding the encoded cover ----
test("img2webp gets frame 0 and the last edge frames at the edge quality, every frame 63 ms at 16 fps", () => {
  const args = img2webpArgs({ files: ["a.png", "b.png", "c.png", "d.png"], fps: 16, encode: { q: 83, edgeQ: 97, edgeFrames: 2, method: 4 }, out: "o.webp" });
  assert.deepEqual(args, ["-loop", "0", "-lossy", "-q", "83", "-m", "4", "-d", "63", "-q", "97", "a.png", "-d", "63", "-q", "83", "b.png", "-d", "63", "-q", "97", "c.png", "-d", "63", "-q", "97", "d.png", "-o", "o.webp"]);
  assert.deepEqual(loopTimes(4), [[0, 0], [1, 0.25], [2, 0.5], [3, 0.75]]);
  assert.equal(frameAt([63, 63, 63], 126), 2);
});

test("an encoded cover decodes frame by frame with its durations and loop count, composited like a browser", { skip: libwebp ? false : "img2webp and dwebp are not on PATH" }, () => {
  const dir = tmp("ltm-webp-");
  try {
    const files = [20, 120, 220].map((level, i) => {
      const pixels = grey(64, 32, 30);
      for (let y = 0; y < 32; y++) for (let x = 20 * i; x < 20 * i + 16; x++) pixels.fill(level, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
      const file = path.join(dir, `f${i}.png`);
      fs.writeFileSync(file, encodePng(64, 32, pixels, 4, 6));
      return file;
    });
    const out = path.join(dir, "c.webp");
    const run = spawnSync(which("img2webp"), img2webpArgs({ files, fps: 16, encode: { q: 90, edgeQ: 90, edgeFrames: 0, method: 4 }, out }), { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const seen = [];
    const info = decodeCover(out, { onFrame: (i, rgba, ms, w, h) => seen.push({ i, ms, w, h, mid: rgba[(16 * 64 + 20 * i + 8) * 4] }) });
    assert.deepEqual([info.format, info.width, info.height, info.loop, info.durations], ["webp", 64, 32, 0, [63, 63, 63]]);
    assert.equal(seen.length, 3);
    seen.forEach((frame, i) => assert.ok(Math.abs(frame.mid - [20, 120, 220][i]) <= 12, `frame ${i}: ${frame.mid}`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the 2x capture is reduced with Lanczos, and the gate's luma grid is about 300 px wide", () => {
  const src = grey(8, 8, 0);
  for (let i = 0; i < 64; i++) if ((i % 8) < 4) src.fill(200, i * 4, i * 4 + 3);
  const small = lanczosResize(src, 8, 8, 4, 4);
  assert.ok(small[0] > 180 && small[3 * 4] < 20, `${small[0]} / ${small[12]}`);
  assert.equal(small[3], 255);
  assert.equal(lumaGrid(grey(1000, 500, 9), 1000, 500).width, 333);
  assert.equal(lumaGrid(grey(960, 640, 9), 960, 640).width, 320);
});

// ---- G6 (C010), the frame-0 art check (C008), the seek tolerance ----
function maskDir(letterHeight, { width = 1000, height = 500, box = [300, 200, 400, 100], count = 3 } = {}) {
  const dir = tmp("ltm-masks-");
  for (let f = 0; f < count; f++) {
    const pixels = grey(width, height, 0);
    for (let k = 0; k < 5; k++) for (let y = box[1] + 10; y < box[1] + 10 + letterHeight; y++) for (let x = box[0] + 20 + 60 * k; x < box[0] + 50 + 60 * k; x++) pixels.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
    fs.writeFileSync(path.join(dir, `m${String(f).padStart(4, "0")}.png`), encodePng(width, height, pixels, 4, 1));
  }
  return dir;
}

test("G6: letters 13 px tall on a 1000 px cover are 10.8 px at README width and fail; 60 px letters pass", () => {
  const box = [0.3, 0.4, 0.4, 0.2];
  const small = maskDir(13), large = maskDir(60);
  try {
    const failing = capHeight({ masksDir: small, box });
    assert.equal(failing.pass, false);
    assert.equal(failing.capPx, 10.8);
    assert.equal(failing.glyphs, 5);
    const passing = capHeight({ masksDir: large, box });
    assert.equal(passing.pass, true);
    assert.ok(passing.capPx >= COVER.minCapPx);
    const exempt = capHeight({ masksDir: small, box, exempt: "painted into the base art cover/assets/base.png" });
    assert.equal(exempt.pass, null, "a declared painted title is measured and shown as INFO");
    assert.equal(exempt.capPx, 10.8);
  } finally {
    for (const dir of [small, large]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("G6 stands beside G5, never instead of it", () => {
  const dir = tmp("ltm-g6-");
  try {
    const frames = path.join(dir, "frames"), masks = maskDir(60, { count: 2 });
    fs.mkdirSync(frames);
    for (let f = 0; f < 2; f++) fs.copyFileSync(path.join(masks, `m${String(f).padStart(4, "0")}.png`), path.join(frames, `f${String(f).padStart(4, "0")}.png`));
    const result = coverGate(frames, { frames, masks, title: [0.3, 0.4, 0.4, 0.2], glyph: {} });
    assert.ok("G5" in result.gates && "G6" in result.gates);
    assert.equal(result.gates.G5.pass, true);
    assert.equal(result.gates.G6.pass, true);
    fs.rmSync(masks, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("C008: frame 0 must show the base art; a flat fill in its place fails the SSIM check", () => {
  const art = { width: 64, height: 64, rgba: grey(64, 64, 0) };
  for (let i = 0; i < 64 * 64; i++) art.rgba.fill(((i % 64) * 4 + Math.floor(i / 64) * 3) % 256, i * 4, i * 4 + 3);
  const box = [0.25, 0, 0.5, 1];
  const frame0 = grey(128, 64, 10);
  const scaled = lanczosResize(art.rgba, 64, 64, 64, 64);
  for (let y = 0; y < 64; y++) scaled.copy(frame0, (y * 128 + 32) * 4, y * 64 * 4, (y + 1) * 64 * 4);
  const shown = artCheck({ frame0, width: 128, height: 64, art, box });
  assert.equal(shown.pass, true);
  assert.ok(shown.ssim > 0.99, String(shown.ssim));
  const flat = artCheck({ frame0: grey(128, 64, 90), width: 128, height: 64, art, box });
  assert.equal(flat.pass, false);
  assert.ok(flat.ssim < COVER.artSsim);
  assert.ok(ssim(grey(16, 16, 50), grey(16, 16, 50), 16, 16) > 0.999);
});

test("the seek check tolerates one level per channel and nothing more; its order is seeded and distinct", () => {
  const dir = tmp("ltm-seek-");
  try {
    const base = grey(16, 16, 100);
    const write = (name, pixels) => { const file = path.join(dir, name); fs.writeFileSync(file, encodePng(16, 16, pixels, 4, 1)); return file; };
    const a = write("a.png", base);
    const one = Buffer.from(base); one[40] = 101;
    const two = Buffer.from(base); two[40] = 102;
    assert.equal(maxLevelDiff(a, write("one.png", one)), 1);
    assert.equal(maxLevelDiff(a, write("two.png", two)), 2);
    assert.ok(maxLevelDiff(a, write("one.png", one)) <= COVER.seekLevels && maxLevelDiff(a, write("two.png", two)) > COVER.seekLevels);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const order = seekOrder(128, 20261020);
  assert.equal(order.length, 16);
  assert.equal(new Set(order).size, 16);
  assert.deepEqual(order, seekOrder(128, 20261020));
  assert.notDeepEqual(order, seekOrder(128, 7));
});

// ---- the asset list (C007, C009) ----
function assetRun(prefix, { recipe = "painted-light", assets, files = {} } = {}) {
  const out = coverRun(prefix, path.join(fixtures, "good"), coverTreatment({ recipe }));
  for (const [rel, bytes] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.writeFileSync(path.join(out, rel), bytes); }
  if (assets) fs.writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets }));
  return out;
}
const png = encodePng(4, 4, grey(4, 4, 70), 4, 1);
const artEntry = (over = {}) => ({ path: "cover/assets/base.png", role: "base-art", source: "user", sha256: sha256(png), box: [0.125, 0, 0.75, 1], ...over });

test("C007: a listed asset that is missing is BLOCKED_ASSET_MISSING (exit 22), and no frame is written", () => {
  const out = assetRun("ltm-asset-missing-", { assets: [artEntry()] });
  try {
    const run = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(run.status, EXIT.BLOCKED_ASSET_MISSING, run.stderr);
    assert.match(run.stderr, /BLOCKED_ASSET_MISSING \(22\): cover\/assets\/base\.png is listed in assets\.json and is not there; supply it or generate it, never draw a stand-in/u);
    assert.equal(fs.existsSync(path.join(out, ".run", "cover", "frames")), false);
    assert.equal(fs.existsSync(path.join(out, "stills")), false);
  } finally {
    done(out);
  }
});

test("the painted recipe needs listed base art; an unlisted raster, a changed file or a bad entry stops the render", () => {
  const cases = [
    [{}, EXIT.BLOCKED_ASSET_MISSING, /lists no base-art/u],
    [{ recipe: "own", files: { "cover/assets/stray.png": png } }, EXIT.STAGE_CONTRACT_ERROR, /cover\/assets\/stray\.png is a raster the page can load and assets\.json does not list it/u],
    [{ assets: [artEntry({ sha256: "0".repeat(64) })], files: { "cover/assets/base.png": png } }, EXIT.STAGE_CONTRACT_ERROR, /no longer matches its sha256/u],
    [{ assets: [artEntry({ path: "cover/assets/base.jpg" })] }, EXIT.BLOCKED_TREATMENT_INVALID, /assets\.json assets\[0\]\.path: base art is a PNG/u],
    [{ assets: [artEntry({ checkBox: [0.13, 0.1, 0.01, 0.01] })], files: { "cover/assets/base.png": png } }, EXIT.BLOCKED_TREATMENT_INVALID, /checkBox: must cover at least 10 %/u]
  ];
  for (const [options, code, message] of cases) {
    const out = assetRun("ltm-asset-", options);
    try {
      const run = cli(["cover", "--out", out, "--round", "1"]);
      assert.equal(run.status, code, `${JSON.stringify(options)}: ${run.stderr}`);
      assert.match(run.stderr, message);
    } finally {
      done(out);
    }
  }
});

test("C009: a finished cover with generated art tells the reply to label it", () => {
  const out = fakeCoverRun(path.join(tmp("ltm-generated-"), "out"));
  try {
    fs.writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "generated" }, { path: "cover/assets/logo.png", role: "logo", source: "user" }] }));
    assert.deepEqual(generatedAssetLabels(out), ["generated: cover/assets/base.png (base art) was made for this cover, not supplied; label it as generated in the reply"]);
    const state = { ...doneState(out), done: true, code: 0, status: "DONE" };
    assert.match(formatDone(state), /^generated: cover\/assets\/base\.png \(base art\)/mu);
  } finally {
    done(out);
  }
});

// ---- cover look rounds and defects (C001) ----
test("a cover round takes the eight cover questions, needs no stills-only round 1, and records defects", () => {
  const out = fakeCoverRun(path.join(tmp("ltm-cover-look-"), "out"));
  try {
    const defect = { t: 1.2, region: [340, 10, 330, 50], frame: "stills/sheet.png", observed: "The glint turns the last letter of the painted title into a solid red block.", cause: "colour-dodge blend saturates coloured letters", fix: "run the glint in overlay blend" };
    const entry = recordLook(out, 1, writeAnswers(out, coverAnswers({ defects: [defect] })));
    assert.equal(entry.kind, "cover");
    assert.deepEqual(entry.defects, [defect]);
    assert.deepEqual(entry.needsAnotherRound, []);
    assert.equal(COVER_LOOK_QUESTIONS.length, 8);
  } finally {
    done(out);
  }
});

test("C001: look refuses a defect with no time, a time outside the loop, a region off the cover, a frame outside the stills, or a fourth defect", () => {
  const good = { t: 1.2, region: [340, 10, 330, 50], frame: "stills/sheet.png", observed: "The glint turns the last letter of the painted title into a solid red block.", cause: "colour-dodge blend saturates coloured letters", fix: "run the glint in overlay blend" };
  for (const [bad, message] of [
    [[{ ...good, t: undefined }], /defect 1: t must be the loop time in seconds/u],
    [[{ ...good, t: 9.5 }], /defect 1: t must be the loop time in seconds \(0 to 6\.048\)/u],
    [[{ ...good, region: [900, 10, 330, 50] }], /defect 1: region must be \[x, y, w, h\] inside the 1000x500 cover/u],
    [[{ ...good, frame: "stills/frame-09.png" }], /defect 1: frame stills\/frame-09\.png is not in the latest stills set/u],
    [[{ ...good, cause: "dodge" }], /defect 1: cause must say something concrete/u],
    [[good, good, good, good], /at most 3 defects per round/u]
  ]) {
    const out = fakeCoverRun(path.join(tmp("ltm-defect-"), "out"));
    try {
      assert.throws(() => recordLook(out, 1, writeAnswers(out, coverAnswers({ defects: bad }))), message);
      assert.equal(fs.existsSync(path.join(out, "look.json")), false, "a refused round writes nothing");
    } finally {
      done(out);
    }
  }
});

test("damage, a slide read or a named designer change asks for another cover round", () => {
  const answers = (q, verdict) => coverAnswers().answers.map((a) => (a.q === q ? { ...a, verdict } : a));
  assert.deepEqual(needsAnotherRound(answers(7, "yes"), "cover"), [7]);
  assert.deepEqual(needsAnotherRound(answers(6, "yes"), "cover"), [6]);
  assert.deepEqual(needsAnotherRound(answers(8, "yes"), "cover"), [8]);
  assert.deepEqual(needsAnotherRound(answers(2, "no"), "cover"), [2]);
  assert.deepEqual(needsAnotherRound(coverAnswers().answers, "cover"), []);
});

// ---- the cover done check ----
function twoRounds(out, { second = coverAnswers() } = {}) {
  recordLook(out, 1, writeAnswers(out, coverAnswers()));
  fakeCoverRun(out, { round: 2 });
  return recordLook(out, 2, writeAnswers(out, second));
}

test("done needs TARGET on the last render and two rounds, the last one viewing the sheet, the poster and the seam pair", () => {
  const out = fakeCoverRun(path.join(tmp("ltm-cover-done-"), "out"));
  try {
    assert.match(formatDone(doneState(out)), /^NOT DONE: 0 look round\(s\) recorded; a cover needs two/u);
    twoRounds(out);
    const state = doneState(out);
    assert.equal(state.status, "DONE", state.reasons.join("; "));
    const cliDone = spawnSync(process.execPath, [gateCli, "--done", out], { encoding: "utf8" });
    assert.equal(cliDone.status, 0, cliDone.stdout);
    fs.writeFileSync(path.join(out, "gate-report.txt"), "COVER gate --strict: PASS(floor)\n  G1 pass(floor) bytes=2400000\n");
    const missed = doneState(out);
    assert.equal(missed.status, "NOT DONE");
    assert.match(missed.reasons.join(" "), /did not reach every TARGET gate \(G1\)/u);
  } finally {
    done(out);
  }
});

test("a last round that skipped the seam pair, or a cover page changed after the render, is not done", () => {
  const out = fakeCoverRun(path.join(tmp("ltm-cover-seam-"), "out"));
  try {
    twoRounds(out, { second: coverAnswers({ viewed: ["stills/sheet.png", "stills/poster.png"], answers: coverAnswers().answers.map((a) => ({ ...a, frame: "stills/sheet.png" })) }) });
    assert.match(doneState(out).reasons.join(" "), /the last round did not view: stills\/seam\.png/u);
    fs.mkdirSync(path.join(out, "cover"));
    fs.writeFileSync(path.join(out, "cover", "index.html"), "<!doctype html>");
    assert.match(doneState(out).reasons.join(" "), /the cover page or an asset changed after the last cover render; render again/u);
  } finally {
    done(out);
  }
});

// ---- organic enrollment ----
test("cover mode is enrolled in the skill body, the references, the route context, the manifest, the doctor and the pack", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  for (const phrase of [/references\/cover\.md/u, /render\.mjs cover --out <d> --round N/u, /Exit 21 \(no cover encoder\) and 22/u, /A README cover loop takes cover mode/u]) assert.match(skill, phrase);
  for (const ref of ["treatment.md", "stage.md", "craft-loop.md", "runtime.md"]) assert.match(fs.readFileSync(path.join(skillRoot, "references", ref), "utf8"), /cover\.md/u, ref);
  const cover = fs.readFileSync(path.join(skillRoot, "references", "cover.md"), "utf8");
  for (const heading of ["## The page contract", "## The cover treatment", "## Assets (`assets.json`)", "## Craft rules, ranked", "## Recipes", "## The gate, on the decoded file", "## Look rounds", "## Defects and window renders", "## Rounds and done", "## Recipe rows and negatives", "## Unconfirmed"]) assert.ok(cover.includes(heading), heading);
  assert.ok(cover.split(/\s+/u).length >= 3500, `cover.md holds ${cover.split(/\s+/u).length} words`);
  const prompt = promptForChatActivationMode("lit-task", "make a short launch video for our new library lit");
  assert.match(prompt, /A README cover or banner loop takes cover mode \(references\/cover\.md\)/u);
  assert.match(prompt, /\(film, stills, stage, cover, sound, look, gate\)/u);
  const pinned = new Set(managedSkillDefinition("lit-typographic-motion").canonicalFiles.map((asset) => asset.path));
  for (const rel of ["references/cover.md", "engine/cover/render.mjs", "engine/cover/gate.mjs", "engine/cover/decode.mjs", "engine/stage/loop-kit.js", "engine/stage/cover-init.js", "fonts/JetBrainsMono-wght-latin.woff2", "recipes/painted-light/index.html", "recipes/painted-light/expected.json", "recipes/negatives/reset-sweep/expected.json"]) assert.ok(pinned.has(rel), rel);
  const line = formatProbe({ chrome: { ok: false, detail: "x" }, ffmpeg: { ok: false, detail: "y", previewEncoder: "none" }, webgl2: { ok: false, detail: "z" }, softwareWarning: "w", coverEncoder: coverEncoder({ PATH: "" }), prewarm: { ready: false, deps: [], missingFonts: [], mismatchedFonts: [], fix: "f", audio: { reason: "a" }, wordTiming: { reason: "b" } } });
  assert.match(line, /^motion cover encoder: none; cover renders stop with exit 21; fix: install libwebp/mu);
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(pack.status, 0, pack.stderr);
  const files = new Set(JSON.parse(pack.stdout)[0].files.map((entry) => entry.path));
  for (const rel of ["references/cover.md", "engine/cover/render.mjs", "engine/cover/frame-worker.mjs", "engine/stage/loop-kit.js", "recipes/orbit-loop/index.html", "fonts/JetBrainsMono-OFL.txt"]) assert.ok(files.has(`skills/lit-typographic-motion/${rel}`), rel);
  assert.equal([...files].some((file) => /fixtures\/cover\/|test-support\/motion-cover/u.test(file)), false, "cover fixtures stay out of the pack");
});

test("C014: every recipe ships an expected row inside TARGET and at most 2 MiB, and the recipe QA is wired", () => {
  for (const name of ["painted-light", "weight-tide", "orbit-loop"]) {
    const expected = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", name, "expected.json"), "utf8"));
    const { row } = expected;
    assert.ok(row.medianD >= COVER.target.medianD && row.movingFrac >= COVER.target.movingFrac, name);
    assert.ok(row.longestStillSec <= COVER.target.stillSec && row.spike <= COVER.target.spike, name);
    assert.ok(row.seamLocal >= COVER.target.seamLocalMin && row.seamLocal <= COVER.target.seamLocal, name);
    assert.ok(row.bytes <= COVER.targetBytes, name);
    assert.equal(validateCoverTreatment(expected.treatment).ok, true, name);
    assert.equal(expected.treatment.recipe, name);
    assert.ok(fs.existsSync(path.join(skillRoot, "recipes", name, "index.html")));
  }
  assert.ok(JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).assets.some((asset) => asset.role === "base-art"));
  for (const [name, mustFail] of [["title-slam", ["G2.floor", "G3.floor"]], ["card-scenes", ["G2.floor"]], ["still-glow", ["G2.floor", "G3.floor"]], ["reset-sweep", ["G4.floor"]]]) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8")).mustFail, mustFail, name);
  }
  assert.match(JSON.parse(fs.readFileSync("package.json", "utf8")).scripts["qa:cover-recipes"], /tools\/qa-cover-recipes\.mjs --negatives/u);
  const feather = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).regressions["feather-150"];
  assert.ok(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "index.html"), "utf8").includes(feather.patch.find), "the feather-150 patch still finds the light edge");
});

test("the painted-light recipe keeps its own five-panel base, so the family art can change without moving its measured bays", async () => {
  // PAINTING in the recipe is measured on this exact painting; the README family art is a different file.
  const base = "test/fixtures/cover/painted-light-five-panel.png";
  const bytes = fs.readFileSync(base);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "955ccd875bd0da509ba850b76a83ac7aa76f2ecc5c019bcb2d04043e8d46179e");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1536, 1024], "PNG width and height");
  const { PAINTING } = await import("../tools/qa-cover-recipes.mjs");
  assert.equal(PAINTING, path.resolve(base));
  assert.match(JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).base, /painted-light-five-panel\.png/u);
});

// ---- the cover recipe QA proves a negative only by the gates it declares ----
const qaCover = (args) => {
  const home = tmp("ltm-cover-qa-home-");
  try {
    return spawnSync(process.execPath, [path.resolve("tools", "qa-cover-recipes.mjs"), "--out", path.join(home, "renders"), ...args], {
      encoding: "utf8", timeout: 120_000, env: { ...process.env, XDG_CACHE_HOME: path.join(home, "no-runtime") }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
};

test("a crashed render never counts as a caught negative or regression", () => {
  const feather = qaCover(["--feather", "150"]);
  assert.equal(feather.status, 1, feather.stdout + feather.stderr);
  assert.match(feather.stdout, /^FAIL +regression painted-light feather-150 +not proven: the render did not complete and gate the decoded file \(exit 14\)/mu);
  const negatives = qaCover(["--negatives", "--only", "weight-tide"]);
  assert.equal(negatives.status, 1, negatives.stdout + negatives.stderr);
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) assert.match(negatives.stdout, new RegExp(`^FAIL +negative ${name} +not proven: the render did not complete`, "mu"));
  assert.match(negatives.stdout, /^FAIL +regression painted-light feather-150 +not proven/mu);
  assert.doesNotMatch(negatives.stdout, /PASS \(fails as declared\)/u);
});

test("a regression nobody declared is a QA failure, not a caught defect", () => {
  const run = qaCover(["--feather", "200"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /^FAIL +regression painted-light feather-200 +not proven: painted-light\/expected\.json declares no regression feather-200/mu);
});

test("the verdict needs a gated render and every declared gate failing; an undeclared FLOOR failure is not enough", async () => {
  const { judgeCase } = await import("../tools/qa-cover-recipes.mjs");
  const gates = (over) => ({ G1: { pass: true, target: true }, G2: { pass: true, target: true }, G3: { pass: true, target: true }, G4: { pass: true, target: true }, ...over });
  const ran = (status, g) => ({ status, manifest: g ? { gate: { gates: g } } : null });
  const miss = { pass: true, target: false };
  const broke = { pass: false, target: false };
  assert.equal(judgeCase(["G1.target"], ran(EXIT.BLOCKED_DEPS_NOT_PREWARMED, null)).ok, false);
  assert.match(judgeCase(["G1.target"], ran(EXIT.BLOCKED_DEPS_NOT_PREWARMED, null)).why, /did not complete/u);
  assert.equal(judgeCase(["G1.target"], ran(1, gates({ G1: miss }))).ok, false, "a crash exit with a stale manifest");
  assert.match(judgeCase(["G1.target"], ran(EXIT.GATE_FAIL_QA, gates({ G4: miss }))).why, /G1\.target did not fail/u);
  assert.equal(judgeCase(["G1.target"], ran(EXIT.GATE_FAIL_QA, gates({ G1: miss, G4: miss }))).ok, true);
  assert.match(judgeCase(["G1.target"], ran(EXIT.GATE_FAIL_QA, gates({ G1: miss, G3: broke }))).why, /G3\.floor, which it does not declare/u);
  assert.equal(judgeCase(["G2.floor", "G3.floor"], ran(EXIT.GATE_FAIL_QA, gates({ G2: broke }))).ok, false);
  assert.equal(judgeCase(["G2.floor", "G3.floor"], ran(EXIT.GATE_FAIL_QA, gates({ G2: broke, G3: broke }))).ok, true);
  assert.match(judgeCase(["G5.floor"], ran(EXIT.GATE_FAIL_QA, gates({}))).why, /G5 was not measured/u);
  assert.match(judgeCase([], ran(EXIT.GATE_FAIL_QA, gates({}))).why, /declares no gate/u);
  assert.match(judgeCase(undefined, ran(EXIT.GATE_FAIL_QA, gates({}))).why, /declares no gate/u);
});

test("every negative and regression declares the gates it must fail", () => {
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
    assert.ok(doc.mustFail.length && doc.mustFail.every((id) => /^G[0-6]\.(floor|target)$/u.test(id)), name);
  }
  const regression = JSON.parse(fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).regressions["feather-150"];
  assert.deepEqual(regression.mustFail, ["G1.target"]);
  assert.match(regression.defect, /look review/u);
});

test("the sheet puts twelve tiles over a plot of the loop's steps, with a shaded span when asked", () => {
  const tiles = Array.from({ length: 12 }, (_, k) => ({ rgba: grey(100, 50, 20 * k), width: 100, height: 50, at: k / 12 }));
  const sheet = composeSheet({ tiles, steps: Array.from({ length: 96 }, (_, i) => 0.002 + 0.001 * Math.sin(i)), medianD: 0.002, marks: [{ from: 0.2, to: 0.3 }] });
  assert.equal(sheet.width, 4 * 400 + 5 * 8);
  assert.ok(sheet.height > 3 * 200 + 170);
});

// ---- real renders (Chrome, img2webp and the decoded-file gate) ----
test("C012: a loop with three speed layers reaches every TARGET gate on the decoded file, and passes the seek check", { skip: needsRender }, () => {
  const out = coverRun("ltm-cover-good-", path.join(fixtures, "good"));
  try {
    const run = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = fs.readFileSync(path.join(out, "gate-report.txt"), "utf8");
    assert.match(report, /^COVER gate --strict: PASS\+TARGET$/mu);
    assert.match(report, /^ {2}SEEK pass sampled=16 identical=1[56] oneLevel=[01]$/mu);
    assert.match(report, /^ {2}G6 pass capPx=/mu);
    assert.match(report, /^ {2}G0 pass compared=96 identical=96/mu);
    for (const file of ["cover.webp", "poster.png", "manifest.json", "stills/sheet.png", "stills/seam.png", "stills/poster.png", "stills/frame-11.png", "stills/stills.json"]) assert.ok(fs.existsSync(path.join(out, file)), file);
    const regate = spawnSync(process.execPath, [gateCli, "--cover", path.join(out, "cover.webp"), "--strict"], { encoding: "utf8" });
    assert.equal(regate.status, 0, regate.stdout);
    assert.match(regate.stdout, /^COVER gate --strict: PASS\+TARGET$/mu);
  } finally {
    done(out);
  }
});

test("C002: a window render sheets only the frames inside [t0 - 0.5, t1 + 0.5] and never touches the delivered files", { skip: needsRender }, () => {
  const out = coverRun("ltm-cover-window-", path.join(fixtures, "good"));
  try {
    const run = cli(["cover", "--out", out, "--round", "1", "--window", "2.0,2.5"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const dir = path.join(out, "windows", "round-1", "2.000-2.500");
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "window.json"), "utf8"));
    assert.ok(doc.frames.length >= 8);
    for (const frame of doc.frames) assert.ok(frame.t >= 1.5 - 1e-9 && frame.t <= 3.0 + 1e-9, String(frame.t));
    assert.ok(fs.existsSync(path.join(dir, "sheet.png")));
    for (const file of ["stills", "gate-report.txt", "manifest.json", "cover.webp"]) assert.equal(fs.existsSync(path.join(out, file)), false, file);
    assert.match(run.stdout, /a window render never counts as done/u);
  } finally {
    done(out);
  }
});

test("C013: a page that keeps state between frames fails the seek-order check, naming the frame and its time (exit 18)", { skip: needsRender }, () => {
  const out = coverRun("ltm-cover-trails-", path.join(fixtures, "trails"));
  try {
    const run = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(run.status, EXIT.STAGE_NONDETERMINISTIC, run.stdout + run.stderr);
    assert.match(run.stderr, /STAGE_NONDETERMINISTIC \(18\): frame \d+ \(t = \d+\.\d{3} s\) differs by up to \d+ levels when sought out of order/u);
  } finally {
    done(out);
  }
});

test("a page that reads Math.random is exit 18 naming the call; a page without renderFrame is exit 17", { skip: needsRender }, () => {
  for (const [fixture, code, message] of [["random", EXIT.STAGE_NONDETERMINISTIC, /the cover page called Math\.random/u], ["no-render", EXIT.STAGE_CONTRACT_ERROR, /defines no window\.renderFrame/u]]) {
    const out = coverRun(`ltm-cover-${fixture}-`, path.join(fixtures, fixture));
    try {
      const run = cli(["cover", "--out", out, "--round", "1"]);
      assert.equal(run.status, code, run.stdout + run.stderr);
      assert.match(run.stderr, message);
    } finally {
      done(out);
    }
  }
});

test("C016: the shipped slide-like negatives fail exactly their named FLOOR gates on the decoded file", { skip: needsRender }, () => {
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
    const dir = path.join(skillRoot, "recipes", "negatives", name);
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
    const out = coverRun(`ltm-negative-${name}-`, dir, coverTreatment({ brandWord: "LITCARD", title: { box: [0.1, 0.25, 0.8, 0.5], kind: "live" }, ...expected.treatment }));
    try {
      const run = cli(["cover", "--out", out, "--round", "1"]);
      assert.equal(run.status, EXIT.GATE_FAIL_QA, run.stdout + run.stderr);
      const gates = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).gate.gates;
      const floor = Object.entries(gates).filter(([key, g]) => ["G1", "G2", "G3", "G4"].includes(key) && g.pass === false).map(([key]) => key).sort();
      assert.deepEqual(floor, expected.mustFail.map((id) => id.replace(/\.floor$/u, "")), `${name}: ${JSON.stringify(gates)}`);
    } finally {
      done(out);
    }
  }
});

// ---- the painted recipe lets any panel be the hero ----
// A seven-panel painting as an opaque flat grey plate: every lit pixel reads 128, every dimmed one less.
const SEVEN = [[13, 217], [231, 435], [449, 653], [667, 872], [886, 1090], [1104, 1308], [1322, 1526]];
const HERO_GLOWS = {
  0: [{ x: 68, y: 385, rx: 20, ry: 7, beat: "eye" }, { x: 140, y: 385, rx: 16, ry: 7, beat: "eye" }, { x: 110, y: 689, rx: 32, ry: 32, beat: "core" }],
  3: [{ x: 725, y: 350, rx: 16, ry: 16, beat: "eye" }, { x: 800, y: 350, rx: 16, ry: 16, beat: "eye" }, { x: 770, y: 680, rx: 24, ry: 24, beat: "core" }]
};
const PAINT_SCALE = 600 / 1024;

function heroStage(hero, glows) {
  const dir = tmp("ltm-hero-");
  const html = fs.readFileSync(path.join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
  const painting = { src: "assets/base.png", width: 1536, height: 1024, panels: SEVEN, panelTop: 148, panelBottom: 945, hero, title: { box: [455, 32, 635, 88], lift: 1, maskAbove: 60 }, glows, accent: { x: 902, y: 987, rx: 60, ry: 22 } };
  const page = html.replace(/^const PAINTING = \{[\s\S]*?^\};$/mu, () => `const PAINTING = ${JSON.stringify(painting)};`);
  assert.notEqual(page, html, "the recipe keeps one `const PAINTING = { ... };` block");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page);
  fs.writeFileSync(path.join(dir, "assets", "base.png"), encodePng(1536, 1024, grey(1536, 1024, 128), 4, 1));
  return dir;
}

async function openHero(coverDir) {
  const state = inspectWarmState({ ...process.env, XDG_CACHE_HOME: warmed });
  assert.ok(!state.blocked, "the test cache is pre-warmed");
  const chromium = await loadPlaywright(state.nodeDir);
  return openCover(chromium, { chromePath: findChrome().path, profile: path.join(tmp("ltm-hero-chrome-"), "p"), coverDir, page: [1200, 600], scale: COVER.captureScale, fonts: coverFonts(motionRoot, state, pins) });
}

const lumaAt = ({ pixels }, o) => 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];

/** Mean luminance of one panel (inset 40 painting px) in a device-scale capture of the 1200x600 page. */
function panelLuma(png, [x0, x1]) {
  const img = decodePng(png), s = img.width / 1200;
  const X0 = Math.round((150 + (x0 + 40) * PAINT_SCALE) * s), X1 = Math.round((150 + (x1 - 40) * PAINT_SCALE) * s);
  const Y0 = Math.round((148 + 40) * PAINT_SCALE * s), Y1 = Math.round((945 - 40) * PAINT_SCALE * s);
  let sum = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) sum += lumaAt(img, (y * img.width + x) * img.channels);
  return sum / ((X1 - X0) * (Y1 - Y0));
}

/** Painting-space box of every pixel that differs by more than 2 levels, and the largest step inside each given box. */
function lightDiff(pngA, pngB, boxes) {
  const a = decodePng(pngA), b = decodePng(pngB), s = a.width / 1200;
  const toPaint = (px, py) => [(px / s - 150) / PAINT_SCALE, py / s / PAINT_SCALE];
  let x0 = Infinity, x1 = -Infinity;
  const peaks = boxes.map(() => 0);
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const o = (y * a.width + x) * a.channels, d = Math.abs(lumaAt(a, o) - lumaAt(b, o));
    if (d <= 2) continue;
    const [px, py] = toPaint(x, y);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    boxes.forEach(([bx0, by0, bx1, by1], i) => { if (px >= bx0 && px <= bx1 && py >= by0 && py <= by1) peaks[i] = Math.max(peaks[i], d); });
  }
  return { x0, x1, peaks };
}

test("a middle hero (panel 3 of 7) stays as bright as the source at frame 0 while a sleeping panel is dimmed", { skip: needsRender }, async () => {
  const browser = await openHero(heroStage(3, HERO_GLOWS));
  try {
    await browser.frame(0);
    const png = await browser.capture();
    const hero = panelLuma(png, SEVEN[3]), sleeper = panelLuma(png, SEVEN[5]);
    assert.ok(hero >= 0.95 * 128, `hero panel luminance ${hero.toFixed(1)} against source 128`);
    assert.ok(sleeper < 0.6 * 128, `sleeping panel luminance ${sleeper.toFixed(1)} should sit under the dim pool`);
  } finally {
    await browser.close();
  }
});

test("the beat lights glow on the hero's own anchors and nowhere else", { skip: needsRender }, async () => {
  for (const hero of [0, 3]) {
    const withLights = await openHero(heroStage(hero, HERO_GLOWS));
    const without = await openHero(heroStage(hero, { ...HERO_GLOWS, [hero]: [] }));
    try {
      await withLights.frame(0.25); await without.frame(0.25);
      const anchors = HERO_GLOWS[hero];
      const { x0, x1, peaks } = lightDiff(await withLights.capture(), await without.capture(), anchors.map((g) => [g.x - g.rx, g.y - g.ry, g.x + g.rx, g.y + g.ry]));
      peaks.forEach((peak, i) => assert.ok(peak > 10, `hero ${hero}: anchor ${i} lit by only ${peak.toFixed(1)} levels`));
      assert.ok(x0 >= SEVEN[hero][0] - 2 && x1 <= SEVEN[hero][1] + 2, `hero ${hero}: the beat lights reach x ${x0.toFixed(0)} to ${x1.toFixed(0)}, outside its panel ${SEVEN[hero]}`);
    } finally {
      await withLights.close(); await without.close();
    }
  }
});

test("a hero declared with an empty light list runs without beat lights", { skip: needsRender }, async () => {
  const browser = await openHero(heroStage(5, { ...HERO_GLOWS, 5: [] }));
  try {
    await browser.frame(0.25);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
  }
});

test("a hero with no light entry stops the page with a message naming the panel, instead of borrowing another machine's lights", { skip: needsRender }, async () => {
  const started = Date.now();
  await assert.rejects(openHero(heroStage(5, HERO_GLOWS)), /raised an error before it set window\.ready: (?:Error: )?PAINTING\.glows has no entry for the hero panel 5/u);
  assert.ok(Date.now() - started < 30_000, "the render must abort when the page reports the error, not after the 60 s ready wait");
});
