// Browser side, part 4: the six look-library passes (MO-SH-05..11), original GLSL written against
// the spec's uniform tables. Every pass writes its uniforms through Pass.set (logged) and counts its
// draw calls, so the gate can prove per-frame GLSL coverage (MO-SH-00a/00b, MO-C-01).
(() => {
  const LTM = window.LTM;

  LTM.createPasses = (core) => {
    const { Pass } = core;
    const passes = {};

    passes["tidal-gradient"] = new Pass("tidal-gradient", `
uniform float u_time; uniform uint u_seed;
uniform vec3 u_background; uniform vec3 u_stopA; uniform vec3 u_stopB;
uniform float u_flowSpeed; uniform float u_warpAmount; uniform float u_curlStrength; uniform int u_octaves;
uniform float u_surge; uniform float u_surgeOnHit; uniform int u_bandingSteps; uniform float u_ditherAmount; uniform vec2 u_origin;
void main() {
  vec2 px = logicalPx();
  vec2 p = px / LOGICAL_H;
  float t = u_time * u_flowSpeed;
  vec2 q = p * 1.4 + u_origin;
  vec2 flow = curl2(q * 0.7 + vec2(t, -t), u_seed) * u_curlStrength * 0.08;
  vec2 warp = vec2(fbm(q + vec2(0.0, t), u_octaves, u_seed), fbm(q + vec2(5.2, 1.3) - vec2(t, 0.0), u_octaves, u_seed + 7u));
  float k = fbm(q + u_warpAmount * warp + flow + vec2(t * 0.5), u_octaves, u_seed + 13u);
  k = sat1(0.5 + 0.9 * k + 0.35 * (px.x / LOGICAL_W - 0.5) - 0.2 * (px.y / LOGICAL_H - 0.5));
  k = sat1(k + 0.06 * u_surge * u_surgeOnHit);
  if (u_bandingSteps > 0) k = floor(k * float(u_bandingSteps)) / float(u_bandingSteps);
  vec3 col = mix(u_background, u_stopA, smoothstep(0.1, 0.55, k));
  col = mix(col, u_stopB, smoothstep(0.5, 0.95, k));
  vec3 s = toSRGB(col) + (hashU(uvec3(uvec2(gl_FragCoord.xy), u_seed)) - 0.5) * u_ditherAmount;
  fragColor = vec4(toLinear(sat3(s)), 1.0);
}`);

    passes.crt = new Pass("crt", `
uniform sampler2D u_src; uniform sampler2D u_ring0; uniform sampler2D u_ring1; uniform sampler2D u_ring2; uniform int u_ringCount;
uniform float u_time; uniform uint u_seed; uniform vec3 u_background;
uniform float u_scanlineFreqPerFrame; uniform float u_scanlineDepth; uniform float u_phosphorPersistence; uniform float u_bloomAmount;
uniform float u_curvature; uniform float u_vignette; uniform float u_triadMaskAmount; uniform float u_flickerAmp; uniform float u_flickerFreqHz;
vec2 barrel(vec2 uv) { vec2 dc = uv - 0.5; return uv + dc * dot(dc, dc) * u_curvature; }
void main() {
  vec2 uv = barrel(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { fragColor = vec4(u_background * 0.6, 1.0); return; }
  vec3 col = texture(u_src, uv).rgb;
  vec3 glow = (texture(u_src, uv + vec2(1.5, 0.0) / u_res).rgb + texture(u_src, uv - vec2(1.5, 0.0) / u_res).rgb) * 0.5;
  col += glow * u_bloomAmount * 0.25;
  if (u_ringCount > 0) col = max(col, texture(u_ring0, uv).rgb * u_phosphorPersistence * 2.0);
  if (u_ringCount > 1) col = max(col, texture(u_ring1, uv).rgb * u_phosphorPersistence * 1.2);
  if (u_ringCount > 2) col = max(col, texture(u_ring2, uv).rgb * u_phosphorPersistence * 0.6);
  vec2 px = logicalPx();
  float line = 0.5 + 0.5 * cos(6.28318530718 * px.y * u_scanlineFreqPerFrame / LOGICAL_H);
  col *= 1.0 - u_scanlineDepth * (1.0 - line);
  int column = int(floor(px.x)) % 3;
  vec3 triad = column == 0 ? vec3(1.0, 0.92, 0.92) : column == 1 ? vec3(0.92, 1.0, 0.92) : vec3(0.92, 0.92, 1.0);
  float grain = hashU(uvec3(uvec2(px), u_seed));
  col *= mix(vec3(1.0), triad * (0.96 + 0.08 * grain), u_triadMaskAmount);
  vec2 dc = vUv - 0.5;
  col *= mix(1.0, smoothstep(0.85, 0.2, length(dc * vec2(1.0, 0.85))), u_vignette);
  col *= 1.0 + 0.5 * min(u_flickerAmp, 0.06) * sin(6.28318530718 * u_flickerFreqHz * u_time);
  fragColor = vec4(col, 1.0);
}`);

    passes.dither = new Pass("dither", `
uniform sampler2D u_src; uniform int u_ditherMode; uniform int u_paletteSize; uniform int u_pixelScale;
uniform float u_ditherStrength; uniform uint u_seed; uniform bool u_noiseOn;
float bayer2(ivec2 p) { return float(2 * ((p.x ^ p.y) & 1) + (p.y & 1)) / 4.0; }
float bayer4(ivec2 p) { return (bayer2(p) + bayer2(p >> 1) / 4.0); }
float bayer8(ivec2 p) { return (bayer2(p) + bayer2(p >> 1) / 4.0 + bayer2(p >> 2) / 16.0); }
float threshold(ivec2 cell) {
  if (u_ditherMode == 0) return bayer2(cell) + 0.125;
  if (u_ditherMode == 1) return bayer4(cell) + 0.03125;
  if (u_ditherMode == 2) return bayer8(cell) + 0.0078125;
  if (!u_noiseOn) return bayer4(cell) + 0.03125;
  uint off = pcg(u_seed);
  vec2 q = vec2(cell) + vec2(float(off & 255u), float((off >> 8u) & 255u));
  return fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715))));
}
void main() {
  vec2 px = logicalPx();
  ivec2 cell = ivec2(floor(px / float(u_pixelScale)));
  vec2 centre = (vec2(cell) + 0.5) * float(u_pixelScale);
  vec2 uv = vec2(centre.x / LOGICAL_W, 1.0 - centre.y / LOGICAL_H);
  vec3 col = texture(u_src, u_pixelScale > 1 ? uv : vUv).rgb;
  vec3 over = max(col - 1.0, 0.0);
  vec3 s = toSRGB(min(col, 1.0));
  float th = threshold(cell);
  if (u_paletteSize >= 2) {
    float levels = float(u_paletteSize - 1);
    s = floor(s * levels + mix(0.5, th, u_ditherStrength)) / levels;
  } else {
    s += (th - 0.5) * u_ditherStrength / 32.0;
  }
  fragColor = vec4(toLinear(sat3(s)) + over, 1.0);
}`);

    passes.glitch = new Pass("glitch", `
uniform sampler2D u_src; uniform float u_time; uniform uint u_seed; uniform float u_intensity;
uniform int u_hit; uniform int u_sliceCount; uniform vec3 u_slices[12]; uniform vec4 u_blocks[3]; uniform vec2 u_blockCorruptSize;
uniform float u_rgbSplitPx; uniform float u_hitRatePerSec; uniform float u_areaCapPct; uniform int u_holdFrames; uniform float u_maxOffsetPx;
vec3 fetch(vec2 px) { return texture(u_src, vec2(px.x / LOGICAL_W, 1.0 - px.y / LOGICAL_H)).rgb; }
void main() {
  vec2 px = logicalPx();
  if (u_hit == 0) { fragColor = vec4(texture(u_src, vUv).rgb, 1.0); return; }
  vec2 src = px;
  bool moved = false;
  for (int i = 0; i < 12; i++) {
    if (i >= u_sliceCount) break;
    vec3 s = u_slices[i];
    if (px.y >= s.x && px.y < s.x + s.y) { src.x -= clamp(s.z, -u_maxOffsetPx, u_maxOffsetPx) * u_intensity / 0.35; moved = true; }
  }
  bool block = false;
  for (int i = 0; i < 3; i++) {
    vec4 b = u_blocks[i];
    if (px.x >= b.x && px.x < b.x + u_blockCorruptSize.x && px.y >= b.y && px.y < b.y + u_blockCorruptSize.y) { src += b.zw; block = true; }
  }
  float split = moved ? u_rgbSplitPx : 0.0;
  vec3 col = vec3(fetch(src + vec2(split, 0.0)).r, fetch(src).g, fetch(src - vec2(split, 0.0)).b);
  if (block) {
    float sum = col.r + col.g + col.b;
    if (sum > 0.0 && col.r / sum >= 0.8) col = vec3(luma(col));
  }
  fragColor = vec4(col, 1.0);
}`);

    // Composites a Canvas2D layer (sRGB texture sampled as linear) over the scene target. It is the
    // draw call that carries terminal-ui's chrome, meters and caret, and the type layer.
    passes["terminal-ui"] = new Pass("terminal-ui", `
uniform sampler2D u_layer; uniform vec2 u_charGridPx; uniform float u_windowChromeWidthPx; uniform int u_meterCount;
uniform float u_logLineRateCharsPerSec; uniform float u_caretBlinkHz; uniform uint u_seed;
void main() { vec4 c = texture(u_layer, vec2(vUv.x, 1.0 - vUv.y)); fragColor = vec4(c.rgb, c.a); }`);

    const typeComposite = new Pass("type-layer", `
uniform sampler2D u_layer;
void main() { vec4 c = texture(u_layer, vec2(vUv.x, 1.0 - vUv.y)); fragColor = vec4(c.rgb, c.a); }`, { logged: false });

    const copy = new Pass("copy", `
uniform sampler2D u_src;
void main() { fragColor = texture(u_src, vUv); }`, { logged: false });

    const accumulate = new Pass("accumulate", `
uniform sampler2D u_src; uniform float u_weight;
void main() { fragColor = vec4(texture(u_src, vUv).rgb * u_weight, u_weight); }`, { logged: false });

    return { passes, typeComposite, copy, accumulate };
  };
})();
