// Pre-flight scan of a stage directory, before any browser starts. It refuses what the capture can
// never make deterministic or offline: external URLs and preconnect hints (exit 19), forbidden
// elements and APIs, flipbooks and animated rasters, and a raster budget overrun (exit 17). The same
// rules also run live in the page (clock.js); this scan names the file and line first.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { decodePng } from "../png.mjs";

export const STAGE_CONTRACT = 17;
export const STAGE_NETWORK = 19;
export const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const textExtensions = new Set([".html", ".htm", ".js", ".mjs", ".css", ".svg", ".json"]);
export const contentTypes = Object.freeze({
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".wav": "audio/wav", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".json": "application/json"
});
// The Blender plate (stage/plate/, and the preview stills in stage/plate-preview/): frames the runner wrote
// and plate.json lists by name and size. They are not page rasters. Returns { ...plate.json, dir } when every
// listed frame is there as listed, else null.
export function readPlate(stageDir, sub = "plate") {
  const file = path.join(stageDir, sub, "plate.json");
  if (!existsSync(file)) return null;
  let plate;
  try { plate = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!Array.isArray(plate.frames)) return null;
  const listed = plate.frames.every((f) => {
    const full = path.join(stageDir, sub, String(f.name));
    return path.basename(String(f.name)) === f.name && existsSync(full) && statSync(full).size === f.bytes;
  });
  return listed ? { ...plate, dir: sub } : null;
}

export const rasterLimits = Object.freeze({ files: 24, bytes: 8 * 1024 * 1024, sameSizeFlipbook: 10 });
// Keyed overlay clips: frame folders that stage/clips/clips.json declares are held to these caps instead of
// rasterLimits. A clip is a sticker on the film, never the film: 8-bit RGBA PNG frames with real
// transparency, at most `side` px on the long side, at most `fps` frames a second.
export const clipLimits = Object.freeze({ clips: 12, framesPerClip: 360, framesTotal: 1500, bytesPerClip: 40 * 1024 * 1024, bytesTotal: 128 * 1024 * 1024, side: 720, fps: 30 });
export const clipsDir = "clips";
// XML namespace identifiers are names, not requests.
const namespaceUris = /https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace|2000\/xmlns\/?|1998\/Math\/MathML)/gu;

export class StageError extends Error {
  constructor(code, name, detail) { super(`${name} (${code}): ${detail}`); this.exitCode = code; this.stageName = name; }
}
const contract = (detail) => new StageError(STAGE_CONTRACT, "STAGE_CONTRACT_ERROR", detail);
const network = (detail) => new StageError(STAGE_NETWORK, "STAGE_NETWORK_REQUEST", detail);

export function listStage(stageDir) {
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(stageDir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(stageDir, next);
      if (lstatSync(full).isSymbolicLink()) {
        const target = realpathSync(full);
        if (!insideDir(realpathSync(stageDir), target)) throw contract(`${next} is a symlink that leaves the stage directory`);
      }
      if (entry.isDirectory()) walk(next); else files.push(next);
    }
  };
  walk("");
  return files.sort();
}

export function insideDir(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// Width and height from a raster header, plus whether it animates.
export function rasterInfo(bytes, ext) {
  if (ext === ".png") {
    if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
    let offset = 8, animated = false;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL") animated = true;
      if (type === "IDAT" || type === "IEND") break;
      offset += 12 + length;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), animated, bitDepth: bytes[24], colorType: bytes[25] };
  }
  if (ext === ".gif") {
    const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
    let offset = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), images = 0;
    const skipBlocks = () => { while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1; offset += 1; };
    while (offset < bytes.length) {
      const marker = bytes[offset];
      if (marker === 0x3b) break;
      if (marker === 0x21) { offset += 2; skipBlocks(); continue; }
      if (marker === 0x2c) {
        images += 1;
        const flags = bytes[offset + 9];
        offset += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0) + 1;
        skipBlocks();
        continue;
      }
      break;
    }
    return { width, height, animated: images > 1 };
  }
  if (ext === ".webp") {
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
    let offset = 12, width = 0, height = 0, animated = false;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), data = offset + 8;
      if (type === "ANIM" || type === "ANMF") animated = true;
      if (type === "VP8X") { animated ||= Boolean(bytes[data] & 0x02); width = 1 + bytes.readUIntLE(data + 4, 3); height = 1 + bytes.readUIntLE(data + 7, 3); }
      else if (type === "VP8 " && !width) { width = bytes.readUInt16LE(data + 6) & 0x3fff; height = bytes.readUInt16LE(data + 8) & 0x3fff; }
      else if (type === "VP8L" && !width) { const b = bytes.readUInt32LE(data + 1); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
      offset = data + size + (size & 1);
    }
    return { width, height, animated };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), animated: false };
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    return null;
  }
  return null;
}

// ---- declared clips: stage/clips/clips.json and the frame folders it names ----
const clipFrame = (n) => `frame_${String(n).padStart(4, "0")}.png`;
const clipId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/u;
const clipFolder = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

// The clips stage/clips/clips.json declares ([] without the file), checked for shape only. Throws exit 17.
export function declaredClips(stageDir, limits = clipLimits) {
  const file = path.join(stageDir, clipsDir, "clips.json");
  if (!existsSync(file)) return [];
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw contract(`${clipsDir}/clips.json is not valid JSON (${error.message})`); }
  if (!doc || !Array.isArray(doc.clips)) throw contract(`${clipsDir}/clips.json needs { "clips": [ { "id", "dir", "count", "fps" } ] }`);
  if (doc.clips.length > limits.clips) throw contract(`${doc.clips.length} clips declared (at most ${limits.clips} clips)`);
  const ids = new Set();
  const dirs = new Set();
  return doc.clips.map((entry, n) => {
    const at = `${clipsDir}/clips.json clip #${n + 1}`;
    if (!entry || typeof entry !== "object") throw contract(`${at} is not an object`);
    if (typeof entry.id !== "string" || !clipId.test(entry.id)) throw contract(`${at}: id must be a plain token of letters, digits, - and _ (got ${JSON.stringify(entry.id)})`);
    if (ids.has(entry.id)) throw contract(`${at}: duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.dir !== "string" || !clipFolder.test(entry.dir) || entry.dir.includes("..")) throw contract(`clip "${entry.id}": dir must be a folder name directly under ${clipsDir}/ (got ${JSON.stringify(entry.dir)})`);
    if (dirs.has(entry.dir)) throw contract(`clip "${entry.id}": dir ${entry.dir} is already declared by another clip`);
    dirs.add(entry.dir);
    if (!Number.isInteger(entry.count) || entry.count < 1) throw contract(`clip "${entry.id}": count must be a whole number of frames (got ${JSON.stringify(entry.count)})`);
    if (!Number.isInteger(entry.fps) || entry.fps < 1 || entry.fps > limits.fps) throw contract(`clip "${entry.id}": fps must be a whole number from 1 to ${limits.fps} (got ${JSON.stringify(entry.fps)})`);
    return { id: entry.id, dir: entry.dir, count: entry.count, fps: entry.fps };
  });
}

// Checks every declared clip against its bytes: exactly frame_0001.png..frame_<count>.png in clips/<dir>/,
// each an 8-bit still RGBA PNG of one size within the overlay cap, real transparency in the first, middle
// and last frame, and the per-clip and total caps. Returns [{ id, dir, count, fps, width, height, bytes,
// frames }], `frames` being stage-relative paths.
export function scanClips(stageDir, { limits = clipLimits, files = listStage(stageDir) } = {}) {
  let totalFrames = 0;
  let totalBytes = 0;
  const clips = declaredClips(stageDir, limits).map((declared) => {
    const prefix = `${clipsDir}/${declared.dir}/`;
    if (declared.count > limits.framesPerClip) throw contract(`clip "${declared.id}": ${declared.count} frames (at most ${limits.framesPerClip} per clip)`);
    const have = new Set(files.filter((rel) => rel.startsWith(prefix) && rasterExtensions.has(path.extname(rel).toLowerCase())).map((rel) => rel.slice(prefix.length)));
    const frames = [];
    for (let n = 1; n <= declared.count; n++) {
      if (!have.has(clipFrame(n))) throw contract(`clip "${declared.id}": ${prefix}${clipFrame(n)} is missing (declared ${declared.count} frames, named frame_0001.png onward)`);
      frames.push(`${prefix}${clipFrame(n)}`);
    }
    if (have.size !== declared.count) {
      const stray = [...have].find((name) => !frames.includes(`${prefix}${name}`));
      throw contract(`clip "${declared.id}": ${prefix}${stray} is not one of the ${declared.count} declared frames; raise count or remove it`);
    }
    let size = null;
    let bytes = 0;
    for (const rel of frames) {
      const data = readFileSync(path.join(stageDir, rel));
      bytes += data.length;
      const info = path.extname(rel).toLowerCase() === ".png" && data.length > 33 ? rasterInfo(data, ".png") : null;
      if (!info) throw contract(`clip "${declared.id}": ${rel} is not a readable PNG`);
      if (info.animated) throw contract(`clip "${declared.id}": ${rel} is an animated image; a clip is a folder of still frames`);
      if (info.colorType !== 6 || info.bitDepth !== 8) throw contract(`clip "${declared.id}": ${rel} must be an 8-bit RGBA PNG with an alpha channel (a keyed frame), not an opaque image`);
      if (Math.max(info.width, info.height) > limits.side) throw contract(`clip "${declared.id}": ${rel} is ${info.width}x${info.height}; a clip is an overlay of at most ${limits.side} px on the long side`);
      if (size && (size.width !== info.width || size.height !== info.height)) throw contract(`clip "${declared.id}": ${rel} is ${info.width}x${info.height} but frame_0001.png is ${size.width}x${size.height}; one size per clip`);
      size = { width: info.width, height: info.height };
    }
    if (bytes > limits.bytesPerClip) throw contract(`clip "${declared.id}": ${(bytes / 1048576).toFixed(1)} MB (at most ${(limits.bytesPerClip / 1048576).toFixed(0)} MB per clip)`);
    for (const rel of [frames[0], frames[Math.floor((frames.length - 1) / 2)], frames.at(-1)]) {
      let pixels;
      try { ({ pixels } = decodePng(readFileSync(path.join(stageDir, rel)))); } catch (error) { throw contract(`clip "${declared.id}": ${rel} cannot be decoded (${error.message}); use a non-interlaced 8-bit RGBA PNG`); }
      let transparent = false;
      for (let i = 3; i < pixels.length && !transparent; i += 4) transparent = pixels[i] < 255;
      if (!transparent) throw contract(`clip "${declared.id}": ${rel} has no transparent pixel; a clip is keyed, not a full-frame video`);
    }
    totalFrames += declared.count;
    totalBytes += bytes;
    return { ...declared, ...size, bytes, frames };
  });
  if (totalFrames > limits.framesTotal) throw contract(`${totalFrames} clip frames in all (at most ${limits.framesTotal})`);
  if (totalBytes > limits.bytesTotal) throw contract(`${(totalBytes / 1048576).toFixed(1)} MB of clip frames in all (at most ${(limits.bytesTotal / 1048576).toFixed(0)} MB)`);
  return clips;
}

// window.LitClips for LitStage.clip: id -> { src, count, fps, width, height }, written from clips.json and
// the first frame's header. null when the stage declares no clips (or one the scan would refuse).
export function clipsScript(stageDir) {
  let table;
  try {
    table = Object.fromEntries(declaredClips(stageDir).map((clip) => {
      const first = path.join(stageDir, clipsDir, clip.dir, clipFrame(1));
      const info = rasterInfo(readFileSync(first), ".png");
      return [clip.id, { src: `${clipsDir}/${clip.dir}`, count: clip.count, fps: clip.fps, width: info.width, height: info.height }];
    }));
  } catch { return null; }
  return Object.keys(table).length ? `window.LitClips = ${JSON.stringify(table)};\n` : null;
}

// Throws a StageError for the first violation; returns the raster list for pre-decoding and the declared
// clips, whose frames are not page rasters. `clips: false` (a cover page) ignores clips.json, so a clip
// folder there is held to the raster limits.
export function scanStage(stageDir, { clips: allowClips = true } = {}) {
  const files = listStage(stageDir);
  if (!files.includes("index.html")) throw contract("stage/index.html is missing");
  const clips = allowClips ? scanClips(stageDir, { files }) : [];
  const clipped = new Set(clips.flatMap((clip) => clip.frames));
  const rasters = [];
  let rasterBytes = 0;
  const plates = ["plate", "plate-preview"].map((sub) => readPlate(stageDir, sub)).filter(Boolean);
  const plated = new Set(plates.flatMap((plate) => plate.frames.map((f) => `${plate.dir}/${f.name}`)));
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    const full = path.join(stageDir, rel);
    if (rel === "scene.py" || plated.has(rel) || clipped.has(rel)) continue;
    if (!Object.hasOwn(contentTypes, ext)) throw contract(`${rel}: ${ext || "extensionless"} files are not served on the stage`);
    if (rasterExtensions.has(ext)) {
      const bytes = readFileSync(full);
      const info = rasterInfo(bytes, ext);
      if (!info) throw contract(`${rel} is not a readable ${ext.slice(1)} image`);
      if (info.animated) throw contract(`${rel} is an animated raster; animate on the stage instead`);
      rasters.push({ rel, ...info, bytes: bytes.length });
      rasterBytes += bytes.length;
      continue;
    }
    if (!textExtensions.has(ext)) continue;
    const text = readFileSync(full, "utf8").replace(namespaceUris, "");
    // Comments are not requests: drop block, HTML and line comments before looking for URLs.
    const scripted = [".js", ".mjs", ".html", ".htm"].includes(ext);
    const code = ext === ".json" ? text : text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/<!--[\s\S]*?-->/gu, " ").replace(scripted ? /(^|[\s;{}(,>])\/\/[^\n]*/gu : /$^/u, "$1");
    const external = code.match(/https?:\/\/[^\s"'`)<>]+/u);
    if (external) throw network(`${rel}:${lineOf(code, external.index)} names an external URL (${external[0]})`);
    const protocolRelative = code.match(/(?:\b(?:src|href|action|poster|data|srcset)\s*=\s*["']?|url\(\s*["']?|\bimport\s*(?:\(\s*)?["']|\bfetch\s*\(\s*["'])\/\/[^\s"'/)]/u);
    if (protocolRelative) throw network(`${rel}:${lineOf(code, protocolRelative.index)} names a protocol-relative URL`);
    const hint = code.match(/<link\b[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch|prefetch|prerender)\b/iu);
    if (hint) throw network(`${rel}:${lineOf(code, hint.index)} has a ${hint[0].match(/preconnect|dns-prefetch|prefetch|prerender/iu)[0]} link`);
    const channel = code.match(/\b(?:WebSocket|WebTransport|RTCPeerConnection)\b/u);
    if (channel) throw network(`${rel}:${lineOf(code, channel.index)} uses ${channel[0]}`);
    if (ext === ".html" || ext === ".htm" || ext === ".svg") {
      const element = code.match(/<(video|audio|iframe|object|embed|frame)\b/iu);
      if (element) throw contract(`${rel}:${lineOf(code, element.index)} has a <${element[1].toLowerCase()}> element`);
    }
    const api = code.match(/\bnew\s+Audio\s*\(|\b(?:webkit)?AudioContext\b|\bOfflineAudioContext\b|\bnew\s+(?:Shared)?Worker\s*\(|\bSharedWorker\b|serviceWorker\s*\.\s*register/u);
    if (api) throw contract(`${rel}:${lineOf(code, api.index)} uses ${api[0].trim()}`);
  }
  if (rasters.length > rasterLimits.files) throw contract(`${rasters.length} raster files; the stage allows at most ${rasterLimits.files}`);
  if (rasterBytes > rasterLimits.bytes) throw contract(`${rasterBytes} bytes of rasters; the stage allows at most ${rasterLimits.bytes}`);
  const bySize = new Map();
  for (const raster of rasters) bySize.set(`${raster.width}x${raster.height}`, [...(bySize.get(`${raster.width}x${raster.height}`) ?? []), raster.rel]);
  for (const [size, list] of bySize) if (list.length >= rasterLimits.sameSizeFlipbook) throw contract(`${list.length} rasters share the size ${size} (a flipbook); rasters are textures and stills, never a frame sequence`);
  return { files, rasters, clips };
}

// One hash over every stage file's name and bytes: a render records it, the done check compares it.
export function stageSha(stageDir) {
  const hash = createHash("sha256");
  for (const rel of listStage(stageDir)) { hash.update(rel); hash.update(readFileSync(path.join(stageDir, rel))); }
  return hash.digest("hex");
}
