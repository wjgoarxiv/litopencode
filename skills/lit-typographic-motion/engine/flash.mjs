// MO-C-03 / MO-SH-04 / MO-SH-04a: the WCAG 2.3.1 excursion-method flash audit, written for this
// engine's own 8-bit output frames. The render feeds it the exact bytes it hands to ffmpeg and to the
// preview encoder and logs each frame's transitions; the gate counts flashes from those records.
import { flashGeometry as G, limits } from "./constants.mjs";

const toLinear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export const linearLut = toLinear;

// The audit geometry for a frame: the 320x180 grid and 107x60-cell window at 16:9, transposed to
// 180x320 cells and a 60x107-cell window for a 9:16 frame.
export function flashGeometryFor(width, height) {
  if (width >= height) return G;
  return Object.freeze({ ...G, gridW: G.gridH, gridH: G.gridW, windowCellsW: G.windowCellsH, windowCellsH: G.windowCellsW });
}

// Area-average an RGBA frame of any size onto the audit grid (linear R, G, B and luminance).
// Integer block sizes take a fast path; other sizes use exact fractional area weights.
export function auditCells(rgba, width, height, geometry = flashGeometryFor(width, height)) {
  const G = geometry;
  const cells = G.gridW * G.gridH;
  const R = new Float64Array(cells), Gc = new Float64Array(cells), B = new Float64Array(cells), L = new Float64Array(cells);
  const bw = width / G.gridW, bh = height / G.gridH;
  if (Number.isInteger(bw) && Number.isInteger(bh)) {
    const area = bw * bh;
    for (let cy = 0; cy < G.gridH; cy++) for (let cx = 0; cx < G.gridW; cx++) {
      let r = 0, g = 0, b = 0;
      for (let y = cy * bh; y < (cy + 1) * bh; y++) {
        let at = (y * width + cx * bw) * 4;
        for (let x = 0; x < bw; x++, at += 4) { r += toLinear[rgba[at]]; g += toLinear[rgba[at + 1]]; b += toLinear[rgba[at + 2]]; }
      }
      const i = cy * G.gridW + cx;
      R[i] = r / area; Gc[i] = g / area; B[i] = b / area;
      L[i] = 0.2126 * R[i] + 0.7152 * Gc[i] + 0.0722 * B[i];
    }
    return { R, G: Gc, B, L };
  }
  const xw = spans(width, G.gridW), yw = spans(height, G.gridH);
  for (let cy = 0; cy < G.gridH; cy++) for (let cx = 0; cx < G.gridW; cx++) {
    let r = 0, g = 0, b = 0, total = 0;
    for (const [y, wy] of yw[cy]) for (const [x, wx] of xw[cx]) {
      const w = wx * wy, at = (y * width + x) * 4;
      r += toLinear[rgba[at]] * w; g += toLinear[rgba[at + 1]] * w; b += toLinear[rgba[at + 2]] * w; total += w;
    }
    const i = cy * G.gridW + cx;
    R[i] = r / total; Gc[i] = g / total; B[i] = b / total;
    L[i] = 0.2126 * R[i] + 0.7152 * Gc[i] + 0.0722 * B[i];
  }
  return { R, G: Gc, B, L };
}

function spans(size, count) {
  const step = size / count;
  return Array.from({ length: count }, (_, c) => {
    const a = c * step, b = (c + 1) * step, out = [];
    for (let p = Math.floor(a); p < Math.ceil(b); p++) {
      const w = Math.min(b, p + 1) - Math.max(a, p);
      if (w > 1e-9) out.push([p, w]);
    }
    return out;
  });
}

function redValue(r, g, b) {
  const sum = r + g + b;
  if (sum <= 0 || r / sum < G.redRatio) return 0;
  return Math.max(0, r - g - b) * G.redScale;
}

function windowHit(mask, G) {
  const W = G.gridW, H = G.gridH, ww = G.windowCellsW, wh = G.windowCellsH;
  const sat = new Uint32Array((W + 1) * (H + 1));
  let any = false;
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) {
      row += mask[(y - 1) * W + x - 1];
      sat[y * (W + 1) + x] = sat[(y - 1) * (W + 1) + x] + row;
    }
    if (row) any = true;
  }
  if (!any) return false;
  const threshold = ww * wh * G.areaFraction;
  for (let y = 0; y + wh <= H; y++) for (let x = 0; x + ww <= W; x++) {
    const area = sat[(y + wh) * (W + 1) + x + ww] - sat[y * (W + 1) + x + ww] - sat[(y + wh) * (W + 1) + x] + sat[y * (W + 1) + x];
    if (area > threshold) return true;
  }
  return false;
}

// Streaming excursion detector. push() takes one frame's audit cells and returns that frame's
// frame-level transitions: an up/down general transition and an up/down red transition, each
// reported once at its onset frame, plus MO-SH-04a's full-frame luminance step flag.
export class ExcursionDetector {
  constructor(geometry = G) {
    this.G = geometry;
    const n = geometry.gridW * geometry.gridH;
    this.lo = new Float64Array(n); this.hi = new Float64Array(n);
    this.rlo = new Float64Array(n); this.rhi = new Float64Array(n);
    this.prevL = new Float64Array(n);
    this.history = [];
    this.active = { up: false, down: false, redUp: false, redDown: false };
    this.frames = 0;
  }

  push(cells) {
    const G = this.G;
    const n = G.gridW * G.gridH;
    const up = new Uint8Array(n), down = new Uint8Array(n), redUp = new Uint8Array(n), redDown = new Uint8Array(n);
    let stepped = 0;
    for (let i = 0; i < n; i++) {
      const l = cells.L[i];
      const v = redValue(cells.R[i], cells.G[i], cells.B[i]);
      if (this.frames === 0) {
        this.lo[i] = this.hi[i] = l; this.rlo[i] = this.rhi[i] = v; this.prevL[i] = l;
        continue;
      }
      if (Math.abs(l - this.prevL[i]) >= limits.fullFrameStepDelta) stepped++;
      this.prevL[i] = l;
      if (l - this.lo[i] >= G.deltaL && Math.min(l, this.lo[i]) < G.darkerBelow) { up[i] = 1; this.lo[i] = this.hi[i] = l; }
      else if (this.hi[i] - l >= G.deltaL && Math.min(l, this.hi[i]) < G.darkerBelow) { down[i] = 1; this.lo[i] = this.hi[i] = l; }
      else { if (l < this.lo[i]) this.lo[i] = l; if (l > this.hi[i]) this.hi[i] = l; }
      if (v - this.rlo[i] > G.redDelta) { redUp[i] = 1; this.rlo[i] = this.rhi[i] = v; }
      else if (this.rhi[i] - v > G.redDelta) { redDown[i] = 1; this.rlo[i] = this.rhi[i] = v; }
      else { if (v < this.rlo[i]) this.rlo[i] = v; if (v > this.rhi[i]) this.rhi[i] = v; }
    }
    const first = this.frames === 0;
    this.frames++;
    this.history.push({ up, down, redUp, redDown });
    if (this.history.length > G.historyFrames) this.history.shift();
    const union = (key) => {
      const mask = new Uint8Array(n);
      for (const frame of this.history) { const m = frame[key]; for (let i = 0; i < n; i++) mask[i] |= m[i]; }
      return mask;
    };
    const result = { fullStep: !first && stepped > n * limits.fullFrameStepArea };
    for (const key of ["up", "down", "redUp", "redDown"]) {
      const hit = !first && windowHit(union(key), G);
      result[key] = hit && !this.active[key];
      this.active[key] = hit;
    }
    return result;
  }
}

// Pair opposing transitions inside one window; a flash is one opposing pair.
function pairsIn(list) {
  let pairs = 0, waiting = 0;
  for (const direction of list) {
    if (waiting === 0) waiting = direction;
    else if (direction !== waiting) { pairs++; waiting = 0; }
  }
  return pairs;
}

// Count flashes from per-frame transition records. `records[f]` = { up, down, redUp, redDown }.
// Master (looping=false): windows [s, s+fps) with s in [0, count-fps] and no wrap (MO-C-03 fixes a/b).
// Preview (looping=true): every start s, and the window wraps across the loop seam (MO-SH-04).
export function countFlashes(records, fps, looping) {
  const count = records.length;
  const events = { general: [], red: [] };
  records.forEach((record, frame) => {
    if (record.up) events.general.push([frame, 1]);
    if (record.down) events.general.push([frame, -1]);
    if (record.redUp) events.red.push([frame, 1]);
    if (record.redDown) events.red.push([frame, -1]);
  });
  const worst = {};
  for (const kind of ["general", "red"]) {
    const list = events[kind];
    let best = { flashes: 0, start: 0, transitions: [] };
    const starts = looping ? count : Math.max(1, count - fps + 1);
    for (let s = 0; s < starts; s++) {
      let inWindow;
      if (looping) {
        inWindow = list.filter(([frame]) => ((frame - s + count) % count) < fps)
          .sort((a, b) => ((a[0] - s + count) % count) - ((b[0] - s + count) % count));
      } else {
        const end = Math.min(s + fps, count);
        inWindow = list.filter(([frame]) => frame >= s && frame < end);
      }
      const flashes = pairsIn(inWindow.map(([, direction]) => direction));
      if (flashes > best.flashes) best = { flashes, start: s, transitions: inWindow.map(([frame, direction]) => `${frame}${direction > 0 ? "+" : "-"}`) };
    }
    worst[kind] = best;
  }
  return {
    general: worst.general.flashes, red: worst.red.flashes,
    worstWindow: { general: worst.general, red: worst.red },
    pass: worst.general.flashes <= limits.flashLimitGeneral && worst.red.flashes <= limits.flashLimitRed
  };
}

// Run the detector over a whole in-memory sequence (fixtures, preview frames).
// A looping sequence runs one extra second past the seam so transitions at the wrap are seen.
export function auditSequence(frames, width, height, fps, looping) {
  const geometry = flashGeometryFor(width, height);
  const detector = new ExcursionDetector(geometry);
  const records = [];
  const steps = [];
  const total = looping ? frames.length + fps : frames.length;
  for (let i = 0; i < total; i++) {
    const frame = frames[i % frames.length];
    const record = detector.push(auditCells(frame, width, height, geometry));
    if (i < frames.length) { records.push(record); steps.push(record.fullStep); }
    else {
      const target = records[i % frames.length];
      for (const key of ["up", "down", "redUp", "redDown"]) target[key] = target[key] || record[key];
      if (record.fullStep) steps[i % frames.length] = true;
    }
  }
  return { records, ...countFlashes(records, fps, looping), fullStep: steps.some(Boolean) };
}
