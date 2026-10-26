// Loudness for every generated track: the ITU-R BS.1770-4 meter, the sample peak, a lookahead limiter and
// the master stage that brings a mix to -16 LUFS under a -2 dBFS ceiling. Pure functions over Float64
// channels at 48 kHz; the sound bed and the score both end here.
export const RATE = 48000;
export const TARGET_LUFS = -16;
export const PEAK_CEILING_DBFS = -2;

// ITU-R BS.1770-4: K-weighting at 48 kHz, 400 ms blocks with 75 % overlap, -70 LUFS absolute and
// -10 LU relative gates.
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

export const dbfs = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
export function samplePeakDbfs(channels) {
  let peak = 0;
  for (const channel of channels) for (const v of channel) peak = Math.max(peak, Math.abs(v));
  return dbfs(peak);
}
export function wavBytes(pcm, rate = RATE, channels = 2) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// A lookahead limiter: the gain that keeps every sample under `ceiling` is found 5 ms ahead, so the
// reduction is fully in place when the peak arrives, then released over 80 ms. Returns new channels.
export function limit(channels, ceiling, { lookaheadSec = 0.005, releaseSec = 0.08, rate = RATE } = {}) {
  const n = channels[0].length;
  const look = Math.max(1, Math.round(lookaheadSec * rate));
  const need = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
    need[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // The minimum of the required gain over the next `look` samples (a sliding window, monotone deque).
  const floor = new Float64Array(n);
  const deque = [];
  let head = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (deque.length > head && need[deque.at(-1)] >= need[i]) deque.pop();
    deque.push(i);
    while (deque[head] > i + look) head++;
    floor[i] = need[deque[head]];
  }
  const release = Math.exp(-1 / (releaseSec * rate));
  const attack = Math.exp(-1 / (look * 0.5));
  const gain = new Float64Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = floor[i] < g ? attack * g + (1 - attack) * floor[i] : release * g + (1 - release) * floor[i];
    gain[i] = g;
  }
  // The smoothed gain can sit above the required gain for a few samples on the attack; clamp so no sample passes the ceiling.
  return channels.map((channel) => channel.map((v, i) => v * Math.min(gain[i], need[i])));
}

// The master stage: gain to -16 LUFS, then the limiter under -2 dBFS, repeated until the limited result
// sits within 0.1 LU. Returns the final channels, the gain applied before the limiter and the loudness.
export function masterTo(left, right, { target = TARGET_LUFS, ceilingDbfs = PEAK_CEILING_DBFS } = {}) {
  const ceiling = 10 ** (ceilingDbfs / 20) * 0.995;
  let gain = 1, lufs = integratedLoudness([left, right]), out = [left, right];
  for (let pass = 0; pass < 8 && Number.isFinite(lufs); pass++) {
    gain *= 10 ** ((target - lufs) / 20);
    out = limit([left.map((v) => v * gain), right.map((v) => v * gain)], ceiling);
    lufs = integratedLoudness(out);
    if (Math.abs(lufs - target) < 0.1) break;
  }
  return { left: out[0], right: out[1], gain, lufs };
}
