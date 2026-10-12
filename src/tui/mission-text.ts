// Terminal layout for the mission chip, the boxed sidebar panel and the home line: cell widths
// (Hangul and emoji take two cells), truncation, the gradient bar, and the coloured segments the TUI
// renders as spans. Every frame of motion is drawn from a MotionFrame, so all of it is testable here.
import { ease, mixHex, rowEntryStart, seg, slideIn, motionTiming, type MotionFrame } from "./mission-motion.ts";
import { missionRowKeys, missionStatus, type MissionStep, type MissionView, type StepState } from "./mission-model.ts";

export type Segment = { readonly text: string; readonly fg: string; readonly bg?: string; readonly bold?: boolean };
export type Line = readonly Segment[];

export type MissionPalette = {
  readonly primary: string;
  readonly accent: string;
  readonly info: string;
  readonly warning: string;
  readonly success: string;
  readonly error: string;
  readonly text: string;
  readonly muted: string;
  readonly borderActive: string;
  readonly borderSubtle: string;
  /** Opaque fills only; undefined when the theme leaves that surface transparent. */
  readonly background?: string;
  readonly panel?: string;
  readonly element?: string;
  /** What fades and tints mix toward: the panel, else the background, else a neutral for the mode. */
  readonly mixBase: string;
  /** Text drawn on a filled pill. */
  readonly onFill: string;
};

/** Panel box width in cells, and the content width inside its border and one cell of padding per side. */
export const panelWidth = 36;
export const panelInnerWidth = panelWidth - 4;

type ColorRead = { readonly hex: string; readonly alpha: number };

function readColor(value: unknown): ColorRead | undefined {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value)) return { hex: value.toLowerCase(), alpha: 1 };
  if (typeof value !== "object" || value === null) return undefined;
  const color = value as { toInts?: () => readonly number[]; r?: unknown; g?: unknown; b?: unknown; a?: unknown };
  let channels: readonly number[] | undefined;
  let alpha = 1;
  if (typeof color.toInts === "function") {
    const ints = color.toInts();
    channels = ints.slice(0, 3);
    if (typeof ints[3] === "number") alpha = ints[3] / 255;
  } else if (typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
    channels = [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
    if (typeof color.a === "number") alpha = color.a;
  }
  if (channels === undefined || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return undefined;
  return { hex: "#" + channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join(""), alpha };
}

/** Theme tokens arrive as RGBA objects; plain hex strings pass through. Alpha is ignored here. */
export function colorToHex(value: unknown, fallback: string): string {
  return readColor(value)?.hex ?? fallback;
}

/**
 * Builds the palette from `api.theme.current`. A surface token with alpha 0 (the system and
 * lucent-orng themes) means "draw no background", never black.
 */
export function paletteFromTheme(theme: Record<string, unknown> | undefined, mode: "dark" | "light" = "dark"): MissionPalette {
  const pick = (key: string, fallback: string): string => colorToHex(theme?.[key], fallback);
  const surface = (key: string): string | undefined => {
    const color = readColor(theme?.[key]);
    return color === undefined || color.alpha === 0 ? undefined : color.hex;
  };
  const background = surface("background");
  const panel = surface("backgroundPanel");
  const element = surface("backgroundElement");
  const neutral = mode === "light" ? "#f2f2f2" : "#1c1c1c";
  return {
    primary: pick("primary", "#ff6337"),
    accent: pick("accent", "#b48cff"),
    info: pick("info", "#0aa6c2"),
    warning: pick("warning", "#ffaf3c"),
    success: pick("success", "#6bdb8f"),
    error: pick("error", "#ff5f5f"),
    text: pick("text", "#e6edf3"),
    muted: pick("textMuted", "#7d8590"),
    borderActive: pick("borderActive", "#484f58"),
    borderSubtle: pick("borderSubtle", "#2a313b"),
    ...(background === undefined ? {} : { background }),
    ...(panel === undefined ? {} : { panel }),
    ...(element === undefined ? {} : { element }),
    mixBase: panel ?? background ?? neutral,
    onFill: background ?? panel ?? (mode === "light" ? "#ffffff" : "#0b0b0b")
  };
}

/**
 * Columns the prompt row leaves for the chip. OpenCode shows the sidebar when the session is not a
 * child, the stored `sidebar` setting is "auto" and the terminal is wider than 120 columns. An unknown
 * setting is treated as open, the narrower and safe guess.
 */
export function chipBudget(input: { readonly width: number; readonly sidebar: string | undefined; readonly child: boolean }): number {
  const sidebarOpen = !input.child && input.sidebar !== "hide" && input.width > 120;
  return input.width - (sidebarOpen ? 42 : 0) - 4 - 42;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function isZeroWidth(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x1160 && code <= 0x11ff);
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || isZeroWidth(code)) return 0;
  return isWide(code) ? 2 : 1;
}

export function cellWidth(value: string): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

/** Cuts `value` to at most `max` cells, ending in an ellipsis when anything was dropped. */
export function truncateCells(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  if (cellWidth(clean) <= max) return clean;
  if (max <= 0) return "";
  let out = "";
  let width = 0;
  for (const char of clean) {
    const next = charWidth(char);
    if (width + next > max - 1) break;
    out += char;
    width += next;
  }
  return out + "…";
}

export function padCells(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - cellWidth(value)));
}

export function lineWidth(line: Line): number {
  return line.reduce((total, segment) => total + cellWidth(segment.text), 0);
}

export function gradientAt(stops: readonly string[], position: number): string {
  if (stops.length === 0) return "#ffffff";
  if (stops.length === 1) return stops[0];
  const scaled = Math.max(0, Math.min(1, position)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return mixHex(stops[index], stops[index + 1], scaled - index);
}

/** A light pass along a row: `sweep` is its centre in 0..1 of the row, or negative when off. */
export function shine(color: string, palette: MissionPalette, position: number, sweep: number, reach: number): string {
  if (sweep < 0) return color;
  const distance = Math.abs(position - sweep);
  return distance < reach ? mixHex(color, palette.text, (1 - distance / reach) * 0.75) : color;
}

export function shimmerAt(frame: MotionFrame): number {
  const t = frame.celebrate;
  if (t === undefined || t < motionTiming.shimmerAt || t > motionTiming.shimmerAt + motionTiming.shimmer) return -1;
  return -0.2 + 1.4 * seg(t, motionTiming.shimmerAt, motionTiming.shimmer);
}

const eighths = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/**
 * A bar of `cells` cells filled to `ratio` with eighth-cell blocks, each cell its own step of the
 * primary-to-accent gradient. The empty track is a thin muted rule, never a dither.
 */
export function progressBar(ratio: number, cells: number, palette: MissionPalette, sweep = -1): Segment[] {
  const clamped = Math.max(0, Math.min(1, ratio));
  const exact = clamped * cells;
  let full = Math.floor(exact);
  let partial = Math.round((exact - full) * 8);
  if (partial === 8) {
    full += 1;
    partial = 0;
  }
  const stops = [palette.primary, palette.accent];
  const color = (index: number): string => {
    const position = cells <= 1 ? 0 : index / (cells - 1);
    return shine(gradientAt(stops, position), palette, position, sweep, 0.18);
  };
  const segments: Segment[] = [];
  let used = Math.min(full, cells);
  for (let index = 0; index < used; index += 1) segments.push({ text: "█", fg: color(index) });
  if (partial > 0 && used < cells) {
    segments.push({ text: eighths[partial], fg: color(used) });
    used += 1;
  }
  if (used < cells) segments.push({ text: "─".repeat(cells - used), fg: palette.borderSubtle });
  return segments;
}

function microBar(ratio: number, palette: MissionPalette): Segment[] {
  const filled = Math.max(0, Math.min(5, Math.round(Math.max(0, Math.min(1, ratio)) * 5)));
  const segments: Segment[] = [];
  for (let index = 0; index < 5; index += 1) {
    segments.push(index < filled ? { text: "▰", fg: gradientAt([palette.primary, palette.accent], index / 4) } : { text: "▱", fg: palette.borderSubtle });
  }
  return segments;
}

function countText(view: MissionView): string {
  return view.progress === undefined ? "" : `${view.progress.done}/${view.progress.total}`;
}

/** The step state to draw: during the completion moment WORK and REVIEW flip to done one after the other. */
function shownState(step: MissionStep, view: MissionView, frame: MotionFrame): { readonly state: StepState; readonly doneMix: number } {
  const t = frame.celebrate;
  if (t === undefined || step.state !== "done" || step.id === "plan") return { state: step.state, doneMix: step.state === "done" ? 1 : 0 };
  const at = step.id === "work" ? motionTiming.workDoneAt : motionTiming.reviewDoneAt;
  const mix = ease.inOutCubic(seg(t, at, motionTiming.crossfade));
  if (t < at) return { state: step.id === "work" ? "now" : "todo", doneMix: 0 };
  return { state: "done", doneMix: mix };
}

type PillStyle = { readonly fg: string; readonly bg?: string; readonly bold: boolean };

function pillStyle(state: StepState, palette: MissionPalette, warn: number): PillStyle {
  if (state === "done") return { fg: palette.success, bg: mixHex(palette.success, palette.background ?? palette.mixBase, 0.72), bold: false };
  if (state === "todo" || state === "skip") return { fg: palette.muted, ...(palette.panel === undefined ? {} : { bg: palette.panel }), bold: false };
  const level = state === "warn" ? Math.max(warn, 0.5) : warn;
  return { fg: palette.onFill, bg: mixHex(palette.info, palette.warning, level), bold: true };
}

function blendStyle(from: PillStyle, to: PillStyle, amount: number, palette: MissionPalette): PillStyle {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const bgFrom = from.bg ?? palette.mixBase;
  const bgTo = to.bg ?? palette.mixBase;
  return { fg: mixHex(from.fg, to.fg, amount), bg: mixHex(bgFrom, bgTo, amount), bold: amount < 0.5 ? from.bold : to.bold };
}

function stepLabel(step: MissionStep, state: StepState, view: MissionView): string {
  const name = step.id.toUpperCase();
  const count = step.id === "work" && view.progress !== undefined ? countText(view) : "";
  if (state === "done") return [name, count, "✓"].filter((part) => part !== "").join(" ");
  if (state === "skip") return `${name} –`;
  if (state === "warn") return [name, "⚑", count].filter((part) => part !== "").join(" ");
  return [name, state === "now" ? count : ""].filter((part) => part !== "").join(" ");
}

export function stepPill(step: MissionStep, view: MissionView, frame: MotionFrame, palette: MissionPalette): Segment {
  const { state, doneMix } = shownState(step, view, frame);
  const before = pillStyle(step.id === "work" ? "now" : "todo", palette, frame.warn);
  const style = state === "done" && doneMix < 1 ? blendStyle(before, pillStyle("done", palette, frame.warn), doneMix, palette) : pillStyle(state, palette, frame.warn);
  return { text: ` ${stepLabel(step, state, view)} `, fg: style.fg, ...(style.bg === undefined ? {} : { bg: style.bg }), bold: style.bold };
}

function brandPill(palette: MissionPalette, sweep: number): Segment[] {
  const chars = [" ", "🔥", " ", "L", "I", "T", " "];
  return chars.map((char, index) => ({ text: char, fg: palette.onFill, bg: shine(palette.primary, palette, index / (chars.length - 1), sweep, 0.3), bold: true }));
}

export type ChipTier = "full" | "medium" | "tight";

export type ChipGroup = readonly Segment[];

/** The chip's pill groups for a tier; the five-segment bar is appended unless `withMicroBar` is false. */
export function chipGroups(view: MissionView, frame: MotionFrame, palette: MissionPalette, tier: ChipTier, withMicroBar = true): ChipGroup[] {
  const sweep = shimmerAt(frame);
  const space: Segment = { text: " ", fg: palette.muted };
  const separator: Segment = { text: " › ", fg: palette.borderActive };
  const flame: Segment = { text: "🔥", fg: palette.text };
  const groups: ChipGroup[] = [];
  if (tier === "full") {
    groups.push(brandPill(palette, sweep));
    view.steps.forEach((step, index) => groups.push([index === 0 ? space : separator, stepPill(step, view, frame, palette)]));
  } else if (tier === "medium") {
    groups.push([flame]);
    const current = view.steps.findIndex((step) => step.state === "now" || step.state === "warn");
    const from = current >= 0 ? current : view.complete ? 1 : 0;
    view.steps.slice(from, from + 2).forEach((step, index) => groups.push([index === 0 ? space : separator, stepPill(step, view, frame, palette)]));
  } else {
    groups.push([flame]);
    const current = view.steps.find((step) => step.state === "now" || step.state === "warn") ?? view.steps[1];
    const count = countText(view);
    const done = view.complete && (frame.celebrate === undefined || frame.celebrate >= motionTiming.workDoneAt);
    const value = done ? `✓ ${count}`.trim() : current.state === "warn" ? `⚑ ${count}`.trim() : count || current.id.toUpperCase();
    const style = pillStyle(done ? "done" : current.state === "warn" ? "warn" : "now", palette, frame.warn);
    groups.push([space, { text: ` ${value} `, fg: style.fg, ...(style.bg === undefined ? {} : { bg: style.bg }), bold: style.bold }]);
  }
  if (withMicroBar && view.progress !== undefined) groups.push([space, ...microBar(frame.barRatio, palette)]);
  return groups;
}

export function groupsWidth(groups: readonly ChipGroup[]): number {
  return groups.reduce((total, group) => total + lineWidth(group), 0);
}

export function fade(segment: Segment, alpha: number, palette: MissionPalette): Segment {
  if (alpha >= 1) return segment;
  return {
    ...segment,
    fg: mixHex(palette.mixBase, segment.fg, alpha),
    ...(segment.bg === undefined ? {} : { bg: mixHex(palette.mixBase, segment.bg, alpha) })
  };
}

const sparkGlyphs = ["·", "✦", "✧", "˚"];
const chipSparks = [
  { at: 4, start: 220, color: "warning" },
  { at: 1, start: 300, color: "primary" },
  { at: 5, start: 380, color: "accent" },
  { at: 2, start: 470, color: "primary" }
] as const;
const chipSparkLife = 420;
export const chipSparkWidth = 7;

export function chipSparkCells(t: number, palette: MissionPalette): Segment[] | undefined {
  const last = chipSparks[chipSparks.length - 1].start + chipSparkLife;
  if (t > last) return undefined;
  const cells: Segment[] = Array.from({ length: chipSparkWidth }, () => ({ text: " ", fg: palette.muted }));
  for (const spark of chipSparks) {
    if (t < spark.start || t > spark.start + chipSparkLife) continue;
    const life = (t - spark.start) / chipSparkLife;
    cells[spark.at] = { text: sparkGlyphs[Math.min(3, Math.floor(life * 4))], fg: mixHex(palette.mixBase, palette[spark.color], Math.sin(Math.PI * life)) };
  }
  return cells;
}

export function chipTier(view: MissionView, frame: MotionFrame, palette: MissionPalette, budget: number): ChipTier {
  for (const tier of ["full", "medium"] as const) {
    if (groupsWidth(chipGroups(view, frame, palette, tier)) <= budget) return tier;
  }
  return "tight";
}

/**
 * The phase chip on the right of the prompt's agent/model row: `🔥 LIT` `PLAN` › `WORK n/m` › `REVIEW`
 * and a five-segment bar, shedding labels before values as `budget` shrinks. Idle sessions render nothing.
 */
export function chipLine(view: MissionView, frame: MotionFrame, palette: MissionPalette, budget: number): Line {
  if (!view.active) return [];
  const tier = chipTier(view, frame, palette, budget);
  const groups = chipGroups(view, frame, palette, tier);
  const out: Segment[] = [];
  if (frame.celebrate !== undefined && groupsWidth(groups) + chipSparkWidth <= budget) out.push(...(chipSparkCells(frame.celebrate, palette) ?? []));
  groups.forEach((group, index) => {
    const start = index * motionTiming.stagger;
    const alpha = frame.chipEnter ? ease.outCubic(seg(frame.t, start, motionTiming.entry)) : 1;
    for (const segment of group) out.push(fade(segment, alpha, palette));
  });
  return out;
}

// The tiny LIT, drawn as text so each column takes its own colour from the warning-primary-accent ramp.
const logoRows = ["█   █ ▀█▀", "█▄▄ █  █ "] as const;
const logoWidth = 9;

function logoLine(row: 0 | 1, palette: MissionPalette, sweep: number): Segment[] {
  const stops = [palette.warning, palette.primary, palette.accent];
  return [...logoRows[row]].map((char, index) => {
    const position = index / (logoWidth - 1);
    return { text: char, fg: shine(gradientAt(stops, position), palette, position, sweep, 0.3), bold: true };
  });
}

/** The header status: a glyph and words, or the COMPLETE badge that pops in and settles to green text. */
export function statusSegments(view: MissionView, frame: MotionFrame, palette: MissionPalette): { readonly segments: Segment[]; readonly offset: number } {
  const status = missionStatus(view);
  if (status.tone === "warning") {
    return { segments: [{ text: `${status.glyph} ${status.text}`, fg: mixHex(palette.info, palette.warning, Math.max(frame.warn, 0.5)), bold: true }], offset: 0 };
  }
  if (status.tone === "info") return { segments: [{ text: `${status.glyph} ${status.text}`, fg: palette.info }], offset: 0 };
  const t = frame.celebrate ?? Number.POSITIVE_INFINITY;
  if (t < motionTiming.popAt) {
    const alpha = 1 - ease.inOutCubic(seg(t, 0, motionTiming.crossfade));
    return { segments: [fade({ text: "● active", fg: palette.info }, alpha, palette)], offset: 0 };
  }
  const progress = seg(t, motionTiming.popAt, motionTiming.pop);
  // A filled pill pops in with an overshoot, holds, then settles to plain green text.
  const filled = 1 - ease.inOutCubic(seg(t, motionTiming.settleAt, motionTiming.crossfade));
  const pill: Segment = {
    text: " ✓ COMPLETE ",
    fg: mixHex(palette.success, palette.onFill, filled),
    ...(filled > 0 ? { bg: mixHex(palette.panel ?? palette.mixBase, palette.success, filled) } : {}),
    bold: true
  };
  return { segments: [fade(pill, progress <= 0 ? 0 : ease.outCubic(progress), palette)], offset: Math.max(-1, slideIn(progress)) };
}

function stepsRow(view: MissionView, frame: MotionFrame, palette: MissionPalette): Segment[] {
  const out: Segment[] = [];
  let previousDone = false;
  view.steps.forEach((step, index) => {
    const { state, doneMix } = shownState(step, view, frame);
    const live = mixHex(palette.info, palette.warning, state === "warn" ? Math.max(frame.warn, 0.5) : frame.warn);
    const color = state === "done" ? mixHex(step.id === "work" ? palette.info : palette.muted, palette.success, doneMix) : state === "now" || state === "warn" ? live : palette.muted;
    const glyph = state === "done" ? "✓" : state === "skip" ? "–" : state === "warn" ? "⚑" : state === "now" ? "●" : "○";
    if (index > 0) out.push({ text: " ── ", fg: previousDone ? palette.success : palette.borderSubtle });
    out.push({ text: `${glyph} ${step.id.toUpperCase()}`, fg: color, bold: state === "now" || state === "warn" });
    previousDone = state === "done";
  });
  return out;
}

function criterionSegment(id: string, status: string, palette: MissionPalette): Segment {
  if (status === "pass") return { text: `✓${id}`, fg: palette.success };
  if (status === "fail") return { text: `✗${id}`, fg: palette.error };
  if (status === "blocked") return { text: `⚑${id}`, fg: palette.warning };
  return { text: `○${id}`, fg: palette.muted };
}

function evidenceColor(kind: string, palette: MissionPalette): string {
  if (kind === "green" || kind === "scenario") return palette.success;
  if (kind === "red") return palette.error;
  if (kind === "checkpoint") return palette.accent;
  return palette.info;
}

type Cell = { text: string; fg: string; bg?: string; bold?: boolean; width: number };

function toCells(line: Line, width: number, palette: MissionPalette): Cell[] {
  const cells: Cell[] = [];
  for (const segment of line) {
    for (const char of segment.text) {
      const w = charWidth(char);
      if (w === 0 && cells.length > 0) {
        cells[cells.length - 1].text += char;
        continue;
      }
      cells.push({ text: char, fg: segment.fg, ...(segment.bg === undefined ? {} : { bg: segment.bg }), ...(segment.bold ? { bold: true } : {}), width: w });
    }
  }
  let used = cells.reduce((total, cell) => total + cell.width, 0);
  while (used < width) {
    cells.push({ text: " ", fg: palette.muted, width: 1 });
    used += 1;
  }
  return cells;
}

function fromCells(cells: readonly Cell[]): Segment[] {
  const out: Segment[] = [];
  for (const cell of cells) {
    const last = out[out.length - 1];
    if (last !== undefined && last.fg === cell.fg && last.bg === cell.bg && (last.bold ?? false) === (cell.bold ?? false)) {
      out[out.length - 1] = { ...last, text: last.text + cell.text };
    } else {
      out.push({ text: cell.text, fg: cell.fg, ...(cell.bg === undefined ? {} : { bg: cell.bg }), ...(cell.bold ? { bold: true } : {}) });
    }
  }
  return out;
}

/** Shifts a row right by `offset` cells and cuts it back to `width`, keeping wide glyphs whole. */
function shiftRow(line: Line, offset: number, width: number): Line {
  if (offset <= 0) return line;
  const shifted: Segment[] = [{ text: " ".repeat(offset), fg: line[0]?.fg ?? "#000000" }, ...line];
  const out: Segment[] = [];
  let used = 0;
  for (const segment of shifted) {
    const room = width - used;
    if (room <= 0) break;
    if (cellWidth(segment.text) <= room) {
      out.push(segment);
      used += cellWidth(segment.text);
      continue;
    }
    let text = "";
    let taken = 0;
    for (const char of segment.text) {
      const w = charWidth(char);
      if (taken + w > room) break;
      text += char;
      taken += w;
    }
    if (text !== "") out.push({ ...segment, text });
    break;
  }
  return out;
}

const embers = Array.from({ length: 18 }, (_unused, index) => {
  const rnd = (n: number): number => {
    const x = Math.sin(index * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    col: Math.floor(rnd(1) * panelInnerWidth),
    row: 2 + Math.floor(rnd(2) * 7),
    start: 200 + Math.floor(rnd(3) * 340),
    life: 400 + Math.floor(rnd(4) * 240),
    rise: 120 + Math.floor(rnd(5) * 80),
    drift: rnd(6) < 0.5 ? 0 : rnd(7) < 0.5 ? -1 : 1,
    color: (["warning", "primary", "accent"] as const)[index % 3]
  };
});

/** Embers rise through the empty cells of the panel during the completion moment and are gone by 1.2 s. */
function withEmbers(rows: Line[], t: number, palette: MissionPalette): Line[] {
  const grid = rows.map((row) => toCells(row, panelInnerWidth, palette));
  let touched = false;
  for (const ember of embers) {
    if (t < ember.start || t > ember.start + ember.life) continue;
    const life = (t - ember.start) / ember.life;
    const up = Math.floor((t - ember.start) / ember.rise);
    const row = ember.row - up;
    const col = ember.col + (up > 1 ? ember.drift : 0);
    if (row < 0 || row >= grid.length) continue;
    let x = 0;
    for (const cell of grid[row]) {
      if (x === col) {
        if (cell.text === " " && cell.width === 1) {
          cell.text = sparkGlyphs[Math.min(3, Math.floor(life * 4))];
          cell.fg = mixHex(palette.mixBase, palette[ember.color], Math.sin(Math.PI * life));
          touched = true;
        }
        break;
      }
      x += cell.width;
      if (x > col) break;
    }
  }
  return touched ? grid.map(fromCells) : rows;
}

export type MissionPanel = {
  readonly border: string;
  readonly title: string;
  readonly titleColor: string;
  readonly bottomTitle?: string;
  readonly background?: string;
  readonly rows: readonly Line[];
};

/**
 * The sidebar mission panel: a rounded box whose border carries the state (accent while working,
 * warning on a warning, success when complete), a tiny LIT header, the goal title, the phase line,
 * the bar, the next item, criteria, warnings and the evidence timeline. Rows are at most
 * `panelInnerWidth` cells.
 */
export function missionPanel(view: MissionView, frame: MotionFrame, palette: MissionPalette): MissionPanel | undefined {
  if (!view.active) return undefined;
  const width = panelInnerWidth;
  const sweep = shimmerAt(frame);
  const keys = missionRowKeys(view);
  const rows = new Map<string, Line>();

  rows.set("h1", [...logoLine(0, palette, sweep), { text: "  ", fg: palette.muted }, { text: truncateCells(view.discipline, width - logoWidth - 2), fg: palette.muted }]);
  const status = statusSegments(view, frame, palette);
  const statusStart = logoWidth + 2 + status.offset;
  rows.set("h2", [...logoLine(1, palette, sweep), { text: " ".repeat(Math.max(0, statusStart - logoWidth)), fg: palette.muted }, ...status.segments]);
  rows.set("b1", []);
  if (view.goal !== undefined) rows.set("title", [{ text: truncateCells(view.goal.title, width), fg: palette.text, bold: true }]);
  rows.set("steps", stepsRow(view, frame, palette));
  if (view.progress !== undefined) rows.set("bar", progressBar(frame.barRatio, width, palette, sweep));
  rows.set("b2", []);
  if (view.next !== undefined) rows.set("next", [{ text: "next ", fg: palette.muted }, { text: truncateCells(`▸ ${view.next}`, width - 5), fg: palette.text }]);
  if (view.goal !== undefined) {
    const criteria: Segment[] = [{ text: "crit", fg: palette.muted }];
    for (const criterion of view.goal.criteria) {
      criteria.push({ text: " ", fg: palette.muted }, criterionSegment(criterion.id, criterion.status, palette));
    }
    rows.set("crit", lineWidth(criteria) <= width ? criteria : [{ text: "crit ", fg: palette.muted }, { text: `${view.goal.passed}/${view.goal.total} pass`, fg: palette.muted }]);
  }
  for (const warning of view.warnings) {
    const color = warning.kind === "retry" ? mixHex(palette.warning, palette.error, 0.5) : palette.warning;
    rows.set(`warn:${warning.kind}:${warning.text}`, [{ text: "⚑ ", fg: color, bold: true }, { text: truncateCells(warning.text, width - 2), fg: color }]);
  }
  rows.set("b3", []);
  rows.set("evh", [{ text: "evidence ", fg: palette.muted }, { text: "─".repeat(width - 9), fg: palette.borderSubtle }]);
  view.timeline.forEach((event, index) => {
    const head = padCells(event.ago, 4) + " ";
    const kind = padCells(truncateCells(event.kind, 10), 10) + " ";
    rows.set(`ev${index}`, [
      { text: head, fg: palette.muted },
      { text: kind, fg: evidenceColor(event.kind, palette) },
      { text: truncateCells(event.label, Math.max(0, width - cellWidth(head) - cellWidth(kind))), fg: palette.muted }
    ]);
  });

  let lines: Line[] = keys.map((key) => {
    const row = rows.get(key) ?? [];
    const start = rowEntryStart(frame, key);
    if (start === undefined) return row;
    const duration = key.startsWith("warn:") ? motionTiming.noticeIn : motionTiming.entry;
    const progress = seg(frame.t, start, duration);
    if (progress <= 0) return [];
    const alpha = ease.outCubic(progress);
    return shiftRow(row.map((segment) => fade(segment, alpha, palette)), Math.max(0, slideIn(progress)), width);
  });
  if (frame.celebrate !== undefined) lines = withEmbers(lines, frame.celebrate, palette);

  const enter = frame.chipEnter ? ease.outCubic(seg(frame.t, 0, motionTiming.entry)) : 1;
  const done = view.complete ? (frame.celebrate === undefined ? 1 : ease.inOutCubic(seg(frame.celebrate, 0, motionTiming.crossfade))) : 0;
  const border = mixHex(palette.mixBase, mixHex(mixHex(palette.accent, palette.warning, frame.warn), palette.success, done), enter);
  const phase = view.complete ? "COMPLETE" : view.phase.toUpperCase();
  const flagged = view.warnings.length > 0 && !view.complete ? " ⚑" : "";
  const bottom = view.goal !== undefined
    ? ` ${view.goal.passed}/${view.goal.total} criteria${view.complete ? " ✓" : ""} `
    : view.progress !== undefined
      ? ` ${view.progress.done}/${view.progress.total} tasks${view.complete ? " ✓" : ""} `
      : undefined;
  return {
    border,
    title: ` 🔥 LIT ▸ ${phase}${flagged} `,
    titleColor: mixHex(palette.mixBase, palette.text, enter),
    ...(bottom === undefined ? {} : { bottomTitle: bottom }),
    ...(palette.panel === undefined ? {} : { background: palette.panel }),
    rows: lines
  };
}

export type LastMission = { readonly title: string; readonly passed: number; readonly total: number; readonly complete: boolean };

/** The home-screen line under the prompt: `🔥 lit ready · last: <goal> ✓ n/m`, labels shed first when narrow. */
export function homeLine(last: LastMission | undefined, palette: MissionPalette, budget: number): Line {
  if (last === undefined || last.title === "") return [];
  const mark: Segment = last.complete
    ? { text: ` ✓ ${last.passed}/${last.total}`, fg: palette.success }
    : { text: ` ● ${last.passed}/${last.total}`, fg: palette.info };
  const full: Segment[] = [
    { text: "🔥 ", fg: palette.text },
    { text: "lit", fg: palette.primary, bold: true },
    { text: " ready", fg: palette.text },
    { text: " · ", fg: palette.muted },
    { text: "last: ", fg: palette.muted },
    { text: last.title, fg: palette.text },
    mark
  ];
  if (lineWidth(full) <= budget) return full;
  const head: Segment[] = [{ text: "🔥 ", fg: palette.text }, { text: "lit", fg: palette.primary, bold: true }, { text: " · ", fg: palette.muted }];
  const room = Math.max(1, budget - lineWidth(head) - cellWidth(mark.text));
  return [...head, { text: truncateCells(last.title, room), fg: palette.text }, mark];
}
