#!/usr/bin/env node
// lit-typographic-motion renderer: headless Chrome (WebGL2 GLSL passes) -> exact RGBA bytes ->
// ffmpeg. One end-to-end command (`film`) runs a whole craft round: timeline -> pre-flight gate ->
// stills -> contact sheet -> (stop with --stills-only) -> master, preview, poster, reduced-motion
// still under .run/ -> full gate -> promote or withhold. Adapted from the offline-renderer method of
// mexicat/pdoom-video (MIT, commit ca251e3); see NOTICE.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXIT, FRAME, easeTokens, engineCredit, isSoftwareRenderer, limits, presets } from "./engine/constants.mjs";
import { buildPassRanges, buildTimeline, chooseAccentEntry, eventSchedule, isShot, markStateful } from "./engine/timing.mjs";
import { selectPreset } from "./engine/text.mjs";
import { ExcursionDetector, auditCells, auditSequence, linearLut } from "./engine/flash.mjs";
import { areaResize, decodePng, encodePng } from "./engine/png.mjs";
import { findChrome, launchLadder, loadPlaywright, which } from "./engine/browser.mjs";
import { inspectAudio, inspectWarmState, pins, skillRoot } from "./runtime.mjs";
import { runGate, timelineChecks } from "./gate.mjs";
import { keepFirstTreatment, loadTreatment, normalize } from "./engine/treatment.mjs";
import { stillsPlan, writeStillsSet } from "./engine/stills.mjs";
import { previewEncoderRung } from "./probe.mjs";
import { encodeMaster, encodePreview, previewRungs, write } from "./engine/encode.mjs";
import { SOUND_EXIT, muxTrack, resolveTrack, soundChecks } from "./engine/sound.mjs";
import { recordLook } from "./engine/look.mjs";

const usage = `lit-typographic-motion render
Usage:
  node render.mjs film   --brief <brief.json> --out <dir> [--round 1|2|3] [--stills-only] [--viewed N]
  node render.mjs stills --brief <brief.json> --out <dir>
  node render.mjs sheet  --brief <brief.json> --out <dir> --cuts
  node render.mjs video  --brief <brief.json> --out <dir> [--round 1|2|3] [--viewed N]
  node render.mjs perf   --brief <brief.json> --out <dir>
  node render.mjs gate   --out <dir> [--viewed N]
  node render.mjs stage  --out <dir> [--round 1|2|3] [--stills-only] [--detach]
  node render.mjs sound  --out <dir>
  node render.mjs look   --out <dir> --round 1|2|3 --answers <answers.json>
Options: --samples N (master default 4) --shutter S (default 0.5) --scale 1..4 --word-timing (Tier 3, opt-in)
Exit codes: 0 OK, 10 BLOCKED_NO_CHROME, 11 BLOCKED_NO_WEBGL2, 12 BLOCKED_NO_FFMPEG_FOR_VIDEO,
            13 GATE_FAIL_QA, 14 BLOCKED_DEPS_NOT_PREWARMED, 15 BLOCKED_FONT_FETCH, 16 BLOCKED_TREATMENT_INVALID,
            17 STAGE_CONTRACT_ERROR, 18 STAGE_NONDETERMINISTIC, 19 STAGE_NETWORK_REQUEST, 20 SOUND_INVALID`;

const pageScripts = ["common.js", "gl.js", "lines.js", "passes.js", "post.js", "type.js", "scenes.js", "engine.js"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (line) => process.stderr.write(`${line}\n`);

class Blocked extends Error {
  constructor(name, code, detail, fix) { super(`${name} (${code}): ${detail}${fix ? `; fix: ${fix}` : ""}`); this.exitCode = code; }
}

function option(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function readBrief(file) {
  if (!file) throw new Error("--brief <brief.json> is required");
  const brief = JSON.parse(readFileSync(file, "utf8"));
  if (typeof brief !== "object" || brief === null) throw new Error("the brief must be a JSON object");
  const held = JSON.stringify(brief).match(/<[^<>"\\]{1,80}>/u);
  if (held) throw new Error(`the brief still holds a placeholder (${held[0]}); write this film's own values`);
  return brief;
}

// The brief's title prints on screen only when it is the film's own name, that is a line of the
// treatment's copy; otherwise it stays metadata and the lines alone make the film.
export function briefForTreatment(brief, treatment) {
  if (typeof brief.title !== "string" || !brief.title.trim()) return brief;
  const lines = new Set((treatment.copy?.lines ?? []).map(normalize));
  return lines.has(normalize(brief.title)) ? brief : { ...brief, title: undefined };
}

// A preset counts as the user's choice only when the request itself names it; one the agent wrote
// into the brief is labelled "agent default".
export function presetSource(brief, treatment) {
  const named = explicitPreset(brief);
  if (!named) return null;
  return normalize(treatment?.request ?? "").includes(normalize(named)) ? "user" : "agent";
}

function briefSourceText(brief) {
  const parts = [brief.title, brief.description, brief.style, ...(brief.lines ?? [])];
  for (const scene of brief.scenes ?? []) parts.push(scene.text, scene.title, scene.sub, scene.paragraph, scene.heading, scene.label, ...(scene.items ?? []));
  return parts.filter((part) => typeof part === "string").join(" ");
}

function explicitPreset(brief) {
  if (brief.preset) return brief.preset;
  if (typeof brief.style === "string" && Object.hasOwn(presets, brief.style)) return brief.style;
  return undefined;
}

// Phase 1 plus the pre-flight timeline rules. Nothing here needs Chrome.
export function planRun(brief, briefPath, args, state) {
  const explicit = explicitPreset(brief);
  const selected = selectPreset(briefSourceText(brief), explicit);
  const preset = explicit ? { ...selected, reason: args.presetSource === "user" ? "user-specified" : "agent default" } : selected;
  const warnings = [];
  let audioTier = "text-reading-time", bpm = Number(brief.bpm ?? limits.defaultBpm), beatGrid, audio = null;
  const audioFile = typeof brief.audio === "string" && brief.audio.trim() ? path.resolve(path.dirname(briefPath), brief.audio) : undefined;
  if (audioFile) {
    const venv = inspectAudio();
    if (!existsSync(audioFile)) warnings.push(`audio file not found (${audioFile}); using text reading time`);
    else if (!venv.ready) warnings.push(venv.reason);
    else {
      const target = path.join(args.runDir, "audio-grid.json");
      const result = spawnSync(venv.python, [path.join(skillRoot, "audio-analysis.py"), audioFile, target], { encoding: "utf8", timeout: 300000 });
      if (result.status !== 0) warnings.push(`audio analysis failed; using text reading time: ${(result.stderr || result.error?.message || "").trim().split("\n").at(-1)}`);
      else {
        const grid = JSON.parse(readFileSync(target, "utf8"));
        if (grid.beatGrid.length >= 2 && grid.bpm >= 40 && grid.bpm <= 240) { audioTier = "librosa-beat-grid"; beatGrid = grid.beatGrid; bpm = grid.bpm; audio = grid; }
        else warnings.push("audio beat grid was too sparse; using text reading time");
      }
    }
  }
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error("bpm must be between 40 and 240");
  const seed = Number.isSafeInteger(brief.seed) ? brief.seed >>> 0 : 20260926;
  const built = buildTimeline(brief, { bpm, beatGrid, targetDurationSec: args.targetDurationSec });
  if (built.floorForced) warnings.push(`the reading floors need ${built.durationSec} s, longer than the treatment's ${args.targetDurationSec} s`);
  const events = eventSchedule(built.timeline, preset.id, seed);
  const accentEntryId = chooseAccentEntry(built.timeline, preset.id, built.durationSec);
  return { preset, explicit, seed, bpm, beatGrid, audio, audioTier, audioFile, warnings, ...built, events, accentEntryId, state };
}

function preflightTimeline(plan) {
  const shaped = { timeline: plan.timeline, fps: FRAME.fps, ...(plan.beatGrid ? { beatGrid: plan.beatGrid } : { bpm: plan.bpm }) };
  const checks = timelineChecks(shaped);
  const failed = Object.entries(checks).filter(([, check]) => !check.pass);
  return { checks, failed };
}

function writePreflightFailure(out, plan, lines, briefPath) {
  mkdirSync(out, { recursive: true });
  const text = ["lit-typographic-motion — render report", `preset: ${plan.preset.id}  (chosen because: ${plan.preset.reason})`, "", "QA gate: FAIL (pre-flight; nothing was rendered)", ...lines.map((line) => `  ${line}`), "", `gate exit: ${EXIT.GATE_FAIL_QA}`, "export state: none (pre-flight FAIL)", `brief: ${briefPath}`, ""].join("\n");
  writeFileSync(path.join(out, "gate-report.txt"), text);
  return text;
}

function fontAssets(plan, state) {
  const files = {};
  for (const w of [75, 100, 125]) for (const g of [400, 700, 900]) files[`archivo-${w}-${g}`] = path.join(skillRoot, "fonts", `Archivo-${w}-${g}.ttf`);
  files.vt323 = path.join(skillRoot, "fonts", "VT323-Regular.ttf");
  files["silkscreen-400"] = path.join(skillRoot, "fonts", "Silkscreen-Regular.ttf");
  files["silkscreen-700"] = path.join(skillRoot, "fonts", "Silkscreen-Bold.ttf");
  files.meslo = path.join(state.fontDir, "MesloLGS-NF-Regular.ttf");
  if (state.hangul === "lit-pptx") {
    files["hangul-400"] = path.resolve(skillRoot, pins.litPptxPair.Regular.path);
    files["hangul-700"] = path.resolve(skillRoot, pins.litPptxPair.Bold.path);
  } else {
    files["hangul-400"] = path.join(state.fontDir, "Pretendard-Regular.otf");
    files["hangul-700"] = files["hangul-400"];
  }
  if (plan.preset.id === "terminalcore") files.galmuri9 = path.join(state.fontDir, "Galmuri9.ttf");
  const fonts = {};
  for (const [key, file] of Object.entries(files)) {
    if (!existsSync(file)) throw new Blocked("BLOCKED_FONT_FETCH", EXIT.BLOCKED_FONT_FETCH, `missing ${file}`, "litopencode motion-runtime install");
    fonts[key] = { base64: readFileSync(file).toString("base64"), file: path.basename(file) };
  }
  const strokes = {};
  for (const name of ["EMSAllure", "EMSFelix", "EMSOsmotron", "EMSReadability", "EMSTech"]) strokes[name] = readFileSync(path.join(skillRoot, "fonts", "stroke", `${name}.svg`), "utf8");
  return { fonts, strokes };
}

// Frame egress (MO-A-02 option 1): a WebSocket on 127.0.0.1:0 carries each frame's RGBA bytes.
// If the sandbox refuses `listen`, the same readback buffer is pulled per frame over CDP instead.
async function openEgress(page, nodeDir) {
  let server;
  try {
    const { WebSocketServer } = await import(pathToFileURL(path.join(nodeDir, "node_modules", "ws", "wrapper.mjs")).href);
    server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 512 * 1024 * 1024 });
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  } catch (error) {
    server?.close();
    return { mode: "pull", reason: `listen on 127.0.0.1:0 failed (${error.code ?? ""} ${error.message}); using per-frame CDP pull of the same readback buffer`, close() {} };
  }
  const pending = new Map();
  const arrived = new Map();
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buffer.readUInt32BE(0) !== 0x4c544d46) return;
      const key = `${buffer.readUInt32BE(4)}:${buffer.readUInt32BE(8)}`;
      const payload = buffer.subarray(16, 16 + buffer.readUInt32BE(12));
      if (pending.has(key)) { pending.get(key)(payload); pending.delete(key); } else arrived.set(key, payload);
    });
  });
  const port = server.address().port;
  try {
    await page.evaluate((url) => window.LTM.engine.connect(url), `ws://127.0.0.1:${port}`);
  } catch (error) {
    server.close();
    return { mode: "pull", reason: `page could not open ws://127.0.0.1:${port} (${error.message}); using per-frame CDP pull`, close() {} };
  }
  return {
    mode: "ws", reason: `WebSocket egress on 127.0.0.1:${port}`,
    wait(frame, kind) {
      const key = `${frame}:${kind}`;
      if (arrived.has(key)) { const value = arrived.get(key); arrived.delete(key); return Promise.resolve(value); }
      return new Promise((resolve) => pending.set(key, resolve));
    },
    close() { server.close(); }
  };
}

async function startEngine(plan, out, { rungOnly, scale, samplesRequested }) {
  const state = plan.state;
  const chrome = findChrome();
  if (!chrome.path) throw new Blocked("BLOCKED_NO_CHROME", EXIT.BLOCKED_NO_CHROME, chrome.missing, "install Chrome or set CHROME_PATH");
  const chromium = await loadPlaywright(state.nodeDir);
  const profileRoot = path.join(out, ".run");
  mkdirSync(profileRoot, { recursive: true });
  let launched;
  try {
    launched = await launchLadder(chromium, chrome.path, profileRoot, { rungOnly });
  } catch (error) {
    if (error.kind === "webgl") throw new Blocked("BLOCKED_NO_WEBGL2", EXIT.BLOCKED_NO_WEBGL2, error.message, "check GPU drivers or SwiftShader availability");
    throw new Blocked("BLOCKED_NO_CHROME", EXIT.BLOCKED_NO_CHROME, error.message, "check that Chrome can start headless in this sandbox");
  }
  const { page } = launched;
  const software = isSoftwareRenderer(launched.renderer);
  const samples = software ? 1 : samplesRequested;
  markStateful(plan.timeline, buildPassRanges({ timeline: plan.timeline, presetId: plan.preset.id, runSeed: plan.seed, renderer: launched.renderer, events: plan.events }));
  await page.addScriptTag({ path: path.join(state.nodeDir, "node_modules", "opentype.js", "dist", "opentype.js") });
  for (const script of pageScripts) await page.addScriptTag({ path: path.join(skillRoot, "engine", "page", script) });
  const shots = plan.timeline.filter(isShot);
  const config = {
    scale, fps: FRAME.fps, seed: plan.seed, presetId: plan.preset.id, look: presets[plan.preset.id], timeline: plan.timeline, events: plan.events,
    accentEntryId: plan.accentEntryId, software, easeTokens, beatSec: plan.beatGrid ? null : 60 / plan.bpm, audio: plan.audio, showIndex: plan.showIndex === true
  };
  const booted = await page.evaluate(({ config, assets }) => window.LTM.boot(config, assets), { config, assets: fontAssets(plan, state) });
  if (booted.error) throw new Blocked("BLOCKED_NO_WEBGL2", EXIT.BLOCKED_NO_WEBGL2, `${booted.error} (renderer ${launched.renderer})`, "check GPU drivers or SwiftShader availability");
  const egress = await openEgress(page, state.nodeDir);
  const width = FRAME.width * scale, height = FRAME.height * scale;
  const renderAt = async (request) => {
    const wantMask = Boolean(request.wantMask);
    const full = { samples, shutter: request.shutter, egress: request.egress ?? egress.mode, ...request };
    if (full.egress === "ws") {
      const framePromise = egress.wait(request.frame, 1);
      const maskPromise = wantMask ? egress.wait(request.frame, 2) : null;
      const meta = await page.evaluate((req) => window.LTM.engine.renderFrame(req), full);
      return { meta, rgba: await framePromise, mask: maskPromise ? await maskPromise : null };
    }
    const meta = await page.evaluate((req) => window.LTM.engine.renderFrame(req), full);
    if (full.egress === "none") return { meta };
    const rgba = Buffer.from(meta.rgbaBase64, "base64");
    const mask = meta.maskBase64 ? Buffer.from(meta.maskBase64, "base64") : null;
    delete meta.rgbaBase64; delete meta.maskBase64;
    return { meta, rgba, mask };
  };
  const close = async () => {
    egress.close();
    await launched.context.close().catch(() => {});
    rmSync(launched.profile, { recursive: true, force: true });
  };
  return { page, launched, software, samples, egress, renderAt, close, width, height, shots };
}

function representativeFrame(shot, plan) {
  const reveals = plan.timeline.filter((entry) => entry.kind === "reveal" && entry.sceneId === shot.sceneId && entry.shotIndex === shot.shotIndex);
  const settled = Math.max(shot.start + shot.holdSec * 0.8, (reveals.at(-1)?.start ?? shot.start) + 0.3);
  return Math.min(Math.round(shot.end * FRAME.fps) - 1, Math.round(Math.min(settled, shot.end - 1 / FRAME.fps) * FRAME.fps));
}

function glitchActive(plan, frame) {
  const t = frame / FRAME.fps;
  return plan.events.some((event) => event.kind === "glitch" && t >= event.time - 0.05 && t < event.time + event.holdFrames / FRAME.fps + 0.05);
}

// The cut times a sound bed lines up with: the engine's shot starts when they match the treatment's
// beats one to one, otherwise the treatment's beats scaled to the film's real length.
export function typeCuts(plan, treatment) {
  const shots = plan.timeline.filter(isShot);
  if (shots.length === treatment.beats.length) return shots.map((shot) => shot.start);
  return treatment.beats.map((beat) => (beat.t0 * plan.durationSec) / treatment.durationSec);
}

export function soundSummary(track, out) {
  const { mode, label, lufs, peakDbfs, palette, key, tempo } = track;
  return { mode, label, ...(track.file ? { file: path.relative(out, track.file) } : {}), ...(lufs !== undefined ? { lufs, peakDbfs, palette, key, tempo } : {}) };
}

// The stills set the look reads: treatment beat midpoints, a strip around every cut
// and a 12-frame contact sheet, rendered at one sample like every look image.
async function renderStillsSet(engine, plan, out, treatment, round) {
  const frameCount = Math.round(plan.durationSec * FRAME.fps);
  const cuts = engine.shots.slice(1).map((shot) => Math.round(shot.start * FRAME.fps));
  const planned = stillsPlan({ beats: treatment.beats, cuts, frameCount, fps: FRAME.fps });
  const frames = new Map();
  for (const frame of planned.all) frames.set(frame, (await engine.renderAt({ frame, samples: 1, shutter: limits.masterShutter })).rgba);
  return writeStillsSet(out, { width: engine.width, height: engine.height, fps: FRAME.fps, frames, plan: planned, round, pathName: "type", beats: treatment.beats });
}

function cutFrames(engine) {
  const cuts = [];
  for (let i = 1; i < engine.shots.length; i++) {
    const c = Math.round(engine.shots[i].start * FRAME.fps);
    cuts.push({ label: `${engine.shots[i - 1].sceneId} | ${engine.shots[i].sceneId}`, frames: [c - 6, c - 1, c, c + 6] });
  }
  if (cuts.length === 0) {
    const last = Math.round(engine.shots[0].end * FRAME.fps) - 1;
    cuts.push({ label: engine.shots[0].sceneId, frames: [0, Math.floor(last / 3), Math.floor((2 * last) / 3), last] });
  }
  return cuts;
}

function p995Luminance(rgba) {
  const bins = new Uint32Array(1024);
  for (let i = 0; i < rgba.length; i += 4) {
    const l = 0.2126 * linearLut[rgba[i]] + 0.7152 * linearLut[rgba[i + 1]] + 0.0722 * linearLut[rgba[i + 2]];
    bins[Math.min(1023, Math.floor(l * 1024))]++;
  }
  const target = (rgba.length / 4) * limits.nearBlackQuantile;
  let acc = 0;
  for (let b = 0; b < 1024; b++) { acc += bins[b]; if (acc >= target) return (b + 1) / 1024; }
  return 1;
}

async function renderFilm(engine, plan, out, args) {
  const runDir = path.join(out, ".run");
  const W = engine.width, H = engine.height;
  const frameCount = Math.round(plan.durationSec * FRAME.fps);
  const shutter = args.shutter;
  const previous = path.join(runDir, "previous-round");
  rmSync(previous, { recursive: true, force: true });
  for (const name of ["film.mp4", "preview.webp", "preview.gif", "poster.png", "reduced-motion.png", "gate-report.txt"]) {
    for (const source of [path.join(out, name), path.join(out, "withheld", name), path.join(runDir, name)]) {
      if (!existsSync(source)) continue;
      mkdirSync(previous, { recursive: true });
      renameSync(source, path.join(previous, `${path.basename(path.dirname(source))}-${name}`));
    }
  }
  rmSync(path.join(out, "withheld"), { recursive: true, force: true });
  for (const dir of ["samples", "pv"]) { rmSync(path.join(runDir, dir), { recursive: true, force: true }); mkdirSync(path.join(runDir, dir), { recursive: true }); }

  // Contrast sample frames (settled moment of each shot) and the cut frames re-rendered for MO-C-09.
  const sampleFrames = new Set();
  for (const shot of engine.shots) {
    let frame = representativeFrame(shot, plan);
    while (glitchActive(plan, frame) && frame > Math.round(shot.start * FRAME.fps)) frame--;
    sampleFrames.add(frame);
  }
  const determinismFrames = [...new Set(cutFrames(engine).flatMap((cut) => [cut.frames[1], cut.frames[2]]).filter((f) => f >= 0 && f < frameCount))].slice(0, 8);
  const cutSet = new Set(determinismFrames);
  const eventsAt = (frame) => plan.events.filter((event) => Math.round(event.time * FRAME.fps) === frame).map((event) => ({ kind: event.kind, sceneId: event.sceneId, shotIndex: event.shotIndex, time: event.time, ...(event.kind === "surge" ? { attackSec: event.attackSec, decaySec: event.decaySec } : {}), ...(event.kind === "glitch" ? { areaPct: event.areaPct } : {}) }));

  const master = encodeMaster(path.join(runDir, "film.mp4"), W, H, FRAME.fps);
  const logFd = openSync(path.join(out, "render.jsonl"), "w");
  const detector = new ExcursionDetector();
  const [pvWidth, pvFps] = previewRungs()[0];
  const pvDir = path.join(runDir, "pv", `${pvWidth}-${pvFps}`);
  mkdirSync(pvDir, { recursive: true });
  const pvStride = FRAME.fps / pvFps;
  const pvHeight = Math.round((pvWidth * H) / W / 2) * 2;
  let minFontPx = Infinity;
  const started = performance.now();
  for (let frame = 0; frame < frameCount; frame++) {
    const { meta, rgba, mask } = await engine.renderAt({ frame, shutter, wantMask: sampleFrames.has(frame) || cutSet.has(frame) });
    const record = detector.push(auditCells(rgba, W, H));
    for (const line of meta.passLines) writeSync(logFd, JSON.stringify({ frame, ...line }) + "\n");
    for (const box of meta.textBoxes) minFontPx = Math.min(minFontPx, box.fontSizePx);
    writeSync(logFd, JSON.stringify({
      frame, pass: null, rgbaSha256: sha256(rgba), sampleTimes: meta.sampleTimes, sceneId: meta.sceneId, shotIndex: meta.shotIndex,
      inkPixels: meta.inkPixels, p995L: Number(p995Luminance(rgba).toFixed(5)),
      transitions: { up: record.up, down: record.down, redUp: record.redUp, redDown: record.redDown }, fullStep: record.fullStep,
      events: eventsAt(frame), post: meta.post, textBoxes: meta.textBoxes, graphics: meta.graphics, fills: meta.fills
    }) + "\n");
    await write(master.child, rgba);
    if (sampleFrames.has(frame)) writeFileSync(path.join(runDir, "samples", `f${frame}.png`), encodePng(W, H, rgba, 4, 1));
    if (sampleFrames.has(frame) || cutSet.has(frame)) writeFileSync(path.join(runDir, "samples", `f${frame}-mask.png`), encodePng(W, H, mask, 1, 6));
    if (frame % pvStride === 0) writeFileSync(path.join(pvDir, `p${String(frame / pvStride).padStart(5, "0")}.png`), encodePng(pvWidth, pvHeight, areaResize(rgba, W, H, pvWidth, pvHeight, 4), 4, 1));
    if (frame % 60 === 0) log(`frame ${frame + 1}/${frameCount} (${((frame + 1) / ((performance.now() - started) / 1000)).toFixed(1)} fps)`);
  }
  master.child.stdin.end();
  const [status] = await once(master.child, "close");
  if (status !== 0) throw new Error(`ffmpeg master encode failed: ${master.stderr().trim()}`);
  // Every planned track is muxed, whatever the audio-analysis tier's state, then checked on the
  // decoded stream: a missing, mistimed or clipping track stops the render with exit 20.
  if (plan.track && plan.track.mode !== "none") {
    const mixed = path.join(runDir, "film-audio.mp4");
    muxTrack(path.join(runDir, "film.mp4"), plan.track, plan.durationSec, mixed);
    renameSync(mixed, path.join(runDir, "film.mp4"));
    const failing = Object.entries(soundChecks(path.join(runDir, "film.mp4"), plan.durationSec, plan.track.mode)).find(([, row]) => !row.pass && !row.warn);
    if (failing) throw Object.assign(new Error(`SOUND_INVALID (20): ${failing[1].detail}`), { exitCode: SOUND_EXIT });
  }
  writeFileSync(path.join(runDir, "samples.json"), JSON.stringify({ frames: [...sampleFrames].sort((a, b) => a - b).map((frame) => ({ frame })) }, null, 2) + "\n");

  // Preview: encoder ladder and size ladder; the exact frames handed to the encoder are audited looping.
  const encoder = previewEncoderRung(which("ffmpeg"));
  let preview = null;
  for (const [width, fps] of previewRungs()) {
    if (minFontPx * (width / FRAME.width) < 10) { log(`preview rung ${width}px skipped: smallest type would fall under 10 px`); break; }
    const dir = path.join(runDir, "pv", `${width}-${fps}`);
    const height = Math.round((width * H) / W / 2) * 2;
    const count = Math.floor(plan.durationSec * fps);
    if (!(width === pvWidth && fps === pvFps)) {
      mkdirSync(dir, { recursive: true });
      for (let k = 0; k < count; k++) {
        const { rgba } = await engine.renderAt({ frame: Math.round((k * FRAME.fps) / fps), shutter });
        writeFileSync(path.join(dir, `p${String(k).padStart(5, "0")}.png`), encodePng(width, height, areaResize(rgba, W, H, width, height, 4), 4, 1));
      }
    }
    const file = await encodePreview(runDir, dir, fps, count, encoder);
    const bytes = statSync(file).size;
    log(`preview ${encoder} ${width}px @ ${fps} fps: ${bytes} B`);
    if (bytes <= limits.previewMaxBytes) {
      const frames = Array.from({ length: count }, (_, k) => decodePng(readFileSync(path.join(dir, `p${String(k).padStart(5, "0")}.png`))).pixels);
      const audit = auditSequence(frames, width, height, fps, true);
      audit.records.forEach((record, k) => writeSync(logFd, JSON.stringify({ stream: "preview", previewFrame: k, sourceFrame: Math.round((k * FRAME.fps) / fps), width, fps, transitions: { up: record.up, down: record.down, redUp: record.redUp, redDown: record.redDown }, fullStep: record.fullStep }) + "\n"));
      preview = { encoder, width, fps, bytes };
      break;
    }
  }
  closeSync(logFd);
  rmSync(path.join(runDir, "pv"), { recursive: true, force: true });
  if (!preview) plan.warnings.push("MO-C-13: no preview rung fit under 3 MB at the 10 px type floor");

  // Poster and reduced-motion still: grain and random noise at 0 (the recorded still override).
  const posterFrame = Math.round((engine.shots[0].start + engine.shots[0].holdSec * 0.6) * FRAME.fps);
  const posterShot = await engine.renderAt({ frame: posterFrame, samples: 1, shutter, still: true });
  writeFileSync(path.join(runDir, "poster.png"), encodePng(W, H, posterShot.rgba, 4, 9, true));
  const lastText = engine.shots.at(-1);
  const stillFrame = Math.round(lastText.end * FRAME.fps) - 1;
  const stillShot = await engine.renderAt({ frame: stillFrame, samples: 1, shutter, still: true });
  writeFileSync(path.join(runDir, "reduced-motion.png"), encodePng(W, H, stillShot.rgba, 4, 9, true));
  writeFileSync(path.join(runDir, "still.json"), JSON.stringify({ posterFrame, stillFrame, inkPixels: stillShot.meta.inkPixels, override: { grain: 0, noise: 0 } }, null, 2) + "\n");

  // MO-D-02: frame time from the driver's call to readback complete, samples 1, >= 120 frames.
  const frameTimeMs = [];
  for (let i = 0; i < limits.perfFrames; i++) {
    const frame = Math.min(frameCount - 1, Math.floor(((i + 0.5) * frameCount) / limits.perfFrames));
    const t0 = performance.now();
    await engine.renderAt({ frame, samples: 1, shutter, egress: "none" });
    frameTimeMs.push(Number((performance.now() - t0).toFixed(3)));
  }
  writeFileSync(path.join(runDir, "perf.json"), JSON.stringify({ renderer: engine.launched.renderer, chromeFlags: engine.launched.rung.flags, samples: 1, frameTimeMs }, null, 2) + "\n");
  return { preview, determinismFrames };
}

// MO-C-09 / MO-A-25: re-render the cut frames in an independent, seeked process and compare.
function rerender(out, briefPath, frames, samples, shutter, rung, tag) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "frames", "--brief", briefPath, "--out", path.join(out, ".run", tag), "--plan", path.join(out, ".run", "plan.json"),
    "--frames", frames.join(","), "--samples", String(samples), "--shutter", String(shutter), "--rung", rung], { encoding: "utf8", timeout: 900000, maxBuffer: 16_000_000 });
  rmSync(path.join(out, ".run", tag), { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`determinism re-render (${rung}) failed: ${(result.stderr || result.error?.message || "").trim().split("\n").slice(-2).join(" ")}`);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)).hashes;
}

function determinism(out, briefPath, frames, engine, plan) {
  const logLines = readFileSync(path.join(out, "render.jsonl"), "utf8").split("\n").filter((line) => line.includes("\"pass\":null"));
  const masterHash = new Map(logLines.map((line) => { const parsed = JSON.parse(line); return [parsed.frame, parsed.rgbaSha256]; }));
  const hashes = rerender(out, briefPath, frames, engine.samples, plan.shutter, engine.launched.rung.name, "det-a");
  const result = { seeked: true, rung: engine.launched.rung.name, samples: engine.samples, frames: frames.map((frame) => ({ frame, master: masterHash.get(frame), rerender: hashes[frame] })) };
  const stateful = plan.timeline.filter(isShot).filter((shot) => shot.stateful);
  result.statefulFrames = frames.filter((frame) => stateful.some((shot) => frame >= Math.round(shot.start * FRAME.fps) && frame < Math.round(shot.end * FRAME.fps)));
  if (result.frames.some((entry) => entry.master !== entry.rerender) && !engine.software) {
    const a = rerender(out, briefPath, frames, 1, plan.shutter, "swiftshader", "det-sa");
    const b = rerender(out, briefPath, frames, 1, plan.shutter, "swiftshader", "det-sb");
    result.swiftshader = frames.map((frame) => ({ frame, a: a[frame], b: b[frame] }));
  }
  writeFileSync(path.join(out, ".run", "determinism.json"), JSON.stringify(result, null, 2) + "\n");
}

function manifestFor(plan, engine, extra) {
  const passRanges = buildPassRanges({ timeline: plan.timeline, presetId: plan.preset.id, runSeed: plan.seed, renderer: engine.launched.renderer, events: plan.events });
  return {
    schemaVersion: 1, engineCredit, presetId: plan.preset.id, seed: plan.seed, fps: FRAME.fps, resolution: [FRAME.width, FRAME.height], scale: plan.scale,
    samples: engine.samples, shutter: plan.shutter, renderer: engine.launched.renderer, softwareRenderer: engine.software, chromeFlags: engine.launched.rung.flags,
    previewEncoder: extra.preview?.encoder ?? null, audioTier: plan.audioTier, ...(plan.beatGrid ? { beatGrid: plan.beatGrid } : { bpm: plan.bpm }),
    durationSec: plan.durationSec, generatedAt: new Date().toISOString(), passRanges,
    timeline: plan.timeline.map(({ id, sceneId, shotIndex, start, end, holdSec, kind, text, script, beatSec, stateful, prerollMax }) => ({ id, sceneId, shotIndex, start, end, holdSec, kind, text, script, beatSec, ...(isShot({ kind }) ? { stateful, prerollMax } : {}) })),
    warnings: plan.warnings, craftRound: plan.round, ...(extra.preview ? { preview: { width: extra.preview.width, fps: extra.preview.fps, bytes: extra.preview.bytes } } : {}),
    path: "type", format: "16:9", targetDurationSec: plan.targetDurationSec ?? null, treatmentSha256: extra.treatmentSha256 ?? null, stillsSha256: extra.stillsSha256 ?? null,
    sound: plan.track ? soundSummary(plan.track, plan.outDir) : null
  };
}

// `look`: appends one look round to look.json (the only writer of that file).
function lookMode(argv, out) {
  const round = Number(option(argv, "round", "0"));
  const entry = recordLook(out, round, option(argv, "answers") ? path.resolve(option(argv, "answers")) : undefined);
  console.log(`look round ${entry.round} recorded on the ${entry.kind === "film" ? "final render" : "stills set"}: ${Object.keys(entry.frames).length} frame(s) viewed${entry.blocked ? " (no vision tool: nobody viewed the frames)" : ""}`);
  if (entry.needsAnotherRound.length) console.log(`another round is needed (questions ${entry.needsAnotherRound.join(", ")})${entry.round >= 3 ? "; round 3 is the last, so deliver with these open items stated" : ""}`);
  else if (entry.kind === "stills") console.log("next: make the change you named, then render the film with the next --round");
  else console.log("next: node gate.mjs --done <dir>");
  return EXIT.OK;
}

// `sound`: builds the treatment's track and cue sheet on its own, timed to the last render when there
// is one and to the treatment's beats otherwise. Renders build it too; this shows it before a render.
function soundMode(out) {
  const { treatment } = loadTreatment(out);
  const manifestFile = path.join(out, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  let fps = treatment.fps ?? 60, frameCount = Math.round(treatment.durationSec * fps), cuts = treatment.beats.map((beat) => beat.t0);
  if (manifest?.path === "stage" && treatment.path === "stage") {
    fps = manifest.fps; frameCount = manifest.frameCount;
    cuts = treatment.beats.map((beat) => Math.round(beat.t0 * fps) / fps);
  } else if (manifest?.path === "type" && treatment.path === "type") {
    fps = manifest.fps; frameCount = Math.round(manifest.durationSec * fps);
    cuts = typeCuts({ timeline: manifest.timeline, durationSec: manifest.durationSec }, treatment);
  }
  const track = resolveTrack(out, treatment, { frameCount, fps, cuts });
  if (track.mode === "none") console.log("sound: none (the treatment asks for silence)");
  else if (track.mode === "generated") console.log(`sound: generated bed ${track.file} (${track.palette}, ${track.key}, ${track.tempo} BPM; ${track.lufs} LUFS, peak ${track.peakDbfs} dBFS, ${track.durationSec.toFixed(3)} s)`);
  else console.log(`sound: ${track.mode} track ${track.file}`);
  if (track.mode !== "none") console.log(`cues: ${path.join(out, "sound-cues.json")}`);
  return EXIT.OK;
}

// `stage`: the stage path (engine/stage/). A detached run returns at once and reports through .run/.
async function stageMode(argv, out, viewed) {
  const round = Number(option(argv, "round", "1"));
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("--round must be 1, 2 or 3");
  const stage = await import("./engine/stage/render.mjs");
  if (argv.includes("--detach")) {
    const detached = stage.detachStage(out, argv.slice(1));
    console.log(`rendering in the background (pid ${detached.pid}); progress: ${detached.progressFile}; the exit code lands in ${detached.exitFile}; log: ${detached.logFile}`);
    return EXIT.OK;
  }
  const stillsOnly = argv.includes("--stills-only");
  const result = await stage.renderStage(out, { round, stillsOnly });
  for (const entry of result.stills.files) console.log(`${entry.kind === "sheet" ? "contact sheet" : "still"}: ${path.join(out, entry.file)}`);
  if (result.stillsOnly) {
    console.log(`stills-only: open every still and the contact sheet, record the round with \`look --round ${round}\`, make the change, then render the film.`);
    return EXIT.OK;
  }
  const gate = runGate(out, { viewed });
  process.stdout.write(gate.report);
  return gate.exitCode;
}

async function run(argv) {
  const mode = argv[0];
  if (!mode || mode === "--help" || argv.includes("--help")) { console.log(usage); return EXIT.OK; }
  if (!["film", "stills", "sheet", "video", "perf", "gate", "frames", "stage", "sound", "look"].includes(mode)) { console.error(usage); return 2; }
  const out = option(argv, "out") ? path.resolve(option(argv, "out")) : undefined;
  if (!out) throw new Error("--out <dir> is required");
  const viewed = argv.includes("--viewed") ? Number(option(argv, "viewed", "0")) || 0 : undefined;
  if (mode === "gate") {
    const result = runGate(out, { viewed });
    process.stdout.write(result.report);
    return result.exitCode;
  }
  if (mode === "stage") return stageMode(argv, out, viewed);
  if (mode === "sound") return soundMode(out);
  if (mode === "look") return lookMode(argv, out);
  let treatment = null;
  if (mode !== "frames") {
    ({ treatment } = loadTreatment(out));
    if (treatment.path !== "type") throw Object.assign(new Error("BLOCKED_TREATMENT_INVALID (16): field path: this treatment takes the stage path; render it with `render.mjs stage --out <dir>`"), { exitCode: 16 });
    keepFirstTreatment(out, treatment);
  }
  if (argv.includes("--word-timing")) throw new Blocked("BLOCKED_DEPS_NOT_PREWARMED", EXIT.BLOCKED_DEPS_NOT_PREWARMED, "Tier-3 word-timing models are absent (no licence-verified Korean alignment model is pinned)", "litopencode motion-runtime install --word-timing, run outside the session");
  const briefPath = path.resolve(option(argv, "brief", ""));
  const rawBrief = readBrief(option(argv, "brief"));
  const brief = treatment ? briefForTreatment(rawBrief, treatment) : rawBrief;
  const state = inspectWarmState();
  if (state.blocked) throw new Blocked(state.blocked.name, state.blocked.exit, state.blocked.detail, state.fix);
  const round = Number(option(argv, "round", "1"));
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("--round must be 1, 2 or 3");
  const scale = Number(option(argv, "scale", "1"));
  if (!Number.isInteger(scale) || scale < 1 || scale > 4) throw new Error("--scale must be an integer 1..4");
  const samplesRequested = Number(option(argv, "samples", String(mode === "stills" || mode === "sheet" ? limits.previewSamples : limits.masterSamples)));
  const shutter = Number(option(argv, "shutter", String(limits.masterShutter)));
  if (!Number.isInteger(samplesRequested) || samplesRequested < 1 || samplesRequested > 16 || !(shutter >= 0 && shutter <= 1)) throw new Error("--samples must be 1..16 and --shutter 0..1");
  mkdirSync(path.join(out, ".run"), { recursive: true });
  let plan;
  let noFfmpeg = false;
  if (mode === "frames") {
    plan = { ...JSON.parse(readFileSync(option(argv, "plan"), "utf8")), state };
  } else {
    plan = planRun(brief, briefPath, { runDir: path.join(out, ".run"), targetDurationSec: treatment.durationSec, presetSource: presetSource(brief, treatment) }, state);
    plan.round = round; plan.scale = scale; plan.shutter = shutter; plan.showIndex = treatment.typePlan.showIndex === true; plan.outDir = out;
    const pre = preflightTimeline(plan);
    if (pre.failed.length) {
      process.stdout.write(writePreflightFailure(out, plan, pre.failed.map(([id, check]) => `${id}: FAIL  (${check.detail})`), briefPath));
      return EXIT.GATE_FAIL_QA;
    }
    // Without ffmpeg a film still writes its stills set and contact sheet, then stops with exit 12.
    noFfmpeg = (mode === "video" || (mode === "film" && !argv.includes("--stills-only"))) && !which("ffmpeg");
  }
  const engine = await startEngine(plan, out, { rungOnly: option(argv, "rung"), scale: plan.scale ?? scale, samplesRequested });
  try {
    if (engine.software) plan.warnings = [...(plan.warnings ?? []), `software-rendered, --samples lowered to 1 (${engine.launched.renderer})`];
    if (mode === "frames") {
      const hashes = {};
      for (const frame of option(argv, "frames").split(",").map(Number)) {
        const { rgba } = await engine.renderAt({ frame, samples: engine.samples, shutter });
        hashes[frame] = sha256(rgba);
      }
      console.log(JSON.stringify({ renderer: engine.launched.renderer, rung: engine.launched.rung.name, hashes }));
      return EXIT.OK;
    }
    const missing = await engine.page.evaluate(() => window.LTM.engine.preflight());
    writeFileSync(path.join(out, ".run", "preflight.json"), JSON.stringify({ missingGlyphs: missing }, null, 2) + "\n");
    writeFileSync(path.join(out, ".run", "brief.json"), JSON.stringify({ path: briefPath, sha256: sha256(readFileSync(briefPath)), sourceText: briefSourceText(brief), explicitPreset: plan.explicit ?? null, presetSource: presetSource(brief, treatment) }, null, 2) + "\n");
    if (missing.length) {
      process.stdout.write(writePreflightFailure(out, plan, [`MO-D-04: FAIL  (missing glyphs: ${missing.slice(0, 8).join(", ")})`], briefPath));
      return EXIT.GATE_FAIL_QA;
    }
    writeFileSync(path.join(out, ".run", "plan.json"), JSON.stringify({ ...plan, state: undefined }) + "\n");
    log(`preset ${plan.preset.id} (${plan.preset.reason}); ${plan.timeline.filter(isShot).length} shots, ${plan.durationSec}s; renderer ${engine.launched.renderer}; egress ${engine.egress.reason}`);
    if (mode === "perf") {
      const frameCount = Math.round(plan.durationSec * FRAME.fps);
      const times = [];
      for (let i = 0; i < limits.perfFrames; i++) {
        const frame = Math.min(frameCount - 1, Math.floor(((i + 0.5) * frameCount) / limits.perfFrames));
        const t0 = performance.now();
        await engine.renderAt({ frame, samples: 1, shutter, egress: "none" });
        times.push(performance.now() - t0);
      }
      const sorted = [...times].sort((a, b) => a - b);
      writeFileSync(path.join(out, ".run", "perf.json"), JSON.stringify({ renderer: engine.launched.renderer, chromeFlags: engine.launched.rung.flags, samples: 1, frameTimeMs: times }, null, 2) + "\n");
      console.log(`perf: ${times.length} frames at --samples 1, p95 ${sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1)} ms (${engine.launched.renderer})`);
      return EXIT.OK;
    }
    const stills = await renderStillsSet(engine, plan, out, treatment, round);
    // The sound plan and its cue sheet exist from the stills round on, so the look can compare cues and cuts.
    plan.track = resolveTrack(out, treatment, { frameCount: Math.round(plan.durationSec * FRAME.fps), fps: FRAME.fps, cuts: typeCuts(plan, treatment) }, typeof rawBrief.audio === "string" && rawBrief.audio.trim() ? path.resolve(path.dirname(briefPath), rawBrief.audio) : undefined);
    for (const entry of stills.files) console.log(`${entry.kind === "sheet" ? "contact sheet" : "still"}: ${path.join(out, entry.file)}`);
    if (noFfmpeg) throw new Blocked("BLOCKED_NO_FFMPEG_FOR_VIDEO", EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, "ffmpeg not found on PATH; the stills and contact sheet above were written", "install ffmpeg, or keep working from `film --stills-only`, which needs no ffmpeg");
    if (mode !== "film" && mode !== "video" || argv.includes("--stills-only")) {
      console.log(`stills-only: open every still and the contact sheet, record the round with \`look --round ${round}\`, make the change, then render the film.`);
      return EXIT.OK;
    }
    const extra = await renderFilm(engine, plan, out, { shutter });
    extra.treatmentSha256 = sha256(readFileSync(path.join(out, "treatment.json")));
    extra.stillsSha256 = sha256(readFileSync(path.join(out, "stills", "stills.json")));
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifestFor(plan, engine, extra), null, 2) + "\n");
    determinism(out, briefPath, extra.determinismFrames, engine, plan);
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifestFor(plan, engine, extra), null, 2) + "\n");
  } finally {
    await engine.close();
  }
  const result = runGate(out, { viewed });
  process.stdout.write(result.report);
  return result.exitCode;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const exitFile = option(argv, "exit-file");
  const finish = (code) => {
    process.exitCode = code;
    if (exitFile) writeFileSync(exitFile, JSON.stringify({ exitCode: code, finishedAt: new Date().toISOString() }) + "\n");
  };
  run(argv).then(finish).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    finish(error.exitCode ?? 1);
  });
}

