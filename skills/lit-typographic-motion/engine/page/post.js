// Browser side, part 5: the global post chain in its fixed order (§A7): bloom + halation ->
// chromatic aberration -> tone shoulder -> film grain -> vignette -> flash -> shake/zoom -> invert.
// All math runs on linear HDR; the sRGB transfer is applied exactly once, in the output pass, which
// also flips rows so the readback comes out top-to-bottom.
(() => {
  const LTM = window.LTM;

  LTM.createPost = (core) => {
    const { Pass } = core;
    const levels = [];
    let w = 960, h = 540;
    for (let i = 0; i < 6; i++) {
      levels.push({ down: core.makeTarget(Math.max(2, w), Math.max(2, h)), up: core.makeTarget(Math.max(2, w), Math.max(2, h)) });
      w >>= 1; h >>= 1;
    }
    const chainA = core.makeTarget(core.W, core.H);
    const output = core.makeTarget(core.W, core.H, "u8");

    const prefilter = new Pass("post-prefilter", `
uniform sampler2D u_src; uniform vec2 u_texel; uniform float u_threshold; uniform float u_knee;
void main() {
  vec3 c = 0.25 * (texture(u_src, vUv + u_texel * vec2(-1, -1)).rgb + texture(u_src, vUv + u_texel * vec2(1, -1)).rgb
    + texture(u_src, vUv + u_texel * vec2(-1, 1)).rgb + texture(u_src, vUv + u_texel * vec2(1, 1)).rgb);
  c = min(c, vec3(32.0));
  float l = max(c.r, max(c.g, c.b));
  float knee = max(u_knee, 1e-4);
  float soft = clamp(l - u_threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  fragColor = vec4(c * max(soft, l - u_threshold) / max(l, 1e-5), 1.0);
}`, { logged: false });

    const down = new Pass("post-down", `
uniform sampler2D u_src; uniform vec2 u_texel;
vec3 s(vec2 o) { return texture(u_src, vUv + u_texel * o).rgb; }
void main() {
  vec3 inner = (s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1))) * 0.125;
  vec3 outer = (s(vec2(-2, -2)) + s(vec2(0, -2)) + s(vec2(2, -2)) + s(vec2(-2, 0)) + s(vec2(2, 0)) + s(vec2(-2, 2)) + s(vec2(0, 2)) + s(vec2(2, 2))) * 0.0625;
  fragColor = vec4(inner + outer * 0.5 + s(vec2(0.0)) * 0.125, 1.0);
}`, { logged: false });

    const up = new Pass("post-up", `
uniform sampler2D u_src; uniform sampler2D u_base; uniform vec2 u_texel; uniform float u_radius;
void main() {
  vec2 o = u_texel * u_radius;
  vec3 tent = texture(u_src, vUv - o).rgb + 2.0 * texture(u_src, vUv + vec2(0.0, -o.y)).rgb + texture(u_src, vUv + vec2(o.x, -o.y)).rgb
    + 2.0 * texture(u_src, vUv + vec2(-o.x, 0.0)).rgb + 4.0 * texture(u_src, vUv).rgb + 2.0 * texture(u_src, vUv + vec2(o.x, 0.0)).rgb
    + texture(u_src, vUv + vec2(-o.x, o.y)).rgb + 2.0 * texture(u_src, vUv + vec2(0.0, o.y)).rgb + texture(u_src, vUv + o).rgb;
  fragColor = vec4(texture(u_base, vUv).rgb + tent / 16.0, 1.0);
}`, { logged: false });

    const passA = new Pass("post", `
uniform sampler2D u_src; uniform sampler2D u_bloom; uniform sampler2D u_halo;
uniform float u_exposure; uniform float u_bloomAmount; uniform float u_halation; uniform float u_ca;
uniform float u_grain; uniform float u_vignette; uniform float u_flash; uniform float u_fade;
uniform uint u_frame; uniform uint u_runSeed;
vec3 shoulder(vec3 x) {
  const float k = 0.75;
  vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
  float over = max(max(x.r, x.g), x.b);
  return mix(y, vec3(1.0), smoothstep(2.0, 12.0, over) * 0.85);
}
void main() {
  vec2 dc = vUv - 0.5;
  float r2 = dot(dc * vec2(LOGICAL_W / LOGICAL_H, 1.0), dc * vec2(LOGICAL_W / LOGICAL_H, 1.0));
  vec2 off = dc * r2 * u_ca / LOGICAL_W * 4.0;
  vec3 col = vec3(texture(u_src, vUv + off).r, texture(u_src, vUv).g, texture(u_src, vUv - off).b);
  col += texture(u_bloom, vUv).rgb * u_bloomAmount / 3.0;
  col += vec3(1.0, 0.2, 0.06) * luma(texture(u_halo, vUv).rgb) * u_halation;
  col *= u_exposure;
  col = shoulder(col);
  vec3 s = toSRGB(sat3(col));
  vec2 px = logicalPx();
  float g1 = hashU(uvec3(uvec2(gl_FragCoord.xy), u_frame ^ u_runSeed)) - 0.5;
  float g2 = hashU(uvec3(uvec2(floor(px / 2.0)), (u_frame * 7919u) ^ u_runSeed)) - 0.5;
  float lm = luma(s);
  s += (g1 * 0.6 + g2 * 0.4) * u_grain * (0.55 + 1.2 * lm * (1.0 - lm));
  col = toLinear(sat3(s));
  col *= mix(1.0, smoothstep(0.95, 0.25, length(dc * vec2(1.0, 0.8))), u_vignette);
  col += vec3(1.0) * u_flash;
  col *= u_fade;
  fragColor = vec4(col, 1.0);
}`, { logged: false });

    const passB = new Pass("post-output", `
uniform sampler2D u_src; uniform vec2 u_shake; uniform float u_zoom; uniform bool u_invert;
void main() {
  // Output row 0 is read back first, so it carries the top of the image (rows come out top-down).
  vec2 topDown = (vUv - 0.5) / u_zoom + 0.5 - u_shake / vec2(LOGICAL_W, LOGICAL_H);
  vec3 s = toSRGB(sat3(texture(u_src, vec2(topDown.x, 1.0 - topDown.y)).rgb));
  if (u_invert) s = 1.0 - s;
  fragColor = vec4(s, 1.0);
}`, { logged: false });

    const render = (src, p, frameIndex, runSeed) => {
      const first = levels[0].down;
      prefilter.use().texture("u_src", src.tex).set("u_texel", "vec2", [1 / core.W, 1 / core.H])
        .set("u_threshold", "float", p.bloomThreshold).set("u_knee", "float", p.bloomKnee).draw(first);
      for (let i = 1; i < levels.length; i++) {
        const from = levels[i - 1].down;
        down.use().texture("u_src", from.tex).set("u_texel", "vec2", [1 / from.width, 1 / from.height]).draw(levels[i].down);
      }
      let previous = levels[levels.length - 1].down;
      for (let i = levels.length - 2; i >= 0; i--) {
        up.use().texture("u_src", previous.tex).texture("u_base", levels[i].down.tex)
          .set("u_texel", "vec2", [1 / previous.width, 1 / previous.height]).set("u_radius", "float", 0.5 + p.bloomRadius).draw(levels[i].up);
        previous = levels[i].up;
      }
      passA.use().texture("u_src", src.tex).texture("u_bloom", levels[0].up.tex).texture("u_halo", levels[3].up.tex)
        .set("u_exposure", "float", p.exposure).set("u_bloomAmount", "float", p.bloom).set("u_halation", "float", p.halation)
        .set("u_ca", "float", p.ca).set("u_grain", "float", p.grain).set("u_vignette", "float", p.vignette)
        .set("u_flash", "float", p.flash).set("u_fade", "float", p.fade)
        .set("u_frame", "uint", frameIndex).set("u_runSeed", "uint", runSeed).draw(chainA);
      passB.use().texture("u_src", chainA.tex).set("u_shake", "vec2", p.shake).set("u_zoom", "float", p.zoom)
        .set("u_invert", "bool", p.invert).draw(output);
      return output;
    };
    return { render, output };
  };
})();
