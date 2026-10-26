// `render.mjs cover`: one cover round. Treatment (exit 16) -> static scan of cover/ (17, 19) -> the
// asset list (22 before any capture) -> pre-warm, Chrome and the encoder (10, 14, 15, 21) -> the
// master browser seeks t = i / N for every frame at 2x, then the title-mask pass -> a fresh browser
// repeats every frame (G0) -> another fresh browser draws a seeded shuffle of 16 frames, which must
// match the master within the rasterizer's one-level rounding (18 otherwise: the page keeps state)
// -> flash audit of the frames as a loop -> img2webp (frame 0 and the frames before the seam at a
// higher quality), or gifski when libwebp is missing -> the gate on the DECODED file, with G6 and the
// frame-0 art check -> stills from the decoded file (twelve frames, poster, seam pair, sheet) ->
// manifest and report. Exit 13 until every gate reaches TARGET; a flash failure withholds the cover.
// `--window t0,t1` captures and sheets only the frames around a logged defect and never counts as done.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { COVER, EXIT } from "../constants.mjs";
import { findChrome, loadPlaywright, which } from "../browser.mjs";
import { ExcursionDetector, auditCells, countFlashes, flashGeometryFor } from "../flash.mjs";
import { encodePng } from "../png.mjs";
import { scanStage, stageSha } from "../stage/scan.mjs";
import { inspectWarmState, pins, skillRoot } from "../../runtime.mjs";
import { artCheck, checkAssets } from "./assets.mjs";
import { CoverPool, capturePass, coverFonts, openCover } from "./capture.mjs";
import { coverGate, formatCoverReport, framesIn, readRgba, verdicts } from "./gate.mjs";
import { lumaGrid, meanLumaStep } from "./image.mjs";
import { composeSheet } from "./sheet.mjs";
import { loadCoverTreatment } from "./treatment.mjs";

export const SHEET_TILES = 12;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stop = (code, name, detail) => Object.assign(new Error(`${name} (${code}): ${detail}`), { exitCode: code });
const pad4 = (n) => String(n).padStart(4, "0");

/** How long img2webp shows each frame: whole milliseconds. */
export const frameMs = (fps) => Math.round(1000 / fps);
/** Frame i of N shows loop time t = i / N; t = 1 is never drawn (it would repeat frame 0 at the seam). */
export const loopTimes = (frames) => Array.from({ length: frames }, (_, i) => [i, i / frames]);

/** The encoder this host offers a cover: img2webp (decoded with dwebp), else gifski (decoded with ffmpeg), else none. */
export function coverEncoder(env = process.env) {
  if (which("img2webp", env) && which("dwebp", env)) return { name: "img2webp", decoder: "dwebp" };
  if (which("gifski", env) && which("ffmpeg", env)) return { name: "gifski", decoder: "ffmpeg" };
  return { name: "none", fix: "install libwebp (img2webp and dwebp), or gifski with ffmpeg; a cover is never an MP4" };
}

/** img2webp arguments: lossy, loop forever, every frame `-d` ms, frame 0 and the last `edgeFrames` at `edgeQ`. */
export function img2webpArgs({ files, fps, encode, out }) {
  const args = ["-loop", "0", "-lossy", "-q", String(encode.q), "-m", String(encode.method)];
  files.forEach((file, i) => args.push("-d", String(frameMs(fps)), "-q", String(i === 0 || i >= files.length - encode.edgeFrames ? encode.edgeQ : encode.q), file));
  return [...args, "-o", out];
}

/** Encode the frames into `<out>/cover.webp` (or cover.gif); returns { file, encoder }. */
export function encodeCover({ files, fps, encode, out, env = process.env }) {
  const encoder = coverEncoder(env);
  if (encoder.name === "none") throw stop(EXIT.BLOCKED_NO_COVER_ENCODER, "BLOCKED_NO_COVER_ENCODER", `no cover encoder on PATH; fix: ${encoder.fix}`);
  const file = path.join(out, encoder.name === "img2webp" ? "cover.webp" : "cover.gif");
  const args = encoder.name === "img2webp" ? img2webpArgs({ files, fps, encode, out: file }) : ["--fps", String(fps), "--quality", "90", "--repeat", "0", "-o", file, ...files];
  const run = spawnSync(which(encoder.name, env), args, { encoding: "utf8", timeout: 1_200_000, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`${encoder.name} failed: ${(run.stderr || run.error?.message || "").trim().split(/\r?\n/u).at(-1)}`);
  return { file, encoder: encoder.name };
}

/** A seeded shuffle (mulberry32, as the loop kit) of `count` distinct frame indices. */
export function seekOrder(frames, seed, count = COVER.seekFrames) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: frames }, (_, i) => i);
  for (let i = frames - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, Math.min(count, frames));
}

/** The largest per-channel difference between two same-size frames on disk. */
export function maxLevelDiff(fileA, fileB) {
  const a = readRgba(fileA), b = readRgba(fileB);
  if (a.width !== b.width || a.height !== b.height) return 255;
  let worst = 0;
  for (let i = 0; i < a.rgba.length; i++) worst = Math.max(worst, Math.abs(a.rgba[i] - b.rgba[i]));
  return worst;
}

/** The film gate's flash detector (WCAG 2.3.1) over the cover frames as a loop. */
export function flashAudit(files, fps) {
  const first = readRgba(files[0]);
  const geometry = flashGeometryFor(first.width, first.height);
  const detector = new ExcursionDetector(geometry);
  const records = [];
  for (let i = 0; i < files.length + fps; i++) {
    const frame = i === 0 ? first : readRgba(files[i % files.length]);
    const record = detector.push(auditCells(frame.rgba, frame.width, frame.height, geometry));
    if (i < files.length) records.push(record);
    else for (const key of ["up", "down", "redUp", "redDown"]) records[i % files.length][key] ||= record[key];
  }
  return countFlashes(records, fps, true);
}

// Everything a cover round checks before a browser starts.
function prepare(out) {
  const cover = loadCoverTreatment(out);
  const coverDir = path.join(out, "cover");
  if (!existsSync(path.join(coverDir, "index.html"))) throw stop(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR", `no cover page at ${path.join(coverDir, "index.html")}; write it first (references/cover.md)`);
  const scan = scanStage(coverDir);
  const assets = checkAssets({ out, treatment: cover, rasters: scan.rasters });
  const state = inspectWarmState();
  if (state.blocked) throw stop(state.blocked.exit, state.blocked.name, `${state.blocked.detail}; fix: ${state.fix}`);
  const chrome = findChrome();
  if (!chrome.path) throw stop(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", `${chrome.missing}; fix: install Chrome or set CHROME_PATH`);
  return { cover, coverDir, assets, state, chromePath: chrome.path, fonts: coverFonts(skillRoot, state, pins), rung: cover.recipe === "hero-3d" ? "gpu" : "swiftshader", notices: [] };
}

// One browser for one pass; the profile lives under .run/cover/ and goes with the pass. The 3D hero asks
// for the GPU rung. When a browser cannot start or draw there, every pass of the round takes the
// software rung (the passes must share one) and the report says so; a page that breaks the
// determinism or network rules is not retried, it would break the same way.
async function withBrowser(chromium, context, profile, body) {
  const open = async () => {
    rmSync(profile, { recursive: true, force: true });
    mkdirSync(profile, { recursive: true });
    return openCover(chromium, { chromePath: context.chromePath, profile, coverDir: context.coverDir, page: context.cover.page, scale: COVER.captureScale, fonts: context.fonts, rung: context.rung });
  };
  let browser;
  try { browser = await open(); }
  catch (error) {
    if (context.rung !== "gpu" || [EXIT.STAGE_NETWORK_REQUEST, EXIT.STAGE_NONDETERMINISTIC].includes(error.exitCode)) throw error;
    context.notices.push(`the 3D hero asked for the GPU rung and it failed there (${String(error.message).slice(0, 120)}); rendered on the software rung (SwiftShader), slower, same frames`);
    context.rung = "swiftshader";
    browser = await open();
  }
  try { return await body(browser); } finally { await browser.close(); rmSync(profile, { recursive: true, force: true }); }
}

/** The decoded frame on show `ms` into the loop. */
export function frameAt(durations, ms) {
  let end = 0;
  for (let i = 0; i < durations.length; i++) { end += durations[i]; if (ms < end) return i; }
  return durations.length - 1;
}

// The stills of a finished cover, taken from the decoded file, and their index stills/stills.json.
function writeCoverStills(out, { round, gate, cover }) {
  const dir = path.join(out, "stills");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { width, height, durations, kept } = gate;
  const total = durations.reduce((a, b) => a + b, 0);
  const files = [];
  const save = (name, w, h, pixels, kind, extra) => {
    const bytes = encodePng(w, h, pixels, 4, 6);
    writeFileSync(path.join(dir, name), bytes);
    files.push({ file: `stills/${name}`, kind, sha256: sha256(bytes), ...extra });
  };
  const tiles = [];
  for (let k = 0; k < SHEET_TILES; k++) {
    const at = k / SHEET_TILES, index = frameAt(durations, at * total);
    save(`frame-${String(k).padStart(2, "0")}.png`, width, height, kept.get(index), "frame", { t: Number((at * total / 1000).toFixed(3)), decodedFrame: index });
    tiles.push({ rgba: kept.get(index), width, height, at });
  }
  const last = durations.length - 1;
  save("poster.png", width, height, kept.get(0), "poster", { decodedFrame: 0 });
  const pair = Buffer.alloc(width * 2 * height * 4);
  for (let y = 0; y < height; y++) {
    kept.get(last).copy(pair, y * width * 8, y * width * 4, (y + 1) * width * 4);
    kept.get(0).copy(pair, y * width * 8 + width * 4, y * width * 4, (y + 1) * width * 4);
  }
  save("seam.png", width * 2, height, pair, "seam", { decodedFrames: [last, 0] });
  const sheet = composeSheet({ tiles, steps: gate.steps, medianD: gate.medianD });
  save("sheet.png", sheet.width, sheet.height, sheet.pixels, "sheet", { tiles: tiles.map((tile) => Number(tile.at.toFixed(4))) });
  const index = { schemaVersion: 1, path: "cover", mode: "cover", round, size: [width, height], fps: cover.fps, durationSec: total / 1000, files, gate: { pass: gate.pass, target: gate.target } };
  writeFileSync(path.join(dir, "stills.json"), JSON.stringify(index, null, 2) + "\n");
  return { index, sha256: sha256(readFileSync(path.join(dir, "stills.json"))) };
}

// Moves the previous round's cover files aside, so a new round never mixes with them.
function clearCoverExports(out, runDir) {
  const previous = path.join(runDir, "previous-round");
  rmSync(previous, { recursive: true, force: true });
  for (const name of ["cover.webp", "cover.gif", "poster.png", "gate-report.txt", "manifest.json"]) {
    for (const source of [path.join(out, name), path.join(out, "withheld", name)]) {
      if (!existsSync(source)) continue;
      mkdirSync(previous, { recursive: true });
      renameSync(source, path.join(previous, `${path.basename(path.dirname(source))}-${name}`));
    }
  }
  rmSync(path.join(out, "withheld"), { recursive: true, force: true });
}

/** One full cover round. Returns { code, report, manifest }: 0 at TARGET, 13 otherwise. */
export async function renderCover(out, { round = 1, log = () => {} } = {}) {
  const context = prepare(out);
  const { cover } = context;
  const encoder = coverEncoder();
  if (encoder.name === "none") throw stop(EXIT.BLOCKED_NO_COVER_ENCODER, "BLOCKED_NO_COVER_ENCODER", `no cover encoder on PATH; fix: ${encoder.fix}`);
  const runDir = path.join(out, ".run");
  const work = path.join(runDir, "cover");
  rmSync(work, { recursive: true, force: true });
  const dirs = { frames: path.join(work, "frames"), masks: path.join(work, "masks"), replay: path.join(work, "replay"), seek: path.join(work, "seek") };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const times = loopTimes(cover.frames);
  const size = cover.size;
  const expected = `${cover.page[0] * COVER.captureScale}x${cover.page[1] * COVER.captureScale}`;
  const order = seekOrder(times.length, cover.seed);
  const chromium = await loadPlaywright(context.state.nodeDir);
  const pool = new CoverPool();
  const began = performance.now();
  let master, replay, sought;
  try {
    await withBrowser(chromium, context, path.join(work, "cm"), async (browser) => {
      log(`cover: master pass, ${times.length} frames at ${expected}`);
      master = await capturePass({ browser, pool, times, dir: dirs.frames, size, expected });
      await capturePass({ browser, pool, times, dir: dirs.masks, prefix: "m", mask: true, size, expected });
    });
    log("cover: replay pass in a fresh browser");
    replay = await withBrowser(chromium, context, path.join(work, "cr"), (browser) => capturePass({ browser, pool, times, dir: dirs.replay, size, expected }));
    log(`cover: seek-order pass, ${order.length} frames`);
    sought = await withBrowser(chromium, context, path.join(work, "cs"), (browser) => capturePass({ browser, pool, times: order.map((i) => times[i]), dir: dirs.seek, prefix: "s", size, expected }));
  } finally {
    await pool.close();
  }
  const captureSec = (performance.now() - began) / 1000;
  const ms = frameMs(cover.fps);
  const differing = times.filter(([i]) => master.get(i) !== replay.get(i));
  if (differing.length) throw stop(EXIT.STAGE_NONDETERMINISTIC, "STAGE_NONDETERMINISTIC", `a fresh capture differs at ${differing.slice(0, 4).map(([i, t]) => `frame ${i} (t = ${t.toFixed(4)})`).join(", ")}${differing.length > 4 ? ` and ${differing.length - 4} more` : ""}; draw every pixel from t and LitLoop.rng(seed)`);
  // An element whose opacity and transform change together can rasterize one level apart depending
  // on what was painted before it; state kept between frames differs by far more.
  let oneLevel = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (sought.get(i) === master.get(i)) continue;
    const worst = maxLevelDiff(path.join(dirs.frames, `f${pad4(i)}.png`), path.join(dirs.seek, `s${pad4(i)}.png`));
    if (worst <= COVER.seekLevels) { oneLevel += 1; continue; }
    throw stop(EXIT.STAGE_NONDETERMINISTIC, "STAGE_NONDETERMINISTIC", `frame ${i} (t = ${((i * ms) / 1000).toFixed(3)} s) differs by up to ${worst} levels when sought out of order (a fresh page drew it ${k ? `after frame ${order[k - 1]}` : "first"}); the page keeps state between frames: clear every canvas and draw each frame from t alone`);
  }
  const files = framesIn(dirs.frames, "f");
  const flash = flashAudit(files, cover.fps);
  const runOut = path.join(work, "encoded");
  mkdirSync(runOut, { recursive: true });
  const encoded = encodeCover({ files, fps: cover.fps, encode: cover.encode, out: runOut });
  const planned = times.length * ms;
  const wanted = Array.from({ length: SHEET_TILES }, (_, k) => (k / SHEET_TILES) * planned);
  let elapsed = 0;
  const keep = (i, duration) => {
    const start = elapsed;
    elapsed += duration;
    return i === 0 || start + duration >= planned || wanted.some((x) => x >= start && x < start + duration);
  };
  const painted = cover.title.kind === "painted" ? context.assets.find((asset) => asset.role === "base-art" && asset.title) : null;
  const gate = coverGate(encoded.file, { frames: dirs.frames, replay: dirs.replay, masks: dirs.masks, title: cover.title.box, glyph: { exempt: painted ? `painted into the base art ${painted.path}` : null }, fps: cover.fps, keep });
  gate.gates.SEEK = { pass: true, sampled: order.length, identical: order.length - oneLevel, oneLevel };
  for (const asset of context.assets.filter((entry) => entry.role === "base-art")) {
    let art = null;
    try { art = readRgba(path.join(out, asset.path)); } catch { art = null; }
    const check = art ? artCheck({ frame0: gate.kept.get(0), width: gate.width, height: gate.height, art, box: asset.box, checkBox: asset.checkBox }) : null;
    gate.gates.ART = check ? { pass: check.pass, ssim: check.ssim, checked: check.checked.join(",") } : { pass: false, reason: `${asset.path} is not a PNG the gate can compare with frame 0` };
  }
  gate.gates.FLASH = { pass: flash.pass, general: flash.general, red: flash.red };
  Object.assign(gate, verdicts(gate.gates));
  clearCoverExports(out, runDir);
  const delivered = path.join(out, path.basename(encoded.file));
  renameSync(encoded.file, delivered);
  const stills = writeCoverStills(out, { round, gate, cover });
  writeFileSync(path.join(out, "poster.png"), readFileSync(path.join(out, "stills", "poster.png")));
  const report = `${formatCoverReport(gate, { strict: true })}${context.notices.map((note) => `warning: ${note}\n`).join("")}`;
  writeFileSync(path.join(out, "gate-report.txt"), report);
  const manifest = {
    schemaVersion: 1, mode: "cover", path: "cover", craftRound: round, recipe: cover.recipe,
    page: cover.page, size, scale: COVER.captureScale, rung: context.rung, warnings: context.notices, fps: cover.fps, frames: times.length, frameMs: ms, seed: cover.seed,
    encoder: encoded.encoder, encode: cover.encode, file: path.basename(delivered), bytes: statSync(delivered).size, captureSec: Number(captureSec.toFixed(1)),
    treatmentSha256: sha256(readFileSync(path.join(out, "treatment.json"))), coverSha256: stageSha(context.coverDir), stillsSha256: stills.sha256,
    gate: { pass: gate.pass, target: gate.target, medianD: gate.medianD, movingFrac: gate.movingFrac, longestStillSec: gate.longestStillSec, spike: gate.spike, seamLocal: gate.seamLocal, gates: gate.gates },
    generatedAt: new Date().toISOString()
  };
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!flash.pass) {
    mkdirSync(path.join(out, "withheld"), { recursive: true });
    renameSync(delivered, path.join(out, "withheld", path.basename(delivered)));
    rmSync(path.join(out, "poster.png"), { force: true });
  }
  const failing = Object.entries(gate.gates).filter(([, g]) => g.pass === false).map(([name]) => name);
  const short = Object.entries(gate.gates).filter(([, g]) => g.pass !== false && g.target === false).map(([name]) => name);
  const summary = `cover: ${path.basename(delivered)} ${manifest.bytes} bytes, ${times.length} frames at ${cover.fps} fps, ${size[0]}x${size[1]} from ${expected} captures in ${captureSec.toFixed(0)} s; stills and sheet in ${path.join(out, "stills")}`;
  if (gate.target) return { code: EXIT.OK, report: `${report}${summary}\n`, manifest };
  const why = `GATE_FAIL_QA (13): ${[failing.length ? `${failing.join(", ")} fail` : "", short.length ? `${short.join(", ")} miss the cover TARGET` : ""].filter(Boolean).join("; ")}${flash.pass ? "" : "; the flash audit failed, so the cover is withheld"}`;
  return { code: EXIT.GATE_FAIL_QA, report: `${report}${summary}\n${why}\n`, manifest };
}

/**
 * `--window t0,t1` (seconds into the loop): capture only the frames from t0 - 0.5 s to t1 + 0.5 s
 * (wrapping at the seam) in a fresh page, before encoding, and sheet them with the span shaded. It
 * writes only windows/round-N/<t0>-<t1>/; the stills, the cover, the report and the manifest stay
 * as they were, so a window render never counts as done.
 */
export async function renderCoverWindow(out, { round = 1, window: [t0, t1], log = () => {} } = {}) {
  const context = prepare(out);
  const { cover } = context;
  const ms = frameMs(cover.fps);
  const loopSec = (cover.frames * ms) / 1000;
  if (!(Number.isFinite(t0) && Number.isFinite(t1) && t0 >= 0 && t1 >= t0 && t1 <= loopSec)) throw stop(2, "USAGE", `--window takes t0,t1 in seconds with 0 <= t0 <= t1 <= ${loopSec.toFixed(3)}`);
  const from = t0 - COVER.windowPadSec, to = t1 + COVER.windowPadSec;
  const picks = [];
  for (let i = 0; i < cover.frames; i++) for (const lap of [-1, 0, 1]) {
    const t = (i * ms) / 1000 + lap * loopSec;
    if (t >= from - 1e-9 && t <= to + 1e-9) picks.push({ index: i, t: Number(t.toFixed(3)) });
  }
  picks.sort((a, b) => a.t - b.t);
  const dir = path.join(out, "windows", `round-${round}`, `${t0.toFixed(3)}-${t1.toFixed(3)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const expected = `${cover.page[0] * COVER.captureScale}x${cover.page[1] * COVER.captureScale}`;
  const chromium = await loadPlaywright(context.state.nodeDir);
  const pool = new CoverPool();
  try {
    log(`cover window: ${picks.length} frames from ${from.toFixed(3)} to ${to.toFixed(3)} s`);
    await withBrowser(chromium, context, path.join(out, ".run", "cover-window"), (browser) => capturePass({ browser, pool, times: [...new Set(picks.map((p) => p.index))].map((i) => [i, i / cover.frames]), dir, size: cover.size, expected }));
  } finally {
    await pool.close();
  }
  const frames = picks.map((p) => readRgba(path.join(dir, `f${pad4(p.index)}.png`)));
  const lumas = frames.map((f) => lumaGrid(f.rgba, f.width, f.height).luma);
  const steps = lumas.slice(1).map((l, k) => meanLumaStep(l, lumas[k]));
  const medianD = steps.length ? [...steps].sort((a, b) => a - b)[steps.length >> 1] : 0;
  const count = Math.min(SHEET_TILES, picks.length);
  const tiles = Array.from({ length: count }, (_, k) => Math.round((k * (picks.length - 1)) / Math.max(1, count - 1))).map((j) => ({ ...frames[j], at: (picks[j].t - from) / (to - from) }));
  const sheet = composeSheet({ tiles, steps, medianD, marks: [{ from: (t0 - from) / (to - from), to: (t1 - from) / (to - from) }] });
  writeFileSync(path.join(dir, "sheet.png"), encodePng(sheet.width, sheet.height, sheet.pixels, 4, 6));
  writeFileSync(path.join(dir, "window.json"), JSON.stringify({ schemaVersion: 1, round, t0, t1, padSec: COVER.windowPadSec, frames: picks, tiles: tiles.map((tile) => Number((from + tile.at * (to - from)).toFixed(3))), note: "frames before encoding; a window render never counts as done" }, null, 2) + "\n");
  return { code: EXIT.OK, report: `WINDOW round ${round}: ${picks.length} frames from ${from.toFixed(3)} to ${to.toFixed(3)} s; sheet: ${path.join(dir, "sheet.png")}\na window render never counts as done: fix the cause, then render the full cover\n` };
}
