// `render.mjs stage`: the stage path. The model's page is filmed frame by frame on a virtual clock:
// the master browser steps and captures every frame while a worker pool decodes and audits the last
// ones; a fresh browser replays the clock from 0 to re-capture the determinism samples; and the QA
// replay (qa.mjs) measures the text. The master never changes a style. Every frame and track passes
// through this renderer, then the gate decides what is delivered.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { EXIT } from "../constants.mjs";
import { findChrome, loadPlaywright, which } from "../browser.mjs";
import { ExcursionDetector, auditSequence, flashGeometryFor } from "../flash.mjs";
import { areaResize, decodePng, encodePng } from "../png.mjs";
import { encodeMaster, encodePreview, previewRungs, previewSize, write } from "../encode.mjs";
import { stillsPlan, writeStillsSet } from "../stills.mjs";
import { fnv1a32 } from "../text.mjs";
import { SOUND_EXIT, muxTrack, resolveTrack, soundChecks } from "../sound.mjs";
import { frameSize, keepFirstTreatment, loadTreatment } from "../treatment.mjs";
import { inspectWarmState, pins, skillRoot } from "../../runtime.mjs";
import { previewEncoderRung } from "../../probe.mjs";
import { openStage, stageFonts } from "./capture.mjs";
import { analyseQa, captureQa, qaPageSource } from "./qa.mjs";
import { StageError, scanStage, stageSha } from "./scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (line) => process.stderr.write(`${line}\n`);
const exit = (code, name, detail) => Object.assign(new Error(`${name} (${code}): ${detail}`), { exitCode: code });

// A small ordered worker pool: frames go in as PNG bytes and come back decoded and audited.
class FramePool {
  constructor(size) {
    this.workers = Array.from({ length: size }, () => new Worker(path.join(here, "frame-worker.mjs")));
    this.pending = new Map();
    this.next = 0;
    this.id = 0;
    for (const worker of this.workers) worker.on("message", (message) => {
      const job = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) job.reject(new StageError(17, "STAGE_CONTRACT_ERROR", message.error));
      else job.resolve(message);
    });
  }
  run(png, width, height, preview) {
    const id = this.id++;
    const worker = this.workers[this.next++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, png, width, height, preview }, [png.buffer]);
    });
  }
  async close() { await Promise.all(this.workers.map((worker) => worker.terminate())); }
}

// Sample frames for the determinism replay: frame 0, the last frame and the first frame of every
// beat, spread evenly to at most 16; beat midpoints are added until there are at least 8.
export function determinismSamples(beats, fps, frameCount) {
  const clamp = (f) => Math.max(0, Math.min(frameCount - 1, Math.round(f)));
  let picks = [...new Set([0, frameCount - 1, ...beats.map((beat) => clamp(beat.t0 * fps))])].sort((a, b) => a - b);
  if (picks.length > 16) picks = Array.from({ length: 16 }, (_, i) => picks[Math.round((i * (picks.length - 1)) / 15)]);
  for (const beat of beats) {
    if (picks.length >= 8) break;
    picks.push(clamp(((beat.t0 + beat.t1) / 2) * fps));
    picks = [...new Set(picks)].sort((a, b) => a - b);
  }
  for (let k = 1; picks.length < Math.min(8, frameCount); k++) {
    picks.push(clamp((k * frameCount) / 9));
    picks = [...new Set(picks)].sort((a, b) => a - b);
  }
  return picks;
}

// The first 64x64 tile (in raster order) where two RGBA frames differ.
export function firstDifferingRegion(a, b, width, height, tile = 64) {
  for (let ty = 0; ty < height; ty += tile) for (let tx = 0; tx < width; tx += tile) {
    for (let y = ty; y < Math.min(height, ty + tile); y++) {
      const start = (y * width + tx) * 4, end = (y * width + Math.min(width, tx + tile)) * 4;
      if (Buffer.compare(a.subarray(start, end), b.subarray(start, end)) !== 0) return { x: tx, y: ty, width: Math.min(tile, width - tx), height: Math.min(tile, height - ty) };
    }
  }
  return null;
}

// Poster: PNG at maximum compression; the size steps down until it fits the 1 MB cap.
function posterPng(rgba, width, height) {
  let w = width, h = height, pixels = rgba;
  for (let attempt = 0; attempt < 5; attempt++) {
    const png = encodePng(w, h, pixels, 4, 9, true);
    if (png.length <= 1_000_000 || attempt === 4) return { png, width: w, height: h };
    const nw = Math.round(w * 0.8 / 2) * 2, nh = Math.round(h * 0.8 / 2) * 2;
    pixels = areaResize(rgba, width, height, nw, nh, 4);
    w = nw; h = nh;
  }
  return null;
}

function progress(runDir, fields) {
  writeFileSync(path.join(runDir, "progress.json"), JSON.stringify({ ...fields, updatedAt: new Date().toISOString() }) + "\n");
}

// Everything needed before a browser starts: the treatment, the stage scan, the cache and Chrome.
export function prepareStage(out) {
  const { treatment } = loadTreatment(out);
  if (treatment.path !== "stage") throw exit(16, "BLOCKED_TREATMENT_INVALID", "field path: this treatment takes the type path; render it with `render.mjs film --brief <brief.json> --out <dir>`");
  keepFirstTreatment(out, treatment);
  const stageDir = path.join(out, "stage");
  if (!existsSync(path.join(stageDir, "index.html"))) throw new StageError(17, "STAGE_CONTRACT_ERROR", `no stage page at ${path.join(stageDir, "index.html")}; write it first (references/stage.md)`);
  const scan = scanStage(stageDir);
  const state = inspectWarmState();
  if (state.blocked) throw exit(state.blocked.exit, state.blocked.name, `${state.blocked.detail}; fix: ${state.fix}`);
  const chrome = findChrome();
  if (!chrome.path) throw exit(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", `${chrome.missing}; fix: install Chrome or set CHROME_PATH`);
  const { width, height } = frameSize(treatment);
  const fps = treatment.fps ?? 60;
  const seed = Number.isSafeInteger(treatment.seed) ? treatment.seed >>> 0 : fnv1a32(treatment.request);
  return { treatment, stageDir, scan, state, chromePath: chrome.path, width, height, fps, seed, fonts: stageFonts(skillRoot, state, pins) };
}

// Opens a stage browser, loads the page and checks its contract against the treatment.
async function openChecked(chromium, context, profile, extraInit) {
  const stage = await openStage(chromium, { chromePath: context.chromePath, profile, stageDir: context.stageDir, width: context.width, height: context.height, fps: context.fps, seed: context.seed, fonts: context.fonts, extraInit });
  try {
    const { definition, webgl } = await stage.load(context.scan.rasters.map((raster) => `/${raster.rel}`));
    if (!definition) throw new StageError(17, "STAGE_CONTRACT_ERROR", "the page never called LitStage.define({ width, height, fps, duration, render }) or set window.litStage");
    if (definition.width !== context.width || definition.height !== context.height) throw new StageError(17, "STAGE_CONTRACT_ERROR", `the page defines ${definition.width}x${definition.height}; the treatment's ${context.treatment.format} needs ${context.width}x${context.height}`);
    if ((definition.fps ?? 60) !== context.fps) throw new StageError(17, "STAGE_CONTRACT_ERROR", `the page defines ${definition.fps} fps; the treatment renders at ${context.fps}`);
    if (!(Number.isFinite(definition.duration) && definition.duration > 0)) throw new StageError(17, "STAGE_CONTRACT_ERROR", "the page's duration must be a positive number of seconds");
    if (webgl.failed) throw exit(EXIT.BLOCKED_NO_WEBGL2, "BLOCKED_NO_WEBGL2", "the page asked for a WebGL context and the software renderer gave none; fix: check SwiftShader availability");
    return { stage, definition, webgl };
  } catch (error) {
    await stage.close();
    throw error;
  }
}

// Captures `frames` (sorted) in one browser by stepping every frame from 0. The stills round skips the
// compositor wait and the capture on frames it does not keep. The determinism replay (`exact`) repeats
// the master's own sequence instead, settling and capturing every frame and keeping only the samples:
// the raster of a frame can depend on whether earlier frames were captured, so only the same sequence
// is a fair comparison.
async function captureSampled(stage, frames, { exact = false } = {}) {
  const shots = new Map();
  const wanted = new Set(frames);
  let cursor = 0;
  for (const frame of frames) {
    if (exact) {
      for (; cursor < frame; cursor++) { await stage.step(cursor, true); await stage.capture(); }
    } else if (frame > cursor) await stage.stepRange(cursor, frame - 1);
    await stage.step(frame, true);
    if (wanted.has(frame)) await stage.check();
    shots.set(frame, await stage.capture());
    cursor = frame + 1;
  }
  return shots;
}

function decodeRgba(png) {
  const image = decodePng(png);
  if (image.channels === 4) return image.pixels;
  const out = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += image.channels, j += 4) { out[j] = image.pixels[i]; out[j + 1] = image.pixels[i + 1]; out[j + 2] = image.pixels[i + 2]; out[j + 3] = 255; }
  return out;
}

// The stage's cuts are the treatment's beat starts, on the frame grid.
function stageCuts(context) {
  return context.treatment.beats.map((beat) => Math.round(beat.t0 * context.fps) / context.fps);
}

function stillsFor(context, frameCount) {
  const { treatment, fps } = context;
  const cuts = treatment.beats.slice(1).map((beat) => Math.round(beat.t0 * fps)).filter((f) => f > 0 && f < frameCount);
  return stillsPlan({ beats: treatment.beats, cuts, frameCount, fps });
}

export function stageTargets(context, frameCount) {
  const beats = context.treatment.beats;
  const mid = (beat) => Math.max(0, Math.min(frameCount - 1, Math.round(((beat.t0 + Math.min(beat.t1, frameCount / context.fps)) / 2) * context.fps)));
  return { posterFrame: mid(beats[Math.floor(beats.length / 2)]), stillFrame: mid(beats.at(-1)) };
}

// The full master capture: every frame stepped, captured, audited and piped to the encoder.
async function captureMaster(context, stage, frameCount, keep, previewSources, runDir) {
  const { width, height, fps } = context;
  const pool = new FramePool(Math.max(2, Math.min(6, os.availableParallelism() - 3)));
  const master = encodeMaster(path.join(runDir, "film.mp4"), width, height, fps);
  const detector = new ExcursionDetector(flashGeometryFor(width, height));
  const logFd = openSync(path.join(runDir, "stage-frames.jsonl"), "w");
  const pvDir = path.join(runDir, "pv-src");
  rmSync(pvDir, { recursive: true, force: true });
  mkdirSync(pvDir, { recursive: true });
  const pv = previewSize(previewRungs()[0][0], width, height);
  const kept = new Map();
  const hashes = new Map();
  const stepMs = [], frameMs = [];
  const queue = [];
  const started = performance.now();
  let consumed = 0;
  const consume = async (job) => {
    const result = await job.promise;
    const record = detector.push(result.cells);
    hashes.set(job.frame, result.hash);
    writeSync(logFd, JSON.stringify({ frame: job.frame, rgbaSha256: result.hash, p995L: result.p995L, transitions: { up: record.up, down: record.down, redUp: record.redUp, redDown: record.redDown }, fullStep: record.fullStep }) + "\n");
    await write(master.child, Buffer.from(result.rgba.buffer, result.rgba.byteOffset, result.rgba.byteLength));
    if (result.previewPng) writeFileSync(path.join(pvDir, `f${job.frame}.png`), result.previewPng);
    consumed += 1;
  };
  try {
    for (let frame = 0; frame < frameCount; frame++) {
      const t0 = performance.now();
      await stage.step(frame, true);
      if (frame % 30 === 0) await stage.check();
      const t1 = performance.now();
      const png = await stage.capture();
      if (keep.has(frame)) kept.set(frame, png);
      stepMs.push(t1 - t0);
      frameMs.push(performance.now() - t0);
      queue.push({ frame, promise: pool.run(new Uint8Array(png), width, height, previewSources.has(frame) ? pv : null) });
      if (queue.length >= 8) await consume(queue.shift());
      if (frame % 30 === 0) progress(runDir, { phase: "master", frame, frameCount, elapsedSec: Number(((performance.now() - started) / 1000).toFixed(1)) });
    }
    await stage.check();
    while (queue.length) await consume(queue.shift());
  } catch (error) {
    master.child.kill("SIGKILL");
    closeSync(logFd);
    await pool.close();
    throw error;
  }
  closeSync(logFd);
  await pool.close();
  master.child.stdin.end();
  const [status] = await once(master.child, "close");
  if (status !== 0) throw new Error(`ffmpeg master encode failed: ${master.stderr().trim()}`);
  const sorted = (list) => [...list].sort((a, b) => a - b);
  const pct = (list, q) => { const s = sorted(list); return Number(s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1)); };
  return { kept, hashes, consumed, timing: { frames: frameCount, stepP50: pct(stepMs, 0.5), frameP50: pct(frameMs, 0.5), frameP95: pct(frameMs, 0.95), masterSec: Number(((performance.now() - started) / 1000).toFixed(1)) } };
}

// Preview: decimated master frames only, on the long-edge ladder; the exact frames handed to the
// encoder are audited as a loop.
async function buildPreview(context, runDir, frameCount) {
  const { width, height, fps } = context;
  const encoder = previewEncoderRung(which("ffmpeg"));
  const top = previewSize(previewRungs()[0][0], width, height);
  const durationSec = frameCount / fps;
  const records = [];
  for (const [longEdge, rungFps] of previewRungs()) {
    const pvFps = Math.min(rungFps, fps);
    const size = previewSize(longEdge, width, height);
    const dir = path.join(runDir, "pv", `${longEdge}-${pvFps}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const count = Math.floor(durationSec * pvFps);
    const frames = [];
    for (let k = 0; k < count; k++) {
      const source = Math.min(frameCount - 1, Math.round((k * fps) / pvFps));
      const src = decodePng(readFileSync(path.join(runDir, "pv-src", `f${source}.png`)));
      const pixels = size.width === top.width ? src.pixels : areaResize(src.pixels, top.width, top.height, size.width, size.height, 4);
      writeFileSync(path.join(dir, `p${String(k).padStart(5, "0")}.png`), encodePng(size.width, size.height, pixels, 4, 1));
      frames.push(pixels);
    }
    const file = await encodePreview(runDir, dir, pvFps, count, encoder);
    const bytes = statSync(file).size;
    log(`preview ${encoder} ${size.width}x${size.height} @ ${pvFps} fps: ${bytes} B`);
    if (bytes <= 3_000_000 || longEdge === previewRungs().at(-1)[0]) {
      const audit = auditSequence(frames, size.width, size.height, pvFps, true);
      audit.records.forEach((record, k) => records.push({ stream: "preview", previewFrame: k, transitions: { up: record.up, down: record.down, redUp: record.redUp, redDown: record.redDown }, fullStep: record.fullStep }));
      rmSync(path.join(runDir, "pv"), { recursive: true, force: true });
      return { encoder, width: size.width, height: size.height, fps: pvFps, bytes, records };
    }
  }
  return null;
}

function previewSourceFrames(fps, frameCount) {
  const sources = new Set();
  for (const [, rungFps] of previewRungs()) {
    const pvFps = Math.min(rungFps, fps);
    const count = Math.floor((frameCount / fps) * pvFps);
    for (let k = 0; k < count; k++) sources.add(Math.min(frameCount - 1, Math.round((k * fps) / pvFps)));
  }
  return sources;
}

// Moves the previous round's exports aside so a new render never mixes with them.
function clearExports(out, runDir) {
  const previous = path.join(runDir, "previous-round");
  rmSync(previous, { recursive: true, force: true });
  for (const name of ["film.mp4", "preview.webp", "preview.gif", "poster.png", "reduced-motion.png", "gate-report.txt", "manifest.json"]) {
    for (const source of [path.join(out, name), path.join(out, "withheld", name), path.join(runDir, name)]) {
      if (!existsSync(source)) continue;
      mkdirSync(previous, { recursive: true });
      renameSync(source, path.join(previous, `${path.basename(path.dirname(source))}-${name}`));
    }
  }
  rmSync(path.join(out, "withheld"), { recursive: true, force: true });
}

export async function renderStage(out, { round = 1, stillsOnly = false } = {}) {
  const context = prepareStage(out);
  const runDir = path.join(out, ".run");
  mkdirSync(runDir, { recursive: true });
  const noFfmpeg = !stillsOnly && !which("ffmpeg");
  const chromium = await loadPlaywright(context.state.nodeDir);
  const began = performance.now();
  const opened = await openChecked(chromium, context, path.join(runDir, "sm"));
  const { stage, definition, webgl } = opened;
  const frameCount = Math.round(definition.duration * context.fps);
  const plan = stillsFor(context, frameCount);
  const { posterFrame, stillFrame } = stageTargets(context, frameCount);
  let stills;
  try {
    if (stillsOnly || noFfmpeg) {
      const shots = await captureSampled(stage, plan.all);
      const frames = new Map([...shots].map(([frame, png]) => [frame, decodeRgba(png)]));
      stills = writeStillsSet(out, { width: context.width, height: context.height, fps: context.fps, frames, plan, round, pathName: "stage", beats: context.treatment.beats });
      resolveTrack(out, context.treatment, { frameCount, fps: context.fps, cuts: stageCuts(context) });
      writeFileSync(path.join(runDir, "stills-timing.json"), JSON.stringify({ frames: plan.all.length, totalSec: Number(((performance.now() - began) / 1000).toFixed(1)) }) + "\n");
      if (noFfmpeg) throw exit(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, "BLOCKED_NO_FFMPEG_FOR_VIDEO", "ffmpeg not found on PATH; the stills and contact sheet were written; fix: install ffmpeg, or keep working from `stage --stills-only`, which needs no ffmpeg");
      return { stillsOnly: true, stills, frameCount };
    }
    clearExports(out, runDir);
    const samples = determinismSamples(context.treatment.beats, context.fps, frameCount);
    const keep = new Set([...plan.all, ...samples, posterFrame, stillFrame]);
    const replay = (async () => {
      const opened2 = await openChecked(chromium, context, path.join(runDir, "sd"));
      try { return await captureSampled(opened2.stage, samples, { exact: true }); } finally { await opened2.stage.close(); }
    })();
    const qa = (async () => {
      const opened3 = await openChecked(chromium, context, path.join(runDir, "sq"), qaPageSource());
      try { return await captureQa(opened3.stage, context, frameCount); } finally { await opened3.stage.close(); }
    })();
    replay.catch(() => {});
    qa.catch(() => {});
    const master = await captureMaster(context, stage, frameCount, keep, previewSourceFrames(context.fps, frameCount), runDir);
    const replayShots = await replay;
    progress(runDir, { phase: "finishing", frame: frameCount, frameCount });
    // Determinism: SHA-256 of decoded RGBA, never PNG bytes.
    const determinism = { method: "fresh browser, clock replayed sequentially from 0", frames: [] };
    for (const frame of samples) {
      const replayRgba = decodeRgba(replayShots.get(frame));
      const entry = { frame, master: master.hashes.get(frame), replay: sha256(replayRgba) };
      if (entry.master !== entry.replay) entry.region = firstDifferingRegion(decodeRgba(master.kept.get(frame)), replayRgba, context.width, context.height);
      determinism.frames.push(entry);
    }
    writeFileSync(path.join(runDir, "determinism.json"), JSON.stringify(determinism, null, 2) + "\n");
    const mismatch = determinism.frames.find((entry) => entry.master !== entry.replay);
    if (mismatch) {
      await Promise.allSettled([qa]);
      const r = mismatch.region;
      throw new StageError(18, "STAGE_NONDETERMINISTIC", `frame ${mismatch.frame} (${(mismatch.frame / context.fps).toFixed(2)} s) differs from a fresh replay${r ? `; first differing region ${r.width}x${r.height} at (${r.x}, ${r.y})` : ""}`);
    }
    const qaResult = analyseQa(await qa, context);
    writeFileSync(path.join(runDir, "qa.json"), JSON.stringify(qaResult, null, 2) + "\n");
    if (qaResult.missing.length) throw new StageError(17, "STAGE_CONTRACT_ERROR", `copy line never found on screen: ${qaResult.missing.map((line) => `"${line}"`).join(", ")}`);
    const frames = new Map([...plan.all].map((frame) => [frame, decodeRgba(master.kept.get(frame))]));
    stills = writeStillsSet(out, { width: context.width, height: context.height, fps: context.fps, frames, plan, round, pathName: "stage", beats: context.treatment.beats });
    const poster = posterPng(decodeRgba(master.kept.get(posterFrame)), context.width, context.height);
    writeFileSync(path.join(runDir, "poster.png"), poster.png);
    writeFileSync(path.join(runDir, "reduced-motion.png"), encodePng(context.width, context.height, decodeRgba(master.kept.get(stillFrame)), 4, 9, true));
    const preview = await buildPreview(context, runDir, frameCount);
    rmSync(path.join(runDir, "pv-src"), { recursive: true, force: true });
    if (preview) {
      const fd = openSync(path.join(runDir, "stage-frames.jsonl"), "a");
      for (const record of preview.records) writeSync(fd, JSON.stringify(record) + "\n");
      closeSync(fd);
    }
    // Every planned track is muxed and checked on the decoded stream (exit 20 on a failure).
    const track = resolveTrack(out, context.treatment, { frameCount, fps: context.fps, cuts: stageCuts(context) });
    if (track.mode !== "none") {
      const mixed = path.join(runDir, "film-audio.mp4");
      muxTrack(path.join(runDir, "film.mp4"), track, frameCount / context.fps, mixed);
      renameSync(mixed, path.join(runDir, "film.mp4"));
      const failing = Object.entries(soundChecks(path.join(runDir, "film.mp4"), frameCount / context.fps, track.mode)).find(([, row]) => !row.pass && !row.warn);
      if (failing) throw exit(SOUND_EXIT, "SOUND_INVALID", failing[1].detail);
    }
    const { mode, label, lufs, peakDbfs, palette, key, tempo } = track;
    const sound = { mode, label, ...(track.file ? { file: path.relative(out, track.file) } : {}), ...(lufs !== undefined ? { lufs, peakDbfs, palette, key, tempo } : {}) };
    const manifest = {
      schemaVersion: 1, path: "stage", format: context.treatment.format, resolution: [context.width, context.height], fps: context.fps, frameCount,
      durationSec: frameCount / context.fps, targetDurationSec: context.treatment.durationSec, seed: context.seed, craftRound: round,
      chromeFlags: stage.flags, webgl, previewEncoder: preview?.encoder ?? null,
      preview: preview ? { width: preview.width, height: preview.height, fps: preview.fps, bytes: preview.bytes } : null,
      posterFrame, posterSize: [poster.width, poster.height], stillFrame, determinismFrames: samples,
      timing: { ...master.timing, totalSec: Number(((performance.now() - began) / 1000).toFixed(1)) },
      sound, qa: { file: ".run/qa.json", samples: qaResult.samples.length, trackFrames: qaResult.trackFrames, allowedFaces: qaResult.allowedFaces },
      treatmentSha256: sha256(readFileSync(path.join(out, "treatment.json"))), stageSha256: stageSha(context.stageDir),
      stillsSha256: sha256(readFileSync(path.join(out, "stills", "stills.json"))), pageErrors: stage.errors.slice(0, 5), missingAssets: stage.missing.slice(0, 5),
      generatedAt: new Date().toISOString()
    };
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    progress(runDir, { phase: "done", frame: frameCount, frameCount });
    return { stillsOnly: false, stills, frameCount, manifest };
  } finally {
    await stage.close();
  }
}

// `render.mjs stage [--detach]`: a detached run writes its log and exit code under .run/ so a host
// tool timeout never kills a long render.
export function detachStage(out, args) {
  const runDir = path.join(out, ".run");
  mkdirSync(runDir, { recursive: true });
  const logFile = path.join(runDir, "render.log");
  rmSync(path.join(runDir, "render-exit.json"), { force: true });
  const fd = openSync(logFile, "w");
  const child = spawn(process.execPath, [path.join(skillRoot, "render.mjs"), "stage", ...args.filter((arg) => arg !== "--detach"), "--exit-file", path.join(runDir, "render-exit.json")], { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  closeSync(fd);
  return { pid: child.pid, logFile, progressFile: path.join(runDir, "progress.json"), exitFile: path.join(runDir, "render-exit.json") };
}

