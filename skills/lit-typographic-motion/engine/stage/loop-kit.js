// LitLoop, served at /lit/loop-kit.js to a cover page (references/cover.md). A cover page draws one
// picture per loop time t in [0, 1) through window.renderFrame(t); the cover renderer seeks the
// frames t = i / N in any order, more than once, in fresh browsers. So every helper below is either
// periodic in t (its value at t = 1 is its value at t = 0) or a pure function of its arguments, and
// none of them keeps state between calls. Randomness exists only as rng(seed), for layout.
(function (scope) {
  "use strict";

  const TAU = 2 * Math.PI;
  const fract = (x) => x - Math.floor(x);
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const mix = (a, b, k) => a * (1 - k) + b * k;

  // mulberry32: the same seed always lays out the same picture.
  function rng(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Value noise on a seeded 3D lattice, smooth-stepped between lattice points.
  function makeNoise(seed) {
    const draw = rng(seed);
    const table = new Float32Array(256).map(() => draw() * 2 - 1);
    const order = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(draw() * (i + 1));
      const keep = order[i];
      order[i] = order[j];
      order[j] = keep;
    }
    const hash = (x, y, z) => table[order[(order[(order[x & 255] + y) & 255] + z) & 255]];
    const fade = (k) => k * k * (3 - 2 * k);
    return function noise(x, y, z) {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
      const plane = (zz) => mix(
        mix(hash(ix, iy, zz), hash(ix + 1, iy, zz), u),
        mix(hash(ix, iy + 1, zz), hash(ix + 1, iy + 1, zz), u),
        v
      );
      return mix(plane(iz), plane(iz + 1), w);
    };
  }

  // Noise sampled on a circle of `radius` around `offset`: one lap per loop, so it closes at t = 1.
  // Different offsets give different copies of the same wander.
  function loopNoise(noise, t, offset = 0, radius = 1.25) {
    const a = TAU * t;
    return noise(offset + radius * Math.cos(a), radius * Math.sin(a), 0.41 * offset);
  }

  // Easing shapes for events. Motion that never stops (a drift, a lap) stays linear.
  const ease = Object.freeze({
    smooth: (p) => p * p * (3 - 2 * p),
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inCubic: (p) => p * p * p,
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    outBack: (p, s = 1.6) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
    gain: (p, k) => (p < 0.5 ? 0.5 * Math.pow(2 * p, k) : 1 - 0.5 * Math.pow(2 - 2 * p, k))
  });

  // A symmetric bump of half-width w centred on c; 0 outside it. Micro events use this: an
  // exponential tail is a slow fade, and the lossy encoder drops slow fades.
  function cubicPulse(c, w, x) {
    const d = Math.abs(x - c) / w;
    return d >= 1 ? 0 : 1 - d * d * (3 - 2 * d);
  }
  // A fast attack and an exponential decay; kept for shapes that end before the loop does.
  function expImpulse(x, k) {
    const h = k * x;
    return h * Math.exp(1 - h);
  }

  // The loop position of one copy: `cycles` laps per loop, shifted back by `offset`.
  const phase = (t, offset = 0, cycles = 1) => fract(cycles * t - offset);
  // How far p is from c around the loop (0 to 0.5): an event can straddle t = 0.
  function cdist(p, c) {
    const d = fract(p - c);
    return d > 0.5 ? 1 - d : d;
  }
  // A one-shot inside the loop: progress 0..1 while p is in [start, start + dur) (wrapping), else -1.
  function windowAt(p, start, dur) {
    const q = fract(p - start);
    return q < dur ? q / dur : -1;
  }
  // Dwell and move: `stops` poses per lap, travelling during the last `travel` share of each slot.
  function steps(p, stops, travel = 0.35, shape = ease.smooth) {
    const slot = Math.floor(p * stops);
    const inSlot = p * stops - slot;
    return (slot + shape(clamp((inSlot - (1 - travel)) / travel))) / stops;
  }
  // 0 -> 1 -> 0 over one lap, resting at both ends.
  const swell = (p) => 0.5 * (1 - Math.cos(TAU * p));

  scope.LitLoop = Object.freeze({ TAU, clamp, fract, mix, rng, makeNoise, loopNoise, ease, cubicPulse, expImpulse, phase, cdist, window: windowAt, steps, swell });
})(typeof window === "undefined" ? globalThis : window);
