// Browser side, part 6: the type kit. Glyphs are drawn from real outline data (opentype.js over
// the actual font files), laid out with the font's own advances and kerning, split into script runs
// (MO-FT-04), and every draw reports its geometry as a textBoxes[] entry (§A8). Single-stroke EMS
// plotter fonts (MO-FT-08) are drawn progressively as polylines.
(() => {
  const LTM = window.LTM;

  LTM.createTypeKit = (fontBuffers, strokeSources) => {
    const fonts = new Map();
    const files = new Map();
    for (const [key, { buffer, file }] of Object.entries(fontBuffers)) {
      fonts.set(key, window.opentype.parse(buffer));
      files.set(key, file);
    }
    const pathCache = new Map();
    const glyphPath = (key, glyph) => {
      const id = `${key}:${glyph.index}`;
      if (!pathCache.has(id)) {
        const font = fonts.get(key);
        pathCache.set(id, new Path2D(glyph.getPath(0, 0, font.unitsPerEm).toPathData(3)));
      }
      return pathCache.get(id);
    };

    const archivoWidths = [75, 100, 125];
    const archivoWeights = [400, 700, 900];
    const nearest = (list, value) => list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best), list[0]);

    // Voice + script -> font key. Hangul runs always resolve to the product's lit-pptx pair and
    // never take width or tracking (MO-A-33, MO-FT-04).
    const resolveFont = (voice, script, weight, width) => {
      if (script === "hangul") {
        if (voice === "pixel") return { key: "galmuri9", weight: 400, width: 100 };
        return { key: weight >= 550 ? "hangul-700" : "hangul-400", weight: weight >= 550 ? 700 : 400, width: 100 };
      }
      if (voice === "pixel") return { key: "vt323", weight: 400, width: 100 };
      if (voice === "chrome") return { key: weight >= 550 ? "silkscreen-700" : "silkscreen-400", weight: weight >= 550 ? 700 : 400, width: 100 };
      if (voice === "machine") return { key: "meslo", weight: 400, width: 100 };
      const w = nearest(archivoWidths, width), g = nearest(archivoWeights, voice === "body" ? Math.min(weight, 700) : weight);
      return { key: `archivo-${w}-${g}`, weight: g, width: w };
    };

    const splitRuns = (text) => {
      const kinds = Array.from(text).map((char) => (/[ᄀ-ᇿ㄰-㆏가-힣]/u.test(char) ? "hangul" : /\p{L}/u.test(char) ? "latin" : "neutral"));
      const chars = Array.from(text);
      const resolved = kinds.map((kind, i) => {
        if (kind !== "neutral") return kind;
        for (let j = i - 1; j >= 0; j--) if (kinds[j] !== "neutral") return kinds[j];
        for (let j = i + 1; j < kinds.length; j++) if (kinds[j] !== "neutral") return kinds[j];
        return "latin";
      });
      const runs = [];
      chars.forEach((char, i) => {
        const last = runs.at(-1);
        if (last && last.script === resolved[i]) last.text += char;
        else runs.push({ script: resolved[i], text: char, start: i });
      });
      return runs;
    };

    // Per-glyph layout of one line: positions come from advances plus the kerning pair in front of
    // each glyph, so glyph i of a split word sits exactly where it sits in the whole run (MO-A-32).
    const layout = (text, { voice = "display", size, weight = 700, width = 100, trackingEm = 0 }) => {
      const glyphs = [];
      const runs = [];
      let x = 0;
      for (const run of splitRuns(text)) {
        const font = resolveFont(voice, run.script, weight, width);
        const tracking = run.script === "hangul" ? 0 : trackingEm;
        const face = fonts.get(font.key);
        if (!face) throw new Error(`font ${font.key} is not loaded`);
        const unit = size / face.unitsPerEm;
        const chars = Array.from(run.text);
        let previous = null;
        const runStart = x;
        chars.forEach((char, i) => {
          const glyph = face.charToGlyph(char);
          if (previous) x += face.getKerningValue(previous, glyph) * unit;
          glyphs.push({ char, index: run.start + i, glyph, key: font.key, x, unit, missing: glyph.index === 0 && !/\s/u.test(char) });
          x += glyph.advanceWidth * unit + (i < chars.length - 1 ? tracking * size : 0);
          previous = glyph;
        });
        runs.push({ script: run.script, text: run.text, font: files.get(font.key), fontKey: font.key, weight: font.weight, widthPct: font.width, trackingEm: tracking, scaleX: 1, x0: runStart, x1: x });
      }
      return { text, glyphs, runs, width: x };
    };

    const glyphX = (text, index, options) => {
      const lay = layout(text, options);
      const glyph = lay.glyphs.find((g) => g.index === index);
      return glyph ? glyph.x : lay.width;
    };

    const capHeight = (key, size) => {
      const face = fonts.get(key);
      const cap = face.tables.os2?.sCapHeight || face.unitsPerEm * 0.7;
      return (cap / face.unitsPerEm) * size;
    };

    const fillStyle = (ctx, fill, x0, y0, x1, y1) => {
      if (typeof fill === "string") return fill;
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      fill.stops.forEach((stop, i) => gradient.addColorStop(i / (fill.stops.length - 1), stop));
      return gradient;
    };

    // Draw one line of text. `visible` limits which glyph indices are painted (reveal / type-in)
    // without moving any glyph; `opacityOf(index)` fades individual glyphs.
    const drawLine = (ctx, spec) => {
      const lay = layout(spec.text, spec);
      const originX = spec.align === "center" ? spec.x - lay.width / 2 : spec.align === "right" ? spec.x - lay.width : spec.x;
      const sx = spec.scale ?? 1;
      const cx = spec.x, cy = spec.y;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      ctx.save();
      ctx.fillStyle = fillStyle(ctx, spec.fill, originX, spec.y - spec.size, originX + lay.width, spec.y);
      for (const g of lay.glyphs) {
        if (/\s/u.test(g.char)) continue;
        if (spec.visible && !spec.visible(g.index)) continue;
        const alpha = (spec.opacity ?? 1) * (spec.opacityOf ? spec.opacityOf(g.index) : 1);
        if (alpha <= 0) continue;
        const gx = cx + (originX + g.x - cx) * sx, gy = cy;
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.scale(g.unit * sx, g.unit * sx);
        ctx.fill(glyphPath(g.key, g.glyph));
        ctx.restore();
        const box = g.glyph.getBoundingBox();
        if (box.x2 > box.x1) {
          bx0 = Math.min(bx0, gx + box.x1 * g.unit * sx); bx1 = Math.max(bx1, gx + box.x2 * g.unit * sx);
          by0 = Math.min(by0, gy - box.y2 * g.unit * sx); by1 = Math.max(by1, gy - box.y1 * g.unit * sx);
        }
      }
      ctx.restore();
      return { lay, bbox: bx0 === Infinity ? null : [bx0, by0, bx1, by1], originX };
    };

    const boxEntry = (spec, drawn, extra = {}) => {
      const primary = drawn.lay.runs.find((run) => run.script === "latin") ?? drawn.lay.runs[0];
      return {
        elementId: spec.id, text: spec.text, voice: spec.voice ?? "display", fontFile: primary?.font ?? null,
        fontSizePx: spec.size * (spec.scale ?? 1), capHeightPx: capHeight(primary.fontKey, spec.size * (spec.scale ?? 1)),
        weight: primary.weight, fill: typeof spec.fill === "string" ? spec.fill : "gradient",
        ...(typeof spec.fill === "string" ? {} : { fillStops: spec.fill.stops }),
        bbox: drawn.bbox, runs: drawn.lay.runs.map(({ x0, x1, fontKey, ...run }) => run),
        role: spec.role ?? "display", lineCount: 1, lineHeight: null, outline: false, halo: false, ...extra
      };
    };

    const text = (ctx, spec) => {
      const drawn = drawLine(ctx, spec);
      return drawn.bbox ? boxEntry(spec, drawn) : null;
    };

    // A multi-line block (kinetic list, wrapped karaoke line, paragraph card). Lines break only
    // where the caller broke them; `wrap` breaks at whitespace, never inside a 어절 (MO-FT-05).
    const block = (ctx, spec) => {
      const lines = spec.lines;
      let bbox = null;
      let drawnLines = 0;
      let last;
      lines.forEach((line, i) => {
        const visible = spec.lineVisible ? spec.lineVisible(i) : true;
        if (!visible || !line) return;
        const lineSpec = { ...spec, text: line, y: spec.y + i * spec.size * spec.lineHeight, x: spec.x + (spec.lineOffset ? spec.lineOffset(i) : 0), opacity: (spec.opacity ?? 1) * (spec.lineOpacity ? spec.lineOpacity(i) : 1), ...(spec.lineGlyphs ? spec.lineGlyphs(i) : {}) };
        const drawn = drawLine(ctx, lineSpec);
        if (!drawn.bbox) return;
        drawnLines += 1;
        last = drawn;
        bbox = bbox ? [Math.min(bbox[0], drawn.bbox[0]), Math.min(bbox[1], drawn.bbox[1]), Math.max(bbox[2], drawn.bbox[2]), Math.max(bbox[3], drawn.bbox[3])] : drawn.bbox;
      });
      if (!bbox) return null;
      const entry = boxEntry({ ...spec, text: lines.join("\n") }, { ...last, bbox }, {
        lineCount: drawnLines, lineHeight: spec.lineHeight, lines, role: spec.role ?? "block"
      });
      if (spec.role === "paragraph") entry.measureCh = Math.max(...lines.map((line) => Array.from(line).length));
      return entry;
    };

    const wrap = (value, maxChars) => {
      const words = value.split(/\s+/u).filter(Boolean);
      const lines = [];
      let current = "";
      for (const word of words) {
        if (current && Array.from(`${current} ${word}`).length > maxChars) { lines.push(current); current = word; }
        else current = current ? `${current} ${word}` : word;
      }
      if (current) lines.push(current);
      return lines;
    };

    const wrapToWidth = (value, options, maxWidth) => {
      const words = value.split(/\s+/u).filter(Boolean);
      const lines = [];
      let current = "";
      for (const word of words) {
        const trial = current ? `${current} ${word}` : word;
        if (current && layout(trial, options).width > maxWidth) { lines.push(current); current = word; }
        else current = trial;
      }
      if (current) lines.push(current);
      return lines;
    };

    const fit = (value, options, maxWidth, maxSize, minSize) => {
      let size = maxSize;
      while (size > minSize && layout(value, { ...options, size }).width > maxWidth) size -= 2;
      return size;
    };

    const missingGlyphs = (value, voice, weight = 700, width = 100) => {
      return layout(value, { voice, size: 100, weight, width }).glyphs.filter((g) => g.missing).map((g) => `${g.char}@${files.get(g.key)}`);
    };

    // ---- single-stroke plotter fonts (EMS SVG, OFL). No kerning tables: glyph advances only.
    const strokeFonts = new Map();
    for (const [name, source] of Object.entries(strokeSources)) {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const face = doc.querySelector("font-face");
      const fontEl = doc.querySelector("font");
      const defaultAdvance = parseFloat(fontEl.getAttribute("horiz-adv-x") ?? "500");
      const glyphs = new Map();
      doc.querySelectorAll("glyph").forEach((node) => {
        const unicode = node.getAttribute("unicode");
        if (unicode === null) return;
        const strokes = [];
        let current = null, command = "M";
        const tokens = (node.getAttribute("d") ?? "").match(/[MLml]|-?\d*\.?\d+(?:e-?\d+)?/gu) ?? [];
        for (let i = 0; i < tokens.length;) {
          if (/[MLml]/u.test(tokens[i])) { command = tokens[i].toUpperCase(); i += 1; continue; }
          const x = parseFloat(tokens[i]), y = parseFloat(tokens[i + 1]);
          i += 2;
          if (command === "M") { current = [[x, y]]; strokes.push(current); command = "L"; }
          else current?.push([x, y]);
        }
        glyphs.set(unicode, { advance: parseFloat(node.getAttribute("horiz-adv-x") ?? String(defaultAdvance)), strokes });
      });
      strokeFonts.set(name, { upm: parseFloat(face?.getAttribute("units-per-em") ?? "1000"), glyphs, defaultAdvance, file: `fonts/stroke/${name}.svg` });
    }

    const strokeLayout = (value, fontName, size) => {
      const font = strokeFonts.get(fontName);
      if (!font) throw new Error(`stroke font ${fontName} is not loaded`);
      const unit = size / font.upm;
      const strokes = [];
      const charRange = [];
      let x = 0, length = 0;
      Array.from(value).forEach((char) => {
        const glyph = font.glyphs.get(char);
        const startLength = length;
        for (const stroke of glyph?.strokes ?? []) {
          const points = stroke.map(([px, py]) => [x + px * unit, -py * unit]);
          let segment = 0;
          for (let i = 1; i < points.length; i++) segment += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
          strokes.push({ points, start: length, length: segment });
          length += segment;
        }
        charRange.push([startLength, length]);
        x += (glyph?.advance ?? font.defaultAdvance) * unit;
      });
      return { strokes, total: length, width: x, charRange, file: font.file };
    };

    const strokeMissing = (value, fontName) => Array.from(value).filter((char) => !/\s/u.test(char) && !strokeFonts.get(fontName)?.glyphs.has(char));

    // Draw the first `len` px of pen travel; returns a textBoxes entry for the ink actually drawn.
    const strokeText = (ctx, spec) => {
      const lay = strokeLayout(spec.text, spec.font, spec.size);
      const len = spec.length ?? lay.total;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      const put = (x, y) => { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); };
      ctx.save();
      ctx.strokeStyle = spec.fill;
      ctx.lineWidth = spec.penWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (const stroke of lay.strokes) {
        if (stroke.start >= len) break;
        const pts = stroke.points.map(([x, y]) => [spec.x + x, spec.y + y]);
        ctx.moveTo(pts[0][0], pts[0][1]);
        put(pts[0][0], pts[0][1]);
        let travelled = stroke.start;
        for (let i = 1; i < pts.length; i++) {
          const step = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (travelled + step <= len) { ctx.lineTo(pts[i][0], pts[i][1]); put(pts[i][0], pts[i][1]); travelled += step; continue; }
          const u = (len - travelled) / Math.max(step, 1e-6);
          const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u;
          ctx.lineTo(x, y); put(x, y);
          break;
        }
      }
      ctx.stroke();
      ctx.restore();
      if (bx0 === Infinity) return null;
      const pad = spec.penWidth / 2;
      return {
        elementId: spec.id, text: spec.text, voice: "stroke", fontFile: lay.file, fontSizePx: spec.size, capHeightPx: spec.size * 0.7,
        weight: 400, fill: spec.fill, bbox: [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad],
        runs: [{ script: "latin", text: spec.text, font: lay.file, weight: 400, widthPct: 100, trackingEm: 0, scaleX: 1 }],
        role: "signature", lineCount: 1, lineHeight: null, outline: false, halo: false, strokeFont: true
      };
    };

    // Pen travel by time: each character is written inside its own [start, end] window.
    const writtenLength = (lay, charTimes, t) => {
      let len = 0;
      for (let i = 0; i < lay.charRange.length; i++) {
        const [a, b] = lay.charRange[i];
        const [t0, t1] = charTimes[i];
        if (t >= t1) len = b;
        else if (t > t0) { len = a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0)); break; }
        else break;
      }
      return len;
    };

    return { layout, glyphX, text, block, wrap, wrapToWidth, fit, capHeight, missingGlyphs, strokeLayout, strokeText, strokeMissing, writtenLength, fontFile: (key) => files.get(key) };
  };
})();
