import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SCORE_GENRES, SCORE_STEMS, buildScore, onePole, planScore, sidechainDepth, writeScore } from "../skills/lit-typographic-motion/engine/score.mjs";
import { RATE, integratedLoudness, readWavStereo, samplePeakDbfs, soundChecks, resolveTrack } from "../skills/lit-typographic-motion/engine/sound.mjs";
import { scoreGenres, validateTreatment } from "../skills/lit-typographic-motion/engine/treatment.mjs";
import { readStyle } from "../skills/lit-typographic-motion/engine/styles.mjs";
import { fixtureStageTreatment, stageTreatment } from "../test-support/motion-treatment.mjs";

// The per-film score: a layered track built in product code from the film itself. Each stem is a file;
// the arrangement follows the beats with the drop on the turn; the mix ducks bass under the kick and
// ends in a limiter and a BS.1770 master at -16 LUFS.
const FPS = 30;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const film = (overrides = {}) => fixtureStageTreatment({ durationSec: 9, sound: { mode: "score", plan: "a layered score that thickens as the arc completes and drops on the turn" }, ...overrides });
const frames = (t) => Math.round(t.durationSec * FPS);
const cutsOf = (t) => t.beats.map((b) => Math.round(b.t0 * FPS) / FPS);
const score = (t, genre) => buildScore({ treatment: genre ? { ...t, sound: { ...t.sound, genre } } : t, frameCount: frames(t), fps: FPS, cuts: cutsOf(t) });
const rms = (st) => { let s = 0; for (let i = 0; i < st.left.length; i++) s += st.left[i] ** 2 + st.right[i] ** 2; return 20 * Math.log10(Math.sqrt(s / (2 * st.left.length)) || 1e-9); };

test("the score genres are the treatment's genres, and each style names one", () => {
  assert.deepEqual([...SCORE_GENRES], [...scoreGenres]);
  for (const id of ["swiss-signal", "tidal", "terminalcore", "paper"]) assert.ok(SCORE_GENRES.includes(readStyle(id).score.genre), id);
});

test("two films get different arrangements, keys and tempos, and one film always plans the same", () => {
  const a = film();
  const b = film({ request: "달리는 기차의 하루를 소개하는 영상 만들어줘 lit", idea: "A single carriage carries the whole town's morning in one slow loop.", story: { ...film().story, turn: "The empty carriage fills with the town at the third stop." } });
  const pa = planScore({ treatment: a, durationSec: 9 }), pb = planScore({ treatment: b, durationSec: 9 });
  assert.deepEqual(planScore({ treatment: a, durationSec: 9 }).progression, pa.progression);
  assert.notDeepEqual([pa.key, pa.mode, pa.bpm, pa.progression.join()], [pb.key, pb.mode, pb.bpm, pb.progression.join()]);
  const four = planScore({ treatment: stageTreatment(), durationSec: 16 });
  assert.deepEqual(four.sections.map((s) => s.kind), ["intro", "build", "drop", "outro"], "the arrangement follows the shots");
  assert.deepEqual(pa.sections.map((s) => s.kind), ["intro", "drop", "outro"]);
});

test("the drop is the turn shot and lands on a bar line", () => {
  const t = film();
  const plan = planScore({ treatment: t, durationSec: 9 });
  const drop = plan.sections.find((s) => s.kind === "drop");
  assert.equal(drop.beat, t.story.beat);
  assert.ok(Math.abs(drop.t0 - t.beats[t.story.beat].t0) < 1e-9);
  const bars = (drop.t0 - plan.origin) / plan.barSec;
  assert.ok(Math.abs(bars - Math.round(bars)) < 1e-6, `the drop sits ${bars} bars from the grid's origin`);
  assert.equal(plan.sections[0].kind, "intro");
  assert.equal(plan.sections.at(-1).kind, "outro");
});

test("a score keeps at least six audible stems, and each is its own file", () => {
  const t = film();
  const s = score(t);
  const audible = SCORE_STEMS.filter((name) => rms(s.stems[name]) > -60);
  assert.ok(audible.length >= 6, `audible stems: ${audible.join(", ")}`);
  assert.ok(SCORE_STEMS.length >= 6);
  const dir = tmp("lit-score-files-");
  try {
    const summary = writeScore({ treatment: t, frameCount: frames(t), fps: FPS, cuts: cutsOf(t), dir });
    for (const name of SCORE_STEMS) assert.ok(fs.statSync(path.join(dir, "sound", "stems", `${name}.wav`)).size > 44, name);
    assert.ok(fs.existsSync(path.join(dir, "sound", "score.wav")));
    const cues = JSON.parse(fs.readFileSync(path.join(dir, "sound-cues.json"), "utf8"));
    assert.equal(cues.mode, "score");
    assert.equal(cues.stems.length, summary.stems.length);
    assert.ok(cues.sections.some((x) => x.kind === "drop") && cues.cues.length >= t.beats.length - 1);
    const wav = readWavStereo(path.join(dir, "sound", "score.wav"));
    assert.equal(wav.rate, RATE);
    assert.equal(wav.channels[0].length, Math.round((frames(t) * RATE) / FPS));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the sidechain ducks the bass under every kick in the drop", () => {
  const depth = sidechainDepth(score(film()));
  assert.ok(depth >= 3, `the bass dips ${depth} dB after a kick`);
});

test("the master sits at -16 LUFS with the peak under -2 dBFS, and never clips", () => {
  const s = score(film());
  assert.ok(Math.abs(s.lufs + 16) <= 0.6, `${s.lufs} LUFS`);
  assert.ok(Math.abs(integratedLoudness([s.left, s.right]) + 16) <= 0.6);
  assert.ok(s.peakDbfs <= -1.9, `${s.peakDbfs} dBFS`);
  assert.ok(samplePeakDbfs([s.left, s.right]) <= -1.9);
  assert.equal(s.loudnessMethod, "BS.1770-4");
  assert.ok(s.bus.ratio > 1 && s.bus.maxReductionDb >= 0);
});

test("every genre is finite, in loudness, and keeps its peak through an AAC encode", () => {
  const dir = tmp("lit-score-aac-");
  try {
    for (const genre of SCORE_GENRES) {
      const t = film();
      const s = score(t, genre);
      assert.ok(s.left.every(Number.isFinite) && s.right.every(Number.isFinite), `${genre} has a non-finite sample`);
      const wav = path.join(dir, `${genre}.wav`), aac = path.join(dir, `${genre}.m4a`);
      const pcm = new Int16Array(s.left.length * 2);
      for (let i = 0; i < s.left.length; i++) { pcm[2 * i] = Math.round(s.left[i] * 32767); pcm[2 * i + 1] = Math.round(s.right[i] * 32767); }
      fs.writeFileSync(wav, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]));
      const made = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "2", "-i", "pipe:0", "-c:a", "aac", "-b:a", "256k", aac], { input: Buffer.from(pcm.buffer) });
      assert.equal(made.status, 0, String(made.stderr));
      const back = spawnSync("ffmpeg", ["-v", "error", "-i", aac, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "pipe:1"], { maxBuffer: 1 << 30 });
      assert.equal(back.status, 0);
      const f = new Float32Array(back.stdout.buffer, back.stdout.byteOffset, back.stdout.byteLength / 4);
      assert.ok(f.every(Number.isFinite), `${genre} decodes to a non-finite sample`);
      let peak = 0;
      for (const v of f) peak = Math.max(peak, Math.abs(v));
      assert.ok(20 * Math.log10(peak) <= -0.5, `${genre} peaks at ${(20 * Math.log10(peak)).toFixed(2)} dBFS after AAC`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the pad filter's one-pole coefficient is clamped, so a cutoff under 1 Hz cannot diverge", () => {
  assert.equal(onePole(0.2), onePole(1));
  assert.equal(onePole(-5), onePole(1));
  for (const hz of [0, 1, 300, 20000]) { const c = onePole(hz); assert.ok(c > 0 && c < 1, `${hz} Hz -> ${c}`); }
});

test("a score film resolves to a track the gate accepts: score.wav, cues with the cuts and the arrangement", () => {
  const t = film();
  const dir = tmp("lit-score-track-");
  try {
    const track = resolveTrack(dir, t, { frameCount: frames(t), fps: FPS, cuts: cutsOf(t) });
    assert.equal(track.mode, "score");
    assert.equal(track.label, "score");
    assert.ok(fs.existsSync(track.file) && /score\.wav$/u.test(track.file));
    assert.ok(Number.isFinite(track.lufs) && Number.isFinite(track.peakDbfs));
    assert.deepEqual(Object.keys(soundChecks(null, 9, "none")), ["SOUND"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the rich fixture validates with a score and the rest of its treatment", () => {
  assert.deepEqual(validateTreatment(stageTreatment()), { ok: true });
});
