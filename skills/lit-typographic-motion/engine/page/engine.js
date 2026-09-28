// Browser side, part 8: the frame engine. For output frame n it renders the pinned sub-sample
// times (MO-A-28), composites each one into linear HDR (preset passes, type layer, filter passes),
// averages them before the post chain, runs the post chain once with the centre sample's overrides,
// reads the 8-bit frame back and hands the exact bytes to the driver. Output depends only on t and
// the fixed run parameters (MO-A-01).
(() => {
  const LTM = window.LTM;

  LTM.boot = async (config, assets) => {
    const core = LTM.createGL(config.scale);
    if (core.error) return { error: core.error };
    const fonts = {};
    for (const [key, entry] of Object.entries(assets.fonts)) {
      const bytes = Uint8Array.from(atob(entry.base64), (c) => c.charCodeAt(0));
      fonts[key] = { buffer: bytes.buffer, file: entry.file };
    }
    const type = LTM.createTypeKit(fonts, assets.strokes);
    const { passes, typeComposite, copy, accumulate } = LTM.createPasses(core);
    const post = LTM.createPost(core);
    const grid = LTM.createLineBatch(core, 256);
    const marks = LTM.createLineBatch(core, 64);
    const typeLayer = core.makeLayer();
    const termLayer = core.makeLayer();
    const targets = { a: core.makeTarget(core.W, core.H), b: core.makeTarget(core.W, core.H), accum: core.makeTarget(core.W, core.H) };
    const ringTargets = [0, 1, 2, 3].map(() => core.makeTarget(core.W, core.H));
    const look = config.look;
    const palette = look.palette;
    const lin = (hex) => LTM.hexToLinear(hex);
    const shots = config.timeline.filter((entry) => entry.kind === "line" || entry.kind === "scene");
    const easeFns = Object.fromEntries(Object.entries(config.easeTokens).map(([name, curve]) => [name, LTM.bezier(curve)]));
    const fps = config.fps;
    const order = [...look.passes];
    const typeSlot = look.passes.includes("terminal-ui") ? order.indexOf("terminal-ui") + 1
      : look.passes.includes("swiss-grid") ? order.indexOf("swiss-grid") + 1 : 1;
    order.splice(typeSlot, 0, "__type");

    const activeShot = (t) => shots.find((shot) => t >= shot.start - 1e-9 && t < shot.end - 1e-9) ?? shots.at(-1);
    const unitsOf = (shot) => config.timeline.filter((entry) => entry.kind === "reveal" && entry.sceneId === shot.sceneId && entry.shotIndex === shot.shotIndex);
    const eventsOf = (shot) => config.events.filter((event) => event.sceneId === shot.sceneId && event.shotIndex === shot.shotIndex);
    const shotSeed = (shot, pass) => LTM.fnv1a32(`${config.seed}:${shot.sceneId}:${shot.shotIndex}:${pass}`);

    const audio = config.audio ? {
      beatAt(t) { const grid = config.audio.beatGrid; let i = 0; while (i + 1 < grid.length && grid[i + 1] <= t) i++; const next = grid[i + 1] ?? grid[i] + 0.5; return i + LTM.clamp((t - grid[i]) / Math.max(1e-3, next - grid[i])); },
      env(name, t) { const bands = config.audio.envelope.bands[name]; if (!bands) return 0; return bands[Math.min(bands.length - 1, Math.max(0, Math.floor(t / config.audio.envelope.hopSec)))] ?? 0; },
      hit(t, halfLife = 0.12) { let last = -Infinity; for (const onset of config.audio.onsets) { if (onset > t) break; last = onset; } return last === -Infinity ? 0 : 0.5 ** ((t - last) / halfLife); }
    } : null;

    const frameFor = (t) => {
      const shot = activeShot(t);
      const index = shots.indexOf(shot);
      return {
        t, lt: t - shot.start, p: LTM.clamp((t - shot.start) / (shot.end - shot.start)), start: shot.start, end: shot.end,
        shot, units: unitsOf(shot), shotNumber: index + 1, shotTotal: shots.length, beat: config.beatSec, a: audio
      };
    };

    // The drawing api a scene sees for one sample. Glyphs go to the type layer (the only source of
    // the glyph-coverage mask); marks are GPU capsules; everything drawn is recorded for the log.
    const makeApi = (f, collect) => {
      const record = { boxes: [], graphics: [], fills: [], carets: [], specs: [], dirty: [] };
      marks.clear();
      const keep = (box) => { if (box) { record.dirty.push(box.bbox); if (collect) record.boxes.push(box); } return box; };
      const api = {
        type, look, palette, presetId: config.presetId, voices: look.voices, accent: config.accentEntryId === f.shot.id, showIndex: config.showIndex === true,
        ease: (name, x) => easeFns[name](x),
        text(spec) { record.specs.push({ kind: "text", ...spec }); return keep(type.text(typeLayer.ctx, spec)); },
        block(spec) { record.specs.push({ kind: "block", ...spec }); return keep(type.block(typeLayer.ctx, spec)); },
        stroke(spec) { record.specs.push({ kind: "stroke", ...spec }); return keep(type.strokeText(typeLayer.ctx, spec)); },
        mark(spec) {
          marks.seg(spec.x0, spec.y0, spec.x1, spec.y1, spec.width, lin(spec.color), 1);
          const half = spec.width / 2;
          const bbox = [Math.min(spec.x0, spec.x1) - half, Math.min(spec.y0, spec.y1) - half, Math.max(spec.x0, spec.x1) + half, Math.max(spec.y0, spec.y1) + half];
          if (collect) { record.graphics.push({ elementId: spec.id, kind: spec.kind, bbox }); record.fills.push({ elementId: spec.id, color: spec.color, bbox, kind: spec.kind }); }
        },
        caret(box, size) { record.carets.push({ x: box.bbox[2] + size * 0.12, y: box.bbox[3], w: size * 0.5, h: size * 0.78 }); }
      };
      return { api, record };
    };

    const swissRules = (f, collect, record) => {
      const p = look.params["swiss-grid"];
      grid.clear();
      const signal = config.presetId === "tidal" ? lin(palette.text) : lin(palette.signal);
      const hair = config.presetId === "tidal" ? lin(palette.text) : lin(palette.secondary);
      const hairAlpha = config.presetId === "tidal" ? 0.28 : 0.9;
      const column = (1920 - 2 * p.marginPx - (p.columns - 1) * p.gutterPx) / p.columns;
      const segments = [];
      segments.push({ id: "grid-margin", a: [p.marginPx, 96], b: [p.marginPx, 984], width: p.hairlineWidthPx, rgb: hair, alpha: hairAlpha });
      segments.push({ id: "grid-baseline", a: [p.marginPx, 736], b: [1920 - p.marginPx, 736], width: p.hairlineWidthPx, rgb: hair, alpha: hairAlpha });
      for (let i = 0; i <= p.columns; i++) {
        const x = p.marginPx + i * (column + p.gutterPx) - (i === p.columns ? p.gutterPx : 0);
        segments.push({ id: `grid-tick-${i}`, a: [x, 984], b: [x, 996], width: p.hairlineWidthPx, rgb: hair, alpha: hairAlpha });
      }
      if (config.presetId === "swiss-signal") {
        const grow = easeFns.slam(LTM.clamp(f.lt / look.motion.entranceSec));
        segments.push({ id: "grid-signal-bar", a: [p.marginPx, 110], b: [p.marginPx + Math.max(1, column * grow), 110], width: 4, rgb: signal, alpha: 1 });
      }
      if (p.showGuides) {
        for (let i = 0; i < p.columns; i++) {
          const x = p.marginPx + i * (column + p.gutterPx);
          segments.push({ id: `grid-guide-${i}`, a: [x, 54], b: [x, 1026], width: 1, rgb: hair, alpha: 0.12 });
        }
      }
      for (const s of segments) {
        grid.seg(s.a[0], s.a[1], s.b[0], s.b[1], s.width, s.rgb, s.alpha);
        if (collect) {
          const half = s.width / 2;
          record.graphics.push({ elementId: s.id, kind: "swiss-grid", bbox: [Math.min(s.a[0], s.b[0]) - half, Math.min(s.a[1], s.b[1]) - half, Math.max(s.a[0], s.b[0]) + half, Math.max(s.a[1], s.b[1]) + half] });
        }
      }
      return p;
    };

    // terminal-ui kit (MO-SH-11): one Canvas2D layer of window chrome, meters and caret; its labels
    // are glyphs, so they are drawn through the type kit into the type layer.
    // The window chrome is static: it is drawn once, and each sample repaints only the meter and
    // caret cells (panel fill first), so the canvas bytes equal a full redraw.
    let chromeDrawn = false;
    let previousCarets = [];
    const terminalChrome = (f, api, record, collect, still) => {
      const p = look.params["terminal-ui"];
      const ctx = termLayer.ctx;
      const frame = [120, 100, 1800, 980];
      ctx.save();
      if (!chromeDrawn) {
        termLayer.clear();
        ctx.strokeStyle = palette.secondary;
        ctx.fillStyle = palette.panel;
        ctx.lineWidth = p.windowChromeWidthPx;
        ctx.fillRect(frame[0], frame[1], frame[2] - frame[0], frame[3] - frame[1]);
        ctx.strokeRect(frame[0], frame[1], frame[2] - frame[0], frame[3] - frame[1]);
        ctx.beginPath(); ctx.moveTo(frame[0], 148); ctx.lineTo(frame[2], 148); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(frame[0], 916); ctx.lineTo(frame[2], 916); ctx.stroke();
        chromeDrawn = true;
      }
      const jitter = LTM.mulberry32(shotSeed(f.shot, "terminal-ui"));
      ctx.strokeStyle = palette.secondary;
      ctx.lineWidth = p.windowChromeWidthPx;
      for (let i = 0; i < p.meterCount; i++) {
        const y = 934 + i * 20;
        ctx.fillStyle = palette.panel;
        ctx.fillRect(1476, y - 4, 290, 20);
        ctx.strokeRect(1480, y, 280, 12);
        const level = LTM.clamp(i === 0 ? f.p : (f.shotNumber - 1 + f.p) / f.shotTotal);
        ctx.fillStyle = palette.secondary;
        ctx.fillRect(1482, y + 2, 276 * level * (0.985 + 0.015 * jitter()), 8);
      }
      const caretRects = record.carets.map((c) => [c.x, c.y - c.h, c.x + c.w, c.y]);
      for (const r of [...previousCarets, ...caretRects]) {
        ctx.fillStyle = palette.panel;
        ctx.fillRect(Math.floor(r[0]) - 2, Math.floor(r[1]) - 2, Math.ceil(r[2] - r[0]) + 4, Math.ceil(r[3] - r[1]) + 4);
      }
      record.termDirty = [...Array.from({ length: p.meterCount }, (_, i) => [1476, 930 + i * 20, 1766, 950 + i * 20]), ...previousCarets, ...caretRects].map((r) => [r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2]);
      previousCarets = caretRects;
      const blinkOn = still || Math.floor(f.t * p.caretBlinkHz * 2) % 2 === 0;
      if (blinkOn) {
        ctx.fillStyle = palette.text;
        for (const caret of record.carets) ctx.fillRect(caret.x, caret.y - caret.h, caret.w, caret.h);
      }
      ctx.restore();
      if (collect) {
        record.graphics.push({ elementId: "terminal-window", kind: "terminal-ui", bbox: [frame[0] - 1, frame[1] - 1, frame[2] + 1, frame[3] + 1] });
        for (let i = 0; i < p.meterCount; i++) record.graphics.push({ elementId: `terminal-meter-${i}`, kind: "terminal-ui", bbox: [1480, 934 + i * 20, 1760, 946 + i * 20] });
        record.fills.push({ elementId: "terminal-panel", color: palette.panel, bbox: frame, kind: "background" });
      }
      const minutes = Math.floor(f.t / 60), seconds = (f.t % 60).toFixed(2).padStart(5, "0");
      // Chrome labels sit on the panel under scanlines and vignette: the dim grey is used only at the
      // large-type size (>= 25 px bold), and the status readout takes the film's one signal hue.
      api.text({ id: "terminal-title", text: "LIT TERMINAL", voice: "chrome", size: 26, weight: 700, x: 144, y: 136, fill: palette.secondary, role: "chrome" });
      api.text({ id: "terminal-status", text: `${String(minutes).padStart(2, "0")}:${seconds}${config.showIndex === true ? `  shot ${f.shotNumber}/${f.shotTotal}` : ""}`, voice: "machine", size: 22, weight: 400, x: 144, y: 956, fill: palette.text, role: "status" });
      return p;
    };

    const surgeAt = (shot, t) => {
      let env = 0;
      for (const event of eventsOf(shot)) {
        if (event.kind !== "surge") continue;
        const d = t - event.time;
        if (d < 0 || d > event.attackSec + event.decaySec) continue;
        const rise = d < event.attackSec ? d / event.attackSec : 1 - (d - event.attackSec) / event.decaySec;
        env = Math.max(env, rise * rise * (3 - 2 * rise));
      }
      return env;
    };
    const glitchAt = (shot, t) => eventsOf(shot).find((event) => event.kind === "glitch" && t >= event.time - 1e-9 && t < event.time + event.holdFrames / fps - 1e-9);
    const bootAt = (shot, t) => eventsOf(shot).find((event) => event.kind === "boot-flicker" && t >= event.time - 1e-9 && t < event.time + event.durationSec - 1e-9);

    // Composite everything active at time t into `out` (linear HDR). Returns the sample record and
    // the scene's overrides. `ring` supplies the CRT persistence frames for stateful shots.
    const composite = (t, options) => {
      const { collect = false, still = false, ring = [], stopBeforeCrt = false, preCrtSink } = options;
      const f = frameFor(t);
      typeLayer.clear();
      const { api, record } = makeApi(f, collect);
      const draw = LTM.scenes[f.shot.scene];
      const overrides = draw(f, api) ?? {};
      let termParams;
      if (look.passes.includes("terminal-ui")) termParams = terminalChrome(f, api, record, collect, still);
      const bg = lin(palette.background);
      if (collect) record.fills.push({ elementId: "background", color: palette.background, bbox: [0, 0, 1920, 1080], kind: "background" });
      core.clearTarget(targets.a, bg);
      let src = targets.a, dst = targets.b;
      const swap = () => { const tmp = src; src = dst; dst = tmp; };
      for (const pass of order) {
        if (pass === "__type") {
          if (marks.count) marks.draw(src);
          typeComposite.use().texture("u_layer", typeLayer.upload(record.dirty)).draw(src, "over");
          continue;
        }
        if (pass === "tidal-gradient") {
          const p = look.params[pass];
          const origin = LTM.mulberry32(shotSeed(f.shot, pass));
          const octaves = config.software ? Math.max(3, Math.floor(p.octaves / 2)) : p.octaves;
          passes[pass].use().set("u_time", "float", t).set("u_seed", "uint", shotSeed(f.shot, pass))
            .set("u_background", "vec3", bg).set("u_stopA", "vec3", lin(palette.signal)).set("u_stopB", "vec3", lin(palette.stopB))
            .set("u_flowSpeed", "float", p.flowSpeed).set("u_warpAmount", "float", p.warpAmount).set("u_curlStrength", "float", p.curlStrength)
            .set("u_octaves", "int", octaves).set("u_surge", "float", surgeAt(f.shot, t)).set("u_surgeOnHit", "float", p.surgeOnHit)
            .set("u_bandingSteps", "int", p.bandingSteps).set("u_ditherAmount", "float", still ? 0 : p.ditherAmount)
            .set("u_origin", "vec2", [origin() * 64, origin() * 64]).draw(src);
          if (collect) record.fills.push({ elementId: "tidal-gradient", color: palette.signal, bbox: [0, 0, 1920, 1080], kind: "background", stops: [palette.background, palette.signal, palette.stopB] });
          continue;
        }
        if (pass === "swiss-grid") {
          const p = swissRules(f, collect, record);
          const entry = core.log.open ? core.log.entry("swiss-grid") : null;
          if (entry && core.log.recordUniforms) Object.assign(entry.uniforms, { u_columns: p.columns, u_gutterPx: p.gutterPx, u_marginPx: p.marginPx, u_baselinePx: p.baselinePx, u_moduleSnap: p.moduleSnap, u_showGuides: p.showGuides, u_hairlineWidthPx: p.hairlineWidthPx });
          const drew = grid.draw(src);
          if (entry) entry.draws += drew;
          continue;
        }
        if (pass === "terminal-ui") {
          const p = termParams;
          passes[pass].use().texture("u_layer", termLayer.upload(record.termDirty)).set("u_charGridPx", "vec2", p.charGridPx)
            .set("u_windowChromeWidthPx", "float", p.windowChromeWidthPx).set("u_meterCount", "int", p.meterCount)
            .set("u_logLineRateCharsPerSec", "float", p.logLineRateCharsPerSec).set("u_caretBlinkHz", "float", p.caretBlinkHz)
            .set("u_seed", "uint", shotSeed(f.shot, pass)).draw(src, "over");
          continue;
        }
        if (pass === "crt") {
          if (stopBeforeCrt) return { target: src, record, overrides, f };
          const p = look.params.crt;
          const boot = bootAt(f.shot, t);
          const persistence = f.shot.stateful ? p.phosphorPersistence : 0;
          const pass0 = passes.crt.use().texture("u_src", src.tex);
          for (let i = 0; i < 3; i++) pass0.texture(`u_ring${i}`, (ring[i] ?? src).tex);
          pass0.set("u_ringCount", "int", f.shot.stateful ? ring.length : 0).set("u_time", "float", t).set("u_seed", "uint", shotSeed(f.shot, "crt"))
            .set("u_background", "vec3", bg).set("u_scanlineFreqPerFrame", "float", p.scanlineFreqPerFrame).set("u_scanlineDepth", "float", p.scanlineDepth)
            .set("u_phosphorPersistence", "float", persistence).set("u_bloomAmount", "float", p.bloomAmount).set("u_curvature", "float", p.curvature)
            .set("u_vignette", "float", p.vignette).set("u_triadMaskAmount", "float", p.triadMaskAmount)
            .set("u_flickerAmp", "float", boot ? 0.06 : p.flickerAmp).set("u_flickerFreqHz", "float", boot ? 14 : p.flickerFreqHz).draw(dst);
          if (preCrtSink) preCrtSink(src);
          swap();
          continue;
        }
        if (pass === "dither") {
          const p = look.params.dither;
          passes.dither.use().texture("u_src", src.tex).set("u_ditherMode", "int", p.mode).set("u_paletteSize", "int", p.paletteSize)
            .set("u_pixelScale", "int", p.pixelScale).set("u_ditherStrength", "float", p.ditherStrength)
            .set("u_seed", "uint", shotSeed(f.shot, "dither")).set("u_noiseOn", "bool", !still).draw(dst);
          swap();
          continue;
        }
        if (pass === "glitch") {
          const p = look.params.glitch;
          const hit = glitchAt(f.shot, t);
          const slices = Array.from({ length: 12 }, (_, i) => hit?.slices[i] ?? [0, 0, 0]);
          const blocks = Array.from({ length: 3 }, (_, i) => hit?.blocks[i] ?? [0, 0, 0, 0]);
          passes.glitch.use().texture("u_src", src.tex).set("u_time", "float", t).set("u_seed", "uint", shotSeed(f.shot, "glitch"))
            .set("u_intensity", "float", p.intensity).set("u_hit", "int", hit ? 1 : 0).set("u_sliceCount", "int", hit ? hit.slices.length : 0)
            .set("u_slices[0]", "vec3[]", slices).set("u_blocks[0]", "vec4[]", blocks).set("u_blockCorruptSize", "vec2", p.blockCorruptSize)
            .set("u_rgbSplitPx", "float", p.rgbSplitPx).set("u_hitRatePerSec", "float", p.hitRatePerSec).set("u_areaCapPct", "float", p.areaCapPct)
            .set("u_holdFrames", "int", p.holdFrames).set("u_maxOffsetPx", "float", p.maxOffsetPx).draw(dst);
          swap();
          continue;
        }
      }
      return { target: src, record, overrides, f };
    };

    // CRT persistence ring for stateful shots: the pre-CRT composite of the previous frame(s), never
    // before the shot's first frame, each at its own t = m / fps. A seek recomputes what is missing.
    const ringCache = new Map();
    const freeSlot = (protect) => {
      const used = new Set(ringCache.values());
      const free = ringTargets.find((target) => !used.has(target));
      if (free) return free;
      const victim = [...ringCache.keys()].filter((key) => !protect.includes(key)).sort((a, b) => a - b)[0];
      const slot = ringCache.get(victim);
      ringCache.delete(victim);
      return slot;
    };
    const storeRing = (m, target, protect) => {
      const slot = freeSlot(protect);
      copy.use().texture("u_src", target.tex).draw(slot);
      ringCache.set(m, slot);
    };
    const ringFor = (n, shot) => {
      if (!shot.stateful) return [];
      const first = Math.round(shot.start * fps);
      const depth = Math.round(shot.prerollMax * fps);
      const wanted = Array.from({ length: depth }, (_, i) => n - 1 - i).filter((m) => m >= first);
      for (const m of wanted) if (!ringCache.has(m)) storeRing(m, composite(m / fps, { stopBeforeCrt: true }).target, wanted);
      return wanted.map((m) => ringCache.get(m));
    };

    const buffers = { rgba: null, mask: null };
    const ensureBuffers = () => {
      if (!buffers.rgba) {
        buffers.rgbaFrame = new ArrayBuffer(16 + core.W * core.H * 4);
        buffers.rgba = new Uint8Array(buffers.rgbaFrame, 16);
        buffers.maskFrame = new ArrayBuffer(16 + core.W * core.H);
        buffers.mask = new Uint8Array(buffers.maskFrame, 16);
      }
    };

    const effectivePost = (overrides, still) => {
      const p = { ...look.post, ...overrides };
      if (still) p.grain = 0;
      p.shake = Array.isArray(p.shake) ? p.shake : [0, 0];
      p.invert = Boolean(p.invert);
      return p;
    };

    const transformBox = (bbox, p) => bbox && [
      (bbox[0] + p.shake[0] - 960) * p.zoom + 960, (bbox[1] + p.shake[1] - 540) * p.zoom + 540,
      (bbox[2] + p.shake[0] - 960) * p.zoom + 960, (bbox[3] + p.shake[1] - 540) * p.zoom + 540
    ];

    // Glyph-coverage mask of the centre sample: the type layer's alpha, mapped through the post
    // chain's shake/zoom so it lines up with the output pixels. Returns the ink pixel count.
    const captureMask = (p, rects) => {
      const mask = buffers.mask;
      mask.fill(0);
      let ink = 0;
      const identity = p.zoom === 1 && p.shake[0] === 0 && p.shake[1] === 0;
      if (identity) {
        const valid = rects.filter(Boolean);
        if (!valid.length) return 0;
        const s = config.scale;
        const x0 = Math.max(0, Math.floor(Math.min(...valid.map((r) => r[0])) * s) - 4), y0 = Math.max(0, Math.floor(Math.min(...valid.map((r) => r[1])) * s) - 4);
        const x1 = Math.min(core.W, Math.ceil(Math.max(...valid.map((r) => r[2])) * s) + 4), y1 = Math.min(core.H, Math.ceil(Math.max(...valid.map((r) => r[3])) * s) + 4);
        if (x1 <= x0 || y1 <= y0) return 0;
        const data = typeLayer.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          if (data[((y - y0) * (x1 - x0) + (x - x0)) * 4 + 3] >= 128) { mask[y * core.W + x] = 255; ink++; }
        }
        return ink;
      }
      const data = typeLayer.ctx.getImageData(0, 0, core.W, core.H).data;
      for (let y = 0; y < core.H; y++) for (let x = 0; x < core.W; x++) {
        const sx = Math.round(((x / config.scale - 960) / p.zoom + 960 - p.shake[0]) * config.scale);
        const sy = Math.round(((y / config.scale - 540) / p.zoom + 540 - p.shake[1]) * config.scale);
        if (sx >= 0 && sy >= 0 && sx < core.W && sy < core.H && data[(sy * core.W + sx) * 4 + 3] >= 128) { mask[y * core.W + x] = 255; ink++; }
      }
      return ink;
    };

    let socket = null;
    const connect = (url) => new Promise((resolve, reject) => {
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => resolve(true);
      socket.onerror = () => reject(new Error(`frame socket failed to open: ${url}`));
    });
    const header = (buffer, frame, kind, length) => {
      const view = new DataView(buffer);
      view.setUint32(0, 0x4c544d46); view.setUint32(4, frame); view.setUint32(8, kind); view.setUint32(12, length);
    };
    const b64 = (bytes) => {
      let out = "";
      for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(out);
    };

    const renderFrame = async (request) => {
      const { frame, samples, shutter, still = false, wantMask = false, egress = "none", logFrame = true } = request;
      ensureBuffers();
      const tn = frame / fps;
      const times = Array.from({ length: samples }, (_, i) => Math.max(0, tn + (shutter / fps) * ((i + 0.5) / samples - 0.5)));
      const centre = Math.floor(samples / 2);
      const shot = activeShot(tn);
      const ring = ringFor(frame, shot);
      if (logFrame) core.log.begin();
      let centreResult = null;
      let ink = 0;
      if (samples > 1) core.clearTarget(targets.accum, [0, 0, 0], 0);
      for (let i = 0; i < samples; i++) {
        core.log.recordUniforms = logFrame && i === centre;
        // With one sample the centre composite is exactly t_n, so its pre-CRT image is this frame's own
        // persistence entry; the sink stores it after the CRT draw has read the ring.
        const sink = shot.stateful && samples === 1 && logFrame ? (target) => storeRing(frame, target, [frame - 1, frame - 2]) : undefined;
        const result = composite(times[i], { collect: i === centre, still, ring, preCrtSink: sink });
        if (i === centre) {
          centreResult = result;
          centreResult.post = effectivePost(result.overrides, still);
          ink = captureMask(centreResult.post, result.record.dirty);
        }
        if (samples > 1) accumulate.use().texture("u_src", result.target.tex).set("u_weight", "float", 1 / samples).draw(targets.accum, "add");
        else centreResult.single = result.target;
      }
      core.log.recordUniforms = false;
      const source = samples > 1 ? targets.accum : centreResult.single;
      const output = post.render(source, centreResult.post, frame, config.seed >>> 0);
      await core.readPixelsAsync(output, buffers.rgba);
      const passLines = logFrame ? core.log.end() : [];
      if (shot.stateful && !(samples === 1 && logFrame)) storeRing(frame, composite(tn, { stopBeforeCrt: true }).target, [frame - 1, frame - 2]);
      const p = centreResult.post;
      const meta = {
        frame, sampleTimes: times, sceneId: centreResult.f.shot.sceneId, shotIndex: centreResult.f.shot.shotIndex,
        passLines, inkPixels: ink,
        textBoxes: centreResult.record.boxes.map((box) => ({ ...box, bbox: transformBox(box.bbox, p) })),
        graphics: centreResult.record.graphics.map((g) => ({ ...g, bbox: transformBox(g.bbox, p) })),
        fills: centreResult.record.fills,
        post: p
      };
      if (egress === "ws") {
        header(buffers.rgbaFrame, frame, 1, buffers.rgba.length);
        socket.send(buffers.rgbaFrame);
        if (wantMask) { header(buffers.maskFrame, frame, 2, buffers.mask.length); socket.send(buffers.maskFrame); }
        while (socket.bufferedAmount > 0) await new Promise((resolve) => setTimeout(resolve, 0));
      } else if (egress === "pull") {
        meta.rgbaBase64 = b64(buffers.rgba);
        if (wantMask) meta.maskBase64 = b64(buffers.mask);
      }
      return meta;
    };

    // Pre-flight MO-D-04: dry-run every shot at its settled moment and look up every drawn
    // codepoint in the font the kit resolved for it, before any frame is rendered.
    const preflight = () => {
      const missing = [];
      for (const shot of shots) {
        const t = Math.max(shot.start, shot.end - 1 / fps);
        const f = frameFor(t);
        typeLayer.clear();
        const { api, record } = makeApi(f, false);
        LTM.scenes[shot.scene](f, api);
        if (look.passes.includes("terminal-ui")) terminalChrome(f, api, record, false, true);
        for (const spec of record.specs) {
          if (spec.kind === "stroke") { for (const char of type.strokeMissing(spec.text, spec.font)) missing.push(`${char} (${spec.font}) in ${shot.id}`); continue; }
          const lines = spec.kind === "block" ? spec.lines : [spec.text];
          for (const line of lines) for (const gap of type.missingGlyphs(line, spec.voice ?? "display", spec.weight ?? 700, spec.width ?? 100)) missing.push(`${gap} in ${shot.id}`);
        }
      }
      return [...new Set(missing)];
    };

    LTM.engine = { renderFrame, preflight, connect, renderer: core.renderer };
    return { renderer: core.renderer, width: core.W, height: core.H };
  };
})();
