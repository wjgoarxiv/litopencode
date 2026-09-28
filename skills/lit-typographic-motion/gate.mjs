#!/usr/bin/env node
// lit-typographic-motion numeric QA gate (spec Section C, MO-D-02..04, and every measurable HARD or
// CAP row of the rule index). It reads a finished output directory: manifest.json, render.jsonl (per
// frame pass lines, frame lines and the preview audit records), the .run/ records (brief copy,
// pre-flight, contrast samples, determinism, perf) and the exports. It writes gate-report.txt, then
// promotes or withholds the exports (MO-C-16).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, FRAME, chromeFlagRungs, flashEventThreshold, isSoftwareRenderer, limits, postOverrideTable, provisionalRules, presets } from "./engine/constants.mjs";
import { countFlashes } from "./engine/flash.mjs";
import { bigEnough, boxContrast, hueClusters, warpMask } from "./engine/contrast.mjs";
import { decodePng } from "./engine/png.mjs";
import { eojeols, passSeed, readingFloor, selectPreset, unitCounts } from "./engine/text.mjs";
import { pinnedSampleTimes } from "./engine/timing.mjs";
import { checkStageRun, formatStageReport } from "./engine/stage/gate.mjs";
import { soundChecks } from "./engine/sound.mjs";
import { doneState, formatDone } from "./engine/look.mjs";

export const exportNames = ["film.mp4", "preview.webp", "preview.gif", "poster.png", "reduced-motion.png"];
const isShot = (entry) => entry.kind === "line" || entry.kind === "scene";
const pass = (detail = "") => ({ pass: true, detail });
const fail = (detail) => ({ pass: false, detail });
const eps = 1e-6;

export function readRun(dir) {
  const root = path.resolve(dir);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const lines = existsSync(path.join(root, "render.jsonl")) ? readFileSync(path.join(root, "render.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const json = (name) => (existsSync(path.join(root, ".run", name)) ? JSON.parse(readFileSync(path.join(root, ".run", name), "utf8")) : null);
  return {
    root, manifest,
    passLines: lines.filter((line) => line.stream === undefined && line.pass !== null && line.pass !== undefined),
    frameLines: lines.filter((line) => line.stream === undefined && line.pass === null),
    previewLines: lines.filter((line) => line.stream === "preview"),
    brief: json("brief.json"), preflight: json("preflight.json"), samples: json("samples.json"),
    determinism: json("determinism.json"), perf: json("perf.json"), still: json("still.json")
  };
}

// ---- timeline rules, shared with the renderer's pre-flight (MO-C-07/08, MO-A-11..16, MO-A-41a) ----
function gridBeats(manifest) {
  if (Array.isArray(manifest.beatGrid) && manifest.beatGrid.length >= 2) {
    const intervals = manifest.beatGrid.slice(1).map((t, i) => t - manifest.beatGrid[i]).sort((a, b) => a - b);
    return { beat: intervals[Math.floor(intervals.length / 2)], onGrid: (t) => t < eps || manifest.beatGrid.some((b) => Math.abs(b - t) <= 1 / manifest.fps + eps) || t > manifest.beatGrid.at(-1) };
  }
  const beat = 60 / manifest.bpm;
  return { beat, onGrid: (t) => Math.abs(t / beat - Math.round(t / beat)) * beat <= 1 / manifest.fps + eps };
}

export function timelineChecks(manifest) {
  const checks = {};
  const timeline = manifest.timeline ?? [];
  const fps = manifest.fps;
  const required = ["id", "sceneId", "shotIndex", "start", "end", "holdSec", "kind", "text", "script", "beatSec"];
  const malformed = timeline.find((entry) => required.some((key) => entry[key] === undefined) || Math.abs(entry.holdSec - (entry.end - entry.start)) > 1e-4 || !["line", "word", "reveal", "scene"].includes(entry.kind));
  checks["MO-A-41a"] = timeline.length && !malformed ? pass(`${timeline.length} entries`) : fail(malformed ? `malformed entry ${malformed.id ?? "?"}` : "empty timeline");
  let tightest = null;
  const under = [];
  const cps = [];
  for (const unit of timeline) {
    const floor = readingFloor(unit.text, unit.kind);
    const slack = unit.holdSec - floor;
    if (!tightest || slack < tightest.slack) tightest = { unit, floor, slack };
    if (unit.holdSec < floor - 1 / fps) under.push(`"${unit.text}" (${unit.kind}) ${unit.holdSec.toFixed(2)}s < ${floor.toFixed(2)}s`);
    if ((unit.kind === "line" || unit.kind === "scene") && unit.holdSec > 0 && unitCounts(unit.text).C / unit.holdSec > limits.latinCharsPerSecond + eps) cps.push(`"${unit.text}" ${(unitCounts(unit.text).C / unit.holdSec).toFixed(1)} cps`);
  }
  const detail = tightest ? `tightest unit "${tightest.unit.text.replace(/\n/gu, " / ")}" (${tightest.unit.kind}) hold ${tightest.unit.holdSec.toFixed(2)}s vs floor ${tightest.floor.toFixed(2)}s` : "no timeline";
  checks["MO-C-07/08"] = under.length || cps.length ? fail(`${[...under, ...cps].slice(0, 3).join("; ")} — ${detail}`) : pass(detail);
  const { beat, onGrid } = gridBeats(manifest);
  const offBeat = timeline.filter((entry) => Math.abs(entry.start - entry.beatSec) > 1 / fps + eps || !onGrid(entry.beatSec));
  checks["MO-A-15"] = offBeat.length ? fail(`${offBeat[0].id} starts ${(Math.abs(offBeat[0].start - offBeat[0].beatSec) * 1000).toFixed(1)} ms from its beat`) : pass(`every start within 1 frame of a grid beat (beat ${beat.toFixed(3)}s)`);
  const short = timeline.filter(isShot).filter((shot) => shot.holdSec < limits.minSceneBeats * beat - 1 / fps);
  checks["MO-A-16"] = short.length ? fail(`${short[0].id} holds ${short[0].holdSec.toFixed(2)}s < ${limits.minSceneBeats} beats`) : pass(`every shot >= ${limits.minSceneBeats} beats`);
  const split = [];
  for (const shot of timeline.filter(isShot)) {
    if (shot.kind !== "line") continue;
    const tokens = eojeols(shot.text);
    const reveals = timeline.filter((entry) => entry.kind === "reveal" && entry.sceneId === shot.sceneId && entry.shotIndex === shot.shotIndex);
    let cursor = 0;
    for (const reveal of reveals) {
      const parts = eojeols(reveal.text);
      const expected = tokens.slice(cursor, cursor + parts.length);
      if (parts.join(" ") !== expected.join(" ")) split.push(`${reveal.id} "${reveal.text}"`);
      cursor += parts.length;
    }
  }
  checks["MO-A-13"] = split.length ? fail(`reveal step splits a 어절: ${split[0]}`) : pass("reveal steps and breaks fall on 어절 boundaries");
  return checks;
}

// ---- helpers over the log ----
function eventsFromLog(frameLines) {
  const events = [];
  let flashHigh = false, invert = false;
  for (const line of frameLines) {
    for (const event of line.events ?? []) events.push({ ...event, frame: line.frame });
    const p = line.post ?? {};
    if ((p.flash ?? 0) > flashEventThreshold && !flashHigh) events.push({ kind: "flash", frame: line.frame, sceneId: line.sceneId, shotIndex: line.shotIndex });
    flashHigh = (p.flash ?? 0) > flashEventThreshold;
    if (Boolean(p.invert) !== invert && line.frame > 0) events.push({ kind: "invert", frame: line.frame, sceneId: line.sceneId, shotIndex: line.shotIndex });
    invert = Boolean(p.invert);
  }
  return events;
}

function sampleTimesOk(line, manifest) {
  const expected = pinnedSampleTimes(line.frame, manifest.samples, manifest.shutter, manifest.fps);
  return Array.isArray(line.sampleTimes) && line.sampleTimes.length === expected.length && line.sampleTimes.every((t, i) => Math.abs(t - expected[i]) < 1e-9);
}

function probeVideo(file) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,width,height,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (probe.status !== 0) return { error: (probe.stderr || probe.error?.message || "ffprobe failed").trim() };
  const json = JSON.parse(probe.stdout);
  return { ...json.streams?.[0], duration: Number(json.format?.duration) };
}

export function locateExport(root, name) {
  for (const candidate of [path.join(root, name), path.join(root, ".run", name), path.join(root, "withheld", name)]) if (existsSync(candidate)) return candidate;
  return null;
}

// ---- the full gate ----
export function checkRun(dir, options = {}) {
  const run = readRun(dir);
  const { manifest, passLines, frameLines, previewLines } = run;
  const fps = manifest.fps;
  const frameCount = Math.round(manifest.durationSec * fps);
  const timeline = manifest.timeline ?? [];
  const shots = timeline.filter(isShot);
  const look = presets[manifest.presetId];
  const checks = {};
  const warnings = [...(manifest.warnings ?? [])];
  const byFramePass = new Map(passLines.map((line) => [`${line.frame}:${line.pass}`, line]));
  const frameByIndex = new Map(frameLines.map((line) => [line.frame, line]));
  const shotOfFrame = (frame) => shots.find((shot) => frame >= Math.round(shot.start * fps) && frame < Math.round(shot.end * fps)) ?? shots.at(-1);

  // MO-C-01 / MO-SH-00 / 00a / 00b: every range has a log line on every frame, and the union of
  // ranges that actually drew covers every output frame.
  const covered = new Uint8Array(frameCount);
  let continuity = null;
  for (const range of manifest.passRanges ?? []) {
    for (let frame = range.frameStart; frame <= range.frameEnd; frame++) {
      const line = byFramePass.get(`${frame}:${range.pass}`);
      if (!line) { continuity ??= `${range.pass}@${range.sceneId}#${range.shotIndex} has no log line at frame ${frame}`; continue; }
      if (line.draws >= 1 && frame < frameCount) covered[frame] = 1;
    }
  }
  const gap = covered.findIndex((value) => !value);
  const missingFrameLine = Array.from({ length: frameCount }, (_, i) => i).find((i) => !frameByIndex.has(i));
  checks["MO-C-01"] = !(manifest.passRanges ?? []).length ? fail("manifest lists no GLSL pass")
    : continuity ? fail(continuity)
    : gap >= 0 ? fail(`frame ${gap} has no look-library pass with draws >= 1`)
    : missingFrameLine !== undefined ? fail(`frame ${missingFrameLine} has no frame line`)
    : pass(`${frameCount}/${frameCount} frames covered by a pass that drew`);

  const seedErrors = [];
  for (const range of manifest.passRanges ?? []) {
    const expected = range.pass === "swiss-grid" ? null : passSeed(manifest.seed, range.sceneId, range.shotIndex, range.pass);
    if (range.seed !== expected) { seedErrors.push(`${range.pass}@${range.sceneId}#${range.shotIndex} seed ${range.seed} != ${expected}`); continue; }
    if (expected === null) continue;
    for (let frame = range.frameStart; frame <= range.frameEnd; frame++) {
      const logged = byFramePass.get(`${frame}:${range.pass}`)?.uniforms?.u_seed;
      if (logged !== undefined && logged !== expected) { seedErrors.push(`${range.pass} frame ${frame} u_seed ${logged} != ${expected}`); break; }
    }
  }
  checks["MO-SH-01"] = seedErrors.length ? fail(seedErrors[0]) : pass("every pass seed = fnv1a32(runSeed:sceneId:shotIndex:pass)");

  // MO-C-02 / MO-A-04 / MO-SH-09 / MO-A-51
  const software = isSoftwareRenderer(manifest.renderer);
  const labelled = (manifest.warnings ?? []).some((w) => /software-rendered, --samples lowered/u.test(w));
  checks["MO-C-02"] = !manifest.renderer || /NO_WEBGL2/u.test(manifest.renderer) ? fail("webgl2: false")
    : manifest.softwareRenderer !== software ? fail(`softwareRenderer flag ${manifest.softwareRenderer} disagrees with renderer "${manifest.renderer}"`)
    : software && !labelled ? fail(`software renderer "${manifest.renderer}" is not labelled`)
    : pass(`${software ? "software (labelled)" : "hardware"} — ${manifest.renderer}`);
  checks["MO-A-04"] = software && manifest.samples !== 1 ? fail(`software GL with --samples ${manifest.samples}`) : pass(software ? "software GL, samples 1" : "hardware GL");
  const downgradeErrors = [];
  for (const range of manifest.passRanges ?? []) {
    const affected = range.pass === "tidal-gradient" || range.pass === "crt";
    if (software && affected && !range.downgraded) downgradeErrors.push(`${range.pass}@${range.sceneId} not marked downgraded`);
    if (software && range.pass === "tidal-gradient" && range.params.octaves !== Math.max(3, Math.floor(presets.tidal.params["tidal-gradient"].octaves / 2))) downgradeErrors.push(`tidal-gradient octaves ${range.params.octaves}`);
    if (software && range.pass === "crt" && range.params.persistenceEnabled) downgradeErrors.push("crt persistence left on under software GL");
    if (!software && range.downgraded) downgradeErrors.push(`${range.pass}@${range.sceneId} downgraded on a hardware renderer`);
  }
  checks["MO-SH-09"] = downgradeErrors.length ? fail(downgradeErrors[0]) : pass(software ? "downgrade formula applied" : "no downgrade needed");
  const rungs = chromeFlagRungs().map((rung) => rung.flags.join(" "));
  checks["MO-A-51"] = rungs.includes((manifest.chromeFlags ?? []).join(" ")) ? pass(manifest.chromeFlags.join(" ")) : fail(`chromeFlags is not a ladder rung: ${(manifest.chromeFlags ?? []).join(" ")}`);

  // MO-C-03 / MO-SH-04 / MO-SH-04a
  const master = countFlashes(frameLines.sort((a, b) => a.frame - b.frame).map((line) => line.transitions ?? {}), fps, false);
  const previewFps = manifest.preview?.fps ?? fps;
  const preview = previewLines.length ? countFlashes(previewLines.sort((a, b) => a.previewFrame - b.previewFrame).map((line) => line.transitions ?? {}), previewFps, true) : null;
  const general = Math.max(master.general, preview?.general ?? 0), red = Math.max(master.red, preview?.red ?? 0);
  const worstSource = (preview && (preview.general > master.general || preview.red > master.red)) ? { name: "preview", r: preview, fps: previewFps } : { name: "master", r: master, fps };
  const worstStart = worstSource.r.worstWindow.general.flashes >= worstSource.r.worstWindow.red.flashes ? worstSource.r.worstWindow.general : worstSource.r.worstWindow.red;
  const flashDetail = `worst window ${general} general / ${red} red  (limit ${limits.flashLimitGeneral} / ${limits.flashLimitRed}); ${worstSource.name} window at frame ${worstStart.start} (${(worstStart.start / worstSource.fps).toFixed(2)}s) transitions ${worstStart.transitions.join(" ") || "none"}`;
  checks["MO-C-03"] = !previewLines.length && options.requirePreview !== false ? fail(`preview frames were not audited; ${flashDetail}`)
    : general <= limits.flashLimitGeneral && red <= limits.flashLimitRed ? pass(flashDetail) : fail(flashDetail);
  const stepFrame = frameLines.find((line) => line.fullStep);
  const stepPreview = previewLines.find((line) => line.fullStep);
  checks["MO-SH-04a"] = stepFrame || stepPreview ? fail(`full-frame luminance step at ${stepFrame ? `frame ${stepFrame.frame}` : `preview frame ${stepPreview.previewFrame}`}`) : pass("no full-frame luminance step in any frame pair");

  // MO-SH-03 / MO-A-58
  const events = eventsFromLog(frameLines);
  let crowded = null;
  for (const shot of shots) {
    const times = events.filter((event) => event.sceneId === shot.sceneId && event.shotIndex === shot.shotIndex).map((event) => event.frame / fps).sort((a, b) => a - b);
    for (let i = 0; i + limits.eventsPerSecondPerShot < times.length; i++) {
      if (times[i + limits.eventsPerSecondPerShot] - times[i] < 1 - eps) { crowded = `${shot.id}: ${limits.eventsPerSecondPerShot + 1} events within ${(times[i + limits.eventsPerSecondPerShot] - times[i]).toFixed(2)}s from ${times[i].toFixed(2)}s`; break; }
    }
    if (crowded) break;
  }
  checks["MO-SH-03"] = crowded ? fail(crowded) : pass(`${events.length} events, at most ${limits.eventsPerSecondPerShot} in any 1 s window per shot`);
  const overrideErrors = [];
  let lastInvertChange = null;
  const { beat } = gridBeats(manifest);
  for (const line of frameLines) {
    for (const [field, rule] of Object.entries(postOverrideTable)) {
      const value = line.post?.[field];
      if (value === undefined) continue;
      if (rule.kind === "number" && (typeof value !== "number" || value < rule.min || (rule.exclusiveMin && value <= rule.min) || value > rule.max)) overrideErrors.push(`frame ${line.frame} ${field}=${value}`);
      if (rule.kind === "boolean" && typeof value !== "boolean") overrideErrors.push(`frame ${line.frame} invert must be boolean`);
      if (rule.kind === "pair" && !(Array.isArray(value) && value.length === 2 && value.every(Number.isFinite))) overrideErrors.push(`frame ${line.frame} shake must be a pair`);
    }
  }
  for (const event of events.filter((e) => e.kind === "invert")) {
    const shot = shotOfFrame(event.frame);
    if (event.frame !== Math.round(shot.start * fps)) overrideErrors.push(`invert changes at frame ${event.frame}, not on a cut`);
    if (lastInvertChange !== null && (event.frame - lastInvertChange) / fps < limits.minSceneBeats * beat - 1 / fps) overrideErrors.push(`invert held ${((event.frame - lastInvertChange) / fps).toFixed(2)}s < ${limits.minSceneBeats} beats`);
    lastInvertChange = event.frame;
  }
  checks["MO-A-58"] = overrideErrors.length ? fail(overrideErrors[0]) : pass("every override inside its range; invert only on cuts");

  // MO-SH-05..08, MO-SH-10, MO-A-05
  const passErrors = [];
  for (const range of manifest.passRanges ?? []) {
    const p = range.params ?? {};
    const shot = shots.find((s) => s.sceneId === range.sceneId && s.shotIndex === range.shotIndex);
    if (range.pass === "glitch") {
      if (!(p.hitRatePerSecRealized <= limits.glitchHitRateCap)) passErrors.push(["MO-SH-05", `glitch hit rate ${p.hitRatePerSecRealized}/s > ${limits.glitchHitRateCap}`]);
      if (!(p.areaCapPct <= limits.glitchAreaCapPct) || !(p.maxAreaPctRealized <= limits.glitchAreaCapPct)) passErrors.push(["MO-SH-05", `glitch area ${p.maxAreaPctRealized ?? p.areaCapPct}% > ${limits.glitchAreaCapPct}%`]);
      const hits = events.filter((e) => e.kind === "glitch" && e.sceneId === range.sceneId && e.shotIndex === range.shotIndex).map((e) => e.frame / fps);
      for (let i = 0; i + 2 < hits.length; i++) if (hits[i + 2] - hits[i] < 1 - eps) passErrors.push(["MO-SH-05", `3 glitch hits within 1 s at ${hits[i].toFixed(2)}s`]);
    }
    if (range.pass === "tidal-gradient") {
      if (!(p.surgeAttackSec >= limits.surgeEdgeFloorSec) || !(p.surgeDecaySec >= limits.surgeEdgeFloorSec)) passErrors.push(["MO-SH-06", `surge attack ${p.surgeAttackSec}s / decay ${p.surgeDecaySec}s under ${limits.surgeEdgeFloorSec}s`]);
      if (!(p.surgeCapPerSec <= limits.surgeRateCap)) passErrors.push(["MO-SH-06", `surge cap ${p.surgeCapPerSec}/s > ${limits.surgeRateCap}`]);
      const surges = events.filter((e) => e.kind === "surge" && e.sceneId === range.sceneId && e.shotIndex === range.shotIndex).map((e) => e.frame / fps);
      for (let i = 0; i + 2 < surges.length; i++) if (surges[i + 2] - surges[i] < 1 - eps) passErrors.push(["MO-SH-06", `3 surges within 1 s at ${surges[i].toFixed(2)}s`]);
      for (const e of events.filter((ev) => ev.kind === "surge" && ev.sceneId === range.sceneId)) if (!(e.attackSec >= limits.surgeEdgeFloorSec && e.decaySec >= limits.surgeEdgeFloorSec)) passErrors.push(["MO-SH-06", `surge at frame ${e.frame} has attack ${e.attackSec}s / decay ${e.decaySec}s`]);
    }
    if (range.pass === "crt") {
      let peak = p.flickerAmpRealized ?? 0;
      for (let frame = range.frameStart; frame <= range.frameEnd; frame++) peak = Math.max(peak, byFramePass.get(`${frame}:crt`)?.uniforms?.u_flickerAmp ?? 0);
      if (peak > limits.crtFlickerCap + eps) passErrors.push(["MO-SH-07", `CRT flicker ${peak} > ${limits.crtFlickerCap}`]);
      if (p.persistenceEnabled && !shot?.stateful) passErrors.push(["MO-A-05", `persistence on non-stateful scene ${range.sceneId}#${range.shotIndex}`]);
    }
    if (range.pass === "dither") {
      for (let frame = range.frameStart; frame <= range.frameEnd; frame++) {
        const logged = byFramePass.get(`${frame}:dither`)?.uniforms?.u_seed;
        if (logged !== undefined && logged !== range.seed) { passErrors.push(["MO-SH-08", `dither reseeded inside ${range.sceneId}#${range.shotIndex} at frame ${frame}`]); break; }
      }
    }
    if (range.pass === "swiss-grid") {
      if (p.showGuides !== false) passErrors.push(["MO-SH-10", `showGuides ${p.showGuides} in ${range.sceneId}`]);
      for (let frame = range.frameStart; frame <= range.frameEnd; frame++) if (byFramePass.get(`${frame}:swiss-grid`)?.uniforms?.u_showGuides === true) { passErrors.push(["MO-SH-10", `showGuides true at frame ${frame}`]); break; }
    }
  }
  for (const id of ["MO-SH-05", "MO-SH-06", "MO-SH-07", "MO-SH-08", "MO-SH-10", "MO-A-05"]) {
    const found = passErrors.find(([rule]) => rule === id);
    checks[id] = found ? fail(found[1]) : pass();
  }

  // Type geometry rules (MO-C-04/05/25/26/27, MO-FT-04, MO-A-33, MO-A-35, MO-A-13 line breaks)
  const boxes = frameLines.flatMap((line) => (line.textBoxes ?? []).map((box) => ({ ...box, frame: line.frame })));
  const graphics = frameLines.flatMap((line) => (line.graphics ?? []).map((g) => ({ ...g, frame: line.frame })));
  const titleViolations = boxes.filter((b) => b.bbox && (b.bbox[0] < limits.titleSafeX - eps || b.bbox[1] < limits.titleSafeY - eps || b.bbox[2] > FRAME.width - limits.titleSafeX + eps || b.bbox[3] > FRAME.height - limits.titleSafeY + eps));
  const overrun = (b) => Math.max(limits.titleSafeX - b.bbox[0], limits.titleSafeY - b.bbox[1], b.bbox[2] - (FRAME.width - limits.titleSafeX), b.bbox[3] - (FRAME.height - limits.titleSafeY)).toFixed(1);
  checks["MO-C-04"] = titleViolations.length ? fail(`violations: ${[...new Map(titleViolations.map((b) => [b.elementId, b])).values()].slice(0, 3).map((b) => `${b.text.replace(/\n/gu, " / ")}@${b.frame}:${overrun(b)} px`).join(", ")}`) : pass("violations: none");
  const actionViolations = graphics.filter((g) => g.bbox && (g.bbox[0] < limits.actionSafeX - eps || g.bbox[1] < limits.actionSafeY - eps || g.bbox[2] > FRAME.width - limits.actionSafeX + eps || g.bbox[3] > FRAME.height - limits.actionSafeY + eps));
  checks["MO-C-05"] = actionViolations.length ? fail(`${actionViolations[0].elementId} at frame ${actionViolations[0].frame} crosses the 95% action-safe border`) : pass(`${new Set(graphics.map((g) => g.elementId)).size} graphic elements inside action-safe`);
  const trackingErrors = [], hangulErrors = [], outlineErrors = [], leadingErrors = [], measureErrors = [], measureNotes = [], breakErrors = [];
  const pairFiles = ["LitOpenCodeSans-Regular.otf", "LitOpenCodeSans-Bold.otf", "Galmuri9.ttf", "Pretendard-Regular.otf"];
  for (const box of boxes) {
    for (const run of box.runs ?? []) {
      if (run.script === "latin" && box.voice === "display" && run.trackingEm < limits.displayTrackingFloorEm - eps) trackingErrors.push(`"${box.text}" display tracking ${run.trackingEm}em @${box.frame}`);
      if (run.script === "latin" && box.voice !== "display" && run.trackingEm < -eps) trackingErrors.push(`"${box.text}" ${box.voice} voice tracking ${run.trackingEm}em @${box.frame}`);
      if (run.script === "hangul") {
        if (Math.abs(run.trackingEm) > eps || run.widthPct !== 100) hangulErrors.push(["MO-FT-04", `Hangul run "${run.text}" tracking ${run.trackingEm}em width ${run.widthPct}% @${box.frame}`]);
        if (run.scaleX !== 1 || ![400, 700].includes(run.weight) || !pairFiles.includes(path.basename(String(run.font)))) hangulErrors.push(["MO-A-33", `Hangul run "${run.text}" synthesized (scaleX ${run.scaleX}, weight ${run.weight}, font ${run.font}) @${box.frame}`]);
      }
    }
    if (box.outline || box.halo) outlineErrors.push(`"${box.text}" is ${box.outline ? "outlined" : "haloed"} @${box.frame}`);
    if ((box.lineCount ?? 1) >= 2) {
      const cjk = (box.runs ?? []).some((run) => run.script === "hangul");
      const floor = Math.max(cjk ? limits.lineHeightCjk : limits.lineHeightLatin, box.lineCount >= 3 ? limits.lineHeightThreePlus : 0);
      if (!(box.lineHeight >= floor - eps)) leadingErrors.push(`"${box.elementId}" ${box.lineCount} lines at line-height ${box.lineHeight} < ${floor} @${box.frame}`);
      if (Array.isArray(box.lines) && cjk) {
        const shot = shotOfFrame(box.frame);
        const tokens = new Set(eojeols(shot.text.replace(/\n/gu, " ")));
        const bad = box.lines.flatMap((line) => eojeols(line)).find((token) => !tokens.has(token));
        if (bad) breakErrors.push(`"${bad}" in ${box.elementId} @${box.frame} is not a whole 어절 of the shot text`);
      }
    }
    if (box.role === "paragraph") {
      const cjk = (box.runs ?? []).some((run) => run.script === "hangul");
      if (cjk && (box.measureCh < limits.cjkMeasureMinCh || box.measureCh > limits.cjkMeasureMaxCh)) measureNotes.push(`advisory: Korean paragraph measure ${box.measureCh}ch outside ${limits.cjkMeasureMinCh}-${limits.cjkMeasureMaxCh}ch`);
      if (!cjk && (box.measureCh < limits.measureMinCh || box.measureCh > limits.measureMaxCh)) measureErrors.push(`paragraph "${box.elementId}" measure ${box.measureCh}ch outside ${limits.measureMinCh}-${limits.measureMaxCh}ch @${box.frame}`);
    }
  }
  checks["MO-C-25"] = trackingErrors.length ? fail(trackingErrors[0]) : pass(`display >= ${limits.displayTrackingFloorEm}em, machine/body >= 0`);
  for (const id of ["MO-FT-04", "MO-A-33"]) { const found = hangulErrors.find(([rule]) => rule === id); checks[id] = found ? fail(found[1]) : pass(); }
  checks["MO-A-35"] = outlineErrors.length ? fail(outlineErrors[0]) : pass("no outlined or haloed type");
  checks["MO-C-26"] = leadingErrors.length ? fail(leadingErrors[0]) : pass(`${new Set(boxes.filter((b) => (b.lineCount ?? 1) >= 2).map((b) => b.elementId)).size} multi-line blocks at or above their floor`);
  checks["MO-C-27"] = measureErrors.length ? fail(measureErrors[0]) : pass(measureNotes[0] ?? "paragraph cards inside 60-75ch");
  Object.assign(checks, timelineChecks(manifest));
  if (breakErrors.length) checks["MO-A-13"] = fail(breakErrors[0]);

  // MO-C-06 contrast on the recorded sample frames
  let minContrast = null;
  const contrastErrors = [];
  const crtRange = (manifest.passRanges ?? []).find((range) => range.pass === "crt");
  const crtCurvature = crtRange ? crtRange.params?.curvature ?? presets.terminalcore.params.crt.curvature : 0;
  for (const sample of run.samples?.frames ?? []) {
    const frameFile = path.join(run.root, ".run", "samples", `f${sample.frame}.png`);
    const maskFile = path.join(run.root, ".run", "samples", `f${sample.frame}-mask.png`);
    const line = frameByIndex.get(sample.frame);
    if (!line || !existsSync(frameFile) || !existsSync(maskFile)) { contrastErrors.push(`sample frame ${sample.frame} is missing its PNG or mask`); continue; }
    const image = decodePng(readFileSync(frameFile));
    const maskImage = decodePng(readFileSync(maskFile));
    const mask = warpMask(maskImage.pixels, maskImage.width, maskImage.height, crtCurvature);
    for (const box of line.textBoxes ?? []) {
      const measured = boxContrast(image.pixels, mask, image.width, image.height, box, manifest.scale ?? 1);
      if (!measured) continue;
      if (!minContrast || measured.ratio / measured.floor < minContrast.ratio / minContrast.floor) minContrast = { ...measured, frame: sample.frame, text: box.text };
      if (measured.ratio < measured.floor) contrastErrors.push(`"${box.text.replace(/\n/gu, " / ")}" at frame ${sample.frame}: ${measured.ratio.toFixed(2)}:1 < ${measured.floor}:1`);
    }
  }
  checks["MO-C-06"] = !run.samples ? fail("no contrast sample frames were recorded")
    : contrastErrors.length ? fail(contrastErrors[0])
    : minContrast ? pass(`min ratio ${minContrast.ratio.toFixed(1)}:1 at frame ${minContrast.frame}  (floor ${minContrast.floor.toFixed(1)}:1)`) : fail("no measurable text on the sample frames");

  // MO-C-09 / MO-A-24 / MO-A-25 / MO-A-28
  const det = run.determinism;
  if (!det) checks["MO-C-09"] = fail("no determinism re-render was recorded");
  else {
    const mismatches = det.frames.filter((entry) => entry.master !== entry.rerender);
    const logMismatch = det.frames.find((entry) => frameByIndex.get(entry.frame)?.rgbaSha256 !== entry.master);
    const frames = det.frames.map((entry) => entry.frame).join(",");
    if (logMismatch) checks["MO-C-09"] = fail(`recorded master hash for frame ${logMismatch.frame} does not match render.jsonl`);
    else if (!mismatches.length) checks["MO-C-09"] = pass(`rgbaSha256 match Y  (frames re-rendered: ${frames})`);
    else if (det.swiftshader && det.swiftshader.every((entry) => entry.a === entry.b)) {
      checks["MO-C-09"] = pass(`rgbaSha256 match N on hardware, Y under SwiftShader — WARN hardware-nondeterminism (frames re-rendered: ${frames})`);
      warnings.push("hardware-nondeterminism");
    } else checks["MO-C-09"] = fail(`rgbaSha256 match N at frame ${mismatches[0].frame}: ${mismatches[0].master} vs ${mismatches[0].rerender}${det.swiftshader ? " (SwiftShader pair also differs)" : ""}`);
  }
  checks["MO-A-25"] = det && det.seeked && checks["MO-C-09"].pass ? pass(`seeked re-render equals the sequential frame lines${det.statefulFrames?.length ? ` (stateful preroll frames ${det.statefulFrames.join(",")})` : ""}`) : fail(det ? "seeked frames did not match the sequential render" : "no seeked re-render recorded");
  const badSample = frameLines.find((line) => !sampleTimesOk(line, manifest));
  checks["MO-A-28"] = badSample ? fail(`frame ${badSample.frame} sample times do not follow t_n + (shutter/fps)((i+0.5)/N - 0.5)`) : pass(`${manifest.samples} pinned sub-samples, shutter ${manifest.shutter}`);

  // MO-C-10..13, MO-A-03, MO-A-37..41, MO-C-14
  const film = locateExport(run.root, "film.mp4");
  const video = film ? probeVideo(film) : null;
  const rate = video?.r_frame_rate ? Number(video.r_frame_rate.split("/")[0]) / Number(video.r_frame_rate.split("/")[1] ?? 1) : 0;
  const tags = video && video.pix_fmt === "yuv420p" && video.color_space === "bt709" && video.color_range === "tv";
  const techOk = video && !video.error && video.codec_name === "h264" && video.width >= FRAME.width && video.height >= FRAME.height && rate >= limits.minFps && Math.abs(rate - fps) < 0.01 && manifest.durationSec >= limits.minDurationSec && tags;
  if (manifest.durationSec > limits.warnDurationSec) warnings.push(`duration ${manifest.durationSec}s is over ${limits.warnDurationSec}s`);
  checks["MO-C-10/11/12"] = techOk ? pass(`(ffprobe yuv420p/bt709/tv Y) ${video.width}x${video.height} @ ${rate} fps, ${manifest.durationSec}s; transfer ${video.color_transfer ?? "unset"}, primaries ${video.color_primaries ?? "unset"}`)
    : fail(`(ffprobe yuv420p/bt709/tv ${tags ? "Y" : "N"}) ${video ? JSON.stringify({ codec: video.codec_name, width: video.width, height: video.height, rate, pix: video.pix_fmt, space: video.color_space, range: video.color_range, trc: video.color_transfer, primaries: video.color_primaries, error: video.error }) : "no MP4"}; duration ${manifest.durationSec}s`);
  checks["MO-A-03"] = techOk ? pass("pinned BT.709 encode") : fail("MP4 encode tags do not match the pinned BT.709 encode");
  const previewFile = locateExport(run.root, "preview.webp") ?? locateExport(run.root, "preview.gif");
  const poster = locateExport(run.root, "poster.png");
  const still = locateExport(run.root, "reduced-motion.png");
  const sizes = { mp4: film ? statSync(film).size : 0, preview: previewFile ? statSync(previewFile).size : 0, poster: poster ? statSync(poster).size : 0 };
  if (film && sizes.mp4 > limits.mp4WarnBytesPer10s * (manifest.durationSec / 10)) warnings.push(`MP4 is ${sizes.mp4} B, over 100 MB per 10 s`);
  const sizeOk = sizes.preview > 0 && sizes.preview <= limits.previewMaxBytes && sizes.poster > 0 && sizes.poster <= limits.posterMaxBytes;
  checks["MO-C-13"] = sizeOk ? pass(`mp4 ${sizes.mp4}, ${previewFile ? path.basename(previewFile).split(".").pop() : "webp"} ${sizes.preview} (cap 3 MB), poster ${sizes.poster} (cap 1 MB)`)
    : fail(`mp4 ${sizes.mp4}, preview ${sizes.preview} (cap 3 MB), poster ${sizes.poster} (cap 1 MB)`);
  const missing = [["MP4", film], ["preview", previewFile], ["poster", poster], ["reduced-motion still", still]].filter(([, file]) => !file).map(([name]) => name);
  checks["MO-A-37-41"] = missing.length ? fail(`missing ${missing.join(", ")}`) : pass("MP4, preview, poster, reduced-motion still and manifest present");
  const lastText = [...timeline].filter(isShot).at(-1);
  const referenceFrame = lastText ? Math.round(lastText.end * fps) - 1 : frameCount - 1;
  const referenceInk = frameByIndex.get(referenceFrame)?.inkPixels ?? 0;
  const stillInk = run.still?.inkPixels ?? 0;
  checks["MO-C-14"] = still && referenceInk > 0 && stillInk >= limits.stillInkRatio * referenceInk ? pass(`present Y, ink-coverage check PASS (${stillInk} vs ${referenceInk} at frame ${referenceFrame})`)
    : fail(`present ${still ? "Y" : "N"}, ink-coverage check FAIL (${stillInk} vs ${referenceInk} at frame ${referenceFrame}, need ${limits.stillInkRatio}x)`);

  // MO-C-29 one signal + one accent cluster
  const observations = [];
  for (const line of frameLines) {
    const shot = shotOfFrame(line.frame);
    for (const box of line.textBoxes ?? []) if (typeof box.fill === "string" && bigEnough(box.bbox)) observations.push({ color: box.fill, frame: line.frame, entryId: shot.id });
    for (const fill of line.fills ?? []) {
      if (!bigEnough(fill.bbox)) continue;
      for (const color of fill.stops ?? [fill.color]) observations.push({ color, frame: line.frame, entryId: shot.id });
    }
  }
  const clusters = hueClusters(observations).sort((a, b) => b.frames - a.frames);
  const accentHex = look.palette.accent?.toUpperCase();
  const accent = clusters.find((c) => accentHex && c.colors.includes(accentHex)) ?? (clusters.length > 1 ? clusters.at(-1) : null);
  checks["MO-C-29"] = clusters.length > 2 ? fail(`${clusters.length} saturated clusters: ${clusters.map((c) => `${c.hue}° ${c.colors.join("/")}`).join(", ")}`)
    : accent && accent.entries.length > limits.accentMaxEntries ? fail(`accent ${accent.colors.join("/")} appears in ${accent.entries.length} timeline entries: ${accent.entries.join(", ")}`)
    : accent && accent.frames > limits.accentMaxFrameFraction * frameCount ? fail(`accent ${accent.colors.join("/")} on ${accent.frames}/${frameCount} frames (> ${limits.accentMaxFrameFraction * 100}%)`)
    : pass(`${clusters.length} saturated cluster(s)${accent ? `; accent in ${accent.entries.join(", ")} on ${accent.frames} frames` : ""}`);

  // MO-D-02..04
  const perf = run.perf;
  if (!perf) checks["MO-D-02"] = fail("no perf run recorded");
  else {
    const times = [...perf.frameTimeMs].sort((a, b) => a - b);
    const p95 = times[Math.max(0, Math.ceil(times.length * 0.95) - 1)];
    const ceiling = isSoftwareRenderer(perf.renderer) ? limits.softwareGpuP95Ms : limits.realGpuP95Ms;
    checks["MO-D-02"] = times.length >= limits.perfFrames && p95 <= ceiling ? pass(`p95 ${p95.toFixed(1)} ms over ${times.length} frames (ceiling ${ceiling} ms)`)
      : fail(`p95 ${p95?.toFixed(1)} ms over ${times.length} frames (ceiling ${ceiling} ms); lower --samples or tidal octaves`);
  }
  let emptyError = null;
  for (const shot of shots) {
    const first = Math.round(shot.start * fps), last = Math.round(shot.end * fps) - 1;
    const allowance = Math.round(limits.nearBlackFloorMultiple * limits.minSceneBeats * beat * fps);
    let run0 = 0;
    for (let frame = first; frame <= last; frame++) {
      const line = frameByIndex.get(frame);
      const empty = line && line.inkPixels === 0 && line.p995L < limits.nearBlackLuminance;
      run0 = empty ? run0 + 1 : 0;
      const edge = frame < limits.nearBlackFadeSec * fps || frame >= frameCount - limits.nearBlackFadeSec * fps ? limits.nearBlackFadeSec * fps : 0;
      if (run0 > allowance + edge) { emptyError = `${run0} empty/near-black frames ending at ${frame} in ${shot.id} (allowance ${allowance})`; break; }
    }
    if (emptyError) break;
  }
  checks["MO-D-03"] = emptyError ? fail(emptyError) : pass("no empty or near-black run past 2x the scene's minimum hold");
  const glyphs = run.preflight?.missingGlyphs;
  checks["MO-D-04"] = !run.preflight ? fail("pre-flight glyph coverage was not recorded") : glyphs.length ? fail(`missing glyphs: ${glyphs.slice(0, 5).join(", ")}`) : pass("every codepoint resolves in its assigned font");

  // MO-B-00 recheck, MO-C-15/16 round bookkeeping
  if (run.brief) {
    const expected = selectPreset(run.brief.sourceText ?? "", run.brief.explicitPreset);
    checks["MO-B-00"] = expected.id === manifest.presetId ? pass(`${manifest.presetId} (${expected.reason})`) : fail(`preset ${manifest.presetId} but the keyword table picks ${expected.id}`);
  } else checks["MO-B-00"] = fail("no brief copy recorded");
  const round = manifest.craftRound;
  checks["MO-C-15/16"] = Number.isInteger(round) && round >= 1 && round <= 3 ? pass(`round ${round} of 3`) : fail(`craft round ${round} outside 1..3`);

  // Sound rows on the decoded muxed stream, for renders that planned sound through a treatment.
  if (manifest.sound?.mode) {
    for (const [id, row] of Object.entries(soundChecks(film, manifest.durationSec, manifest.sound.mode))) {
      if (row.warn) warnings.push(`${id}: ${row.detail}`);
      else checks[id] = row;
    }
  }
  const failed = Object.entries(checks).filter(([, check]) => !check.pass).map(([id]) => id);
  return { run, manifest, checks, warnings, failed, passed: failed.length === 0, sizes, minContrast, frameCount, flash: { master, preview } };
}

const fixedOrder = ["MO-C-25", "MO-C-26", "MO-C-27", "MO-C-29", "MO-D-02", "MO-D-03", "MO-D-04"];
const indexOrder = ["MO-A-03", "MO-A-04", "MO-A-05", "MO-A-13", "MO-A-15", "MO-A-16", "MO-A-25", "MO-A-28", "MO-A-33", "MO-A-35", "MO-A-37-41", "MO-A-41a", "MO-A-51", "MO-A-58",
  "MO-SH-01", "MO-SH-03", "MO-SH-04a", "MO-SH-05", "MO-SH-06", "MO-SH-07", "MO-SH-08", "MO-SH-09", "MO-SH-10", "MO-B-00", "MO-FT-04", "MO-C-15/16"];
const labels = {
  "MO-C-01": "GLSL presence:        ", "MO-C-02": "WebGL2 tier:          ", "MO-C-03": "flash audit:          ", "MO-C-04": "title-safe:           ",
  "MO-C-05": "action-safe:          ", "MO-C-06": "type contrast:        ", "MO-C-07/08": "reading time:      ", "MO-C-09": "determinism:         ",
  "MO-C-10/11/12": "duration/fps/res: ", "MO-C-13": "file sizes:           ", "MO-C-14": "reduced-motion still: "
};

export function formatReport(result, context) {
  const { manifest, checks } = result;
  const out = (name) => path.join(context.exportDir, name);
  const previewName = manifest.previewEncoder === "gif" ? "preview.gif" : "preview.webp";
  const lines = [
    "lit-typographic-motion — render report",
    `outputs: ${out("film.mp4")} · ${out(previewName)} (encoder: ${manifest.previewEncoder}) · ${out("poster.png")} · ${out("reduced-motion.png")}`,
    `preset: ${manifest.presetId}  (chosen because: ${context.presetReason})`,
    `duration / fps / resolution: ${manifest.durationSec} s @ ${manifest.fps} fps, ${manifest.resolution[0] * (manifest.scale ?? 1)}x${manifest.resolution[1] * (manifest.scale ?? 1)}`,
    `GLSL passes (manifest): ${(manifest.passRanges ?? []).map((r) => `${r.pass}@${r.sceneId}#${r.shotIndex}:${r.frameStart}-${r.frameEnd}`).join(", ")}`,
    `WebGL2: ${manifest.softwareRenderer ? "software" : "hardware"} — ${manifest.renderer}  (flags: ${(manifest.chromeFlags ?? []).join(" ")})`,
    "",
    `QA gate: ${result.passed ? "PASS" : "FAIL"}`
  ];
  const line = (id) => {
    const check = checks[id];
    const provisional = id === "MO-C-07/08" || provisionalRules.includes(id) ? " [provisional]" : "";
    const status = check.pass ? "PASS" : "FAIL";
    if (id === "MO-C-03") return `  MO-C-03 flash audit:          ${check.detail.split(";")[0]}  ${status}`;
    if (id === "MO-C-06") return `  MO-C-06 type contrast:        ${check.detail}  ${status}${provisional}`;
    if (id === "MO-C-07/08") return `  MO-C-07/08 reading time:      ${check.detail}  ${status}${provisional}`;
    if (id === "MO-C-09") return `  MO-C-09 determinism:         ${check.detail}  ${status}`;
    if (id === "MO-C-10/11/12") return `  MO-C-10/11/12 duration/fps/res: ${status}  ${check.detail}`;
    if (id === "MO-C-13") return `  MO-C-13 file sizes:           ${check.detail}  ${status}${provisional}`;
    if (id === "MO-C-14") return `  MO-C-14 reduced-motion still: ${check.detail}${provisional}`;
    return `  ${id} ${labels[id] ?? ""}${status}${check.detail ? `  (${check.detail})` : ""}${provisional}`;
  };
  for (const id of ["MO-C-01", "MO-C-02", "MO-C-03", "MO-C-04", "MO-C-05", "MO-C-06", "MO-C-07/08", "MO-C-09", "MO-C-10/11/12", "MO-C-13", "MO-C-14"]) lines.push(line(id));
  for (const id of fixedOrder) lines.push(line(id));
  for (const id of indexOrder) if (checks[id]) lines.push(line(id));
  for (const id of Object.keys(checks).filter((key) => key.startsWith("SOUND"))) lines.push(line(id));
  lines.push("", `craft rounds run: ${manifest.craftRound} / 3 max`, `frames actually viewed this run: ${context.viewed} (confirmed looked, not just rendered)`);
  if (!checks["MO-C-03"].pass) lines.push(`MO-C-03 worst window: ${checks["MO-C-03"].detail}`);
  if (result.warnings.length) lines.push(`warnings: ${result.warnings.join("; ")}`);
  lines.push(`provisional thresholds (no user sign-off recorded): ${provisionalRules.join(", ")}`);
  lines.push(`gate exit: ${context.exitCode}`);
  lines.push(`export state: ${context.exportState}`);
  lines.push(`brief: ${context.briefPath ?? "unknown"}`);
  return lines.join("\n") + "\n";
}

// Promote or withhold (MO-C-16): a surviving MO-C-03 FAIL puts every export only in withheld/;
// otherwise exports move to their deliverable names, including after other FAILs (MO-A-45).
export function applyExports(root, flashPass) {
  const withheld = path.join(root, "withheld");
  for (const name of exportNames) {
    const sources = [path.join(root, ".run", name), path.join(root, name), path.join(withheld, name)].filter(existsSync);
    const source = sources[0];
    if (!source) continue;
    const target = flashPass ? path.join(root, name) : path.join(withheld, name);
    if (!flashPass) mkdirSync(withheld, { recursive: true });
    if (source !== target) renameSync(source, target);
    for (const extra of sources.slice(1)) if (extra !== target && existsSync(extra)) rmSync(extra);
  }
  if (flashPass && existsSync(withheld) && readdirSync(withheld).length === 0) rmSync(withheld, { recursive: true });
  return flashPass ? "delivered" : "withheld";
}

// Frames viewed this round: the look round recorded on this render when there is one; otherwise the
// --viewed count, which a re-run without --viewed keeps for the same craft round.
function viewedCount(root, round, viewed) {
  const lookFile = path.join(root, "look.json");
  if (existsSync(lookFile)) {
    const look = JSON.parse(readFileSync(lookFile, "utf8"));
    const recorded = look.rounds?.filter((entry) => entry.round === round).at(-1);
    if (recorded) return Object.keys(recorded.frames ?? {}).length;
  }
  const viewedFile = path.join(root, ".run", "viewed.json");
  if (viewed === undefined) {
    try { const prior = JSON.parse(readFileSync(viewedFile, "utf8")); return prior.round === round ? prior.count : 0; } catch { return 0; }
  }
  if (existsSync(path.dirname(viewedFile))) writeFileSync(viewedFile, JSON.stringify({ round, count: viewed }) + "\n");
  return viewed;
}

export function runGate(dir, { viewed, requirePreview = true } = {}) {
  const root = path.resolve(dir);
  const manifestPath = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")).path;
  if (manifestPath === "stage") return runStageGate(root, { viewed });
  const result = checkRun(root, { requirePreview });
  viewed = viewedCount(root, result.manifest?.craftRound ?? null, viewed);
  const flashPass = result.checks["MO-C-03"].pass;
  const exportState = applyExports(root, flashPass);
  const exitCode = result.passed ? EXIT.OK : EXIT.GATE_FAIL_QA;
  const presetReason = result.run.brief?.explicitPreset ? (result.run.brief.presetSource === "user" ? "user-specified" : "agent default") : selectPreset(result.run.brief?.sourceText ?? "", undefined).reason;
  const report = formatReport(result, { exportDir: flashPass ? root : path.join(root, "withheld"), viewed, exitCode, exportState: exportState === "withheld" ? "withheld (MO-C-03 FAIL: diagnostics only, never deliverables)" : exportState, presetReason, briefPath: result.run.brief?.path });
  writeFileSync(path.join(root, "gate-report.txt"), report);
  return { ...result, exitCode, report, exportState };
}

function runStageGate(root, { viewed }) {
  const result = checkStageRun(root);
  viewed = viewedCount(root, result.manifest.craftRound, viewed);
  const flashPass = result.checks["MO-C-03"].pass;
  const exportState = applyExports(root, flashPass);
  const exitCode = result.passed ? EXIT.OK : EXIT.GATE_FAIL_QA;
  const report = formatStageReport(result, { exportDir: flashPass ? root : path.join(root, "withheld"), viewed, exitCode, exportState: exportState === "withheld" ? "withheld (MO-C-03 FAIL: diagnostics only, never deliverables)" : exportState });
  writeFileSync(path.join(root, "gate-report.txt"), report);
  return { ...result, exitCode, report, exportState };
}

// A turn counts as done only after a gate PASS, a valid treatment and two recorded look rounds, the
// last one on the final render's own stills (engine/look.mjs).
export function completionState(dir) {
  return doneState(dir);
}

function main(argv) {
  if (!argv.length || argv.includes("--help")) {
    console.log("lit-typographic-motion gate\nUsage: node gate.mjs <output-dir> [--viewed N]\n       node gate.mjs --done <output-dir>   (0 DONE, 1 NOT DONE, 2 DONE_WITH_OPEN_ITEMS after round 3, 3 DONE_UNVIEWED)");
    return 0;
  }
  if (argv[0] === "--done") {
    const state = completionState(argv[1]);
    console.log(formatDone(state));
    return state.code;
  }
  const viewedIndex = argv.indexOf("--viewed");
  const viewed = viewedIndex >= 0 ? Number(argv[viewedIndex + 1]) || 0 : undefined;
  const result = runGate(argv[0], { viewed });
  process.stdout.write(result.report);
  return result.exitCode;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`gate error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = EXIT.GATE_FAIL_QA; }
}

