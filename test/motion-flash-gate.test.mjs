import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSequence, countFlashes } from "../skills/lit-typographic-motion/engine/flash.mjs";

// Frames at 320x180: one pixel is one audit cell (6x6 logical px at 1080p), so the fixtures stay
// small while exercising the real excursion detector and the 640x360-px (107x60-cell) window.
const W = 320, H = 180, FPS = 60;
const encode = (linear) => Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));
const flat = (value) => Buffer.alloc(W * H * 4, value);

function frameWith(bg, block, rgb) {
  const frame = flat(bg);
  if (block) {
    const [x0, y0, x1, y1] = block;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      frame[i] = rgb[0]; frame[i + 1] = rgb[1]; frame[i + 2] = rgb[2]; frame[i + 3] = 255;
    }
  }
  return frame;
}

test("fixture (i): a full-frame 0.05<->0.55 pulse with 6-frame attack and decay, 4/s at 60 fps, fails", () => {
  const frames = Array.from({ length: 120 }, (_, f) => {
    const phase = f % 15;
    const level = phase < 6 ? 0.05 + (0.5 * phase) / 6 : phase < 12 ? 0.55 - (0.5 * (phase - 6)) / 6 : 0.05;
    return flat(encode(level));
  });
  const audit = auditSequence(frames, W, H, FPS, false);
  assert.equal(audit.pass, false);
  assert.ok(audit.general >= 4, `expected >= 4 general flashes, got ${audit.general}`);
});

test("fixture (ii): a 700x400 px block toggling black/white 4/s on a static frame fails", () => {
  const block = [60, 40, 60 + Math.ceil(700 / 6), 40 + Math.ceil(400 / 6)];
  const frames = Array.from({ length: 120 }, (_, f) => (Math.floor(f / 7.5) % 2 === 0 ? frameWith(0, null) : frameWith(0, block, [255, 255, 255])));
  const audit = auditSequence(frames, W, H, FPS, false);
  assert.equal(audit.pass, false);
});

test("a small block under the 10-degree area threshold toggling the same way passes", () => {
  const block = [60, 40, 60 + 40, 40 + 30];
  const frames = Array.from({ length: 120 }, (_, f) => (Math.floor(f / 7.5) % 2 === 0 ? frameWith(0, null) : frameWith(0, block, [255, 255, 255])));
  assert.equal(auditSequence(frames, W, H, FPS, false).pass, true);
});

test("a slow two-second fade is not a flash", () => {
  const frames = Array.from({ length: 180 }, (_, f) => flat(encode(0.05 + 0.5 * Math.min(1, f / 120))));
  const audit = auditSequence(frames, W, H, FPS, false);
  assert.equal(audit.general, 0);
  assert.equal(audit.pass, true);
});

test("four flashes placed in the final second of a non-looping master still fail (no wrap-around dilution)", () => {
  const records = Array.from({ length: 180 }, () => ({ up: false, down: false, redUp: false, redDown: false }));
  for (const [frame, up] of [[121, true], [128, false], [135, true], [142, false], [149, true], [156, false], [163, true], [170, false]]) records[frame][up ? "up" : "down"] = true;
  records[2].up = true;
  const result = countFlashes(records, FPS, false);
  assert.equal(result.general, 4);
  assert.equal(result.pass, false);
});

test("red flashes are counted per 1 s window, not as a flat film-wide total", () => {
  const spread = Array.from({ length: 600 }, () => ({ up: false, down: false, redUp: false, redDown: false }));
  for (let second = 0; second < 5; second++) { spread[second * 120 + 5].redUp = true; spread[second * 120 + 20].redDown = true; }
  assert.equal(countFlashes(spread, FPS, false).red, 1, "five red flashes spread over ten seconds are one per window");
  const packed = Array.from({ length: 120 }, () => ({ up: false, down: false, redUp: false, redDown: false }));
  for (let k = 0; k < 4; k++) { packed[10 + k * 12].redUp = true; packed[16 + k * 12].redDown = true; }
  const result = countFlashes(packed, FPS, false);
  assert.equal(result.red, 4);
  assert.equal(result.pass, false);
});

test("saturated red cells register red transitions from real frames", () => {
  const block = [20, 20, 20 + 120, 20 + 70];
  const frames = Array.from({ length: 120 }, (_, f) => (Math.floor(f / 7.5) % 2 === 0 ? frameWith(0, null) : frameWith(0, block, [255, 0, 0])));
  const audit = auditSequence(frames, W, H, FPS, false);
  assert.ok(audit.red >= 4, `expected red flashes, got ${audit.red}`);
});

test("the looping preview audit wraps its window across the loop seam", () => {
  const records = Array.from({ length: 60 }, () => ({ up: false, down: false, redUp: false, redDown: false }));
  for (const [frame, key] of [[54, "up"], [56, "down"], [58, "up"], [59, "down"], [1, "up"], [3, "down"], [5, "up"], [7, "down"]]) records[frame][key] = true;
  assert.equal(countFlashes(records, 30, false).general, 2);
  assert.equal(countFlashes(records, 30, true).general, 4);
});

test("a full-frame luminance step in one frame pair is flagged (MO-SH-04a)", () => {
  const frames = [flat(20), flat(20), flat(200), flat(200)];
  assert.equal(auditSequence(frames, W, H, FPS, false).fullStep, true);
  assert.equal(auditSequence([flat(20), flat(30), flat(40)], W, H, FPS, false).fullStep, false);
});
