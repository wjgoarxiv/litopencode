// The stills set every render writes, on both paths: one frame at each treatment beat's midpoint, a
// transition strip per cut (-6 / 0 / +6 frames side by side) and a 12-frame contact sheet. The look
// round reads only these files, so `stills/stills.json` records each file's SHA-256 and the round.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { areaResize, encodePng } from "./png.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pad = (n) => String(n).padStart(2, "0");

export function stillsPlan({ beats, cuts, frameCount, fps }) {
  const clamp = (frame) => Math.max(0, Math.min(frameCount - 1, Math.round(frame)));
  const beatFrames = beats.map((beat, i) => ({ index: i, frame: clamp(((beat.t0 + Math.min(beat.t1, frameCount / fps)) / 2) * fps) }));
  const strips = cuts.map((cut, i) => ({ index: i, cut: clamp(cut), frames: [clamp(cut - 6), clamp(cut), clamp(cut + 6)] }));
  const sheet = Array.from({ length: 12 }, (_, k) => clamp(((k + 0.5) * frameCount) / 12));
  const all = [...new Set([...beatFrames.map((b) => b.frame), ...strips.flatMap((s) => s.frames), ...sheet])].sort((a, b) => a - b);
  return { beatFrames, strips, sheet, all };
}

function tile(images, cols, tileW, tileH, gap) {
  const rows = Math.ceil(images.length / cols);
  const width = cols * tileW + (cols + 1) * gap, height = rows * tileH + (rows + 1) * gap;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = 17; out[i + 1] = 17; out[i + 2] = 17; out[i + 3] = 255; }
  images.forEach((image, k) => {
    const x0 = gap + (k % cols) * (tileW + gap), y0 = gap + Math.floor(k / cols) * (tileH + gap);
    for (let y = 0; y < tileH; y++) image.copy(out, ((y0 + y) * width + x0) * 4, y * tileW * 4, (y + 1) * tileW * 4);
  });
  return { width, height, pixels: out };
}

// `frames` maps a frame number to its RGBA buffer at width x height. Writes stills/ and sheet/ and
// returns the stills index (also written as stills/stills.json).
export function writeStillsSet(out, { width, height, fps, frames, plan, round, pathName, beats }) {
  const stillsDir = path.join(out, "stills"), sheetDir = path.join(out, "sheet");
  for (const dir of [stillsDir, sheetDir]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  const entries = [];
  const save = (file, w, h, pixels, kind, extra) => {
    const bytes = encodePng(w, h, pixels, 4, 6);
    writeFileSync(file, bytes);
    entries.push({ file: path.relative(out, file), kind, sha256: sha256(bytes), ...extra });
  };
  for (const beat of plan.beatFrames) {
    save(path.join(stillsDir, `beat-${pad(beat.index + 1)}-mid.png`), width, height, frames.get(beat.frame), "beat", { beat: beat.index, frame: beat.frame, t: beat.frame / fps, onScreen: beats[beat.index]?.onScreen });
  }
  const halfW = Math.round(width / 2), halfH = Math.round(height / 2);
  for (const strip of plan.strips) {
    const images = strip.frames.map((frame) => areaResize(frames.get(frame), width, height, halfW, halfH, 4));
    const composed = tile(images, 3, halfW, halfH, 8);
    save(path.join(stillsDir, `cut-${pad(strip.index + 1)}-strip.png`), composed.width, composed.height, composed.pixels, "strip", { cut: strip.cut, frames: strip.frames, t: strip.cut / fps });
  }
  const landscape = width >= height;
  const cols = landscape ? 4 : 6, tileW = Math.round(width / 4), tileH = Math.round(height / 4);
  const sheet = tile(plan.sheet.map((frame) => areaResize(frames.get(frame), width, height, tileW, tileH, 4)), cols, tileW, tileH, 8);
  save(path.join(sheetDir, "contact.png"), sheet.width, sheet.height, sheet.pixels, "sheet", { frames: plan.sheet });
  const index = { schemaVersion: 1, path: pathName, round, fps, size: [width, height], files: entries };
  writeFileSync(path.join(stillsDir, "stills.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}
