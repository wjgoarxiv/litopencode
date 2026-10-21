// The cover gate, measured on the DECODED cover (engine/cover/decode.mjs), never only on the frames
// that went into the encoder: G0 determinism, G1 size, length and loop, G2 motion energy, G3 holds
// and spikes, G4 the seam, G5 title contrast through the mask pass, G6 title cap height at README
// width. Every motion number is taken on a fixed time grid, because the encoder merges identical
// frames into one long frame and a per-frame count would make a slide film look busy. FLOOR fails
// the cover; TARGET is what cover mode delivers, and `--strict` (every cover render) fails on it too,
// 2 MiB included. Thresholds live in engine/constants.mjs (COVER).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { COVER } from "../constants.mjs";
import { decodePng } from "../png.mjs";
import { decodeCover } from "./decode.mjs";
import { lumaGrid, meanLumaStep, rgbaOf } from "./image.mjs";

const sorted = (list) => [...list].sort((a, b) => a - b);
const median = (list) => { const s = sorted(list), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (list, q) => { const s = sorted(list); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

/** A PNG on disk as { width, height, rgba }. */
export function readRgba(file) {
  const image = decodePng(readFileSync(file));
  return { width: image.width, height: image.height, rgba: rgbaOf(image) };
}
/** The sorted `<prefix>NNNN.png` files of a capture directory. */
export function framesIn(dir, prefix = "f") {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".png")).sort().map((name) => path.join(dir, name)) : [];
}
/** SHA-256 of a frame's decoded RGBA, the hash every determinism check compares (never PNG bytes). */
export const rgbaSha = (rgba) => createHash("sha256").update(rgba).digest("hex");

/**
 * Load a cover for the gate: an encoded .webp or .gif, or a directory of PNG frames shown at `fps`.
 * `keep(index, durationMs)` is asked once per decoded frame, in order, whether to keep that frame
 * whole (RGBA) for the stills and the frame-0 art check. Returns { format, width, height, loop,
 * bytes, durations, lumas, kept }.
 */
export function loadCover(input, { fps = 16, keep = () => false, env = process.env } = {}) {
  const lumas = [];
  const kept = new Map();
  if (statSync(input).isDirectory()) {
    const files = framesIn(input);
    let width = 0, height = 0;
    files.forEach((file, i) => {
      const image = readRgba(file);
      ({ width, height } = image);
      lumas.push(lumaGrid(image.rgba, width, height).luma);
      if (keep(i, 1000 / fps)) kept.set(i, image.rgba);
    });
    return { format: "png", width, height, loop: 0, bytes: null, durations: files.map(() => 1000 / fps), lumas, kept };
  }
  const info = decodeCover(input, {
    env,
    onFrame: (i, rgba, ms, width, height) => {
      lumas.push(lumaGrid(rgba, width, height).luma);
      if (keep(i, ms > 0 ? ms : 100)) kept.set(i, Buffer.from(rgba));
    }
  });
  return { ...info, durations: info.durations.map((ms) => (ms > 0 ? ms : 100)), lumas, kept };
}

/** The frame on show at each grid time 0, step, 2 step, ... over the whole loop. */
export function onGrid(frames, durations, step) {
  const total = durations.reduce((a, b) => a + b, 0);
  const out = [];
  let index = 0, ends = durations[0];
  for (let ms = 0; ms < total - 1e-6; ms += step) {
    while (ms >= ends && index < frames.length - 1) ends += durations[++index];
    out.push(frames[index]);
  }
  return out;
}

/** Motion on the grid. The loop is a ring: the step from the last sample back to the first is the seam. */
export function motionMetrics({ lumas, durations }) {
  const step = Math.max(COVER.gridMs, Math.min(...durations));
  const grid = onGrid(lumas, durations, step);
  const n = grid.length;
  const steps = [];
  for (let i = 1; i < n; i++) steps.push(meanLumaStep(grid[i], grid[i - 1]));
  const seam = meanLumaStep(grid[0], grid[n - 1]);
  const ring = [...steps, seam];
  const medianD = median(ring);
  const still = ring.map((d) => d < COVER.stillEps);
  let longest = 0;
  if (still.every(Boolean)) longest = n * step;
  else {
    // Walk the ring once from a moving step, so a hold that wraps through the seam counts whole.
    const from = still.indexOf(false);
    let run = 0;
    for (let k = 1; k <= n; k++) {
      run = still[(from + k) % n] ? run + step : 0;
      longest = Math.max(longest, run);
    }
  }
  // On a coarse grid (merged frames) the last sample reaches past the loop's end; a hold is never longer than the loop.
  longest = Math.min(longest, durations.reduce((a, b) => a + b, 0));
  const neighbours = n >= 4 ? (ring[n - 3] + ring[n - 2] + ring[0] + ring[1]) / 4 : medianD;
  return {
    gridFrames: n, gridMs: step, durationSec: (n * step) / 1000, sourceDurationSec: durations.reduce((a, b) => a + b, 0) / 1000,
    medianD, p10D: quantile(ring, 0.1), p90D: quantile(ring, 0.9), maxD: Math.max(...ring),
    movingFrac: ring.filter((d) => d >= COVER.stillEps).length / ring.length,
    longestStillSec: longest / 1000, spike: Math.max(...ring) / Math.max(medianD, COVER.stillEps),
    seam, seamLocal: seam / Math.max(COVER.stillEps, neighbours), steps: ring
  };
}

const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgba, p) => 0.2126 * linear(rgba[p]) + 0.7152 * linear(rgba[p + 1]) + 0.0722 * linear(rgba[p + 2]);
/** A [x, y, w, h] box of fractions as whole pixels of a width x height frame. */
export const boxPixels = (box, width, height) => box.map((v, k) => Math.round(v * (k % 2 ? height : width)));

/**
 * G5 on every frame: the median title pixel (white in the mask) against the 90th-percentile
 * background pixel of the title box, the background being box pixels at least 3 px from any title
 * pixel. Without one mask per frame the gate fails and says what is missing.
 */
export function titleContrast({ framesDir, masksDir, box }) {
  const frames = framesIn(framesDir, "f"), masks = framesIn(masksDir, "m");
  if (!frames.length || masks.length !== frames.length) return { measured: false, reason: `one mask per frame is needed (${frames.length} frames, ${masks.length} masks)` };
  const ratios = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = readRgba(frames[i]), mask = readRgba(masks[i]);
    const { width, height } = frame;
    if (mask.width !== width || mask.height !== height) return { measured: false, reason: `mask ${i} is ${mask.width}x${mask.height}, the frame ${width}x${height}` };
    const [bx, by, bw, bh] = boxPixels(box, width, height);
    const role = new Uint8Array(width * height); // 0 background, 1 halo, 2 title
    for (let p = 0; p < width * height; p++) if (mask.rgba[p * 4] > 127) role[p] = 2;
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      if (role[y * width + x] !== 2) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < height && xx >= 0 && xx < width && role[yy * width + xx] === 0) role[yy * width + xx] = 1;
      }
    }
    const title = [], ground = [];
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      const p = y * width + x;
      if (role[p] === 2) title.push(luminance(frame.rgba, p * 4));
      else if (role[p] === 0) ground.push(luminance(frame.rgba, p * 4));
    }
    if (!title.length || !ground.length) return { measured: false, reason: `frame ${i}: the title box holds ${title.length} title and ${ground.length} background pixels` };
    const t = median(title);
    const g = t > median(ground) ? quantile(ground, 0.9) : quantile(ground, 0.1);
    ratios.push((Math.max(t, g) + 0.05) / (Math.min(t, g) + 0.05));
  }
  return { measured: true, min: Math.min(...ratios), median: median(ratios), frames: ratios.length };
}

/**
 * G6 on up to 12 mask frames spread over the loop: the white pixels in the title box are split into
 * connected glyphs; dots and accents (under 1 % of the largest glyph's area or 30 % of the tallest
 * glyph's height) are left out; the median height of the rest is the cap height. The smallest
 * sample, scaled from the cover width to `displayWidth`, must reach COVER.minCapPx. A title painted
 * into declared base art is `exempt`: still measured, reported as INFO. G6 stands beside G5.
 */
export function capHeight({ masksDir, box, displayWidth = COVER.displayWidth, exempt = null, samples = 12 }) {
  const masks = framesIn(masksDir, "m");
  if (!masks.length) return { pass: false, reason: "no mask frames to measure the title on" };
  const count = Math.min(samples, masks.length);
  const picks = [...new Set(Array.from({ length: count }, (_, k) => Math.floor((k * masks.length) / count)))];
  let cap = Infinity, glyphs = 0, coverWidth = 0;
  for (const i of picks) {
    const mask = readRgba(masks[i]);
    coverWidth = mask.width;
    const [bx, by, bw, bh] = boxPixels(box, mask.width, mask.height);
    const seen = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) seen[y * bw + x] = mask.rgba[((by + y) * mask.width + bx + x) * 4] > 127 ? 1 : 0;
    const parts = [];
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] !== 1) continue;
      const stack = [start];
      seen[start] = 2;
      let area = 0, top = bh, bottom = -1;
      while (stack.length) {
        const q = stack.pop(), y = Math.floor(q / bw), x = q % bw;
        area += 1; top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const next of [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, y > 0 ? q - bw : -1, y < bh - 1 ? q + bw : -1]) {
          if (next >= 0 && seen[next] === 1) { seen[next] = 2; stack.push(next); }
        }
      }
      parts.push({ area, height: bottom - top + 1 });
    }
    if (!parts.length) return { pass: false, reason: `mask ${i} has no title pixels in the title box` };
    const largest = Math.max(...parts.map((p) => p.area)), tallest = Math.max(...parts.map((p) => p.height));
    const letters = parts.filter((p) => p.area >= 0.01 * largest && p.height >= 0.3 * tallest);
    glyphs = Math.max(glyphs, letters.length);
    cap = Math.min(cap, median(letters.map((p) => p.height)));
  }
  const capPx = (cap * displayWidth) / coverWidth;
  const measured = { capPx: Number(capPx.toFixed(1)), coverPx: cap, displayWidth, glyphs, sampled: picks.length };
  if (exempt) return { pass: null, ...measured, reason: exempt };
  return { pass: capPx >= COVER.minCapPx, ...measured };
}

/** G0: two captures in fresh browsers, compared frame by frame on decoded RGBA. */
export function determinism(a, b) {
  const first = framesIn(a, "f"), second = framesIn(b, "f");
  const count = Math.min(first.length, second.length);
  let identical = 0, firstDiffering = null;
  for (let i = 0; i < count; i++) {
    if (rgbaSha(readRgba(first[i]).rgba) === rgbaSha(readRgba(second[i]).rgba)) identical += 1;
    else firstDiffering ??= i;
  }
  return { compared: count, identical, countsMatch: first.length === second.length, firstDiffering };
}

/**
 * Gate one cover. `frames` and `replay` (two capture directories) give G0; `masks` and `title` give
 * G5; `glyph` adds G6. Returns the metrics, `gates`, `pass` (FLOOR) and `target` (TARGET, which
 * `--strict` and every cover render need), plus the kept frames.
 */
export function coverGate(input, { frames = null, replay = null, masks = null, title = null, glyph = null, fps = 16, keep, env = process.env } = {}) {
  const source = loadCover(input, { fps, keep, env });
  const m = motionMetrics(source);
  const gates = {};
  if (frames && replay) {
    const det = determinism(frames, replay);
    gates.G0 = { pass: det.compared > 0 && det.countsMatch && det.identical === det.compared, ...det };
  }
  if (source.format !== "png") {
    gates.G1 = {
      pass: source.bytes <= COVER.maxBytes && m.sourceDurationSec >= COVER.minSec && m.sourceDurationSec <= COVER.maxSec && source.loop === 0,
      target: source.bytes <= COVER.targetBytes,
      bytes: source.bytes, durationSec: m.sourceDurationSec, loop: source.loop, size: `${source.width}x${source.height}`
    };
  }
  const F = COVER.floor, T = COVER.target;
  gates.G2 = { pass: m.medianD >= F.medianD && m.movingFrac >= F.movingFrac, target: m.medianD >= T.medianD && m.movingFrac >= T.movingFrac, medianD: m.medianD, movingFrac: m.movingFrac };
  gates.G3 = { pass: m.longestStillSec <= F.stillSec, target: m.longestStillSec <= T.stillSec && m.spike <= T.spike, longestStillSec: m.longestStillSec, spike: m.spike };
  gates.G4 = { pass: m.seamLocal <= F.seamLocal, target: m.seamLocal >= T.seamLocalMin && m.seamLocal <= T.seamLocal, seam: m.seam, seamLocal: m.seamLocal };
  if (title && frames) {
    const c = titleContrast({ framesDir: frames, masksDir: masks, box: title });
    gates.G5 = c.measured ? { pass: c.min >= COVER.minContrast, min: c.min, median: c.median, frames: c.frames } : { pass: false, reason: c.reason };
  }
  if (title && masks && glyph) gates.G6 = capHeight({ masksDir: masks, box: title, displayWidth: glyph.displayWidth ?? COVER.displayWidth, exempt: glyph.exempt ?? null });
  return { input, ...source, lumas: undefined, sourceFrames: source.lumas.length, ...m, gates, ...verdicts(gates) };
}

/** FLOOR is every gate's pass; TARGET also needs every gate's target. INFO rows (pass null) count for neither. */
export function verdicts(gates) {
  const pass = Object.values(gates).every((g) => g.pass !== false);
  return { pass, target: pass && Object.values(gates).every((g) => g.target !== false) };
}

const shown = (v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(4)) : v);

/** The report: the verdict line (the done check reads it), the file line, one line per gate. */
export function formatCoverReport(result, { strict = false } = {}) {
  const verdict = result.pass ? (result.target ? "PASS+TARGET" : "PASS(floor)") : "FAIL";
  const lines = [
    `COVER gate${strict ? " --strict" : ""}: ${verdict}`,
    `  ${result.width}x${result.height} ${result.format} frames=${result.sourceFrames} dur=${shown(result.sourceDurationSec)}s bytes=${result.bytes ?? "-"} loop=${result.loop} grid=${result.gridMs}ms`
  ];
  for (const [name, gate] of Object.entries(result.gates)) {
    const { pass, target, ...detail } = gate;
    const word = pass === null ? "INFO" : pass ? (target === false ? "pass(floor)" : "pass") : "FAIL";
    lines.push(`  ${name} ${word} ${Object.entries(detail).map(([k, v]) => `${k}=${shown(v)}`).join(" ")}`.trimEnd());
  }
  return `${lines.join("\n")}\n`;
}
