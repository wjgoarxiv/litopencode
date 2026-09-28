// Pre-flight scan of a stage directory, before any browser starts. It refuses what the capture can
// never make deterministic or offline: external URLs and preconnect hints (exit 19), forbidden
// elements and APIs, flipbooks and animated rasters, and a raster budget overrun (exit 17). The same
// rules also run live in the page (clock.js); this scan names the file and line first.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

export const STAGE_CONTRACT = 17;
export const STAGE_NETWORK = 19;
export const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const textExtensions = new Set([".html", ".htm", ".js", ".mjs", ".css", ".svg", ".json"]);
export const contentTypes = Object.freeze({
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".wav": "audio/wav", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".json": "application/json"
});
export const rasterLimits = Object.freeze({ files: 24, bytes: 8 * 1024 * 1024, sameSizeFlipbook: 10 });
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
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), animated };
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

// Throws a StageError for the first violation; returns the raster list for pre-decoding.
export function scanStage(stageDir) {
  const files = listStage(stageDir);
  if (!files.includes("index.html")) throw contract("stage/index.html is missing");
  const rasters = [];
  let rasterBytes = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    const full = path.join(stageDir, rel);
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
  return { files, rasters };
}

// One hash over every stage file's name and bytes: a render records it, the done check compares it.
export function stageSha(stageDir) {
  const hash = createHash("sha256");
  for (const rel of listStage(stageDir)) { hash.update(rel); hash.update(readFileSync(path.join(stageDir, rel))); }
  return hash.digest("hex");
}
