import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { copiesExample, downgrades, loadTreatment, shippedExamples, typeLedCue, validateTreatment } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { stageTreatment, typeTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

const render = path.resolve("skills", "lit-typographic-motion", "render.mjs");
const fieldOf = (t) => validateTreatment(t).field;

test("the stage and type fixtures validate", () => {
  assert.deepEqual(validateTreatment(stageTreatment()), { ok: true });
  assert.deepEqual(validateTreatment(typeTreatment()), { ok: true });
});

test("every missing required field is named", () => {
  for (const key of ["request", "genre", "path", "pathReason", "idea", "audience", "channel", "format", "formatReason", "durationSec", "beats", "subject", "visualDevices", "typePlan", "palette", "sound", "copy", "ambition"]) {
    const t = stageTreatment();
    delete t[key];
    assert.equal(fieldOf(t), key, key);
  }
});

test("placeholder values and a copied example are refused", () => {
  assert.equal(fieldOf(stageTreatment({ idea: "<one sentence>" })), "idea");
  assert.equal(fieldOf(stageTreatment({ durationSec: "<4-90>" })), "durationSec");
  const examples = shippedExamples();
  assert.ok(examples.length >= 1, "references/treatment.md ships a placeholder example");
  assert.equal(validateTreatment(examples[0]).ok, false, "the shipped example never validates as-is");
  // Strip the angle brackets: the values now pass the placeholder rule but still equal the example.
  const unbracketed = JSON.parse(JSON.stringify(examples[0]).replace(/<([^<>"]*)>/gu, "$1"));
  const t = stageTreatment({ idea: unbracketed.idea, audience: unbracketed.audience, channel: unbracketed.channel, ambition: unbracketed.ambition });
  t.beats = t.beats.map((beat) => ({ ...beat, purpose: unbracketed.beats[0].purpose, onScreen: unbracketed.beats[0].onScreen, motion: unbracketed.beats[0].motion, sound: unbracketed.beats[0].sound }));
  assert.equal(copiesExample(t, examples), true);
  assert.equal(fieldOf(t), "copiedExample");
});

test("an idea or invented copy that restates the request is refused", () => {
  assert.equal(fieldOf(stageTreatment({ idea: "하루 동안 물을 모으는 빗물 정원을 설명합니다." })), "idea");
  const t = stageTreatment();
  t.copy.lines = ["물을 모으는 빗물 정원을 설명하는 영상"];
  assert.equal(fieldOf(t), "copy");
});

test("a user copy line that is not in the request is refused", () => {
  const t = typeTreatment();
  t.copy.lines = ["바람이 먼저 안다", "새로 쓴 문장"];
  assert.equal(fieldOf(t), "copy");
});

test("the stage path needs a drawn subject device and two counting kinds", () => {
  const noSubject = stageTreatment();
  noSubject.visualDevices = noSubject.visualDevices.map((device) => ({ ...device, role: device.role === "subject" ? "support" : device.role }));
  assert.equal(fieldOf(noSubject), "visualDevices");
  const textureOnly = stageTreatment({ visualDevices: [{ kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }, { kind: "particles", role: "texture", beats: [0, 1] }, { kind: "illustration", role: "subject", beats: [0, 1, 2, 3] }] });
  assert.equal(fieldOf(textureOnly), "visualDevices");
  const shortSubject = stageTreatment();
  shortSubject.visualDevices[0].beats = [0];
  assert.equal(fieldOf(shortSubject), "visualDevices");
  assert.equal(fieldOf(stageTreatment({ visualDevices: [{ kind: "grid", role: "subject", beats: [0, 1, 2] }] })), "visualDevices");
});

test("the type path needs user words or a type-led cue, and never takes 9:16", () => {
  const noCue = stageTreatment({ path: "type", visualDevices: [] });
  assert.equal(fieldOf(noCue), "path");
  const portrait = typeTreatment({ format: "9:16" });
  assert.equal(fieldOf(portrait), "path");
});

test("too few beats for the genre, a short beat and a gap are refused", () => {
  const few = stageTreatment();
  few.beats = [{ ...few.beats[0], t1: 8 }, { ...few.beats[3], t0: 8 }];
  few.visualDevices = [{ kind: "illustration", role: "subject", beats: [0, 1] }, { kind: "diagram", role: "support", beats: [1] }];
  assert.equal(fieldOf(few), "beats");
  const short = stageTreatment();
  short.beats[1] = { ...short.beats[1], t1: 5 };
  short.beats[2] = { ...short.beats[2], t0: 5 };
  assert.equal(fieldOf(short), "beats");
  const gap = stageTreatment();
  gap.beats[2] = { ...gap.beats[2], t0: 8.5 };
  assert.equal(fieldOf(gap), "beats");
  assert.equal(fieldOf(stageTreatment({ durationSec: 8, beats: stageTreatment().beats.map((b) => ({ ...b, t0: b.t0 / 2, t1: b.t1 / 2 })) })), "durationSec", "an explainer runs at least 10 s unless a length was asked");
});

test("inventions must name the invented subject", () => {
  const t = stageTreatment();
  t.subject = { name: "물결 정원 3호", source: "invented", specifics: ["a basin", "for renters", "a blue gravel lip"] };
  t.inventions = ["both copy lines"];
  assert.equal(fieldOf(t), "inventions");
  t.inventions.push("물결 정원 3호");
  assert.equal(fieldOf(t), undefined);
  const claimed = stageTreatment();
  claimed.subject.name = "달빛 정원";
  assert.equal(fieldOf(claimed), "subject", "source user needs the request to name the subject");
});

test("generated sound needs a documented palette, key and tempo; silence needs a reason", () => {
  assert.equal(fieldOf(stageTreatment({ sound: { mode: "generated", plan: "bed", palette: "orchestra", key: "D minor", tempo: 90 } })), "sound");
  assert.equal(fieldOf(stageTreatment({ sound: { mode: "none", plan: "no sound" } })), "sound");
  assert.equal(fieldOf(stageTreatment({ sound: { mode: "none", plan: "no sound", mutedByDesign: true } })), undefined);
  assert.equal(fieldOf(stageTreatment({ sound: { mode: "supplied", plan: "the user's track" } })), "sound");
});

test("type-led cues: compounds, explicit type requests and quoted spans of two or more words", () => {
  assert.equal(typeLedCue("키네틱 타이포 영상 만들어줘"), "키네틱 타이포");
  assert.match(typeLedCue("\"천천히 가도 된다\" 영상 만들어줘"), /quoted span of 3 words/u);
  assert.equal(typeLedCue("make a video about the city's lights and the team's year"), null);
  assert.equal(typeLedCue("「한 마디」 영상"), "a quoted span of 2 words");
});

test("downgrades are detected against the first valid treatment", () => {
  const first = stageTreatment();
  assert.deepEqual(downgrades(first, stageTreatment()), []);
  const cut = stageTreatment({ durationSec: 12 });
  assert.match(downgrades(first, cut).join(";"), /durationSec dropped/u);
  assert.match(downgrades(first, stageTreatment({ sound: { mode: "none", plan: "x", mutedByDesign: true } })).join(";"), /sound changed to none/u);
  assert.match(downgrades(first, { ...stageTreatment(), path: "type" }).join(";"), /stage to type/u);
  const fewer = stageTreatment();
  fewer.visualDevices[0].beats = [0, 1];
  assert.match(downgrades(first, fewer).join(";"), /subject beats fell/u);
});

test("renders stop with exit 16 and the field name, before any browser or cache check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-treatment-"));
  try {
    const brief = path.join(dir, "brief.json");
    fs.writeFileSync(brief, JSON.stringify({ lines: ["바람이 먼저 안다"] }));
    const missing = spawnSync(process.execPath, [render, "film", "--brief", brief, "--out", path.join(dir, "out"), "--stills-only"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: path.join(dir, "empty-cache") } });
    assert.equal(missing.status, 16, missing.stderr);
    assert.match(missing.stderr, /BLOCKED_TREATMENT_INVALID \(16\): field treatment/u);
    writeTreatment(path.join(dir, "out"), typeTreatment({ idea: "<one sentence>" }));
    const invalid = spawnSync(process.execPath, [render, "film", "--brief", brief, "--out", path.join(dir, "out"), "--stills-only"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: path.join(dir, "empty-cache") } });
    assert.equal(invalid.status, 16);
    assert.match(invalid.stderr, /field idea/u);
    writeTreatment(path.join(dir, "out"), stageTreatment());
    const wrongPath = spawnSync(process.execPath, [render, "film", "--brief", brief, "--out", path.join(dir, "out"), "--stills-only"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: path.join(dir, "empty-cache") } });
    assert.equal(wrongPath.status, 16);
    assert.match(wrongPath.stderr, /field path: this treatment takes the stage path/u);
    assert.throws(() => loadTreatment(path.join(dir, "nowhere")), (error) => error.exitCode === 16 && error.field === "treatment");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
