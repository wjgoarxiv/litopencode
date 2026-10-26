// The stage's text QA, in its own replay browser (the master capture never changes a style). The clock
// is stepped from 0; every 1/10 s the page's text runs are read for the reading-floor track, and at
// each QA sample (every beat midpoint plus two settled frames per beat) two captures are taken, one
// as the film shows it and one with every glyph made transparent, so the difference is the ink.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boxContrast } from "../contrast.mjs";
import { linearLut } from "../flash.mjs";
import { regionFill } from "../fill.mjs";
import { decodePng } from "../png.mjs";
import { readingFloor } from "../text.mjs";
import { LAYOUTS, ZONE_TOLERANCE, readStyle, scaleStep, styleFamilies, styleTextColors } from "../styles.mjs";
import { assetUsed } from "../assets.mjs";
import { normalize, registerOf, withoutQuotes } from "../treatment.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const qaPageSource = () => readFileSync(path.join(here, "qa-page.js"), "utf8");
export const qaLimits = Object.freeze({
  inkDelta: 2, minInkPixels: 12, visibleOpacity: 0.6, judgedOpacity: 0.95, settledPx: 2, decorShare: 0.25, presenceStd: 8 / 255, largeShare: 0.03, safeInset: 0.05, floorTolerance: 0.1,
  // The house-style rules: two visible runs overlap past this share of the smaller box; copy colour may
  // sit this far (RGB distance) from a style text role; shot changes are sampled this far on each side.
  overlapShare: 0.08, emptyRegion: 0.15, emptyRegionsMax: 2, colourDistance: 12, cutWindowSec: 0.4, cutStepSec: 1 / 15, settledAt: Object.freeze([0.35, 0.8])
});
export const TEXT_QA = qaLimits;
const internalTerms = /(?<![\p{L}\p{N}])(?:path|preset|gate|beat|treatment)(?![\p{L}\p{N}])/iu;
const fileName = /(?<![\p{L}\p{N}])[\w-]+\.(?:html?|json|mjs|js|css|png|jpe?g|webp|svg|wav|mp4|md)(?![\p{L}\p{N}])/iu;

// The QA sample frames: each beat midpoint plus two settled frames, and a sample every 1/15 s within
// 0.4 s of each cut (`cut: true`), where an outgoing and an incoming line can cross. The cut rows feed
// only the text-over-text check; a line mid-transition is not judged for style or zone.
export function qaSamples({ beats, fps, frameCount }) {
  const clamp = (f) => Math.max(0, Math.min(frameCount - 1, Math.round(f)));
  const rows = new Map();
  beats.forEach((beat, i) => {
    for (const q of qaLimits.settledAt) rows.set(clamp((beat.t0 + q * (beat.t1 - beat.t0)) * fps), { frame: clamp((beat.t0 + q * (beat.t1 - beat.t0)) * fps), beat: i, mid: false });
  });
  beats.forEach((beat, i) => {
    const frame = clamp(((beat.t0 + beat.t1) / 2) * fps);
    rows.set(frame, { frame, beat: i, mid: true });
  });
  const reach = Math.round(qaLimits.cutWindowSec * fps), step = Math.max(1, Math.round(qaLimits.cutStepSec * fps));
  beats.forEach((beat, i) => {
    if (i === 0) return;
    const at = Math.round(beat.t0 * fps);
    for (let f = clamp(at - reach); f <= clamp(at + reach); f += step) if (!rows.has(f)) rows.set(f, { frame: f, beat: f < at ? i - 1 : i, mid: false, cut: true });
  });
  return [...rows.values()].sort((a, b) => a.frame - b.frame);
}

export function titleSafeBox(width, height) {
  return [width * qaLimits.safeInset, height * qaLimits.safeInset, width * (1 - qaLimits.safeInset), height * (1 - qaLimits.safeInset)];
}

function rgbaOf(png) {
  const image = decodePng(png);
  if (image.channels === 4) return image.pixels;
  const out = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += image.channels, j += 4) { out[j] = image.pixels[i]; out[j + 1] = image.pixels[i + 1]; out[j + 2] = image.pixels[i + 2]; out[j + 3] = 255; }
  return out;
}

const union = (rects) => rects.length ? [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))] : null;
const onScreen = (rects, width, height) => rects.some(([x0, y0, x1, y1]) => x1 > 0 && y1 > 0 && x0 < width && y0 < height && x1 > x0 && y1 > y0);
const keyOf = (run, width, height) => {
  const box = union(run.rects);
  return box ? `${run.norm}@${Math.floor(((box[0] + box[2]) / 2) / (width / 10))},${Math.floor(((box[1] + box[3]) / 2) / (height / 10))}` : `${run.norm}@off`;
};

// Drives the QA browser; returns the raw samples and the 10 fps track for analyseQa().
export async function captureQa(stage, context, frameCount) {
  const { fps, treatment } = context;
  const plan = qaSamples({ beats: treatment.beats, fps, frameCount });
  const byFrame = new Map(plan.map((row) => [row.frame, row]));
  const mids = new Set(plan.filter((row) => row.mid).map((row) => row.frame));
  const qaFrames = new Set(plan.map((row) => row.frame));
  const trackStep = Math.max(1, Math.round(fps / 10));
  const page = stage.page, cdp = stage.cdp;
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const families = context.fonts.families;
  // The allowed platform faces are whatever the product's own web fonts report as, probed once in
  // this browser (a laid-out probe; only custom fonts count, so a system fallback never joins them).
  const removeProbe = await page.evaluateHandle(async (list) => { const remove = window.__litQa.probeFaces(list); document.body.offsetHeight; await window.__litQa.settle(); return remove; }, families);
  const allowed = new Set();
  {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-lit-qa-probe]" });
    for (const nodeId of nodeIds) for (const font of (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts) if (font.isCustomFont) allowed.add(font.familyName);
  }
  await page.evaluate((remove) => remove(), removeProbe);
  const track = [], samples = [], canvasTexts = new Set();
  for (let frame = 0; frame < frameCount; frame++) {
    const isQa = qaFrames.has(frame);
    await stage.step(frame, isQa);
    if (!isQa && frame % trackStep !== 0) continue;
    const runs = await page.evaluate(() => window.__litQa.runs());
    if (frame % trackStep === 0) track.push({ frame, runs: runs.map(({ text, norm, rects, opacity, decor, kind }) => ({ text, norm, rects, opacity, decor, kind })) });
    if (!isQa) continue;
    for (const text of await page.evaluate(() => window.__litQa.canvasTexts())) canvasTexts.add(text);
    const a = await stage.capture();
    await page.evaluate(() => { window.__litQa.snapshot(); window.__litQa.hide(); window.__litQa.cancelNew(); return window.__litQa.settle(); });
    const b = await stage.capture();
    await page.evaluate(() => { window.__litQa.show(); window.__litQa.cancelNew(); });
    let fonts = null;
    if (mids.has(frame)) {
      const marks = await page.evaluate(async () => { const list = window.__litQa.markFonts(); document.body.offsetHeight; await window.__litQa.settle(); return list; });
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const byMark = new Map();
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-lit-qa-run]" });
      for (const nodeId of nodeIds) {
        const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
        const mark = attributes[attributes.indexOf("data-lit-qa-run") + 1];
        byMark.set(mark, (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map((font) => font.familyName));
      }
      fonts = marks.map((list) => [...new Set(list.flatMap((mark) => byMark.get(mark) ?? []))]);
      await page.evaluate(() => window.__litQa.unmarkFonts());
    }
    const row = byFrame.get(frame);
    samples.push({ frame, beat: row.beat, mid: row.mid, cut: row.cut === true, runs, a, b, fonts });
  }
  return { track, samples, trackStep, allowed: [...allowed], canvasTexts: [...canvasTexts] };
}

const inkIn = (diff, width, height, rects) => {
  let n = 0;
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) if (diff[y * width + x]) n += 1;
  }
  return n;
};

// [r, g, b] of a CSS colour string (rgb(), rgba() or #hex), or null.
export function parseCssColour(value) {
  const text = String(value ?? "").trim();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/u.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{6})$/iu.exec(text);
  return hex ? [0, 2, 4].map((i) => Number.parseInt(hex[1].slice(i, i + 2), 16)) : null;
}

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlapArea = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

// The house-style rules on the collected samples, as gate rows. Text over text: any two visible,
// non-decor runs sharing more than 8 % of the smaller box, at the QA samples and across the cuts. For
// copy that is settled: the style's colours, faces and type scale, and the shot's type zone.
// Each sample is { frame, beat, cut, runs: [{ text, kind, copy, decor, settled, color, family, fontSizePx, gradient, box }] }.
export function judgeStyle({ treatment, width, height, samples }) {
  const style = readStyle(treatment.style);
  const format = width >= height ? "16:9" : "9:16";
  const colours = styleTextColors(style).map(parseCssColour);
  const families = styleFamilies(style);
  const overlaps = [], offColour = [], offFace = [], offScale = [], offScaleOther = [], offZone = [];
  const tolX = width * ZONE_TOLERANCE, tolY = height * ZONE_TOLERANCE;
  for (const sample of samples) {
    const visible = sample.runs.filter((run) => run.box && !run.decor);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (overlapArea(a.box, b.box) > qaLimits.overlapShare * Math.min(area(a.box), area(b.box))) overlaps.push(`"${a.text.slice(0, 24)}" x "${b.text.slice(0, 24)}"@${sample.frame}${sample.cut ? " (cut)" : ""}`);
    }
    if (sample.cut) continue;
    const beat = treatment.beats[sample.beat];
    const layout = beat?.layout ? LAYOUTS[format][beat.layout] : null;
    for (const run of sample.runs) {
      if (run.kind === "canvas" || !run.settled || !run.box) continue;
      const where = `"${run.text.slice(0, 32)}"@${sample.frame}`;
      if (run.copy) {
        const rgb = parseCssColour(run.color);
        if (!run.gradient && rgb && !colours.some((c) => Math.hypot(c[0] - rgb[0], c[1] - rgb[1], c[2] - rgb[2]) <= qaLimits.colourDistance)) offColour.push(`${where} ${run.color}`);
        if (run.family && !families.has(run.family)) offFace.push(`${where} ${run.family}`);
      }
      if (run.fontSizePx && !scaleStep(style, format, run.fontSizePx)) (run.copy ? offScale : offScaleOther).push(`${where} ${Math.round(run.fontSizePx)}px`);
      if (run.copy && layout) {
        const z = layout.type;
        if (!z) offZone.push(`${where} in a full shot (no copy zone)`);
        else {
          const [zx, zy, zw, zh] = [z[0] * width, z[1] * height, z[2] * width, z[3] * height];
          if (run.box[0] < zx - tolX || run.box[1] < zy - tolY || run.box[2] > zx + zw + tolX || run.box[3] > zy + zh + tolY) offZone.push(`${where} outside the ${beat.layout} type zone`);
        }
      }
    }
  }
  const list = (items) => `${items.slice(0, 3).join(", ")}${items.length > 3 ? ` (+${items.length - 3} more)` : ""}`;
  const steps = Object.entries(style.scale[format]).map(([k, v]) => `${k} ${v}`).join(", ");
  const styleFails = [
    offColour.length ? `colour off the ${style.id} text roles (${style.textRoles.join(", ")}): ${list(offColour)}` : null,
    offFace.length ? `face outside the style (${[...families].join(", ")}): ${list(offFace)}` : null,
    offScale.length ? `size off the type scale (${steps} px, +-4 %): ${list(offScale)}` : null
  ].filter(Boolean);
  return {
    "TEXT-OVERLAP": overlaps.length ? { pass: false, detail: `text over text: ${list(overlaps)}` } : { pass: true, detail: `no two visible text runs overlap at the QA samples${samples.some((s) => s.cut) ? " or across the cuts" : ""}` },
    "TEXT-ON-STYLE": styleFails.length ? { pass: false, detail: styleFails.join("; ") }
      : offScaleOther.length ? { pass: false, warn: true, detail: `copy is on the ${style.id} style; other text off the scale: ${list(offScaleOther)}` }
        : { pass: true, detail: `copy uses the ${style.id} colours, faces and type scale` },
    "TEXT-ZONE": offZone.length ? { pass: false, detail: list(offZone) } : { pass: true, detail: "every settled copy run sits in its shot's type zone" }
  };
}

// RICH-FILL: at each shot's midpoint the frame is cut into 4 x 3 regions, and a region under 0.15 busy
// share is empty. A rich film leaves at most 2 of the 12 empty in all but one shot (the end card may
// breathe). A minimal film is exempt: negative space is its point.
export function richFill({ treatment, mids }) {
  if (registerOf(treatment) === "minimal") return { pass: true, na: true, detail: "minimal register: negative space is the point" };
  const measured = mids.filter((sample) => Array.isArray(sample.regions));
  if (!measured.length) return { pass: true, na: true, detail: "region fill not measured" };
  const thin = measured.map((sample) => ({ beat: sample.beat, empty: sample.regions.filter((value) => value < qaLimits.emptyRegion).length })).filter((shot) => shot.empty > qaLimits.emptyRegionsMax);
  if (thin.length <= 1) return { pass: true, detail: `${measured.length - thin.length} of ${measured.length} shot midpoints fill the frame (at most ${qaLimits.emptyRegionsMax} of 12 regions empty${thin.length ? `; shot ${thin[0].beat + 1} may breathe` : ""})` };
  return { pass: false, detail: `${thin.length} of ${measured.length} shot midpoints leave the frame empty: ${thin.map((shot) => `shot ${shot.beat + 1} has ${shot.empty} of 12 regions empty`).join(", ")} (a rich film fills the frame: more drawing, more labels, a layer behind the subject)` };
}

// Turns the captures into gate rows. Copy runs (their text holds a copy line) FAIL; decor runs WARN.
export function analyseQa(raw, context) {
  const { width, height, fps, treatment } = context;
  const copyLines = treatment.copy.lines.map((line) => ({ line, norm: normalize(line) }));
  const isCopy = (run) => copyLines.some((copy) => run.norm.includes(copy.norm));
  const safe = titleSafeBox(width, height);
  const shortSide = Math.min(width, height);
  const request = normalize(withoutQuotes(treatment.request)), idea = normalize(treatment.idea);
  const fails = { contrast: [], safe: [], floor: [], decor: [], fonts: [] };
  const warns = { contrast: [], moved: [], meta: new Set(), canvas: [], fonts: [], presence: null };
  const seenVisible = new Set();
  const trackByFrame = new Map(raw.track.map((entry) => [entry.frame, entry]));
  let presenceHits = 0, presenceMids = 0;
  const judged = [];
  const styleSamples = [];
  const fillSamples = [];
  for (const sample of raw.samples) {
    const A = rgbaOf(sample.a), B = rgbaOf(sample.b);
    if (sample.mid) fillSamples.push({ beat: sample.beat, regions: regionFill(A, width, height) });
    const grow = (run) => Math.max(2, 0.2 * run.fontSize * run.scale);
    const textRects = sample.runs.flatMap((run) => run.rects.map(([x0, y0, x1, y1]) => [x0 - grow(run), y0 - grow(run), x1 + grow(run), y1 + grow(run)]));
    const inText = (x, y) => textRects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
    const diff = new Uint8Array(width * height);
    let outside = 0;
    for (let p = 0, i = 0; p < diff.length; p++, i += 4) {
      if (Math.abs(A[i] - B[i]) > qaLimits.inkDelta || Math.abs(A[i + 1] - B[i + 1]) > qaLimits.inkDelta || Math.abs(A[i + 2] - B[i + 2]) > qaLimits.inkDelta) {
        diff[p] = 255;
        if (!inText(p % width, Math.floor(p / width))) outside += 1;
      }
    }
    if (sample.cut) {
      // A shot change in flight: only the text-over-text check reads it (judgeStyle).
      if (outside > 0) continue;
      const runs = [];
      for (const run of sample.runs) {
        if (run.kind === "canvas" || run.decor || run.opacity < qaLimits.visibleOpacity || !onScreen(run.rects, width, height)) continue;
        if (inkIn(diff, width, height, run.rects) < qaLimits.minInkPixels) continue;
        runs.push({ text: run.text, kind: run.kind, copy: isCopy(run), decor: false, settled: false, box: union(run.rects) });
      }
      styleSamples.push({ frame: sample.frame, beat: sample.beat, cut: true, runs });
      continue;
    }
    if (sample.mid) {
      presenceMids += 1;
      let n = 0, sum = 0, sumSq = 0;
      for (let p = 0, i = 0; p < diff.length; p += 7, i += 28) {
        if (inText(p % width, Math.floor(p / width))) continue;
        const l = 0.2126 * linearLut[B[i]] + 0.7152 * linearLut[B[i + 1]] + 0.0722 * linearLut[B[i + 2]];
        n += 1; sum += l; sumSq += l * l;
      }
      if (n && Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2)) > qaLimits.presenceStd) presenceHits += 1;
    }
    if (outside > 0) { warns.moved.push(`frame ${sample.frame}: ${outside} pixels changed outside the text (state moved; sample discarded)`); continue; }
    let visibleArea = 0, decorArea = 0;
    const styleRuns = [];
    sample.runs.forEach((run, index) => {
      if (run.kind === "canvas") { if (run.opacity >= qaLimits.visibleOpacity && onScreen(run.rects, width, height)) seenVisible.add(run.norm); return; }
      const mask = new Uint8Array(width * height);
      let ink = 0;
      for (const [x0, y0, x1, y1] of run.rects) {
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
          const p = y * width + x;
          if (diff[p] && !mask[p]) { mask[p] = 255; ink += 1; }
        }
      }
      const visible = run.opacity >= qaLimits.visibleOpacity && onScreen(run.rects, width, height) && ink >= qaLimits.minInkPixels;
      if (!visible) return;
      seenVisible.add(run.norm);
      const box = union(run.rects);
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      visibleArea += area;
      if (run.decor) decorArea += area;
      const copy = isCopy(run);
      if (run.decor && copy) fails.decor.push(`decor text "${run.text}" carries a copy line at frame ${sample.frame}`);
      if (copy && !run.decor && run.rects.some(([x0, y0, x1, y1]) => x0 < safe[0] - 0.5 || y0 < safe[1] - 0.5 || x1 > safe[2] + 0.5 || y1 > safe[3] + 0.5)) fails.safe.push(`"${run.text}" leaves the central 90 % at frame ${sample.frame}`);
      if (sample.fonts) {
        const faces = sample.fonts[index] ?? [];
        const foreign = faces.filter((face) => !raw.allowed.includes(face));
        if (foreign.length) (copy && !run.decor ? fails.fonts : warns.fonts).push(`"${run.text}" draws with ${foreign.join(", ")} at frame ${sample.frame}`);
      }
      // Settled: the box moved less than 2 px against the neighbouring 1/10 s samples, opacity >= 0.95.
      const key = keyOf(run, width, height);
      const neighbours = [sample.frame - raw.trackStep, sample.frame + raw.trackStep].map((f) => trackByFrame.get(Math.round(f / raw.trackStep) * raw.trackStep)).filter(Boolean);
      const settled = run.opacity >= qaLimits.judgedOpacity && neighbours.length > 0 && neighbours.every((entry) => {
        const match = entry.runs.find((other) => keyOf(other, width, height) === key);
        const mine = union(run.rects), theirs = match ? union(match.rects) : null;
        return theirs && mine.every((v, k) => Math.abs(v - theirs[k]) < qaLimits.settledPx);
      });
      styleRuns.push({ text: run.text, kind: run.kind, copy, decor: run.decor, settled, color: run.color, family: run.family, fontSizePx: run.fontSize * run.scale, gradient: run.gradient, box });
      if (!settled) return;
      const sizePx = run.fontSize * run.scale;
      const measured = boxContrast(A, mask, width, height, { bbox: box, capHeightPx: sizePx, fill: run.gradient ? "gradient" : "solid", fontSizePx: sizePx, weight: run.weight }, shortSide / 1080, sizePx >= qaLimits.largeShare * shortSide);
      if (!measured) return;
      judged.push({ frame: sample.frame, text: run.text, ratio: Number(measured.ratio.toFixed(2)), floor: measured.floor, copy, decor: run.decor });
      if (measured.ratio < measured.floor) (copy && !run.decor ? fails.contrast : warns.contrast).push(`"${run.text}" at frame ${sample.frame}: ${measured.ratio.toFixed(2)}:1 < ${measured.floor}:1`);
    });
    styleSamples.push({ frame: sample.frame, beat: sample.beat, cut: false, runs: styleRuns });
    if (visibleArea > 0 && decorArea / visibleArea > qaLimits.decorShare) fails.decor.push(`decor text covers ${Math.round((100 * decorArea) / visibleArea)} % of the visible text at frame ${sample.frame}`);
  }
  // The 1/10 s track: visible copy runs for the reading floor, and every run for the meta-label lint.
  const stepSec = raw.trackStep / fps;
  for (const copy of copyLines) {
    let run = 0, longest = 0;
    for (const entry of raw.track) {
      const shown = entry.runs.some((r) => r.norm.includes(copy.norm) && r.opacity >= qaLimits.visibleOpacity && onScreen(r.rects, width, height));
      if (shown) seenVisible.add(copy.norm);
      run = shown ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const floor = readingFloor(copy.line, "line");
    if (longest > 0 && longest * stepSec < floor - qaLimits.floorTolerance) fails.floor.push(`"${copy.line}" is readable for ${(longest * stepSec).toFixed(1)} s; its floor is ${floor.toFixed(2)} s`);
  }
  for (const entry of raw.track) for (const run of entry.runs) {
    if (!run.norm || run.opacity < qaLimits.visibleOpacity) continue;
    if ((request.length >= 4 && (run.norm === request || run.norm.includes(request))) || (idea.length >= 4 && run.norm.includes(idea)) || fileName.test(run.text) || internalTerms.test(run.text)) warns.meta.add(`"${run.text}"`);
  }
  const registered = new Set(raw.samples.flatMap((sample) => sample.runs.filter((run) => run.kind === "canvas").map((run) => run.norm)));
  for (const text of raw.canvasTexts) if (text.trim() && !registered.has(normalize(text))) warns.canvas.push(`"${text}"`);
  if (presenceMids > 0 && presenceHits * 2 < presenceMids) warns.presence = `only ${presenceHits} of ${presenceMids} beat midpoints show structure outside the text once the words are hidden`;
  const missing = copyLines.filter((copy) => ![...seenVisible].some((norm) => norm.includes(copy.norm))).map((copy) => copy.line);
  const row = (list, pass) => (list.length ? { pass: false, detail: `${list.slice(0, 3).join("; ")}${list.length > 3 ? ` (+${list.length - 3} more)` : ""}` } : { pass: true, detail: pass });
  const warnRow = (list, label) => (list.length ? { pass: false, warn: true, detail: `${label}: ${[...list].slice(0, 3).join("; ")}` } : null);
  const checks = {
    "TEXT-copy-found": missing.length ? { pass: false, detail: `never on screen: ${missing.map((line) => `"${line}"`).join(", ")}` } : { pass: true, detail: `${copyLines.length} copy line(s) found on screen` },
    "TEXT-contrast": row(fails.contrast, `${judged.filter((j) => j.copy).length} settled copy measurements at or above 4.5:1 (3:1 large)`),
    "TEXT-title-safe": row(fails.safe, "copy inside the central 90 %"),
    "TEXT-reading-floor": row(fails.floor, "every copy line holds its reading floor"),
    "TEXT-decor": row(fails.decor, "decor text carries no copy and stays under 25 % of the text"),
    "TEXT-fonts": row(fails.fonts, `copy draws only with ${raw.allowed.join(", ")}`)
  };
  const used = context.stageDir ? assetUsed(treatment, context.stageDir) : null;
  if (used) checks["ASSET-USED"] = used;
  if (treatment.path === "stage") checks["RICH-FILL"] = richFill({ treatment, mids: fillSamples });
  if (treatment.style) Object.assign(checks, judgeStyle({ treatment, width, height, samples: styleSamples }));
  for (const [id, value] of Object.entries({ "TEXT-decor-contrast": warnRow(warns.contrast, "decor contrast"), "TEXT-moved": warnRow(warns.moved, "samples discarded"), "TEXT-meta-labels": warnRow([...warns.meta], "request, idea, file name or internal term on screen"),
    "TEXT-canvas": warnRow(warns.canvas, "canvas text not measured"), "TEXT-decor-fonts": warnRow(warns.fonts, "decor fonts"), "TEXT-presence": warns.presence ? { pass: false, warn: true, detail: warns.presence } : null })) if (value) checks[id] = value;
  return { checks, missing, judged, samples: raw.samples.map((sample) => ({ frame: sample.frame, mid: sample.mid, runs: sample.runs.length })), trackFrames: raw.track.length, allowedFaces: raw.allowed };
}
