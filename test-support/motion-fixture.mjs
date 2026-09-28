// Synthetic lit-typographic-motion output directories for gate fixtures. The baseline passes every
// gate rule; each test mutates one aspect and asserts that exactly that rule fails. No browser.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodePng } from "../skills/lit-typographic-motion/engine/png.mjs";
import { passSeed } from "../skills/lit-typographic-motion/engine/text.mjs";
import { chromeFlagRungs, presets } from "../skills/lit-typographic-motion/engine/constants.mjs";

export const FPS = 60;
export const DURATION = 6;
export const FRAMES = FPS * DURATION;
export const SEED = 4242;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

export function tempDir(prefix = "ltm-fixture-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

let mp4Cache = null;
// A real 1920x1080 60 fps H.264 file with the pinned BT.709 tags, or null without ffmpeg.
export function fixtureMp4(options = {}) {
  const key = JSON.stringify(options);
  mp4Cache ??= new Map();
  if (mp4Cache.has(key)) return mp4Cache.get(key);
  const which = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (which.status !== 0) { mp4Cache.set(key, null); return null; }
  const { width = 1920, height = 1080, fps = 60, seconds = DURATION, tagged = true } = options;
  const file = path.join(tempDir("ltm-mp4-"), "film.mp4");
  const vf = tagged ? ["-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"] : ["-vf", "format=yuv420p"];
  const tags = tagged ? ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"] : [];
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds}`, ...vf, "-c:v", "libx264", "-preset", "ultrafast", ...tags, file], { encoding: "utf8" });
  const value = result.status === 0 ? file : null;
  mp4Cache.set(key, value);
  return value;
}

export function baseManifest() {
  const look = presets["swiss-signal"];
  const timeline = [
    { id: "title-slam#0", sceneId: "title-slam", shotIndex: 0, start: 0, end: 1.2, holdSec: 1.2, kind: "line", text: "Test Title", script: "latin", beatSec: 0, stateful: false, prerollMax: 0 },
    { id: "end-card#0", sceneId: "end-card", shotIndex: 0, start: 1.2, end: 6, holdSec: 4.8, kind: "scene", text: "Closing line", script: "latin", beatSec: 1.2, stateful: false, prerollMax: 0 }
  ];
  const passRanges = [];
  for (const shot of timeline) {
    for (const pass of look.passes) {
      passRanges.push({
        pass, frameStart: Math.round(shot.start * FPS), frameEnd: Math.round(shot.end * FPS) - 1, sceneId: shot.sceneId, shotIndex: 0,
        seed: pass === "swiss-grid" ? null : passSeed(SEED, shot.sceneId, 0, pass),
        params: pass === "swiss-grid" ? { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, showGuides: false } : { mode: 1, paletteSize: 0, pixelScale: 1, ditherStrength: 0.3 },
        downgraded: false
      });
    }
  }
  return {
    schemaVersion: 1, engineCredit: "mexicat/pdoom-video ca251e3dddda422b364385eb484b5a3593a0990d (MIT)", presetId: "swiss-signal", seed: SEED,
    fps: FPS, resolution: [1920, 1080], scale: 1, samples: 4, shutter: 0.5,
    renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)", softwareRenderer: false,
    chromeFlags: chromeFlagRungs("darwin")[0].flags, previewEncoder: "img2webp", audioTier: "text-reading-time", bpm: 100,
    durationSec: DURATION, generatedAt: "2026-09-27T00:00:00.000Z", passRanges, timeline, warnings: [], craftRound: 1,
    preview: { width: 960, fps: 30, bytes: 1024 }
  };
}

export const baseBox = () => ({
  elementId: "title", text: "Test Title", voice: "display", fontFile: "Archivo-100-900.ttf", fontSizePx: 120, capHeightPx: 84, weight: 900,
  fill: "#E9EBE4", bbox: [300, 480, 900, 600],
  runs: [{ script: "latin", text: "Test Title", font: "Archivo-100-900.ttf", weight: 900, widthPct: 100, trackingEm: -0.035, scaleX: 1 }],
  role: "display", lineCount: 1, lineHeight: null, outline: false, halo: false
});

export function baseFrameLine(manifest, frame) {
  const shot = manifest.timeline.filter((e) => e.kind !== "reveal").find((e) => frame >= Math.round(e.start * FPS) && frame < Math.round(e.end * FPS));
  const n = manifest.samples, s = manifest.shutter;
  return {
    frame, pass: null, rgbaSha256: hash(`frame-${frame}`),
    sampleTimes: Array.from({ length: n }, (_, i) => Math.max(0, frame / FPS + (s / FPS) * ((i + 0.5) / n - 0.5))),
    sceneId: shot.sceneId, shotIndex: shot.shotIndex, inkPixels: 5000, p995L: 0.8,
    transitions: { up: false, down: false, redUp: false, redDown: false }, fullStep: false, events: [],
    post: { ...presets["swiss-signal"].post }, textBoxes: [baseBox()],
    graphics: [{ elementId: "grid-margin", kind: "swiss-grid", bbox: [95.5, 96, 96.5, 984] }],
    fills: [{ elementId: "background", color: "#0C0E13", bbox: [0, 0, 1920, 1080], kind: "background" }]
  };
}

export function basePassLines(manifest, frame) {
  return manifest.passRanges.filter((r) => frame >= r.frameStart && frame <= r.frameEnd).map((r) => ({
    frame, pass: r.pass, draws: 1,
    uniforms: r.pass === "swiss-grid" ? { u_showGuides: false } : { u_seed: r.seed }
  }));
}

// Sample frame PNG + mask: a light glyph block (fg) on the preset background.
export function samplePng(fg = [233, 235, 228], bg = [12, 14, 19], box = [300, 480, 900, 600], gradient = false) {
  const W = 1920, H = 1080;
  const rgba = Buffer.alloc(W * H * 4), mask = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inside = x >= box[0] + 20 && x < box[2] - 20 && y >= box[1] + 20 && y < box[3] - 20 && (x % 40) < 28;
    const t = gradient ? (x - box[0]) / (box[2] - box[0]) : 1;
    const c = inside ? fg.map((v, k) => Math.round(bg[k] + (v - bg[k]) * t)) : bg;
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    if (inside) mask[y * W + x] = 255;
  }
  return { frame: encodePng(W, H, rgba, 4, 1), mask: encodePng(W, H, mask, 1, 1) };
}

// Write a full output directory. `mutate` receives the model before it is written.
export function writeRun(dir, mutate = () => {}) {
  const manifest = baseManifest();
  const model = {
    manifest,
    frameLines: Array.from({ length: FRAMES }, (_, f) => baseFrameLine(manifest, f)),
    passLines: null,
    previewLines: Array.from({ length: DURATION * 30 }, (_, k) => ({ stream: "preview", previewFrame: k, sourceFrame: k * 2, width: 960, fps: 30, transitions: { up: false, down: false, redUp: false, redDown: false }, fullStep: false })),
    brief: { path: path.join(dir, "brief.json"), sha256: "0", sourceText: "Test Title Closing line", explicitPreset: null },
    preflight: { missingGlyphs: [] },
    samples: { frames: [{ frame: 200 }] },
    sample: samplePng(),
    determinism: null,
    perf: { renderer: manifest.renderer, chromeFlags: manifest.chromeFlags, samples: 1, frameTimeMs: Array.from({ length: 120 }, () => 12) },
    still: { posterFrame: 43, stillFrame: FRAMES - 1, inkPixels: 5000 },
    exports: { "film.mp4": fixtureMp4(), "preview.webp": Buffer.alloc(1024, 1), "poster.png": Buffer.alloc(2048, 1), "reduced-motion.png": Buffer.alloc(2048, 1) }
  };
  mutate(model);
  model.passLines ??= Array.from({ length: FRAMES }, (_, f) => basePassLines(model.manifest, f)).flat();
  model.determinism ??= { seeked: true, frames: [71, 72].map((frame) => ({ frame, master: model.frameLines[frame].rgbaSha256, rerender: model.frameLines[frame].rgbaSha256 })) };
  fs.mkdirSync(path.join(dir, ".run", "samples"), { recursive: true });
  fs.writeFileSync(path.join(dir, "brief.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(model.manifest, null, 2));
  const lines = [...model.passLines, ...model.frameLines, ...model.previewLines].map((line) => JSON.stringify(line)).join("\n");
  fs.writeFileSync(path.join(dir, "render.jsonl"), lines + "\n");
  for (const [name, value] of Object.entries({ "brief.json": model.brief, "preflight.json": model.preflight, "samples.json": model.samples, "determinism.json": model.determinism, "perf.json": model.perf, "still.json": model.still })) {
    if (value !== undefined) fs.writeFileSync(path.join(dir, ".run", name), JSON.stringify(value));
  }
  for (const { frame } of model.samples.frames) {
    fs.writeFileSync(path.join(dir, ".run", "samples", `f${frame}.png`), model.sample.frame);
    fs.writeFileSync(path.join(dir, ".run", "samples", `f${frame}-mask.png`), model.sample.mask);
  }
  for (const [name, value] of Object.entries(model.exports)) {
    if (value === null || value === undefined) continue;
    const target = path.join(dir, name);
    if (Buffer.isBuffer(value)) fs.writeFileSync(target, value);
    else fs.copyFileSync(value, target);
  }
  return model;
}
