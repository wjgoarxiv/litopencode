// LitOpenCode stage kit, served at /lit/stage-kit.js. Motion primitives only: eases, a spring,
// keyframes, timing helpers, a seeded random source, text splitting, SVG path drawing, a single-path
// morph, mask and clip helpers, colour mixing and the text registration the QA replay reads. It ships
// no scene, object, layout or copy; the page draws whatever its treatment calls for. Every function is
// a pure function of its arguments and the time the renderer passes to render(t).
(function () {
  "use strict";

  const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const mapRange = (x, a, b, c = 0, d = 1) => lerp(c, d, clamp((x - a) / (b - a || 1)));

  // ---- easing ----
  // cubic-bezier(x1, y1, x2, y2) solved by Newton steps with a bisection fallback, as CSS does.
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = sx(t) - x;
        if (Math.abs(err) < 1e-7) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 40; i++) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-7) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }

  const pow = (k) => ({ in: (x) => x ** k, out: (x) => 1 - (1 - x) ** k, inOut: (x) => (x < 0.5 ? 2 ** (k - 1) * x ** k : 1 - (-2 * x + 2) ** k / 2) });
  const quad = pow(2), cubic = pow(3), quart = pow(4), quint = pow(5);
  const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1;
  const ease = {
    linear: (x) => x,
    inQuad: quad.in, outQuad: quad.out, inOutQuad: quad.inOut,
    inCubic: cubic.in, outCubic: cubic.out, inOutCubic: cubic.inOut,
    inQuart: quart.in, outQuart: quart.out, inOutQuart: quart.inOut,
    inQuint: quint.in, outQuint: quint.out, inOutQuint: quint.inOut,
    inSine: (x) => 1 - Math.cos((x * Math.PI) / 2), outSine: (x) => Math.sin((x * Math.PI) / 2), inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)), outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    inCirc: (x) => 1 - Math.sqrt(1 - x * x), outCirc: (x) => Math.sqrt(1 - (x - 1) ** 2),
    inOutCirc: (x) => (x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2),
    inBack: (x) => c3 * x ** 3 - c1 * x * x, outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
    inOutBack: (x) => (x < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
    // Named motion-design curves.
    snap: bezier(0.16, 1, 0.3, 1), glide: bezier(0.37, 0, 0.63, 1), settle: bezier(0.22, 1, 0.36, 1), exit: bezier(0.7, 0, 0.84, 0),
    anticipate: bezier(0.36, -0.3, 0.64, 1)
  };
  const easeFn = (e) => (typeof e === "function" ? e : ease[e] ?? ease.linear);

  // ---- spring: the closed-form damped harmonic oscillator, so any t is exact and seek-safe ----
  // Returns f(t) in seconds, from `from` to `to`, with an optional starting velocity (units/s).
  function spring({ stiffness = 170, damping = 26, mass = 1, from = 0, to = 1, velocity = 0 } = {}) {
    const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const x0 = from - to, v0 = velocity;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta), a = x0, b = (v0 + zeta * w0 * x0) / wd;
      return (t) => (t <= 0 ? from : to + Math.exp(-zeta * w0 * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t)));
    }
    if (zeta === 1) return (t) => (t <= 0 ? from : to + Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t));
    const s = w0 * Math.sqrt(zeta * zeta - 1), r1 = -zeta * w0 + s, r2 = -zeta * w0 - s;
    const b2 = (v0 - r1 * x0) / (r2 - r1), b1 = x0 - b2;
    return (t) => (t <= 0 ? from : to + b1 * Math.exp(r1 * t) + b2 * Math.exp(r2 * t));
  }

  // ---- keyframes: kf(t, [{ t, v, ease }]) with numbers, arrays of numbers or colours ----
  function kf(t, keys) {
    if (!keys.length) return undefined;
    if (t <= keys[0].t) return keys[0].v;
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (t <= b.t) {
        const p = easeFn(b.ease)((t - a.t) / (b.t - a.t || 1));
        if (typeof a.v === "number") return lerp(a.v, b.v, p);
        if (Array.isArray(a.v)) return a.v.map((value, k) => lerp(value, b.v[k], p));
        if (typeof a.v === "string") return mix(a.v, b.v, p);
        return p < 1 ? a.v : b.v;
      }
    }
    return keys.at(-1).v;
  }

  // ---- timing ----
  // Local progress of a window [start, start + dur] at time t, eased.
  const at = (t, start, dur, e) => easeFn(e)(clamp((t - start) / (dur || 1e-9)));
  // Staggered start of item i of n: { each } seconds apart, from "start", "end", "center" or an index.
  function stagger(i, { each = 0.05, from = "start", n = 1 } = {}) {
    const origin = from === "end" ? n - 1 : from === "center" ? (n - 1) / 2 : typeof from === "number" ? from : 0;
    return Math.abs(i - origin) * each;
  }
  // A sequence of named segments: seq([["in", 0.6], ["hold", 2], ["out", 0.4]]) gives each one's start,
  // end and a progress(t) reader.
  function seq(parts, start = 0) {
    const out = {};
    let cursor = start;
    for (const [name, dur] of parts) {
      const s = cursor;
      out[name] = { start: s, end: s + dur, dur, progress: (t, e) => at(t, s, dur, e) };
      cursor += dur;
    }
    out.end = cursor;
    return out;
  }

  // ---- seeded random (mulberry32). rand(seed) returns a generator; LitStage.rand() uses the treatment's seed ----
  function rand(seed) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (a, b) => a + (b - a) * next();
    next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
    next.pick = (list) => list[Math.floor(next() * list.length)];
    return next;
  }

  // ---- text: grapheme- and 어절-aware splitting on Intl.Segmenter ----
  // by: "grapheme" (each user-perceived character), "word" (Latin words; a Hangul 어절 stays whole)
  // or "line" (keeps the element's own line breaks). Spaces stay as plain text nodes, so the line
  // wraps where it would have wrapped. Returns the created spans in reading order.
  function splitText(el, { by = "grapheme", className = "lit-part" } = {}) {
    const source = el.textContent;
    el.textContent = "";
    const parts = [];
    const add = (value) => {
      if (/^\s+$/u.test(value)) { el.appendChild(document.createTextNode(value)); return; }
      const span = document.createElement("span");
      span.className = className;
      span.style.display = "inline-block";
      span.style.whiteSpace = "pre";
      span.dataset.i = String(parts.length);
      span.textContent = value;
      el.appendChild(span);
      parts.push(span);
    };
    if (by === "line") { source.split("\n").forEach((line, i) => { if (i) el.appendChild(document.createElement("br")); add(line); }); return parts; }
    if (by === "word") {
      // Whitespace-delimited units keep a Hangul 어절 (word plus its particles) together.
      for (const token of source.split(/(\s+)/u)) if (token) add(token);
      return parts;
    }
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of segmenter.segment(source)) add(segment);
    return parts;
  }

  // ---- SVG path drawing ----
  // Reveals a stroked path from 0 to p (0..1); `from: "end"` draws backwards.
  function drawPath(path, p, { from = "start" } = {}) {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = String((from === "end" ? -1 : 1) * length * (1 - clamp(p)));
    return length;
  }

  // ---- morph: one closed or open subpath into another ----
  // Both paths are sampled by arc length with the browser's own geometry (so arcs and quadratics are
  // normalized the same way), rotated to the start that minimizes the travel, and rebuilt as a
  // Catmull-Rom curve converted to cubic segments. A path with more than one subpath is unsupported.
  const svgNS = "http://www.w3.org/2000/svg";
  let probe = null;
  function samplePath(d, n) {
    if ((d.match(/[Mm]/gu) ?? []).length > 1) throw new Error("LitStage.morph: multi-subpath morphs are unsupported; morph each subpath on its own");
    if (!probe) {
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
      svg.style.position = "absolute"; svg.style.visibility = "hidden";
      probe = document.createElementNS(svgNS, "path");
      svg.appendChild(probe);
      (document.body ?? document.documentElement).appendChild(svg);
    }
    probe.setAttribute("d", d);
    const length = probe.getTotalLength();
    const closed = /[Zz]\s*$/u.test(d.trim());
    const count = closed ? n : n - 1;
    return { closed, points: Array.from({ length: n }, (_, i) => { const q = probe.getPointAtLength((length * i) / count); return [q.x, q.y]; }) };
  }
  function bestRotation(a, b) {
    let best = 0, bestCost = Infinity;
    for (let r = 0; r < b.length; r++) {
      let cost = 0;
      for (let i = 0; i < a.length; i++) { const q = b[(i + r) % b.length]; cost += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2; }
      if (cost < bestCost) { bestCost = cost; best = r; }
    }
    return b.map((_, i) => b[(i + best) % b.length]);
  }
  function toCubicPath(points, closed) {
    const n = points.length;
    const P = (i) => (closed ? points[(i + n) % n] : points[clamp(i, 0, n - 1)]);
    const f = (v) => Math.round(v * 100) / 100;
    let d = `M${f(points[0][0])} ${f(points[0][1])}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return closed ? `${d}Z` : d;
  }
  function morph(fromD, toD, { samples = 96 } = {}) {
    const a = samplePath(fromD, samples), b = samplePath(toD, samples);
    const target = a.closed && b.closed ? bestRotation(a.points, b.points) : b.points;
    const closed = a.closed && b.closed;
    return (p) => {
      const k = clamp(p);
      return toCubicPath(a.points.map((q, i) => [lerp(q[0], target[i][0], k), lerp(q[1], target[i][1], k)]), closed);
    };
  }

  // ---- masks and clips ----
  const clip = {
    // A circle growing from (cx, cy) in percent of the element's box.
    circle(el, p, { cx = 50, cy = 50, max = 150 } = {}) { el.style.clipPath = `circle(${clamp(p) * max}% at ${cx}% ${cy}%)`; },
    // A straight wipe from one side: "left", "right", "top" or "bottom".
    wipe(el, p, from = "left") {
      const r = (1 - clamp(p)) * 100;
      const inset = { left: `0 ${r}% 0 0`, right: `0 0 0 ${r}%`, top: `0 0 ${r}% 0`, bottom: `${r}% 0 0 0` }[from];
      el.style.clipPath = `inset(${inset})`;
    },
    // A rectangle that opens from the centre outwards.
    iris(el, p) { const r = (1 - clamp(p)) * 50; el.style.clipPath = `inset(${r}% ${r}% ${r}% ${r}%)`; }
  };
  const mask = {
    // A soft linear reveal at `angle` degrees with a `soft` percent feather.
    linear(el, p, { angle = 90, soft = 12 } = {}) {
      const edge = lerp(-soft, 100 + soft, clamp(p));
      const image = `linear-gradient(${angle}deg, #000 ${edge - soft}%, transparent ${edge + soft}%)`;
      el.style.maskImage = image; el.style.webkitMaskImage = image;
    },
    // A soft radial reveal.
    radial(el, p, { cx = 50, cy = 50, soft = 10 } = {}) {
      const r = lerp(0, 150, clamp(p));
      const image = `radial-gradient(circle at ${cx}% ${cy}%, #000 ${Math.max(0, r - soft)}%, transparent ${r}%)`;
      el.style.maskImage = image; el.style.webkitMaskImage = image;
    }
  };

  // ---- colour ----
  function parseColor(c) {
    if (Array.isArray(c)) return c;
    const s = String(c).trim();
    if (s[0] === "#") {
      const h = s.length === 4 ? s.slice(1).split("").map((x) => x + x).join("") : s.slice(1, 7);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = s.match(/rgba?\(([^)]+)\)/u);
    if (m) return m[1].split(",").slice(0, 3).map(Number);
    throw new Error(`LitStage.mix: unsupported colour ${s}`);
  }
  const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const toSrgb = (v) => Math.round(255 * clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  // Mixes in linear light, which keeps a blend between two saturated colours from going muddy.
  function mix(a, b, p) {
    const x = parseColor(a), y = parseColor(b), k = clamp(p);
    const out = x.map((v, i) => toSrgb(lerp(toLinear(v), toLinear(y[i]), k)));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
  }

  // ---- text registration for the QA replay ----
  // DOM text: mark the element whose text reads as one run; decor marks illustrative text inside a
  // drawn subject (a sign, a label on an object), which is held to lighter checks and may not carry a
  // copy line.
  function text(el, { decor = false } = {}) {
    el.dataset.litText = "";
    if (decor) el.dataset.litDecor = ""; else delete el.dataset.litDecor;
    return el;
  }
  // Canvas or WebGL text: register it on every frame it is drawn, in page pixels.
  const registered = [];
  function registerText({ content, x, y, w, h, decor = false }) {
    registered.push({ content: String(content), x, y, w, h, decor: Boolean(decor) });
  }

  // ---- the stage contract ----
  let definition = null;
  function define(spec) {
    if (!spec || typeof spec !== "object") throw new Error("LitStage.define needs { width, height, fps, duration, render }");
    definition = spec;
    window.litStage = spec;
    return spec;
  }

  const seeded = typeof window.__litStage?.seed === "number" ? window.__litStage.seed : 1;
  window.LitStage = {
    define, get definition() { return definition ?? window.litStage ?? null; },
    clamp, lerp, mapRange, ease, bezier, spring, kf, at, stagger, seq,
    rand: Object.assign((seed) => rand(seed === undefined ? seeded : seed), { seed: seeded }),
    splitText, drawPath, morph, clip, mask, mix, text: Object.assign((arg, opts) => (arg instanceof Element ? text(arg, opts) : registerText(arg)), { registered }),
    get registeredText() { return registered; },
    _beginFrame() { registered.length = 0; }
  };
})();
