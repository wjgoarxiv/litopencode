// Browser side, part 7: the six original starter scenes. A scene is a pure function of the frame
// `f` (time, local progress, its timeline entry and reveal units) and the drawing api; every beat
// inside it is a function of f.lt / f.p against its own window, never a literal frame number
// (MO-A-06). Each returns post-chain overrides for that sample (MO-A-58).
(() => {
  const LTM = window.LTM;
  const SAFE = { x0: 96, y0: 54, x1: 1824, y1: 1026 };
  const LEFT = 144;

  const entrance = (f, api, lt) => {
    const motion = api.look.motion;
    if (motion.entrance === "slam") return api.ease("slam", LTM.clamp(lt / motion.entranceSec));
    if (motion.entrance === "drift") return api.ease("drift", LTM.clamp(lt / Math.min(0.8, f.shot.holdSec * 0.4)));
    return 1;
  };

  // Terminal type-in: Latin appears glyph by glyph; a Hangul 어절 appears whole (MO-A-13).
  const typeInVisibility = (value, lt, rate) => {
    const chars = Array.from(value);
    const groupStart = new Array(chars.length).fill(0);
    let cursor = 0, i = 0;
    while (i < chars.length) {
      if (/[가-힣ᄀ-ᇿ㄰-㆏]/u.test(chars[i])) {
        let j = i;
        while (j < chars.length && !/\s/u.test(chars[j])) j++;
        for (let k = i; k < j; k++) groupStart[k] = cursor;
        cursor += (j - i) / rate;
        i = j;
      } else { groupStart[i] = cursor; cursor += 1 / rate; i++; }
    }
    return { visible: (index) => lt >= groupStart[index], done: lt >= cursor, count: chars.filter((_, index) => lt >= groupStart[index]).length };
  };

  const pixelSize = (size, value) => (/[가-힣]/u.test(value) ? Math.max(45, Math.floor(size / 9) * 9) : size);

  const scenes = {};

  scenes["title-slam"] = (f, api) => {
    const voice = api.voices.display;
    const weight = api.presetId === "swiss-signal" ? 900 : 700;
    const value = f.shot.text;
    const k = entrance(f, api, f.lt);
    const maxWidth = api.presetId === "terminalcore" ? 1380 : 1440;
    // Fit against the widest state the entrance passes through (the 125% width cut at 1.04 scale),
    // so the slam's first frames stay inside title-safe too.
    const slam = api.look.motion.entrance === "slam";
    let size = api.type.fit(value, { voice, weight, width: slam ? 125 : 100, trackingEm: slam ? -0.035 : 0 }, slam ? maxWidth / 1.04 : maxWidth, voice === "pixel" ? 144 : 210, 64);
    if (voice === "pixel") size = pixelSize(size, value);
    const typed = api.presetId === "terminalcore" ? typeInVisibility(value, f.lt, api.look.params["terminal-ui"].logLineRateCharsPerSec) : null;
    const box = api.text({
      id: "title", text: value, voice, size, weight,
      width: api.look.motion.entrance === "slam" && k < 0.5 ? 125 : 100,
      trackingEm: api.look.motion.entrance === "slam" ? -0.035 : 0,
      x: LEFT + (api.presetId === "terminalcore" ? 24 : 0), y: 640 + (api.look.motion.entrance === "slam" ? 18 * (1 - k) : -10 * f.p),
      fill: api.palette.text, opacity: typed ? 1 : k, scale: api.look.motion.entrance === "slam" ? 1.04 - 0.04 * k : 1,
      visible: typed ? typed.visible : undefined
    });
    if (typed && box) api.caret(box, size);
    // The shot index is printed only when the treatment asks for it (typePlan.showIndex).
    if (api.presetId !== "terminalcore" && api.showIndex) {
      api.text({ id: "title-index", text: `${String(f.shotNumber).padStart(2, "0")} / ${String(f.shotTotal).padStart(2, "0")}`, voice: "machine", size: 24, weight: 400, x: SAFE.x1 - 48, y: 190, align: "right", fill: api.palette.text, opacity: k, role: "annotation" });
    }
    return {};
  };

  scenes.karaoke = (f, api) => {
    const hangul = /[가-힣]/u.test(f.shot.text);
    const voice = api.presetId === "terminalcore" ? "pixel" : hangul ? "body" : "display";
    const weight = 700;
    let size = api.type.fit(f.shot.text, { voice, weight, width: 100 }, 1540, voice === "pixel" ? 108 : 112, 72);
    let lines = [f.shot.text];
    if (api.type.layout(f.shot.text, { voice, weight, size }).width > 1540) {
      size = voice === "pixel" ? 72 : 88;
      lines = api.type.wrapToWidth(f.shot.text, { voice, weight, size }, 1540);
    }
    if (voice === "pixel") size = pixelSize(size, f.shot.text);
    const lineHeight = hangul ? 1.6 : 1.5;
    const revealedWords = f.units.filter((unit) => f.t >= unit.start).length;
    const newestStart = f.units[revealedWords - 1]?.start ?? f.start;
    const fadeIn = LTM.clamp((f.t - newestStart) / 0.12);
    let wordCursor = 0;
    const lineWordStart = lines.map((line) => { const start = wordCursor; wordCursor += line.split(" ").length; return start; });
    const drawOne = (line, lineIndex) => {
      const charWord = [];
      let w = lineWordStart[lineIndex];
      for (const char of Array.from(line)) { charWord.push(w); if (char === " ") w++; }
      return {
        visible: (index) => charWord[index] < revealedWords,
        opacityOf: (index) => (charWord[index] === revealedWords - 1 ? fadeIn : 1)
      };
    };
    const y0 = lines.length === 1 ? 600 : 520;
    const x = LEFT + (api.presetId === "terminalcore" ? 24 : 0);
    if (lines.length === 1) {
      const vis = drawOne(lines[0], 0);
      const box = api.text({ id: "line", text: lines[0], voice, size, weight, x, y: y0, fill: api.palette.text, ...vis });
      if (api.presetId === "terminalcore" && box) api.caret(box, size);
    } else {
      const perLine = lines.map((line, i) => drawOne(line, i));
      api.block({
        id: "line", lines, voice, size, weight, x, y: y0, lineHeight, fill: api.palette.text, role: "block",
        lineVisible: (i) => lineWordStart[i] < revealedWords,
        lineGlyphs: (i) => perLine[i]
      });
    }
    return {};
  };

  scenes["kinetic-list"] = (f, api) => {
    const items = f.shot.params.items;
    const hangul = items.some((item) => /[가-힣]/u.test(item));
    const voice = api.presetId === "terminalcore" ? "pixel" : hangul ? "body" : "display";
    const lineHeight = hangul ? 1.6 : 1.5;
    const widest = items.reduce((a, b) => (Array.from(b).length > Array.from(a).length ? b : a));
    let size = Math.min(api.type.fit(widest, { voice, weight: 700, width: 100 }, 1320, 96, 48), Math.floor(620 / (items.length * lineHeight)));
    if (voice === "pixel") size = pixelSize(size, items.join(" "));
    if (f.shot.params.heading) {
      api.text({ id: "list-heading", text: f.shot.params.heading, voice: "machine", size: 26, weight: 400, x: LEFT + 4, y: 250, fill: api.palette.text, role: "annotation" });
    }
    const k = (i) => api.ease("slam", LTM.clamp((f.t - f.units[i].start) / 0.24));
    api.block({
      id: "list", lines: items, voice, size, weight: 700, x: LEFT + (api.presetId === "terminalcore" ? 24 : 0), y: 340 + size, lineHeight,
      fill: api.palette.text, role: "block",
      lineVisible: (i) => f.t >= f.units[i].start,
      lineOffset: (i) => -24 * (1 - k(i)),
      lineOpacity: (i) => k(i)
    });
    return {};
  };

  scenes.counter = (f, api) => {
    const { from, to, label } = f.shot.params;
    const span = f.shot.holdSec * 0.6;
    const stepped = Math.floor(f.lt * 15) / 15;
    const value = Math.round(from + (to - from) * api.ease("drift", LTM.clamp(stepped / span)));
    const digits = String(value);
    const final = String(Math.round(to));
    const voice = api.presetId === "terminalcore" ? "pixel" : "display";
    let size = api.type.fit(final, { voice, weight: 900, width: 100 }, 480, 150, 60);
    const box = api.text({ id: "counter", text: digits, voice, size, weight: 900, x: LEFT + (api.presetId === "terminalcore" ? 24 : 0), y: 600, fill: api.palette.text });
    if (label) api.text({ id: "counter-label", text: label, voice: "machine", size: 30, weight: 400, x: LEFT + 4 + (api.presetId === "terminalcore" ? 24 : 0), y: 680, fill: api.palette.text, role: "annotation" });
    if (api.accent && box) api.mark({ id: "accent", x0: LEFT + 14, y0: 440, x1: LEFT + 70, y1: 440, width: 28, color: api.palette.accent, kind: "accent" });
    return {};
  };

  scenes.signature = (f, api) => {
    const font = f.shot.params.font;
    const size = 180;
    const lay = api.type.strokeLayout(f.shot.text, font, size);
    const writeStart = f.start + f.shot.holdSec * 0.12, writeEnd = f.start + f.shot.holdSec * 0.72;
    const chars = Array.from(f.shot.text);
    const charTimes = chars.map((_, i) => [writeStart + (writeEnd - writeStart) * (i / chars.length), writeStart + (writeEnd - writeStart) * ((i + 1) / chars.length)]);
    const length = api.type.writtenLength(lay, charTimes, f.t);
    const scale = Math.min(1, 1500 / Math.max(1, lay.width));
    api.stroke({ id: "signature", text: f.shot.text, font, size: size * scale, x: LEFT + (api.presetId === "terminalcore" ? 24 : 0), y: 620, penWidth: 3.2, fill: api.palette.text, length: length * scale });
    return {};
  };

  scenes["end-card"] = (f, api) => {
    const { title, sub, paragraph } = f.shot.params;
    const voice = api.voices.display;
    const k = entrance(f, api, f.lt);
    const weight = api.presetId === "swiss-signal" ? 900 : 700;
    let size = api.type.fit(title, { voice, weight, width: 100, trackingEm: -0.02 }, 1300, voice === "pixel" ? 126 : 150, 56);
    if (voice === "pixel") size = pixelSize(size, title);
    const x = LEFT + (api.presetId === "terminalcore" ? 24 : 0);
    const typed = api.presetId === "terminalcore" ? typeInVisibility(title, f.lt, api.look.params["terminal-ui"].logLineRateCharsPerSec) : null;
    const titleBox = api.text({ id: "end-title", text: title, voice, size, weight, trackingEm: api.presetId === "terminalcore" ? 0 : -0.02, x, y: 520, fill: api.palette.text, opacity: typed ? 1 : k, visible: typed?.visible });
    if (typed && titleBox && !sub && !paragraph) api.caret(titleBox, size);
    let y = 520 + 90;
    if (sub) {
      const subVoice = api.presetId === "terminalcore" ? "machine" : /[가-힣]/u.test(sub) ? "body" : "machine";
      api.text({ id: "end-sub", text: sub, voice: subVoice, size: 40, weight: subVoice === "body" ? 400 : 400, x: x + 4, y, fill: api.palette.text, opacity: typed ? (typed.done ? 1 : 0) : k, role: "annotation" });
      y += 80;
    }
    if (paragraph) {
      const hangul = /[가-힣]/u.test(paragraph);
      const lines = hangul ? api.type.wrapToWidth(paragraph, { voice: "body", weight: 400, size: 30 }, 900) : api.type.wrap(paragraph, 66);
      api.block({ id: "end-paragraph", lines, voice: "body", size: 30, weight: 400, x: x + 4, y, lineHeight: hangul ? 1.6 : 1.5, fill: api.palette.text, role: "paragraph", opacity: typed ? (typed.done ? 1 : 0) : k });
    }
    if (api.accent) api.mark({ id: "accent", x0: x + 14, y0: 400, x1: x + 70, y1: 400, width: 28, color: api.palette.accent, kind: "accent" });
    return {};
  };

  LTM.scenes = scenes;
  LTM.SAFE = SAFE;
})();
