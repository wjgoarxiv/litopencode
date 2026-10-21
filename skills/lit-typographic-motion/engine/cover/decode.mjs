// Decode an encoded cover the way a README reader's browser shows it, frame by frame, with each
// frame's display time. The gate reads only this: a lossy animation encoder skips pixels that change
// by less than a few levels, and those skips exist in the file, never in the PNG frames it was fed.
//
// Animated WebP: the RIFF container is read here (canvas, loop count, and every ANMF rectangle with
// its duration, blend and dispose bits); each frame's own bitstream is wrapped as a still WebP and
// decoded by `dwebp` from libwebp (it ships beside img2webp); the stills are composited on a
// transparent canvas as libwebp's animation decoder does. GIF (the gifski fallback): ffmpeg decodes
// the frames and the container gives the delays and the loop count.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { which } from "../browser.mjs";

const u24 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);

/** The WebP container: { width, height, loop, frames: [{ x, y, w, h, durationMs, blend, dispose, payload }] }. */
export function readWebpContainer(bytes) {
  if (bytes.length < 20 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const info = { width: 0, height: 0, loop: null, frames: [] };
  const end = Math.min(bytes.length, 8 + bytes.readUInt32LE(4));
  for (let at = 12; at + 8 <= end;) {
    const kind = bytes.toString("latin1", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + size);
    if (kind === "VP8X") {
      info.width = 1 + u24(body, 4);
      info.height = 1 + u24(body, 7);
    } else if (kind === "ANIM") {
      info.loop = body.readUInt16LE(4);
    } else if (kind === "ANMF") {
      info.frames.push({ x: 2 * u24(body, 0), y: 2 * u24(body, 3), w: 1 + u24(body, 6), h: 1 + u24(body, 9), durationMs: u24(body, 12), blend: (body[15] & 2) === 0, dispose: (body[15] & 1) === 1, payload: body.subarray(16) });
    } else if ((kind === "VP8 " || kind === "VP8L") && info.frames.length === 0) {
      info.frames.push({ x: 0, y: 0, w: 0, h: 0, durationMs: 0, blend: false, dispose: false, still: bytes.subarray(at, at + 8 + size + (size & 1)) });
    }
    at += 8 + size + (size & 1);
  }
  if (info.loop === null && info.frames.length === 1) info.loop = 0;
  return info;
}

// One ANMF payload (an optional ALPH chunk, then VP8 or VP8L) as a standalone still WebP.
function stillWebp(frame) {
  if (frame.still) return withRiffSize(Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "latin1"), frame.still]));
  const alpha = frame.payload.toString("latin1", 0, 4) === "ALPH";
  const parts = [];
  if (alpha) {
    const vp8x = Buffer.alloc(18);
    vp8x.write("VP8X", 0, "latin1");
    vp8x.writeUInt32LE(10, 4);
    vp8x[8] = 0x10;
    vp8x.writeUIntLE(frame.w - 1, 12, 3);
    vp8x.writeUIntLE(frame.h - 1, 15, 3);
    parts.push(vp8x);
  }
  parts.push(frame.payload);
  return withRiffSize(Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "latin1"), ...parts]));
}
function withRiffSize(buffer) {
  buffer.writeUInt32LE(buffer.length - 8, 4);
  return buffer;
}

/** A PAM (P7) image as dwebp writes it: { width, height, rgba }. */
export function readPam(buffer) {
  const end = buffer.indexOf("ENDHDR\n");
  if (buffer.toString("latin1", 0, 2) !== "P7" || end < 0) throw new Error("not a PAM image");
  const header = buffer.toString("latin1", 0, end);
  const field = (name) => Number(header.match(new RegExp(`${name} (\\d+)`, "u"))?.[1]);
  const width = field("WIDTH"), height = field("HEIGHT"), depth = field("DEPTH");
  const data = buffer.subarray(end + 7);
  if (depth === 4) return { width, height, rgba: data };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = data[i * depth + Math.min(c, depth - 1)];
  return { width, height, rgba };
}

// Draw a decoded rectangle onto the canvas: replace, or alpha-blend without premultiplication.
function composite(canvas, canvasWidth, frame, rgba) {
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const s = (y * frame.w + x) * 4, d = ((frame.y + y) * canvasWidth + frame.x + x) * 4;
      const sa = rgba[s + 3];
      if (!frame.blend || sa === 255) {
        canvas[d] = rgba[s]; canvas[d + 1] = rgba[s + 1]; canvas[d + 2] = rgba[s + 2]; canvas[d + 3] = sa;
        continue;
      }
      if (sa === 0) continue;
      const below = (canvas[d + 3] * (255 - sa)) / 255;
      const alpha = sa + below;
      for (let c = 0; c < 3; c++) canvas[d + c] = Math.round((rgba[s + c] * sa + canvas[d + c] * below) / alpha);
      canvas[d + 3] = Math.round(alpha);
    }
  }
}

function clearRect(canvas, canvasWidth, frame) {
  for (let y = frame.y; y < frame.y + frame.h; y++) canvas.fill(0, (y * canvasWidth + frame.x) * 4, (y * canvasWidth + frame.x + frame.w) * 4);
}

/** The GIF container: per-frame delays in ms, the loop count and the size. */
export function readGifContainer(bytes) {
  if (bytes.toString("latin1", 0, 3) !== "GIF") throw new Error("not a GIF file");
  const delays = [];
  let loop = null, delay = 100;
  let at = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
  const skipBlocks = () => { while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1; at += 1; };
  while (at < bytes.length) {
    const marker = bytes[at];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[at + 1];
      if (label === 0xf9) delay = 10 * bytes.readUInt16LE(at + 4);
      if (label === 0xff && bytes.toString("latin1", at + 3, at + 14) === "NETSCAPE2.0") loop = bytes.readUInt16LE(at + 16);
      at += 2;
      skipBlocks();
    } else if (marker === 0x2c) {
      const flags = bytes[at + 9];
      at += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0) + 1;
      skipBlocks();
      delays.push(delay > 0 ? delay : 100);
      delay = 100;
    } else break;
  }
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), loop, delays };
}

/**
 * Decode every frame of `file` (.webp or .gif). `onFrame(index, rgba, durationMs, width, height)`
 * sees the composited canvas, which is reused between calls: copy what you keep. Returns
 * { format, width, height, loop, durations, bytes }.
 */
export function decodeCover(file, { env = process.env, onFrame = () => {} } = {}) {
  const bytes = readFileSync(file);
  if (file.toLowerCase().endsWith(".gif")) {
    const info = readGifContainer(bytes);
    const ffmpeg = which("ffmpeg", env);
    if (!ffmpeg) throw new Error("ffmpeg is needed to decode a GIF cover");
    const raw = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 2 ** 31 });
    if (raw.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${String(raw.stderr).trim().split(/\r?\n/u)[0]}`);
    const size = info.width * info.height * 4;
    const count = Math.min(info.delays.length, Math.floor(raw.stdout.length / size));
    for (let i = 0; i < count; i++) onFrame(i, raw.stdout.subarray(i * size, (i + 1) * size), info.delays[i], info.width, info.height);
    return { format: "gif", width: info.width, height: info.height, loop: info.loop, durations: info.delays.slice(0, count), bytes: bytes.length };
  }
  const dwebp = which("dwebp", env);
  if (!dwebp) throw new Error("dwebp not found (libwebp ships it beside img2webp); install libwebp");
  const info = readWebpContainer(bytes);
  if (!info.frames.length) throw new Error(`${file} holds no frame`);
  const work = mkdtempSync(path.join(os.tmpdir(), "ltm-webp-"));
  try {
    let width = info.width, height = info.height, canvas = null, previous = null;
    const durations = [];
    info.frames.forEach((frame, i) => {
      const source = path.join(work, "frame.webp"), target = path.join(work, "frame.pam");
      writeFileSync(source, stillWebp(frame));
      const run = spawnSync(dwebp, [source, "-pam", "-quiet", "-o", target], { encoding: "utf8" });
      if (run.status !== 0) throw new Error(`dwebp failed on frame ${i}: ${(run.stderr || run.error?.message || "").trim().split(/\r?\n/u)[0]}`);
      const decoded = readPam(readFileSync(target));
      if (frame.still) { width = decoded.width; height = decoded.height; frame.w = width; frame.h = height; }
      canvas ??= Buffer.alloc(width * height * 4);
      if (previous?.dispose) clearRect(canvas, width, previous);
      composite(canvas, width, frame, decoded.rgba);
      durations.push(frame.durationMs);
      onFrame(i, canvas, frame.durationMs, width, height);
      previous = frame;
    });
    return { format: "webp", width, height, loop: info.loop, durations, bytes: bytes.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
