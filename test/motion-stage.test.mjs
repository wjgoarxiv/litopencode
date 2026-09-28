import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageChromeFlags } from "../skills/lit-typographic-motion/engine/stage/capture.mjs";
import { determinismSamples, firstDifferingRegion } from "../skills/lit-typographic-motion/engine/stage/render.mjs";
import { insideDir, rasterInfo, scanStage } from "../skills/lit-typographic-motion/engine/stage/scan.mjs";
import { titleSafeBox } from "../skills/lit-typographic-motion/engine/stage/qa.mjs";
import { flashGeometryFor } from "../skills/lit-typographic-motion/engine/flash.mjs";
import { decodePng, encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { fixtureStageTreatment, stageRun } from "../test-support/motion-treatment.mjs";

// The stage path: capture, clock, serving, network and determinism.
// Paths that launch Chrome need a pre-warmed test cache, never the user's real one.
const skillRoot = path.resolve("skills", "lit-typographic-motion");
const render = path.join(skillRoot, "render.mjs");
const fixtures = path.resolve("test", "fixtures", "stage");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const needsWarm = warmed ? false : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache, so this path cannot launch the stage";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const page = (name) => fs.readFileSync(path.join(fixtures, name), "utf8");

function stage(dir, args = [], env = {}) {
  return spawnSync(process.execPath, [render, "stage", "--out", dir, ...args], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed, ...env }, timeout: 600_000 });
}

function withRun(prefix, html, options, body) {
  const dir = tmp(prefix);
  try { return body(stageRun(path.join(dir, "out"), html, options), dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function pixel(file, x, y) {
  const image = decodePng(fs.readFileSync(file));
  const i = (y * image.width + x) * image.channels;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}

// ---- pure units ----
test("the stage launch uses the software rung, every stage flag and the keychain flags, and no deterministic-mode flag", () => {
  const flags = stageChromeFlags(1080, 1920);
  for (const flag of ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-new-content-rendering-timeout",
    "--disable-threaded-animation", "--disable-threaded-scrolling", "--disable-image-animation-resync", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars",
    "--mute-audio", "--force-device-scale-factor=1", "--window-size=1080,1920", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings",
    "--metrics-recording-only", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage", "--use-mock-keychain", "--password-store=basic"]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.some((flag) => /deterministic-mode|use-angle=metal|enable-gpu-rasterization/u.test(flag)), false);
});

test("the kit ships motion primitives only, under its 60 KB cap, with no dependency", () => {
  const kit = fs.readFileSync(path.join(skillRoot, "engine", "stage", "stage-kit.js"), "utf8");
  assert.ok(Buffer.byteLength(kit) <= 60 * 1024, `${Buffer.byteLength(kit)} bytes`);
  assert.doesNotMatch(kit, /\bimport\s|require\(|https?:\/\/(?!www\.w3\.org\/2000\/svg)/u);
  for (const name of ["bezier", "spring", "kf", "stagger", "seq", "rand", "splitText", "drawPath", "morph", "clip", "mask", "mix", "text", "define"]) assert.match(kit, new RegExp(`\\b${name}\\b`, "u"), name);
  assert.match(kit, /multi-subpath morphs are unsupported/u);
});

test("determinism samples: 8 to 16 frames with frame 0, the last frame and each beat's first frame", () => {
  const beats = Array.from({ length: 5 }, (_, i) => ({ t0: i * 3, t1: i * 3 + 3 }));
  const picks = determinismSamples(beats, 60, 900);
  assert.ok(picks.length >= 8 && picks.length <= 16, String(picks.length));
  for (const frame of [0, 899, 180, 360, 540, 720]) assert.ok(picks.includes(frame), String(frame));
  const many = determinismSamples(Array.from({ length: 30 }, (_, i) => ({ t0: i * 2, t1: i * 2 + 2 })), 60, 3600);
  assert.equal(many.length, 16);
  assert.ok(many.includes(0) && many.includes(3599));
});

test("9:16 geometry: the title-safe box and the flash grid and window are portrait", () => {
  assert.deepEqual(titleSafeBox(1080, 1920), [54, 96, 1026, 1824]);
  assert.deepEqual(titleSafeBox(1920, 1080), [96, 54, 1824, 1026]);
  const portrait = flashGeometryFor(1080, 1920), landscape = flashGeometryFor(1920, 1080);
  assert.deepEqual([portrait.gridW, portrait.gridH, portrait.windowCellsW, portrait.windowCellsH], [180, 320, 60, 107]);
  assert.deepEqual([landscape.gridW, landscape.gridH, landscape.windowCellsW, landscape.windowCellsH], [320, 180, 107, 60]);
});

test("the first differing region names a 64x64 tile", () => {
  const a = Buffer.alloc(256 * 128 * 4), b = Buffer.from(a);
  b[(70 * 256 + 130) * 4] = 9;
  assert.deepEqual(firstDifferingRegion(a, b, 256, 128), { x: 128, y: 64, width: 64, height: 64 });
  assert.equal(firstDifferingRegion(a, Buffer.from(a), 256, 128), null);
});

test("the static scan refuses external URLs, hints, forbidden elements and APIs, flipbooks, animated rasters and escaping symlinks", () => {
  const cases = [
    ["<img src=\"https://example.com/a.png\">", 19, /external URL/u],
    ["<script src=\"//cdn.example.net/x.js\"></script>", 19, /protocol-relative/u],
    ["<link rel=\"preconnect\" href=\"/\">", 19, /preconnect/u],
    ["<script>new WebSocket(location.href)</script>", 19, /WebSocket/u],
    ["<video src=\"a.mp4\"></video>", 17, /<video>/u],
    ["<iframe src=\"/x\"></iframe>", 17, /<iframe>/u],
    ["<script>const c = new AudioContext();</script>", 17, /AudioContext/u],
    ["<script>new Worker('w.js')</script>", 17, /Worker/u]
  ];
  for (const [html, code, message] of cases) {
    const dir = tmp("ltm-scan-");
    try {
      fs.writeFileSync(path.join(dir, "index.html"), html);
      assert.throws(() => scanStage(dir), (error) => error.exitCode === code && message.test(error.message), html);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const ok = tmp("ltm-scan-ok-");
  try {
    fs.writeFileSync(path.join(ok, "index.html"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg><script>// see https://example.com in a comment\nconst ns = 'http://www.w3.org/2000/svg';</script>");
    assert.equal(scanStage(ok).files.length, 1, "namespace URIs and comments are not requests");
    const tile = encodePng(8, 8, Buffer.alloc(8 * 8 * 4, 200), 4, 1);
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(ok, `f${i}.png`), tile);
    assert.throws(() => scanStage(ok), (error) => error.exitCode === 17 && /flipbook/u.test(error.message));
    for (let i = 0; i < 10; i++) fs.rmSync(path.join(ok, `f${i}.png`));
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([1, 0, 1, 0, 0, 0, 0]), ...[0, 1].map(() => Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0])), Buffer.from([0x3b])]);
    assert.equal(rasterInfo(gif, ".gif").animated, true);
    fs.writeFileSync(path.join(ok, "spin.gif"), gif);
    assert.throws(() => scanStage(ok), (error) => error.exitCode === 17 && /animated raster/u.test(error.message));
    fs.rmSync(path.join(ok, "spin.gif"));
    const outside = tmp("ltm-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ok, "leak.css"));
    assert.throws(() => scanStage(ok), (error) => error.exitCode === 17 && /leaves the stage directory/u.test(error.message));
    fs.rmSync(outside, { recursive: true, force: true });
  } finally { fs.rmSync(ok, { recursive: true, force: true }); }
  assert.equal(insideDir("/a/stage", "/a/stage/x/y.png"), true);
  assert.equal(insideDir("/a/stage", "/a/other.png"), false);
});

// ---- renders (Chrome + pre-warmed cache) ----
test("GREEN: a clock-only page (Date, performance.now, timers, rAF, CSS animation) renders deterministically", { skip: needsWarm }, () => {
  withRun("ltm-green-clock-", page("clock-only.html"), {}, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const det = JSON.parse(fs.readFileSync(path.join(out, ".run", "determinism.json"), "utf8"));
    assert.ok(det.frames.length >= 8 && det.frames.every((entry) => entry.master === entry.replay));
    assert.match(result.stdout, /MO-C-09 PASS/u);
    for (const row of ["SOUND-stream", "SOUND-duration", "SOUND-peak", "SOUND-start"]) assert.match(result.stdout, new RegExp(`${row} PASS`, "u"), "the generated bed is muxed and checked on the stage path too");
  });
});

test("GREEN: blur, backdrop-filter, blend modes, shadows, feGaussianBlur, canvas shadowBlur and a WebGL shader are deterministic", { skip: needsWarm }, () => {
  withRun("ltm-green-effects-", page("effects.html"), {}, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /MO-C-02 PASS  \(WebGL on the stage's software rung/u);
    assert.match(result.stdout, /MO-C-09 PASS/u);
  });
});

test("GREEN: a pure-function page whose layers leave opacity 0 on a cut under a sine sway matches its replay", { skip: needsWarm }, () => {
  const beats = [0, 3, 6, 9].map((t0, i) => ({ t0, t1: t0 + 3, purpose: ["open", "turn", "gather", "close"][i], onScreen: "the stalks gather", motion: "stalks sway and gather", sound: "pad" }));
  const lines = ["지붕의 비가", "사흘을 버틴다", "처마 아래", "물길 보기", "안내는 현장에서 합니다", "빗물을", "한 곳에", "처마 아래에서", "다시 봐요"];
  const treatment = fixtureStageTreatment({ durationSec: 12, format: "9:16", beats, copy: { source: "invented", lines } });
  withRun("ltm-green-sway-", page("sway-gather.html"), { treatment }, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /STAGE_NONDETERMINISTIC/u);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const det = JSON.parse(fs.readFileSync(path.join(out, ".run", "determinism.json"), "utf8"));
    assert.ok(det.frames.some((entry) => entry.frame === 180), "the 6 s cut is a sample");
    assert.ok(det.frames.every((entry) => entry.master === entry.replay));
  });
});

for (const [name, file] of [["wall clock (performance.timeOrigin)", "red-wallclock.html"],["unseeded random (crypto.getRandomValues)", "red-random.html"]]) {
  test(`RED: a page painting the ${name} exits 18 and names the frame and region`, { skip: needsWarm }, () => {
    withRun("ltm-red-", page(file), {}, (out) => {
      const result = stage(out, ["--round", "2"]);
      assert.equal(result.status, 18, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /STAGE_NONDETERMINISTIC \(18\): frame \d+ \([\d.]+ s\) differs from a fresh replay; first differing region \d+x\d+ at \(\d+, \d+\)/u);
    });
  });
}

test("the page keeps the format's full viewport after every capture", { skip: needsWarm }, () => {
  withRun("ltm-viewport-", page("bottom-bar.html"), {}, (out) => {
    const result = stage(out, ["--stills-only"]);
    assert.equal(result.status, 0, result.stderr);
    for (const still of ["beat-01-mid.png", "beat-02-mid.png", "beat-03-mid.png"]) {
      assert.deepEqual(pixel(path.join(out, "stills", still), 960, 1070), [0, 200, 0], `${still}: the bar sits on the last rows`);
      assert.notDeepEqual(pixel(path.join(out, "stills", still), 960, 1030), [0, 200, 0], `${still}: and nowhere above them`);
    }
  });
});

test("a CSS transition started at t = 2 s shows its expected colour at t = 2.1 s", { skip: needsWarm }, () => {
  withRun("ltm-transition-", page("transition.html"), {}, (out) => {
    const result = stage(out, ["--stills-only"]);
    assert.equal(result.status, 0, result.stderr);
    const [r, g, b] = pixel(path.join(out, "stills", "beat-02-mid.png"), 800, 500);
    assert.ok(Math.abs(r - 20) <= 2 && g <= 2 && b <= 2, `rgb(${r}, ${g}, ${b}) at t = 2.1 s; a linear 1 s transition from black to rgb(200, 0, 0) is at rgb(20, 0, 0)`);
    const settled = pixel(path.join(out, "stills", "beat-03-mid.png"), 800, 500);
    assert.ok(Math.abs(settled[0] - 200) <= 2, `rgb(${settled.join(", ")}) after the transition`);
  });
});

test("a WAAPI finished.then chain visibly continues", { skip: needsWarm }, () => {
  withRun("ltm-chain-", page("finished-chain.html"), {}, (out) => {
    const result = stage(out, ["--stills-only"]);
    assert.equal(result.status, 0, result.stderr);
    const moved = pixel(path.join(out, "stills", "beat-02-mid.png"), 950, 750);
    const origin = pixel(path.join(out, "stills", "beat-02-mid.png"), 150, 750);
    assert.ok(moved[0] > 200 && origin[0] < 60, `the second block reached x = 900 (${moved.join(",")} there, ${origin.join(",")} at its start)`);
    const before = pixel(path.join(out, "stills", "beat-01-mid.png"), 150, 750);
    assert.ok(before[0] > 200, "before the first animation finished, the second block had not moved");
  });
});

test("a 9:16 film: ffprobe reports 1080x1920 and the flash grid is portrait", { skip: needsWarm }, () => {
  withRun("ltm-portrait-", page("portrait.html"), { treatment: fixtureStageTreatment({ format: "9:16", formatReason: "a phone feed plays it upright" }) }, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(out, "film.mp4")], { encoding: "utf8" });
    assert.equal(probe.stdout.trim(), "1080,1920");
    assert.match(result.stdout, /MO-C-03 PASS  \(worst window .*grid 180x320 cells\)/u);
    const still = decodePng(fs.readFileSync(path.join(out, "stills", "beat-01-mid.png")));
    assert.deepEqual([still.width, still.height], [1080, 1920]);
  });
});

test("contract: no LitStage.define, a wrong size, a runtime forbidden element or API exit 17", { skip: needsWarm }, () => {
  const cases = [
    ["<script src=\"/lit/stage-kit.js\"></script><p>no contract</p>", /never called LitStage\.define/u],
    ["<script src=\"/lit/stage-kit.js\"></script><script>LitStage.define({ width: 1280, height: 720, fps: 30, duration: 4.2, render() {} });</script>", /defines 1280x720/u],
    ["<script src=\"/lit/stage-kit.js\"></script><script>document.body.appendChild(document.createElement(['vid', 'eo'].join(''))); LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4.2, render() {} });</script>", /<video>/u],
    ["<script src=\"/lit/stage-kit.js\"></script><script>try { new window[['Audio', 'Context'].join('')](); } catch {} LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4.2, render() {} });</script>", /AudioContext/u]
  ];
  for (const [html, message] of cases) {
    withRun("ltm-contract-", `<!doctype html><meta charset="utf-8"><body>${html}</body>`, {}, (out) => {
      const result = stage(out, ["--stills-only"]);
      assert.equal(result.status, 17, `${html}\n${result.stderr}`);
      assert.match(result.stderr, message, html);
    });
  }
});

test("network: a runtime request outside the stage origin or a WebSocket exits 19", { skip: needsWarm }, () => {
  const cases = [
    ["<script src=\"/lit/stage-kit.js\"></script><script>const u = ['ht', 'tps://example.com/p.png'].join(''); const img = new Image(); img.src = u; LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4.2, render() {} });</script>", /STAGE_NETWORK_REQUEST \(19\): the page requested https:\/\/example\.com\/p\.png/u],
    ["<script src=\"/lit/stage-kit.js\"></script><script>try { new window[['Web', 'Socket'].join('')]('ws://lit.stage/x'); } catch {} LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4.2, render() {} });</script>", /STAGE_NETWORK_REQUEST \(19\): the page used WebSocket/u]
  ];
  for (const [html, message] of cases) {
    withRun("ltm-network-", `<!doctype html><meta charset="utf-8"><body>${html}</body>`, {}, (out) => {
      const result = stage(out, ["--stills-only"]);
      assert.equal(result.status, 19, `${html}\n${result.stderr}`);
      assert.match(result.stderr, message);
    });
  }
});

test("DOM text QA: low-contrast, off-safe and too-brief copy FAIL; decor is exempt but may not carry copy", { skip: needsWarm }, () => {
  const treatment = fixtureStageTreatment({ copy: { source: "invented", lines: ["낮은 대비의 문장", "가장자리 문장", "짧게 스친 문장"] } });
  withRun("ltm-qa-fail-", page("qa-fail.html"), { treatment }, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 13, `${result.stdout}\n${result.stderr}`);
    const rows = JSON.parse(fs.readFileSync(path.join(out, ".run", "qa.json"), "utf8")).checks;
    assert.equal(rows["TEXT-copy-found"].pass, true);
    assert.match(rows["TEXT-contrast"].detail, /"낮은 대비의 문장" at frame \d+: 1\.\d+:1 < 3:1/u);
    assert.match(rows["TEXT-title-safe"].detail, /"가장자리 문장" leaves the central 90 %/u);
    assert.match(rows["TEXT-reading-floor"].detail, /"짧게 스친 문장" is readable for 0\.[3-5] s; its floor is \d\.\d+ s/u);
    assert.match(rows["TEXT-decor"].detail, /decor text "가장자리 문장" carries a copy line/u);
    assert.equal(rows["TEXT-decor-contrast"]?.warn, true, "decor contrast only warns");
    for (const id of ["TEXT-title-safe", "TEXT-reading-floor", "TEXT-contrast"]) assert.doesNotMatch(rows[id].detail, /장식 간판/u, `${id} exempts decor`);
  });
});

test("DOM text QA warnings: a file name on screen, unregistered canvas text and a moved-state sample", { skip: needsWarm }, () => {
  const treatment = fixtureStageTreatment({ copy: { source: "invented", lines: ["고요한 정원의 아침"] } });
  withRun("ltm-qa-warn-", page("qa-warn.html"), { treatment }, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const rows = JSON.parse(fs.readFileSync(path.join(out, ".run", "qa.json"), "utf8")).checks;
    assert.match(rows["TEXT-meta-labels"].detail, /"treatment\.json"/u);
    assert.match(rows["TEXT-canvas"].detail, /canvas text not measured: "canvas words"/u);
    assert.match(rows["TEXT-moved"].detail, /changed outside the text \(state moved; sample discarded\)/u);
    for (const id of ["TEXT-meta-labels", "TEXT-canvas", "TEXT-moved"]) { assert.equal(rows[id].warn, true, id); assert.match(result.stdout, new RegExp(`${id} WARN`, "u")); }
    assert.match(result.stdout, /QA gate: PASS/u);
  });
});

test("copy that never reaches the screen stops the stage render with exit 17", { skip: needsWarm }, () => {
  const treatment = fixtureStageTreatment({ copy: { source: "invented", lines: ["화면에 없는 문장"] } });
  withRun("ltm-qa-missing-", page("clock-only.html"), { treatment }, (out) => {
    const result = stage(out, ["--round", "2"]);
    assert.equal(result.status, 17, result.stderr);
    assert.match(result.stderr, /STAGE_CONTRACT_ERROR \(17\): copy line never found on screen: "화면에 없는 문장"/u);
  });
});

test("a treatment for the other path, or no stage page, stops before any browser", () => {
  withRun("ltm-nopage-", "", {}, (out) => {
    fs.rmSync(path.join(out, "stage"), { recursive: true, force: true });
    const result = stage(out, ["--stills-only"], { XDG_CACHE_HOME: path.join(out, "empty-cache") });
    assert.equal(result.status, 17, result.stderr);
    assert.match(result.stderr, /no stage page/u);
  });
});
