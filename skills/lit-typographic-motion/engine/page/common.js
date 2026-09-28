// Browser side, part 1: shared GLSL header and small pure helpers. Loaded first; everything the
// page engine owns hangs off window.LTM. No clock or unseeded random source is read anywhere here.
(() => {
  const LTM = (window.LTM = window.LTM || {});

  LTM.glslHeader = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 u_res;      // physical target size
uniform float u_scale;   // physical px per logical px
#define LOGICAL_W 1920.0
#define LOGICAL_H 1080.0
// Fragment position in logical px, origin top-left, y down (the layout convention every scene uses).
vec2 logicalPx() { vec2 p = gl_FragCoord.xy / u_scale; return vec2(p.x, LOGICAL_H - p.y); }
float sat1(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
// Integer hash (PCG output permutation) so every pseudo-random value is a pure function of its inputs.
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hashU(uvec3 p) { return float(pcg(p.x ^ pcg(p.y ^ pcg(p.z)))) * (1.0 / 4294967295.0); }
vec2 grad2(ivec2 cell, uint seed) {
  float a = hashU(uvec3(uint(cell.x + 32768), uint(cell.y + 32768), seed)) * 6.28318530718;
  return vec2(cos(a), sin(a));
}
// Gradient noise on a hashed lattice, quintic fade; range about [-0.7, 0.7].
float gnoise(vec2 p, uint seed) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i, seed), f), b = dot(grad2(i + ivec2(1, 0), seed), f - vec2(1, 0));
  float c = dot(grad2(i + ivec2(0, 1), seed), f - vec2(0, 1)), d = dot(grad2(i + ivec2(1, 1), seed), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int octaves, uint seed) {
  float sum = 0.0, amp = 0.5;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(p, seed + uint(i) * 1013u);
    p = turn * p * 2.02 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum;
}
// Curl of a scalar noise field: a divergence-free flow direction.
vec2 curl2(vec2 p, uint seed) {
  float e = 0.02;
  float n1 = gnoise(p + vec2(0.0, e), seed), n2 = gnoise(p - vec2(0.0, e), seed);
  float n3 = gnoise(p + vec2(e, 0.0), seed), n4 = gnoise(p - vec2(e, 0.0), seed);
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}
`;

  LTM.hexToLinear = (hex) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  };

  LTM.clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  LTM.lerp = (a, b, t) => a + (b - a) * t;

  // Cubic-bezier easing tokens resolved by Newton iteration (a fixed, pure computation).
  LTM.bezier = ([x1, y1, x2, y2]) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = sampleX(t) - x;
        const d = slopeX(t);
        if (Math.abs(err) < 1e-7 || Math.abs(d) < 1e-7) break;
        t -= err / d;
      }
      return sampleY(LTM.clamp(t));
    };
  };

  LTM.mulberry32 = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  LTM.fnv1a32 = (input) => {
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(String(input))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash >>> 0;
  };
})();
