// Stage init script: runs before any page script (Playwright addInitScript) in every stage browser
// (master, determinism replay and QA replay alike). It puts the page on a virtual clock the renderer
// steps one frame at a time, seeds Math.random from the treatment, and stubs every API the stage may
// not use so a violation is recorded instead of silently leaking wall time, sound or the network.
(() => {
  "use strict";
  const config = window.__litStageConfig ?? { seed: 1, fps: 60 };
  const NativeDate = Date;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const epoch = 1767225600000; // a fixed wall-clock origin; the film never reads the real date
  let now = 0; // virtual milliseconds since frame 0
  const violations = [];
  const record = (code, what) => { if (!violations.some((v) => v.what === what)) violations.push({ code, what, t: now / 1000 }); };

  // ---- time sources ----
  const VirtualDate = function (...args) {
    if (!new.target) return new NativeDate(epoch + now).toString();
    return Reflect.construct(NativeDate, args.length ? args : [epoch + now], new.target);
  };
  VirtualDate.prototype = NativeDate.prototype;
  Object.setPrototypeOf(VirtualDate, NativeDate);
  VirtualDate.now = () => epoch + now;
  window.Date = VirtualDate;
  Object.defineProperty(performance, "now", { value: () => now, configurable: true, writable: true });
  try { Object.defineProperty(document.timeline, "currentTime", { get: () => now, configurable: true }); } catch { /* not configurable in this build */ }

  const timers = new Map();
  let timerSeq = 1;
  window.setTimeout = (fn, ms, ...args) => { const id = timerSeq++; timers.set(id, { due: now + Math.max(0, Number(ms) || 0), fn, args, every: 0, id }); return id; };
  window.setInterval = (fn, ms, ...args) => { const id = timerSeq++; const every = Math.max(1, Number(ms) || 0); timers.set(id, { due: now + every, fn, args, every, id }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); };
  window.clearInterval = (id) => { timers.delete(id); };
  let rafs = new Map();
  let rafSeq = 1;
  window.requestAnimationFrame = (cb) => { const id = rafSeq++; rafs.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  window.requestIdleCallback = (cb) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1);
  window.cancelIdleCallback = (id) => window.clearTimeout(id);

  // ---- seeded randomness (mulberry32) ----
  let state = config.seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- forbidden APIs: 17 for sound and workers, 19 for network channels ----
  const forbid = (name, code) => function forbidden() { record(code, name); throw new Error(`${name} is not allowed on the stage`); };
  for (const [name, code] of [["Audio", 17], ["AudioContext", 17], ["webkitAudioContext", 17], ["OfflineAudioContext", 17], ["Worker", 17], ["SharedWorker", 17],
    ["WebSocket", 19], ["WebTransport", 19], ["RTCPeerConnection", 19], ["webkitRTCPeerConnection", 19]]) {
    try { Object.defineProperty(window, name, { value: forbid(name, code), configurable: true, writable: true }); } catch { /* keep going */ }
  }
  if (navigator.serviceWorker) {
    try { Object.defineProperty(navigator.serviceWorker, "register", { value: () => { record(17, "serviceWorker.register"); return Promise.reject(new Error("service workers are not allowed on the stage")); } }); } catch { /* keep going */ }
  }
  const forbiddenTags = new Set(["VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED", "FRAME"]);
  const inspect = (node) => {
    if (node.nodeType !== 1) return;
    if (forbiddenTags.has(node.tagName)) record(17, `<${node.tagName.toLowerCase()}>`);
    for (const child of node.querySelectorAll?.("video,audio,iframe,object,embed,frame") ?? []) record(17, `<${child.tagName.toLowerCase()}>`);
  };
  new MutationObserver((list) => { for (const m of list) for (const node of m.addedNodes) inspect(node); }).observe(document, { childList: true, subtree: true });

  // ---- canvas: WebGL keeps its drawing buffer for capture; 2D text calls are listed for the QA ----
  const webgl = { requested: false, failed: false };
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attributes, ...rest) {
    const isGl = /webgl/iu.test(String(type));
    const ctx = nativeGetContext.call(this, type, isGl ? { ...(attributes ?? {}), preserveDrawingBuffer: true } : attributes, ...rest);
    if (isGl) { webgl.requested = true; if (!ctx) webgl.failed = true; }
    return ctx;
  };
  const canvasTexts = new Set();
  for (const method of ["fillText", "strokeText"]) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (text, ...rest) { canvasTexts.add(String(text)); return native.call(this, text, ...rest); };
  }

  // ---- the per-frame step (the renderer's algorithm, steps 1-7) ----
  const tracked = new Map();
  const svgRoots = new Map();
  const pump = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const contract = () => window.LitStage?.definition ?? window.litStage ?? null;

  function runTimers() {
    for (let guard = 0; guard < 100000; guard++) {
      let next = null;
      for (const timer of timers.values()) if (timer.due <= now && (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id))) next = timer;
      if (!next) return;
      if (next.every) next.due += next.every; else timers.delete(next.id);
      try { if (typeof next.fn === "function") next.fn(...next.args); } catch (error) { record(0, `timer error: ${error?.message ?? error}`); }
    }
  }
  function runRaf() {
    const batch = rafs;
    rafs = new Map();
    for (const cb of batch.values()) { try { cb(now); } catch (error) { record(0, `animation-frame error: ${error?.message ?? error}`); } }
  }

  async function step(frame, settle = true) {
    const fps = config.fps;
    const t = frame / fps;
    now = (frame * 1000) / fps;
    window.LitStage?._beginFrame?.();
    canvasTexts.clear();
    const live = new Set(document.getAnimations());
    for (const [animation, info] of tracked) {
      if (!live.has(animation)) { tracked.delete(animation); continue; }
      if (info.finished) continue;
      const local = (t - info.birth) * 1000;
      const end = animation.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && local >= end) { animation.currentTime = end; animation.finish(); info.finished = true; await pump(); }
      else animation.currentTime = local;
    }
    for (const [svg, birth] of svgRoots) { svg.pauseAnimations(); svg.setCurrentTime(Math.max(0, t - birth)); }
    runTimers();
    await pump();
    runRaf();
    await pump();
    const def = contract();
    if (def && typeof def.render === "function") def.render(t);
    await pump();
    getComputedStyle(document.documentElement).opacity;
    for (const animation of document.getAnimations()) {
      if (tracked.has(animation)) continue;
      animation.pause();
      tracked.set(animation, { birth: t, finished: false });
      animation.currentTime = 0;
    }
    for (const svg of document.querySelectorAll("svg")) {
      if (svg.ownerSVGElement || svgRoots.has(svg)) continue;
      svgRoots.set(svg, t);
      svg.pauseAnimations();
      svg.setCurrentTime(0);
    }
    document.documentElement.getBoundingClientRect();
    await document.fonts.ready;
    await Promise.all([...document.images].filter((img) => !img.complete).map((img) => img.decode().catch(() => {})));
    if (settle) await new Promise((resolve) => nativeRaf(() => nativeRaf(resolve)));
    return violations.length;
  }
  // Frames that are not captured still run every step in order; only the compositor wait is skipped.
  async function stepRange(from, to) {
    for (let frame = from; frame <= to; frame++) await step(frame, false);
    return violations.length;
  }

  // Before frame 0: load every face, decode every raster, make every img eager.
  async function prepare(rasterUrls) {
    await document.fonts.ready;
    await Promise.all([...document.fonts].map((face) => face.load().catch(() => null)));
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await Promise.all(rasterUrls.map((url) => { const img = new Image(); img.src = url; return img.decode().catch(() => {}); }));
    for (const node of document.querySelectorAll("video,audio,iframe,object,embed,frame")) inspect(node);
    const def = contract();
    return def ? { width: def.width, height: def.height, fps: def.fps, duration: def.duration, render: typeof def.render === "function" } : null;
  }

  Object.defineProperty(window, "__litStage", {
    value: Object.freeze({
      seed: config.seed >>> 0, step, stepRange, prepare, violations, webgl,
      canvasTexts: () => [...canvasTexts], registered: () => (window.LitStage?.registeredText ?? []).map((entry) => ({ ...entry })),
      nativeRaf
    }),
    configurable: false, enumerable: false, writable: false
  });
})();
