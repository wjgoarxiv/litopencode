// Phase 1: brief -> timeline, pass ranges and the per-shot event schedule. Every cut is resolved
// here, ahead of any frame, against this brief's own text and this run's BPM or beat grid
// (the anchor-and-snap method, MO-A-06); scenes never carry literal frame numbers.
import { FRAME, flashEventThreshold, isSoftwareRenderer, limits, presets } from "./constants.mjs";
import { cpsFloor, eojeols, mulberry32, passSeed, readingFloor, smart, textScript } from "./text.mjs";

export const sceneKinds = Object.freeze(["title-slam", "karaoke", "kinetic-list", "counter", "signature", "end-card"]);
const strokeFontNames = Object.freeze(["EMSAllure", "EMSFelix", "EMSOsmotron", "EMSReadability", "EMSTech"]);

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} needs non-empty text`);
  return smart(value.trim().replace(/\s+/gu, " "));
}

// Normalize the brief's scene list. A brief may give `scenes` explicitly or only `lines`.
export function normalizeScenes(brief) {
  const source = Array.isArray(brief.scenes) && brief.scenes.length > 0 ? brief.scenes
    : Array.isArray(brief.lines) && brief.lines.length > 0 ? defaultScenes(brief)
    : typeof brief.title === "string" ? defaultScenes({ ...brief, lines: [brief.title] })
    : undefined;
  if (source === undefined) throw new Error("the brief needs `scenes`, `lines` or a `title`");
  return source.map((entry, index) => {
    const scene = entry.scene ?? entry.kind;
    if (!sceneKinds.includes(scene)) throw new Error(`scene ${index + 1}: unknown scene "${scene}" (use ${sceneKinds.join(", ")})`);
    const base = { scene, sceneId: entry.sceneId ?? scene, params: {} };
    if (scene === "kinetic-list") {
      if (!Array.isArray(entry.items) || entry.items.length < 2) throw new Error(`scene ${index + 1}: kinetic-list needs at least two items`);
      base.params.items = entry.items.map((item, i) => requireText(item, `kinetic-list item ${i + 1}`));
      base.params.heading = entry.heading ? requireText(entry.heading, "kinetic-list heading") : undefined;
      base.text = [base.params.heading, ...base.params.items].filter(Boolean).join("\n");
    } else if (scene === "counter") {
      const to = Number(entry.to), from = Number(entry.from ?? 0);
      if (!Number.isFinite(to) || !Number.isFinite(from)) throw new Error(`scene ${index + 1}: counter needs numeric from/to`);
      base.params.from = from; base.params.to = to;
      base.params.label = entry.label ? requireText(entry.label, "counter label") : undefined;
      base.text = [String(Math.round(to)), base.params.label].filter(Boolean).join("\n");
    } else if (scene === "signature") {
      base.params.font = entry.font ?? "EMSAllure";
      if (!strokeFontNames.includes(base.params.font)) throw new Error(`scene ${index + 1}: signature font must be one of ${strokeFontNames.join(", ")}`);
      base.text = requireText(entry.text, "signature");
    } else if (scene === "end-card") {
      base.params.title = requireText(entry.text ?? entry.title, "end-card");
      base.params.sub = entry.sub ? requireText(entry.sub, "end-card sub line") : undefined;
      base.params.paragraph = entry.paragraph ? requireText(entry.paragraph, "end-card paragraph") : undefined;
      base.text = [base.params.title, base.params.sub, base.params.paragraph].filter(Boolean).join("\n");
    } else {
      base.text = requireText(entry.text, scene);
    }
    return base;
  });
}

function defaultScenes(brief) {
  const lines = brief.lines.map((line) => String(line));
  const title = typeof brief.title === "string" && brief.title.trim() ? brief.title : lines[0];
  const body = typeof brief.title === "string" && brief.title.trim() ? lines : lines.slice(1);
  const scenes = [{ scene: "title-slam", text: title }];
  for (const line of body.slice(0, -1)) scenes.push({ scene: "karaoke", text: line });
  const last = body.at(-1);
  scenes.push({ scene: "end-card", text: title, sub: last && last !== title ? last : undefined });
  return scenes;
}

// The beat grid: Tier 1 is k * 60 / bpm; Tier 2 is the analysed beats. Both start at film time 0.
export function makeGrid({ bpm, beatGrid }) {
  if (Array.isArray(beatGrid) && beatGrid.length >= 2) {
    const beats = [0, ...beatGrid.filter((t) => t > 1 / FRAME.fps)].sort((a, b) => a - b);
    const intervals = beatGrid.slice(1).map((t, i) => t - beatGrid[i]).filter((d) => d > 0).sort((a, b) => a - b);
    const beat = intervals[Math.floor(intervals.length / 2)] ?? 60 / limits.defaultBpm;
    return {
      beat,
      at(index) { return index < beats.length ? beats[index] : beats.at(-1) + (index - beats.length + 1) * beat; },
      indexAtOrAfter(time) {
        for (let i = 0; ; i++) if (this.at(i) >= time - 1e-9) return i;
      }
    };
  }
  const beat = 60 / bpm;
  return {
    beat,
    at(index) { return index * beat; },
    indexAtOrAfter(time) { return Math.max(0, Math.ceil(time / beat - 1e-9)); }
  };
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;

function holdFor(scene) {
  const kind = scene.scene === "kinetic-list" || scene.scene === "end-card" ? "scene" : "line";
  const floor = Math.max(readingFloor(scene.text, kind), cpsFloor(scene.text, kind));
  return { kind, floor };
}

// MO-A-09..16: each shot holds 1.25 x its floor, at least two beats, and every start lands on a grid beat.
// A treatment's durationSec is the target: when the natural film is shorter, every hold scales up by the
// same factor (never below its floor) and the last shot reaches the target; when the reading floors
// force a longer film, the film keeps its floors and `floorForced` says so.
export function buildTimeline(brief, { bpm = limits.defaultBpm, beatGrid, targetDurationSec } = {}) {
  const natural = layoutTimeline(brief, { bpm, beatGrid, holdScale: 1 });
  if (!(targetDurationSec > 0)) return natural;
  if (natural.durationSec > targetDurationSec + 1e-9) return { ...natural, targetDurationSec, floorForced: true };
  const holdScale = targetDurationSec / natural.durationSec;
  const scaled = layoutTimeline(brief, { bpm, beatGrid, holdScale, targetDurationSec });
  return { ...scaled, targetDurationSec, floorForced: false };
}

function layoutTimeline(brief, { bpm, beatGrid, holdScale, targetDurationSec = 0 }) {
  const scenes = normalizeScenes(brief);
  const grid = makeGrid({ bpm, beatGrid });
  const shotCounts = new Map();
  const timeline = [];
  let index = 0;
  const minDuration = Math.max(limits.minDurationSec, Number(brief.minDurationSec ?? 0) || 0, targetDurationSec);
  scenes.forEach((scene, sceneIndex) => {
    const shotIndex = shotCounts.get(scene.sceneId) ?? 0;
    shotCounts.set(scene.sceneId, shotIndex + 1);
    const { kind, floor } = holdFor(scene);
    const start = grid.at(index);
    const units = revealTexts(scene);
    let unitIndex = index;
    const unitStarts = [];
    for (let i = 0; i < units.length; i++) {
      unitStarts.push(grid.at(unitIndex));
      let step = unitIndex + 1;
      while (grid.at(step) - grid.at(unitIndex) < Math.max(limits.revealFloor, scene.scene === "kinetic-list" ? 0.5 : 0) - 1e-9) step++;
      unitIndex = step;
    }
    const revealSpan = units.length > 0 ? grid.at(unitIndex) - start : 0;
    let needed = Math.max(limits.generatorMargin * floor, revealSpan + limits.minSceneBeats * grid.beat, limits.minSceneBeats * grid.beat) * holdScale;
    if (sceneIndex === scenes.length - 1) needed = Math.max(needed, minDuration - start);
    let endIndex = grid.indexAtOrAfter(start + needed - 1e-9);
    while (endIndex - index < limits.minSceneBeats) endIndex++;
    const end = grid.at(endIndex);
    const shot = {
      id: `${scene.sceneId}#${shotIndex}`, sceneId: scene.sceneId, shotIndex,
      start: round6(start), end: round6(end), holdSec: round6(end - start),
      kind, text: scene.text, script: textScript(scene.text), beatSec: round6(start),
      scene: scene.scene, params: scene.params, floorSec: round6(floor), stateful: false, prerollMax: 0
    };
    timeline.push(shot);
    units.forEach((text, i) => {
      const unitStart = unitStarts[i];
      const unitEnd = i + 1 < units.length ? unitStarts[i + 1] : end;
      timeline.push({
        id: `${shot.id}/r${i}`, sceneId: scene.sceneId, shotIndex, start: round6(unitStart), end: round6(unitEnd),
        holdSec: round6(unitEnd - unitStart), kind: "reveal", text, script: textScript(text), beatSec: round6(unitStart)
      });
    });
    index = endIndex;
  });
  return { timeline, grid, durationSec: timeline.filter(isShot).at(-1).end };
}

export const isShot = (entry) => entry.kind === "line" || entry.kind === "scene";

// MO-A-28: sub-sample i of N for output frame n sits at t_n + (shutter/fps)((i + 0.5)/N - 0.5), >= 0.
export function pinnedSampleTimes(frame, samples, shutter, fps = FRAME.fps) {
  return Array.from({ length: samples }, (_, i) => Math.max(0, frame / fps + (shutter / fps) * ((i + 0.5) / samples - 0.5)));
}

function revealTexts(scene) {
  if (scene.scene === "karaoke") return eojeols(scene.text);
  if (scene.scene === "kinetic-list") return scene.params.items;
  return [];
}

// MO-C-29: the accent belongs to one timeline entry and at most 10% of frames.
export function chooseAccentEntry(timeline, presetId, durationSec) {
  if (!presets[presetId].palette.accent) return undefined;
  const shots = timeline.filter(isShot);
  const candidate = [...shots].reverse().find((shot) => shot.scene === "end-card" || shot.scene === "counter");
  if (!candidate) return undefined;
  return candidate.holdSec / durationSec <= limits.accentMaxFrameFraction ? candidate.id : undefined;
}

// MO-SH-03: the precomputed per-shot event schedule (glitch hits, surges, boot-flicker bursts).
// Events are admitted only while every 1 s window of the shot holds at most two of them.
export function eventSchedule(timeline, presetId, runSeed) {
  const look = presets[presetId];
  const events = [];
  for (const shot of timeline.filter(isShot)) {
    const accepted = [];
    const admit = (event) => {
      const times = [...accepted.map((other) => other.time), event.time].sort((a, b) => a - b);
      const cap = limits.eventsPerSecondPerShot;
      for (let i = 0; i + cap < times.length; i++) if (times[i + cap] - times[i] < 1 - 1e-9) return false;
      accepted.push(event);
      return true;
    };
    const shotRef = { sceneId: shot.sceneId, shotIndex: shot.shotIndex };
    if (look.passes.includes("terminal-ui")) admit({ kind: "boot-flicker", time: shot.start, durationSec: look.motion.bootFlickerSec, ...shotRef });
    if (look.passes.includes("tidal-gradient")) {
      const p = look.params["tidal-gradient"];
      const gap = Math.max(1 / p.surgeCapPerSec, 2.4);
      for (let t = shot.start + 0.3; t < shot.end - p.surgeAttackSec - p.surgeDecaySec; t += gap) {
        admit({ kind: "surge", time: round6(t), attackSec: p.surgeAttackSec, decaySec: p.surgeDecaySec, amount: p.surgeOnHit, ...shotRef });
      }
    }
    if (look.passes.includes("glitch")) {
      const p = look.params.glitch;
      const random = mulberry32(passSeed(runSeed, shot.sceneId, shot.shotIndex, "glitch"));
      const gap = 1 / p.hitRatePerSec;
      const holdSec = p.holdFrames / FRAME.fps;
      const firstAt = shot.start + (presetId === "tidal" ? shot.holdSec * 0.55 : 0.6);
      for (let t = firstAt; t < shot.end - 0.3 - holdSec; t += gap) {
        const hit = glitchHit(random, p, round6(t));
        admit({ kind: "glitch", ...hit, ...shotRef });
        if (presetId === "tidal") break;
      }
    }
    events.push(...accepted.sort((a, b) => a.time - b.time));
  }
  return events;
}

// One glitch hit = one displace plus one restore: slices, an RGB split and a few corrupt blocks,
// drawn once from the shot's seeded stream and held for `holdFrames` without re-rolling.
function glitchHit(random, p, time) {
  const areaRows = Math.floor(FRAME.height * Math.min(p.areaCapPct, limits.glitchAreaCapPct) / 100);
  const slices = [];
  let rows = 0;
  for (let i = 0; i < p.sliceCount && rows < areaRows; i++) {
    const height = Math.min(areaRows - rows, Math.round(8 + random() * (areaRows / p.sliceCount)));
    const y = Math.round(random() * (FRAME.height - height));
    const offset = Math.round((random() * 2 - 1) * p.maxOffsetPx);
    slices.push([y, height, offset]);
    rows += height;
  }
  const blocks = Array.from({ length: 3 }, () => [
    Math.round(random() * (FRAME.width - p.blockCorruptSize[0])), Math.round(random() * (FRAME.height - p.blockCorruptSize[1])),
    Math.round((random() * 2 - 1) * 64), Math.round((random() * 2 - 1) * 36)
  ]);
  return { time, holdFrames: p.holdFrames, slices, blocks, rgbSplitPx: p.rgbSplitPx, areaPct: round6((rows / FRAME.height) * 100) };
}

// MO-SH-00 / §A10: one passRanges entry per pass per shot, with MO-SH-01 seeds.
export function buildPassRanges({ timeline, presetId, runSeed, renderer, events }) {
  const look = presets[presetId];
  const software = isSoftwareRenderer(renderer);
  const ranges = [];
  for (const shot of timeline.filter(isShot)) {
    const frameStart = Math.round(shot.start * FRAME.fps);
    const frameEnd = Math.round(shot.end * FRAME.fps) - 1;
    const shotEvents = events.filter((event) => event.sceneId === shot.sceneId && event.shotIndex === shot.shotIndex);
    for (const pass of look.passes) {
      const p = look.params[pass] ?? {};
      let params = {};
      let downgraded = false;
      if (pass === "swiss-grid") params = { columns: p.columns, gutterPx: p.gutterPx, marginPx: p.marginPx, baselinePx: p.baselinePx, showGuides: p.showGuides };
      else if (pass === "dither") params = { mode: p.mode, paletteSize: p.paletteSize, pixelScale: p.pixelScale, ditherStrength: p.ditherStrength };
      else if (pass === "glitch") {
        const hits = shotEvents.filter((event) => event.kind === "glitch");
        params = { intensity: p.intensity, hitRatePerSecRealized: round6(hits.length / shot.holdSec), areaCapPct: p.areaCapPct,
          maxAreaPctRealized: Math.max(0, ...hits.map((hit) => hit.areaPct)), holdFrames: p.holdFrames };
      } else if (pass === "tidal-gradient") {
        const octaves = software ? Math.max(3, Math.floor(p.octaves / 2)) : p.octaves;
        downgraded = software;
        params = { paletteStopsHex: [look.palette.signal, look.palette.stopB], octaves, flowSpeed: p.flowSpeed,
          surgeCountRealized: shotEvents.filter((event) => event.kind === "surge").length, surgeCapPerSec: p.surgeCapPerSec,
          surgeAttackSec: p.surgeAttackSec, surgeDecaySec: p.surgeDecaySec, ditherAmount: p.ditherAmount };
      } else if (pass === "crt") {
        downgraded = software;
        params = { flickerAmpRealized: p.flickerAmp, scanlineFreq: p.scanlineFreqPerFrame, scanlineDepth: p.scanlineDepth,
          curvature: p.curvature, vignette: p.vignette, persistenceEnabled: !software && p.phosphorPersistence > 0 };
      } else if (pass === "terminal-ui") {
        params = { compositedThrough: look.passes.filter((id) => id === "crt" || id === "dither"), meterCount: p.meterCount,
          logLineRateCharsPerSec: p.logLineRateCharsPerSec, wordTimingSource: p.wordTimingSource, layers: 1 };
      }
      ranges.push({
        pass, frameStart, frameEnd, sceneId: shot.sceneId, shotIndex: shot.shotIndex,
        seed: pass === "swiss-grid" ? null : passSeed(runSeed, shot.sceneId, shot.shotIndex, pass), params, downgraded
      });
    }
  }
  return ranges;
}

// A shot composited through CRT phosphor persistence carries state across frames (the previous
// frame's pre-CRT image), so it is stateful with a one-frame preroll (MO-A-05, MO-SH-07).
export const persistenceFrames = 1;
export function markStateful(timeline, passRanges) {
  for (const shot of timeline.filter(isShot)) {
    const crt = passRanges.find((range) => range.pass === "crt" && range.sceneId === shot.sceneId && range.shotIndex === shot.shotIndex);
    shot.stateful = Boolean(crt?.params.persistenceEnabled);
    shot.prerollMax = shot.stateful ? round6(persistenceFrames / FRAME.fps) : 0;
  }
}

export { flashEventThreshold };
