import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildBed, integratedLoudness, quietestStretchSec, readWavStereo, resolveTrack, samplePeakDbfs, soundChecks, wavBytes } from "../skills/lit-typographic-motion/engine/sound.mjs";
import { inspectAudio } from "../skills/lit-typographic-motion/runtime.mjs";
import { stageTreatment, typeTreatment, writeTreatment } from "../test-support/motion-treatment.mjs";

const render = path.resolve("skills", "lit-typographic-motion", "render.mjs");
const warmed = process.env.MOTION_TEST_XDG_CACHE_HOME;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const timing = (t, fps = 60) => ({ frameCount: Math.round(t.durationSec * fps), fps, cuts: t.beats.map((beat) => beat.t0) });

test("the generated bed is deterministic, exactly as long as the film, under -2 dBFS and near -16 LUFS", () => {
  const t = stageTreatment();
  const a = buildBed(t, timing(t)), b = buildBed(t, timing(t));
  assert.equal(createHash("sha256").update(wavBytes(a.pcm)).digest("hex"), createHash("sha256").update(wavBytes(b.pcm)).digest("hex"));
  assert.equal(a.pcm.length / 2, Math.round((960 * 48000) / 60));
  assert.ok(a.stats.peakDbfs <= -2, `peak ${a.stats.peakDbfs}`);
  assert.ok(Math.abs(a.stats.lufs + 16) <= 2, `loudness ${a.stats.lufs}`);
  const at30 = buildBed({ ...t, fps: 30 }, timing(t, 30));
  assert.equal(at30.pcm.length / 2, Math.round((480 * 48000) / 30));
});

test("each timbre palette, key and tempo gives a different bed", () => {
  const t = stageTreatment();
  const hashes = new Set();
  for (const sound of [{ palette: "glass" }, { palette: "warm" }, { palette: "pulse" }, { palette: "air" }, { palette: "warm", key: "F# major" }, { palette: "warm", tempo: 120 }]) {
    const bed = buildBed({ ...t, sound: { ...t.sound, ...sound } }, timing(t));
    hashes.add(createHash("sha256").update(wavBytes(bed.pcm)).digest("hex"));
  }
  assert.equal(hashes.size, 6);
});

test("the cue sheet lines every accent up with its cut and states the delta", () => {
  const t = stageTreatment();
  const bed = buildBed(t, timing(t));
  const hits = bed.cues.filter((cue) => cue.kind === "hit");
  assert.deepEqual(hits.map((cue) => cue.beat), [0, 2], "beats 0 and 2 ask for a hit");
  for (const cue of bed.cues) assert.ok(Math.abs(cue.deltaMs) <= 1000 / 48000 + 1e-9 || cue.kind === "cadence", JSON.stringify(cue));
  assert.ok(bed.cues.some((cue) => cue.kind === "rise" && cue.cutTime === 8), "beat 1 rises into the cut at 8 s");
  assert.ok(bed.cues.some((cue) => cue.kind === "cadence"), "the last beat closes on a cadence");
  assert.ok(bed.cues.some((cue) => cue.kind === "cut" && cue.cutTime === 12), "an unaccented cut is still listed");
});

test("the in-code BS.1770-4 meter agrees with ffmpeg ebur128 within 0.5 LU", { skip: hasFfmpeg ? false : "ffmpeg is absent" }, () => {
  const dir = tmp("ltm-lufs-");
  try {
    for (const palette of ["glass", "pulse"]) {
      const t = stageTreatment({ sound: { ...stageTreatment().sound, palette } });
      const bed = buildBed(t, timing(t));
      const file = path.join(dir, `${palette}.wav`);
      fs.writeFileSync(file, wavBytes(bed.pcm));
      const ours = integratedLoudness(readWavStereo(file).channels);
      const probe = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
      const theirs = Number(probe.stderr.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/u)[1]);
      assert.ok(Math.abs(ours - theirs) <= 0.5, `${palette}: ours ${ours.toFixed(2)}, ffmpeg ${theirs}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a generated bed never starts silent: no stretch under -50 dBFS longer than 1.5 s in the first 3 s", () => {
  const t = stageTreatment();
  const bed = buildBed(t, timing(t));
  const channels = [Float64Array.from({ length: bed.pcm.length / 2 }, (_, i) => bed.pcm[2 * i] / 32768), Float64Array.from({ length: bed.pcm.length / 2 }, (_, i) => bed.pcm[2 * i + 1] / 32768)];
  assert.ok(quietestStretchSec(channels, 48000) <= 1.5);
  assert.ok(samplePeakDbfs(channels) <= -2);
});

test("a planned supplied or authored track that is missing exits 20", () => {
  const dir = tmp("ltm-missing-");
  try {
    const t = stageTreatment({ sound: { mode: "supplied", plan: "the user's track", file: "nowhere.wav" } });
    assert.throws(() => resolveTrack(dir, t, timing(t)), (error) => error.exitCode === 20 && /SOUND_INVALID \(20\): the supplied track nowhere\.wav is missing/u.test(error.message));
    writeTreatment(dir, t);
    const cli = spawnSync(process.execPath, [render, "sound", "--out", dir], { encoding: "utf8" });
    assert.equal(cli.status, 20, cli.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the gate names a planned track that never reached the film", { skip: hasFfmpeg ? false : "ffmpeg is absent" }, () => {
  const dir = tmp("ltm-nostream-");
  try {
    const film = path.join(dir, "silent.mp4");
    const made = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=2:r=30", "-pix_fmt", "yuv420p", film]);
    assert.equal(made.status, 0);
    const rows = soundChecks(film, 2, "generated");
    assert.equal(rows["SOUND-stream"].pass, false);
    assert.match(rows["SOUND-stream"].detail, /plans generated sound but the film has no audio stream/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the sound subcommand writes the bed and its cue sheet from the treatment", () => {
  const dir = tmp("ltm-soundcmd-");
  try {
    writeTreatment(dir, stageTreatment());
    const result = spawnSync(process.execPath, [render, "sound", "--out", dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sound: generated bed .*sound\.wav \(warm, D minor, 90 BPM; -1[5-7]\.\d+ LUFS/u);
    const cues = JSON.parse(fs.readFileSync(path.join(dir, "sound-cues.json"), "utf8"));
    assert.equal(cues.mode, "generated");
    assert.deepEqual(cues.cuts, [0, 4, 8, 12]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function toneWav(file, seconds) {
  const rate = 44100, n = Math.round(seconds * rate), pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { const v = Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 330 * i) / rate)); pcm[2 * i] = v; pcm[2 * i + 1] = v; }
  const bytes = wavBytes(pcm, rate, 2);
  fs.writeFileSync(file, bytes);
}

const audioTierAbsent = warmed && !inspectAudio({ XDG_CACHE_HOME: warmed }).ready;
test("type path: a short supplied track is muxed without the audio-analysis tier and padded to the film, never truncating it", { skip: warmed ? (audioTierAbsent ? false : "the test cache has the audio venv; this case needs it absent") : "MOTION_TEST_XDG_CACHE_HOME is not set to a pre-warmed test cache" }, () => {
  const dir = tmp("ltm-supplied-");
  try {
    const out = path.join(dir, "out");
    const treatment = typeTreatment({ sound: { mode: "supplied", plan: "the user's short sting under the first line", file: "sting.wav" } });
    writeTreatment(out, treatment);
    toneWav(path.join(out, "sting.wav"), 1.5);
    fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify({ lines: ["바람이 먼저 안다", "길은 늘 열려 있다"] }));
    const result = spawnSync(process.execPath, [render, "film", "--brief", path.join(dir, "brief.json"), "--out", out, "--round", "2", "--samples", "1"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: warmed }, timeout: 600_000 });
    assert.ok([0, 13].includes(result.status), `${result.status}: ${result.stderr.split("\n").slice(-5).join("\n")}`);
    const film = fs.existsSync(path.join(out, "film.mp4")) ? path.join(out, "film.mp4") : path.join(out, "withheld", "film.mp4");
    const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration:format=duration", "-of", "json", film], { encoding: "utf8" }).stdout);
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    assert.ok(audio, "the supplied track is in the film although the audio-analysis tier is absent");
    assert.ok(Number(video.duration) >= 8 - 1e-6, `the video keeps its ${video.duration} s`);
    assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) <= 0.1, `audio ${audio.duration} s vs video ${video.duration} s`);
    assert.match(result.stdout, /SOUND-stream PASS/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
