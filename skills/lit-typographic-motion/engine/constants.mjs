// Every number the motion engine and its gate use lives here. Rows marked [NEW] come from the
// family spec's own proposed defaults; no user sign-off is recorded for them yet, so they are
// PROVISIONAL. They are implemented exactly as written and must not be tuned in this wave.

export const EXIT = Object.freeze({
  OK: 0,
  BLOCKED_NO_CHROME: 10,
  BLOCKED_NO_WEBGL2: 11,
  BLOCKED_NO_FFMPEG_FOR_VIDEO: 12,
  GATE_FAIL_QA: 13,
  BLOCKED_DEPS_NOT_PREWARMED: 14,
  BLOCKED_FONT_FETCH: 15,
  BLOCKED_TREATMENT_INVALID: 16,
  STAGE_CONTRACT_ERROR: 17,
  STAGE_NONDETERMINISTIC: 18,
  STAGE_NETWORK_REQUEST: 19,
  SOUND_INVALID: 20
});

export const FRAME = Object.freeze({ width: 1920, height: 1080, fps: 60 });

export const limits = Object.freeze({
  defaultBpm: 100, // MO-A-14
  generatorMargin: 1.25, // MO-A-09/10: Tier-1 pace = 1.25 x the reading floor
  minSceneBeats: 2, // MO-A-16
  beatSnapFrames: 1, // MO-A-15: <= 1 frame at 60 fps
  masterSamples: 4, masterShutter: 0.5, // MO-A-26
  previewSamples: 1, // MO-A-27
  titleSafeX: 96, titleSafeY: 54, // MO-C-04
  actionSafeX: 48, actionSafeY: 27, // MO-C-05 [NEW] provisional
  bodyContrast: 4.5, largeContrast: 3, // MO-C-06
  largeFontPx: 32, largeBoldFontPx: 25, largeBoldWeight: 700, // MO-C-06 [NEW] provisional
  lineFloorLatin: 0.9, lineFloorHangul: 1.0, wordFloor: 0.5, revealFloor: 0.35, // MO-C-07/08 [NEW] provisional
  secondsPerHangulSyllable: 0.2, latinWordsPerSecond: 3.3, latinCharsPerSecond: 17, // MO-C-07/08 [NEW] provisional
  minFps: 30, minDurationSec: 3, warnDurationSec: 90, // MO-C-10..12 (30 fps floor and 3 s floor [NEW] provisional)
  previewMaxBytes: 3 * 1000 * 1000, posterMaxBytes: 1000 * 1000, // MO-C-13 [NEW] provisional
  mp4WarnBytesPer10s: 100 * 1000 * 1000, // MO-C-13 [NEW] provisional
  stillInkRatio: 0.9, // MO-C-14 [NEW] provisional
  displayTrackingFloorEm: -0.04, // MO-C-25 [NEW] provisional
  lineHeightLatin: 1.5, lineHeightCjk: 1.6, lineHeightThreePlus: 1.4, // MO-C-26
  measureMinCh: 60, measureMaxCh: 75, cjkMeasureMinCh: 30, cjkMeasureMaxCh: 45, // MO-C-27
  clusterHueDeg: 15, clusterSaturation: 0.5, clusterMinSidePx: 24, // MO-C-29 [NEW] provisional
  accentMaxEntries: 1, accentMaxFrameFraction: 0.1, // MO-C-29 [NEW] provisional
  realGpuP95Ms: 40, softwareGpuP95Ms: 250, perfFrames: 120, // MO-D-02 [NEW] provisional
  nearBlackLuminance: 0.05, nearBlackQuantile: 0.995, nearBlackFloorMultiple: 2, nearBlackFadeSec: 1, // MO-D-03 [NEW] provisional
  missingGlyphsAllowed: 0, // MO-D-04 [NEW] provisional
  flashLimitGeneral: 3, flashLimitRed: 3, // MO-C-03
  eventsPerSecondPerShot: 2, // MO-SH-03
  glitchHitRateCap: 2.0, glitchAreaCapPct: 20, // MO-SH-05
  surgeRateCap: 2, surgeEdgeFloorSec: 0.1, // MO-SH-06
  crtFlickerCap: 0.06, // MO-SH-07
  maxTerminalLayers: 2, // MO-SH-11
  fullFrameStepDelta: 0.1, fullFrameStepArea: 0.25 // MO-SH-04a
});

// Rules whose threshold is a [NEW] spec default; the report labels each one provisional.
export const provisionalRules = Object.freeze([
  "MO-C-05", "MO-C-06", "MO-C-07", "MO-C-08", "MO-C-13", "MO-C-14", "MO-C-25", "MO-C-29",
  "MO-D-02", "MO-D-03", "MO-D-04"
]);

// MO-C-03 flash audit geometry (logical px at 1920x1080).
export const flashGeometry = Object.freeze({
  gridW: 320, gridH: 180, cellPx: 6,
  windowCellsW: 107, windowCellsH: 60, // 640x360 logical px, a 10-degree field
  areaFraction: 0.25, // more than 25% of one window (> 57,600 px)
  deltaL: 0.1, darkerBelow: 0.8,
  redRatio: 0.8, redScale: 320, redDelta: 20,
  historyFrames: 3 // cells registered in frames [f-2, f]
});

// MO-SH-09: the one canonical software-rasterizer list.
export const softwareRendererNames = Object.freeze([
  "swiftshader", "llvmpipe", "softpipe", "lavapipe", "apple software renderer", "microsoft basic render driver"
]);
export const unknownRenderer = "unknown (debug-info extension unavailable)";
export function isSoftwareRenderer(name) {
  const lower = String(name ?? "").toLowerCase();
  return softwareRendererNames.some((part) => lower.includes(part));
}

// MO-A-51: per-platform GPU rung, then the SwiftShader rung; anti-throttling flags always appended.
export const alwaysChromeFlags = Object.freeze([
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"
]);
// Every launch also carries these two, so headless Chrome under a custom profile or an isolated HOME
// never asks the macOS keychain for its safe-storage item (that request raises a dialog on the
// user's screen). The engine stores no credentials, so a mock keychain loses nothing.
export const keychainChromeFlags = Object.freeze(["--use-mock-keychain", "--password-store=basic"]);
export function chromeFlagRungs(platform = process.platform) {
  const native = platform === "darwin" ? ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
    : platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu-rasterization"]
    : ["--use-angle=gl", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"];
  return [
    { name: "gpu", flags: [...native, ...alwaysChromeFlags, ...keychainChromeFlags] },
    { name: "swiftshader", flags: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", ...alwaysChromeFlags, ...keychainChromeFlags] }
  ];
}

// MO-A-58: override vocabulary with a fixed type, range and neutral value per field.
export const postOverrideTable = Object.freeze({
  exposure: { kind: "number", min: 0, exclusiveMin: true, max: Infinity, neutral: 1 },
  bloom: { kind: "number", min: 0, max: 1, neutral: 0 },
  bloomThreshold: { kind: "number", min: 0, max: 1, neutral: 0.85 },
  bloomKnee: { kind: "number", min: 0, max: 1, neutral: 0 },
  bloomRadius: { kind: "number", min: 0, max: 1, neutral: 0 },
  halation: { kind: "number", min: 0, max: 1, neutral: 0 },
  ca: { kind: "number", min: 0, max: Infinity, neutral: 0 },
  grain: { kind: "number", min: 0, max: 1, neutral: 0 },
  vignette: { kind: "number", min: 0, max: 1, neutral: 0 },
  fade: { kind: "number", min: 0, max: 1, neutral: 1 },
  flash: { kind: "number", min: 0, max: 1, neutral: 0 },
  shake: { kind: "pair", neutral: [0, 0] },
  zoom: { kind: "number", min: 0, exclusiveMin: true, max: Infinity, neutral: 1 },
  invert: { kind: "boolean", neutral: false }
});
export const flashEventThreshold = 0.1; // each rise of `flash` above 0.1 is one MO-SH-03 event

export const passIds = Object.freeze(["glitch", "tidal-gradient", "crt", "dither", "swiss-grid", "terminal-ui"]);

// MO-B-00: whole-word keyword table, first match wins; an explicit style always wins.
export const presetKeywordTable = Object.freeze([
  { preset: "terminalcore", words: ["터미널", "crt", "해커", "terminal", "hacker"], reason: "terminal cue" },
  { preset: "tidal", words: ["물결", "파도", "잔잔한", "흐름", "gradient", "wave", "tide", "calm"], reason: "flow cue" }
]);

// MO-B-01..03 style bibles, as data the engine reads. Colours are sRGB hex; the engine
// linearizes them once. The prose version lives in references/style-bibles.md.
export const presets = Object.freeze({
  "swiss-signal": {
    palette: { background: "#0C0E13", text: "#E9EBE4", signal: "#0F7A82", accent: "#D9A441", secondary: "#4B5058" },
    passes: ["swiss-grid", "dither"],
    voices: { display: "display", machine: "machine", body: "body" },
    motion: { entrance: "slam", entranceSec: 0.18, hold: "hold", cut: "snap-cut" },
    post: { exposure: 1, bloom: 0.18, bloomThreshold: 0.85, bloomKnee: 0.4, bloomRadius: 0.6, halation: 0.08, ca: 0.8, grain: 0.035, vignette: 0.22, fade: 1, flash: 0, shake: [0, 0], zoom: 1, invert: false },
    params: {
      "swiss-grid": { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, moduleSnap: true, showGuides: false, hairlineWidthPx: 1 },
      dither: { mode: 1, paletteSize: 0, pixelScale: 1, ditherStrength: 0.3 }
    }
  },
  terminalcore: {
    palette: { background: "#05070A", panel: "#0C1116", text: "#39FF6A", signal: "#39FF6A", alternate: "#2FB6FF", secondary: "#7C8B93" },
    passes: ["terminal-ui", "crt", "dither", "glitch"],
    voices: { display: "pixel", machine: "machine", body: "pixel" },
    motion: { entrance: "type-in", entranceSec: 0, hold: "hold", cut: "hard-cut", bootFlickerSec: 0.25 },
    post: { exposure: 1, bloom: 0.22, bloomThreshold: 0.8, bloomKnee: 0.4, bloomRadius: 0.55, halation: 0.05, ca: 1.0, grain: 0.03, vignette: 0.3, fade: 1, flash: 0, shake: [0, 0], zoom: 1, invert: false },
    params: {
      "terminal-ui": { charGridPx: [14, 24], windowChromeWidthPx: 1.5, meterCount: 2, logLineRateCharsPerSec: 22, caretBlinkHz: 1.2, wordTimingSource: "reading-time" },
      crt: { scanlineFreqPerFrame: 540, scanlineDepth: 0.22, phosphorPersistence: 0.15, bloomAmount: 0.15, curvature: 0.04, vignette: 0.3, triadMaskAmount: 0.12, flickerAmp: 0.03, flickerFreqHz: 8 },
      dither: { mode: 1, paletteSize: 0, pixelScale: 2, ditherStrength: 0.35 },
      glitch: { intensity: 0.35, sliceCount: 6, maxOffsetPx: 24, blockCorruptSize: [32, 18], rgbSplitPx: 3, holdFrames: 2, hitRatePerSec: 1.0, areaCapPct: 12 }
    }
  },
  tidal: {
    palette: { background: "#0E1420", text: "#E8ECEF", signal: "#124559", stopB: "#4C3B6E", accent: "#E07856" },
    passes: ["tidal-gradient", "swiss-grid", "glitch"],
    voices: { display: "display", machine: "machine", body: "body" },
    motion: { entrance: "drift", entranceSec: 2.4, hold: "flow", cut: "hard-cut", punchSec: 0.3 },
    post: { exposure: 1, bloom: 0.12, bloomThreshold: 0.85, bloomKnee: 0.4, bloomRadius: 0.7, halation: 0.04, ca: 0.6, grain: 0.03, vignette: 0.18, fade: 1, flash: 0, shake: [0, 0], zoom: 1, invert: false },
    params: {
      "tidal-gradient": { flowSpeed: 0.06, warpAmount: 0.35, curlStrength: 0.4, octaves: 4, surgeOnHit: 0.5, surgeAttackSec: 0.15, surgeDecaySec: 0.25, surgeCapPerSec: 2, bandingSteps: 0, ditherAmount: 0.02 },
      "swiss-grid": { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, moduleSnap: true, showGuides: false, hairlineWidthPx: 1 },
      glitch: { intensity: 0.3, sliceCount: 5, maxOffsetPx: 18, blockCorruptSize: [32, 18], rgbSplitPx: 2, holdFrames: 2, hitRatePerSec: 0.5, areaCapPct: 10 }
    }
  }
});

// Named easing tokens (MO-A-08, MO-B-01..03). Scenes use these names only.
export const easeTokens = Object.freeze({
  slam: [0.16, 1, 0.3, 1],
  "surge-punch": [0.16, 1, 0.3, 1],
  drift: [0.37, 0, 0.63, 1],
  exit: [0.7, 0, 0.84, 0]
});

export const engineCredit = "mexicat/pdoom-video ca251e3dddda422b364385eb484b5a3593a0990d (MIT)";
export const engineCreditLine = "Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.";
