// Valid treatments for the motion tests: one stage film and one type film. Each test clones one and
// breaks a single field. The subjects are neutral fictional ones written for these fixtures.
import fs from "node:fs";
import path from "node:path";

export function stageTreatment(overrides = {}) {
  return structuredClone({
    request: "하루 동안 물을 모으는 빗물 정원을 설명하는 영상 만들어줘 lit",
    genre: "explainer",
    path: "stage",
    pathReason: "the film has to draw the garden and the water moving through it",
    idea: "One raindrop's route shows how a shallow basin stores a storm and feeds its plants for days.",
    audience: "homeowners weighing a small garden project",
    channel: "a community workshop projector",
    format: "16:9",
    formatReason: "the workshop plays it on a wide projector",
    durationSec: 16,
    beats: [
      { t0: 0, t1: 4, purpose: "question", onScreen: "rain drums on a roof above a dry basin", motion: "drops fall in a seeded pattern", sound: "soft pulse, hit on the first drop" },
      { t0: 4, t1: 8, purpose: "steps", onScreen: "the drop runs down a chain into the basin", motion: "path draw follows the drop", sound: "rise into the fill" },
      { t0: 8, t1: 12, purpose: "result", onScreen: "the basin fills, roots darken, the gravel lip holds", motion: "mask wipes the water level up", sound: "hit on the cut, pad opens" },
      { t0: 12, t1: 16, purpose: "recap", onScreen: "three days pass as the level slowly drops", motion: "time-lapse sun arcs", sound: "cadence to close" }
    ],
    subject: { name: "빗물 정원", source: "user", specifics: ["a shallow planted basin that holds roof runoff", "for small-lot homes", "a gravel overflow lip"] },
    visualDevices: [
      { kind: "illustration", role: "subject", beats: [0, 1, 2, 3] },
      { kind: "diagram", role: "support", beats: [1, 2] },
      { kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }
    ],
    typePlan: { faces: ["LitOpenCode Sans", "Archivo"], hierarchy: "one short line per beat, low in the frame, under the drawing", maxWordsOnScreen: 6 },
    palette: [{ hex: "#10202A", role: "night sky" }, { hex: "#E8EEF0", role: "copy" }, { hex: "#4FA3A5", role: "water" }, { hex: "#C9A15A", role: "gravel" }],
    sound: { mode: "generated", plan: "a warm bed that thickens as the basin fills", palette: "warm", key: "D minor", tempo: 90 },
    copy: { source: "invented", lines: ["지붕의 비가 사흘을 버틴다", "자갈 턱이 넘침을 막는다"] },
    inventions: ["both copy lines", "the three-day holding figure"],
    ambition: "Every cut is a match cut on the water line, and the drawing alone explains the idea with the sound off.",
    ...overrides
  });
}

export function typeTreatment(overrides = {}) {
  return structuredClone({
    request: "\"바람이 먼저 안다\" \"길은 늘 열려 있다\" 이 두 문장으로 키네틱 타이포 영상 만들어줘 lit",
    genre: "type-led",
    path: "type",
    pathReason: "the user supplied the words and asked for kinetic type",
    idea: "Two short sentences breathe in and out like a held note.",
    audience: "readers of a small poetry account",
    channel: "a desktop feed player",
    format: "16:9",
    formatReason: "the feed plays wide on desktop",
    durationSec: 8,
    beats: [
      { t0: 0, t1: 4, purpose: "first breath", onScreen: "the first sentence settles low left", motion: "slam then hold", sound: "pad enters, hit on the cut" },
      { t0: 4, t1: 8, purpose: "second breath", onScreen: "the second sentence answers it", motion: "slam then hold", sound: "cadence to close" }
    ],
    subject: { name: "두 문장", source: "user", specifics: ["two lines the user wrote", "one held pause between them"] },
    visualDevices: [],
    typePlan: { faces: ["LitOpenCode Sans"], hierarchy: "one line at a time", maxWordsOnScreen: 4 },
    palette: [{ hex: "#0C0E13", role: "ground" }, { hex: "#E9EBE4", role: "type" }, { hex: "#0F7A82", role: "signal" }],
    sound: { mode: "generated", plan: "a quiet glass bed with one hit per line", palette: "glass", key: "A minor", tempo: 80 },
    copy: { source: "user", lines: ["바람이 먼저 안다", "길은 늘 열려 있다"] },
    inventions: [],
    ambition: "Each line holds long enough to be read twice, and the cut lands on the bed's hit.",
    ...overrides
  });
}

export function writeTreatment(dir, treatment) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "treatment.json"), JSON.stringify(treatment, null, 2) + "\n");
}

// A short stage treatment for capture fixtures: genre "other" (three even beats, no 10 s floor).
export function fixtureStageTreatment({ durationSec = 4.2, fps = 30, format = "16:9", ...overrides } = {}) {
  const third = durationSec / 3;
  const t = stageTreatment({
    genre: "other", durationSec, fps, format,
    beats: [
      { t0: 0, t1: third, purpose: "open", onScreen: "the arc starts to draw", motion: "path draw", sound: "pad enters" },
      { t0: third, t1: 2 * third, purpose: "turn", onScreen: "the drop rides the arc", motion: "drop follows the path", sound: "hit on the cut" },
      { t0: 2 * third, t1: durationSec, purpose: "close", onScreen: "the arc completes", motion: "settle", sound: "cadence to close" }
    ],
    visualDevices: [{ kind: "path", role: "subject", beats: [0, 1, 2] }, { kind: "shape", role: "support", beats: [1, 2] }],
    ...overrides
  });
  if (!overrides.copy) t.copy = { source: "invented", lines: ["지붕의 비가 사흘을 버틴다"] };
  return t;
}

// Copies a fixture page (and optional extra stage files) into a fresh output directory with a treatment.
export function stageRun(dir, page, { treatment = fixtureStageTreatment(), files = {} } = {}) {
  const stage = path.join(dir, "stage");
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "index.html"), page);
  for (const [rel, bytes] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.writeFileSync(path.join(stage, rel), bytes); }
  writeTreatment(dir, treatment);
  return dir;
}
