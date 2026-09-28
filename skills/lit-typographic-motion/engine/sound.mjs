// Sound for both render paths. A generated bed is written from the treatment in pure code (no network,
// no model weights): tempo, a pulse and a chord pad in the treatment's key and timbre palette, plus the
// accents each beat's `sound` field asks for (a hit on its cut, a rise into the next beat, a closing
// cadence, a thin stretch that pares the bed back). It is 48 kHz 16-bit stereo, exactly as long as the film, peaks
// at most -2 dBFS and is normalized to -16 LUFS by an ITU-R BS.1770-4 meter implemented here. Every
// track, generated, supplied or authored, is muxed, padded or trimmed to the film with a 50 ms fade.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mulberry32, fnv1a32 } from "./text.mjs";

export const SOUND_EXIT = 20;
export const RATE = 48000;
const TARGET_LUFS = -16;
const PEAK_CEILING_DBFS = -2;
const fadeSec = 0.05;

// ---- ITU-R BS.1770-4: K-weighting at 48 kHz, 400 ms blocks with 75 % overlap, -70 LUFS absolute and
// -10 LU relative gates ----
const shelf = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const highPass = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] };
function biquad(input, { b, a }) {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
export function integratedLoudness(channels, rate = RATE) {
  if (rate !== RATE) throw new Error("the loudness meter's K-weighting coefficients are for 48 kHz");
  const weighted = channels.map((channel) => biquad(biquad(channel, shelf), highPass));
  const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate);
  const blocks = [];
  for (let start = 0; start + block <= weighted[0].length; start += hop) {
    let sum = 0;
    for (const channel of weighted) { let s = 0; for (let i = start; i < start + block; i++) s += channel[i] * channel[i]; sum += s / block; }
    blocks.push(sum);
  }
  const loudness = (z) => -0.691 + 10 * Math.log10(z);
  const absolute = blocks.filter((z) => loudness(z) > -70);
  if (absolute.length === 0) return -Infinity;
  const relativeGate = loudness(absolute.reduce((s, z) => s + z, 0) / absolute.length) - 10;
  const gated = absolute.filter((z) => loudness(z) > relativeGate);
  return loudness(gated.reduce((s, z) => s + z, 0) / gated.length);
}

const dbfs = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
export function samplePeakDbfs(channels) {
  let peak = 0;
  for (const channel of channels) for (const v of channel) peak = Math.max(peak, Math.abs(v));
  return dbfs(peak);
}
// The longest run of 50 ms windows under `floorDb` RMS inside [0, untilSec).
export function quietestStretchSec(channels, rate, untilSec = 3, floorDb = -50) {
  const win = Math.round(0.05 * rate), end = Math.min(channels[0].length, Math.round(untilSec * rate));
  let run = 0, longest = 0;
  for (let start = 0; start + win <= end; start += win) {
    let sum = 0;
    for (const channel of channels) for (let i = start; i < start + win; i++) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / (win * channels.length));
    run = dbfs(rms) < floorDb ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return (longest * win) / rate;
}

// ---- music ----
const noteIndex = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
function progression(key) {
  const [, name, mode] = key.match(/^([A-G][#b]?) (major|minor)$/u);
  const root = 48 + noteIndex[name];
  const scale = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const degrees = mode === "major" ? [0, 4, 5, 3] : [0, 5, 2, 6];
  const triad = (degree) => [0, 2, 4].map((step) => { const d = degree + step; return root + scale[d % 7] + 12 * Math.floor(d / 7); });
  return { root, chords: degrees.map(triad), tonic: triad(0) };
}

// Timbre palettes: `pad(f, t)` is one voice at `f` Hz and film time `t`; the flags add a sub, bells, an
// arpeggio or breath noise.
const palettes = {
  glass: { pad: (f, t) => 0.55 * Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(2 * Math.PI * 2 * f * t), bell: true, pulse: 0.35, noise: 0 },
  warm: { pad: (f, t) => { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t + h) / h; return 0.42 * v; }, sub: true, pulse: 0.45, noise: 0 },
  pulse: { pad: (f, t) => 0.35 * Math.sin(2 * Math.PI * f * t), arp: true, pulse: 0.6, noise: 0 },
  air: { pad: (f, t) => 0.5 * Math.sin(2 * Math.PI * f * t) + 0.12 * Math.sin(2 * Math.PI * 1.5 * f * t), pulse: 0.25, noise: 0.08 }
};

// Accent words a beat's `sound` field may carry.
export function accentsFor(beat) {
  const text = String(beat.sound ?? "").toLowerCase();
  return { hit: /\bhits?\b|\bimpact\b|\bboom\b|\bstab\b/u.test(text), rise: /\brise\b|\briser\b|\bswell\b|\bbuild\b/u.test(text), cadence: /\bcadence\b|\bresolve\b|\bfinal chord\b/u.test(text), thin: /\bthin(?:s|ned)?\b|\bsparse\b|\bpared back\b/u.test(text) };
}

// cuts[i] is the film time where beat i starts on screen (the render's own cut times).
export function buildBed(treatment, { frameCount, fps, cuts }) {
  const sound = treatment.sound;
  const length = Math.round((frameCount * RATE) / fps);
  const duration = length / RATE;
  const palette = palettes[sound.palette];
  const random = mulberry32(fnv1a32(`${treatment.seed ?? ""}:${treatment.idea}:${sound.palette}:${sound.key}:${sound.tempo}`));
  const { chords, tonic, root } = progression(sound.key);
  const beatSec = 60 / sound.tempo;
  const chordSec = beatSec * 8;
  const L = new Float64Array(length), R = new Float64Array(length);
  const beats = treatment.beats;
  const beatAt = (t) => { let k = 0; while (k + 1 < cuts.length && cuts[k + 1] <= t) k++; return k; };
  const accents = beats.map(accentsFor);
  const cadenceStart = accents.at(-1)?.cadence ? Math.max(0, duration - 1.6) : Infinity;
  // Pad: the chord of the moment, three voices spread across the stereo field.
  const noiseState = { l: 0, r: 0 };
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const chord = t >= cadenceStart ? tonic : chords[Math.floor(t / chordSec) % chords.length];
    const thinGain = accents[beatAt(t)]?.thin ? 0.4 : 1;
    const swell = 0.75 + 0.25 * Math.sin((2 * Math.PI * t) / (chordSec * 2));
    let l = 0, r = 0;
    chord.forEach((note, v) => {
      const s = palette.pad(hz(note + 12), t) * (0.33 - 0.04 * v);
      const pan = 0.5 + (v - 1) * 0.3;
      l += s * (1 - pan); r += s * pan;
    });
    if (palette.sub) { const s = 0.25 * Math.sin(2 * Math.PI * hz(chord[0] - 12) * t); l += s; r += s; }
    if (palette.noise) {
      noiseState.l += 0.02 * ((random() * 2 - 1) - noiseState.l); noiseState.r += 0.02 * ((random() * 2 - 1) - noiseState.r);
      l += palette.noise * 6 * noiseState.l; r += palette.noise * 6 * noiseState.r;
    }
    L[i] = l * thinGain * swell; R[i] = r * thinGain * swell;
  }
  // Pulse: a soft tuned knock on every tempo beat; arpeggio or bell notes on the off-beats.
  const addNote = (start, f, amp, decay, pan = 0.5, shape = "sine") => {
    const s0 = Math.round(start * RATE), n = Math.min(length - s0, Math.round(decay * 6 * RATE));
    for (let k = 0; k < n; k++) {
      const age = k / RATE;
      const env = Math.exp(-age / decay) * Math.min(1, age / 0.004);
      let v = Math.sin(2 * Math.PI * f * age);
      if (shape === "square") v = Math.sign(v) * 0.6 + 0.4 * v;
      if (shape === "bell") v = Math.sin(2 * Math.PI * f * age + 2.2 * Math.exp(-age / 0.3) * Math.sin(2 * Math.PI * f * 3.5 * age));
      L[s0 + k] += amp * env * v * (1 - pan); R[s0 + k] += amp * env * v * pan;
    }
  };
  for (let b = 0; b * beatSec < duration; b++) {
    const t = b * beatSec;
    const knock = hz(root - 12);
    const s0 = Math.round(t * RATE), n = Math.min(length - s0, Math.round(0.25 * RATE));
    for (let k = 0; k < n; k++) {
      const age = k / RATE, f = knock * (1 + 1.5 * Math.exp(-age / 0.03));
      const v = palette.pulse * 0.5 * Math.exp(-age / 0.09) * Math.sin(2 * Math.PI * f * age);
      L[s0 + k] += v; R[s0 + k] += v;
    }
    const chord = t >= cadenceStart ? tonic : chords[Math.floor(t / chordSec) % chords.length];
    if (palette.arp) for (let e = 0; e < 2; e++) addNote(t + e * beatSec / 2, hz(chord[(b * 2 + e) % 3] + 24), 0.16, 0.12, 0.3 + 0.4 * random(), "square");
    if (palette.bell && b % 2 === 1) addNote(t, hz(chord[b % 3] + 24), 0.12, 0.5, 0.2 + 0.6 * random(), "bell");
  }
  // Accents against the cut times.
  const cues = [];
  accents.forEach((accent, index) => {
    const cut = cuts[index] ?? beats[index].t0;
    const next = cuts[index + 1] ?? duration;
    if (accent.hit && cut < duration) {
      const s0 = Math.round(cut * RATE), n = Math.min(length - s0, Math.round(0.6 * RATE));
      for (let k = 0; k < n; k++) {
        const age = k / RATE, f = 55 * (1 + 2 * Math.exp(-age / 0.04));
        const v = 0.9 * Math.exp(-age / 0.18) * Math.sin(2 * Math.PI * f * age) + 0.25 * Math.exp(-age / 0.02) * (random() * 2 - 1);
        L[s0 + k] += v; R[s0 + k] += v;
      }
      cues.push({ kind: "hit", beat: index, time: s0 / RATE, cutTime: cut, deltaMs: Number(((s0 / RATE - cut) * 1000).toFixed(3)) });
    }
    if (accent.rise && next <= duration + 1e-9) {
      const span = Math.min(1.2, next - cut), s0 = Math.round((next - span) * RATE), s1 = Math.round(next * RATE);
      let lp = 0;
      for (let k = s0; k < Math.min(length, s1); k++) {
        const p = (k - s0) / Math.max(1, s1 - s0);
        lp += 0.05 * ((random() * 2 - 1) - lp);
        const v = 0.5 * p * p * (lp * 3 + 0.4 * Math.sin(2 * Math.PI * (220 + 660 * p) * (k / RATE)));
        L[k] += v; R[k] += v;
      }
      cues.push({ kind: "rise", beat: index, time: s1 / RATE, cutTime: next, deltaMs: Number(((s1 / RATE - next) * 1000).toFixed(3)) });
    }
    if (accent.thin) cues.push({ kind: "thin", beat: index, time: Math.round(cut * RATE) / RATE, cutTime: cut, deltaMs: Number(((Math.round(cut * RATE) / RATE - cut) * 1000).toFixed(3)) });
  });
  if (Number.isFinite(cadenceStart)) {
    for (const note of tonic) addNote(cadenceStart, hz(note + 12), 0.22, 0.9, 0.5);
    cues.push({ kind: "cadence", beat: beats.length - 1, time: cadenceStart, cutTime: duration, deltaMs: Number(((cadenceStart - (duration - 1.6)) * 1000).toFixed(3)) });
  }
  // Every cut also gets a cue line for the look's sound question, accented or not.
  cuts.forEach((cut, index) => { if (index > 0 && !cues.some((cue) => cue.beat === index && cue.kind === "hit")) cues.push({ kind: "cut", beat: index, time: cut, cutTime: cut, deltaMs: 0 }); });
  // 50 ms fades at both ends, then loudness to -16 LUFS under a -2 dBFS soft ceiling.
  const fadeN = Math.round(fadeSec * RATE);
  for (let k = 0; k < fadeN; k++) { const g = k / fadeN; L[k] *= g; R[k] *= g; L[length - 1 - k] *= g; R[length - 1 - k] *= g; }
  const ceiling = 10 ** (PEAK_CEILING_DBFS / 20) * 0.995;
  let gain = 1, lufs = integratedLoudness([L, R]), outL = L, outR = R;
  for (let pass = 0; pass < 6 && Number.isFinite(lufs); pass++) {
    gain *= 10 ** ((TARGET_LUFS - lufs) / 20);
    outL = L.map((v) => ceiling * Math.tanh((v * gain) / ceiling));
    outR = R.map((v) => ceiling * Math.tanh((v * gain) / ceiling));
    lufs = integratedLoudness([outL, outR]);
    if (Math.abs(lufs - TARGET_LUFS) < 0.1) break;
  }
  const pcm = new Int16Array(length * 2);
  for (let i = 0; i < length; i++) { pcm[2 * i] = Math.round(outL[i] * 32767); pcm[2 * i + 1] = Math.round(outR[i] * 32767); }
  const decoded = [Float64Array.from({ length }, (_, i) => pcm[2 * i] / 32768), Float64Array.from({ length }, (_, i) => pcm[2 * i + 1] / 32768)];
  cues.sort((a, b) => a.time - b.time || a.beat - b.beat);
  return { pcm, cues, stats: { samples: length, durationSec: duration, lufs: Number(integratedLoudness(decoded).toFixed(2)), peakDbfs: Number(samplePeakDbfs(decoded).toFixed(2)), palette: sound.palette, key: sound.key, tempo: sound.tempo } };
}

export function wavBytes(pcm, rate = RATE, channels = 2) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Writes <out>/sound.wav and <out>/sound-cues.json for a generated bed; returns the stats.
export function writeBed(out, treatment, timing) {
  const bed = buildBed(treatment, timing);
  const wav = path.join(out, "sound.wav");
  writeFileSync(wav, wavBytes(bed.pcm));
  writeFileSync(path.join(out, "sound-cues.json"), JSON.stringify({ mode: "generated", palette: bed.stats.palette, key: bed.stats.key, tempo: bed.stats.tempo, cuts: timing.cuts, cues: bed.cues }, null, 2) + "\n");
  return { file: wav, ...bed.stats };
}

// The track a render muxes: generated (built here), supplied or authored (a file), or none.
export function resolveTrack(out, treatment, timing, briefAudio) {
  const mode = treatment.sound.mode;
  if (mode === "none") return { mode };
  if (mode === "generated") return { mode, ...writeBed(out, treatment, timing), label: "generated" };
  const named = treatment.sound.file ?? briefAudio;
  const file = named ? path.resolve(out, named) : null;
  if (!file || !existsSync(file)) throw Object.assign(new Error(`SOUND_INVALID (20): the ${mode} track ${named ?? "(none named)"} is missing`), { exitCode: SOUND_EXIT });
  writeFileSync(path.join(out, "sound-cues.json"), JSON.stringify({ mode, file: path.relative(out, file), cuts: timing.cuts, cues: timing.cuts.map((cut, beat) => ({ kind: "cut", beat, time: cut, cutTime: cut, deltaMs: 0 })) }, null, 2) + "\n");
  return { mode, file, label: mode };
}

// Muxes any track into the video: pad or trim to the video's length with 50 ms fades, AAC 256k.
export function muxTrack(videoFile, track, durationSec, target) {
  const fadeOut = Math.max(0, durationSec - fadeSec).toFixed(6);
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", videoFile, "-i", track.file, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
    "-af", `aresample=${RATE},apad,atrim=0:${durationSec.toFixed(6)},afade=t=in:d=${fadeSec},afade=t=out:st=${fadeOut}:d=${fadeSec}`,
    "-ac", "2", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", target], { encoding: "utf8", timeout: 300000 });
  if (result.status !== 0) throw Object.assign(new Error(`SOUND_INVALID (20): the ${track.mode} track could not be muxed: ${(result.stderr || "").trim().split("\n").at(-1)}`), { exitCode: SOUND_EXIT });
}

// Decodes a film's audio stream (48 kHz stereo float) for the gate; null when there is none.
export function decodeFilmAudio(file) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (probe.status !== 0 || !probe.stdout.trim()) return null;
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", String(RATE), "pipe:1"], { maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) return null;
  const floats = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
  const n = floats.length / 2;
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = floats[2 * i]; R[i] = floats[2 * i + 1]; }
  return [L, R];
}

// Section 7's gate on the decoded muxed stream. Returns check rows; `silenceFails` is true for a
// generated bed (exit 20) and false for a supplied or authored track (WARN).
export function soundChecks(filmFile, videoDurationSec, mode) {
  if (mode === "none") return { SOUND: { pass: true, detail: "silent by the treatment's request" } };
  const channels = filmFile && existsSync(filmFile) ? decodeFilmAudio(filmFile) : null;
  if (!channels) return { "SOUND-stream": { pass: false, detail: `the treatment plans ${mode} sound but the film has no audio stream` } };
  const duration = channels[0].length / RATE;
  const peak = samplePeakDbfs(channels);
  const quiet = quietestStretchSec(channels, RATE);
  const lufs = integratedLoudness(channels);
  return {
    "SOUND-stream": { pass: true, detail: `${mode} track present (${lufs.toFixed(1)} LUFS integrated)` },
    "SOUND-duration": Math.abs(duration - videoDurationSec) <= 0.1 ? { pass: true, detail: `${duration.toFixed(3)} s against the video's ${videoDurationSec.toFixed(3)} s` } : { pass: false, detail: `${duration.toFixed(3)} s against the video's ${videoDurationSec.toFixed(3)} s (more than 0.1 s off)` },
    "SOUND-peak": peak <= -0.5 ? { pass: true, detail: `sample peak ${peak.toFixed(2)} dBFS` } : { pass: false, detail: `sample peak ${peak.toFixed(2)} dBFS is over -0.5 dBFS` },
    "SOUND-start": quiet <= 1.5 ? { pass: true, detail: `longest stretch under -50 dBFS in the first 3 s: ${quiet.toFixed(2)} s` }
      : mode === "generated" ? { pass: false, detail: `the bed sits under -50 dBFS for ${quiet.toFixed(2)} s in the first 3 s` } : { pass: false, warn: true, detail: `the ${mode} track sits under -50 dBFS for ${quiet.toFixed(2)} s in the first 3 s` }
  };
}

export function readWavStereo(file) {
  const bytes = readFileSync(file);
  const channels = bytes.readUInt16LE(22), bits = bytes.readUInt16LE(34);
  if (bits !== 16) throw new Error("only 16-bit PCM WAV is read here");
  let offset = 12;
  while (offset + 8 <= bytes.length && bytes.toString("ascii", offset, offset + 4) !== "data") offset += 8 + bytes.readUInt32LE(offset + 4);
  const size = bytes.readUInt32LE(offset + 4), start = offset + 8, frames = size / (2 * channels);
  const L = new Float64Array(frames), R = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = bytes.readInt16LE(start + i * 2 * channels) / 32768; R[i] = bytes.readInt16LE(start + (i * channels + (channels > 1 ? 1 : 0)) * 2) / 32768; }
  return { rate: bytes.readUInt32LE(24), channels: [L, R] };
}
