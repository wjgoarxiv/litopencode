// Terminal layout for the mission chip, the boxed sidebar panel and the home line: cell widths
// (Hangul and emoji take two cells), truncation, the gradient bar, and the coloured segments the TUI
// renders as spans. Every frame of motion is drawn from a MotionFrame, so all of it is testable here.
import { ease, mixHex, rowEntryStart, seg, slideIn, motionTiming, type MotionFrame } from "./mission-motion.ts";
import { currentStepIndex, missionRowKeys, missionStatus, stepName, type MissionStep, type MissionView, type StepState } from "./mission-model.ts";

export type Segment = { readonly text: string; readonly fg: string; readonly bg?: string; readonly bold?: boolean };
export type Line = readonly Segment[];

export type MissionPalette = {
  readonly primary: string;
  readonly secondary: string;
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
    secondary: pick("secondary", "#ff2d95"),
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

/** The stage colour ramp: the theme's primary through secondary to accent, so every theme keeps its own feel. */
export function stageColor(index: number, count: number, palette: MissionPalette): string {
  return gradientAt([palette.primary, palette.secondary, palette.accent], count <= 1 ? 0 : index / (count - 1));
}

function microBar(ratio: number, palette: MissionPalette, cells = 5): Segment[] {
  const filled = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, ratio)) * cells)));
  const segments: Segment[] = [];
  for (let index = 0; index < cells; index += 1) {
    segments.push(index < filled ? { text: "▰", fg: gradientAt([palette.primary, palette.secondary, palette.accent], cells <= 1 ? 0 : index / (cells - 1)) } : { text: "▱", fg: palette.borderSubtle });
  }
  return segments;
}

function countText(view: MissionView): string {
  return view.progress === undefined ? "" : `${view.progress.done}/${view.progress.total}`;
}

/**
 * The step state to draw. During the completion moment the stage that was running and every stage
 * after it flip to done one after the other, 60 ms apart.
 */
function shownState(step: MissionStep, index: number, frame: MotionFrame): { readonly state: StepState; readonly doneMix: number } {
  const t = frame.celebrate;
  const from = frame.celebrateFrom;
  if (t === undefined || from === undefined || step.state !== "done" || index < from) return { state: step.state, doneMix: step.state === "done" ? 1 : 0 };
  const at = motionTiming.workDoneAt + (index - from) * (motionTiming.reviewDoneAt - motionTiming.workDoneAt);
  if (t < at) return { state: index === from ? "now" : "todo", doneMix: 0 };
  return { state: "done", doneMix: ease.inOutCubic(seg(t, at, motionTiming.crossfade)) };
}

type PillStyle = { readonly fg: string; readonly bg?: string; readonly bold: boolean };

function pillStyle(state: StepState, palette: MissionPalette, warn: number): PillStyle {
  if (state === "done") return { fg: palette.success, bg: mixHex(palette.success, palette.background ?? palette.mixBase, 0.72), bold: false };
  if (state === "todo" || state === "skip") return { fg: palette.muted, ...(palette.panel === undefined ? {} : { bg: palette.panel }), bold: false };
  const level = state === "warn" ? Math.max(warn, 0.5) : warn;
  return { fg: palette.onFill, bg: mixHex(palette.info, palette.warning, level), bold: true };
}

/** A light pass over the running stage: once when the map moves forward, and during the completion moment. */
export function stageFlash(frame: MotionFrame): number {
  if (frame.stageFrom !== undefined && frame.t <= motionTiming.shimmer) return -0.2 + 1.4 * seg(frame.t, 0, motionTiming.shimmer);
  return shimmerAt(frame);
}

/**
 * The colour of the connector into stage `index`. It carries the stage ramp once the stage before it is
 * behind the map, and fills in turn, 60 ms apart, when the map has just moved forward.
 */
export function linkColor(view: MissionView, index: number, frame: MotionFrame, palette: MissionPalette, idle: string): string {
  const before = view.steps[index - 1];
  if (before === undefined) return idle;
  const state = shownState(before, index - 1, frame).state;
  if (state !== "done" && state !== "skip") return idle;
  const color = stageColor(index - 0.5, view.steps.length, palette);
  if (frame.stageFrom === undefined || index <= frame.stageFrom) return color;
  return mixHex(idle, color, ease.outCubic(seg(frame.t, (index - frame.stageFrom - 1) * motionTiming.stagger, motionTiming.entry)));
}

/**
 * One stage of the breadcrumb. Behind the map a stage is its name in its ramp colour with `✓` (or `–`
 * when skipped); ahead it is a muted name; the running stage is a filled capital pill followed by an
 * optional `bar`-cell bar and the count.
 */
export function crumb(view: MissionView, index: number, frame: MotionFrame, palette: MissionPalette, bar: number, flash = -1): Segment[] {
  const step = view.steps[index];
  const { state, doneMix } = shownState(step, index, frame);
  const name = stepName(step.id, view);
  const counted = step.id === "work" && view.progress !== undefined;
  if (state === "done") {
    const color = stageColor(index, view.steps.length, palette);
    return [{ text: [name, counted ? countText(view) : "", "✓"].filter((part) => part !== "").join(" "), fg: doneMix >= 1 ? color : mixHex(index === frame.celebrateFrom ? palette.info : palette.muted, color, doneMix) }];
  }
  if (state === "skip") return [{ text: `${name} –`, fg: palette.muted }];
  if (state === "todo") return [{ text: name, fg: palette.muted }];
  const style = pillStyle(state, palette, frame.warn);
  const label = ` ${name.toUpperCase()}${state === "warn" ? " ⚑" : ""} `;
  const chars = [...label];
  const pill: Segment[] = flash < 0
    ? [{ text: label, fg: style.fg, ...(style.bg === undefined ? {} : { bg: style.bg }), bold: style.bold }]
    : chars.map((char, position) => ({ text: char, fg: style.fg, bg: shine(style.bg ?? palette.info, palette, position / (chars.length - 1), flash, 0.3), bold: true }));
  if (!counted) return pill;
  return [...pill, ...(bar > 0 ? [{ text: " ", fg: palette.muted }, ...microBar(frame.barRatio, palette, bar)] : []), { text: ` ${countText(view)}`, fg: palette.text, bold: true }];
}

const spinnerFrames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

function clockText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes < 60 ? `${minutes}:${rest}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}

/**
 * The live step: the running tool's name and how long it has run, `⠹ bash · 0:48`. The spinner moves
 * with the elapsed second, so it changes only when the time does. Nothing of the tool's input is shown.
 */
export function liveSegments(view: MissionView, frame: MotionFrame, palette: MissionPalette, room: number): Segment[] {
  if (view.live === undefined || view.complete || room < 4) return [];
  const seconds = frame.now === undefined ? undefined : Math.max(0, Math.floor((frame.now - view.live.start) / 1000));
  const spin = [...spinnerFrames][(seconds ?? 0) % 10];
  const time = seconds === undefined ? "" : ` · ${clockText(seconds)}`;
  return [
    { text: `${spin} `, fg: palette.warning },
    { text: truncateCells(view.live.tool, Math.max(1, room - 2 - cellWidth(time))), fg: palette.text },
    { text: time, fg: palette.muted }
  ];
}

function brandPill(palette: MissionPalette, sweep: number): Segment[] {
  const chars = [" ", "🔥", " ", "L", "I", "T", " "];
  return chars.map((char, index) => ({ text: char, fg: palette.onFill, bg: shine(palette.primary, palette, index / (chars.length - 1), sweep, 0.3), bold: true }));
}

export type ChipTier = "full" | "medium" | "tight";

export type ChipGroup = readonly Segment[];

/**
 * The chip's groups for a tier. The full tier is the brand and the breadcrumb around the running stage
 * (the one before, the running one with a seven-cell bar, the one after); medium keeps the running
 * stage and the next with a five-cell bar; tight keeps only the count.
 */
export function chipGroups(view: MissionView, frame: MotionFrame, palette: MissionPalette, tier: ChipTier): ChipGroup[] {
  const space: Segment = { text: " ", fg: palette.muted };
  const flame: Segment = { text: "🔥", fg: palette.text };
  const count = view.steps.length;
  const reached = currentStepIndex(view);
  const current = Math.min(count - 1, Math.max(0, reached));
  const flash = stageFlash(frame);
  const groups: ChipGroup[] = [];
  const trail = (from: number, to: number, bar: number): void => {
    for (let index = Math.max(0, from); index <= Math.min(count - 1, to); index += 1) {
      const lead: Segment = index === Math.max(0, from) ? space : { text: " › ", fg: linkColor(view, index, frame, palette, palette.borderActive) };
      groups.push([lead, ...crumb(view, index, frame, palette, bar, index === current ? flash : -1)]);
    }
  };
  // A finished map keeps its last stages in view, so the completion moment can flip them in turn.
  const anchor = reached >= count ? count - 2 : current;
  if (tier === "full") {
    groups.push(brandPill(palette, shimmerAt(frame)));
    trail(anchor - 1, anchor + 1, 7);
  } else if (tier === "medium") {
    groups.push([flame]);
    trail(anchor, anchor + 1, 5);
  } else {
    groups.push([flame]);
    const step = view.steps[current];
    const shown = shownState(step, current, frame).state;
    const done = view.complete && shown === "done";
    const value = done ? `✓ ${countText(view)}`.trim() : step.state === "warn" ? `⚑ ${countText(view)}`.trim() : countText(view) || stepName(step.id, view).toUpperCase();
    const style = pillStyle(done ? "done" : step.state === "warn" ? "warn" : "now", palette, frame.warn);
    groups.push([space, { text: ` ${value} `, fg: style.fg, ...(style.bg === undefined ? {} : { bg: style.bg }), bold: style.bold }]);
  }
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
 * The map chip on the right of the prompt's agent/model row: `🔥 LIT  plan ✓ › WORK ▰▰▰▱▱▱▱ 3/7 › review`,
 * then the live step when the full chip leaves room for it, shedding labels before values as `budget`
 * shrinks. Idle sessions render nothing.
 */
export function chipLine(view: MissionView, frame: MotionFrame, palette: MissionPalette, budget: number): Line {
  if (!view.active) return [];
  const tier = chipTier(view, frame, palette, budget);
  const groups = chipGroups(view, frame, palette, tier);
  if (tier === "full") {
    const live = liveSegments(view, frame, palette, 24);
    if (live.length > 0 && groupsWidth(groups) + 2 + lineWidth(live) <= budget) groups.push([{ text: "  ", fg: palette.muted }, ...live]);
  }
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

/**
 * One stage of the sidebar's vertical map: `◆` behind, `◉` running in bold, `⚑` flagged, `◇` ahead,
 * with the plan's task count or the loop's iteration on the right.
 */
function stepperRow(view: MissionView, index: number, frame: MotionFrame, palette: MissionPalette, width: number): Segment[] {
  const step = view.steps[index];
  const { state, doneMix } = shownState(step, index, frame);
  const counted = step.id === "work" && view.progress !== undefined ? ` ${countText(view)}` : "";
  const name = `${stepName(step.id, view)}${counted}`;
  const note = step.id === "plan" && view.planTasks !== undefined ? `${view.planTasks} tasks` : step.id === "work" && view.iteration !== undefined ? `iter ${view.iteration}` : "";
  const live = mixHex(palette.info, palette.warning, state === "warn" ? Math.max(frame.warn, 0.5) : frame.warn);
  let head: Segment[];
  if (state === "done") {
    const color = stageColor(index, view.steps.length, palette);
    head = [{ text: "◆ ", fg: doneMix >= 1 ? color : mixHex(palette.info, color, doneMix) }, { text: name, fg: palette.text }];
  } else if (state === "now" || state === "warn") {
    head = [{ text: `${state === "warn" ? "⚑" : "◉"} ${name}`, fg: live, bold: true }];
  } else {
    head = [{ text: `◇ ${name}${state === "skip" ? " –" : ""}`, fg: palette.muted }];
  }
  if (note === "") return head;
  const room = width - cellWidth(note) - 1;
  const used = lineWidth(head);
  if (used > room) return head;
  return [...head, { text: " ".repeat(width - used - cellWidth(note)), fg: palette.muted }, { text: note, fg: palette.muted }];
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
 * warning on a warning, success when complete), a tiny LIT header, the goal title, the vertical stage
 * map with its connectors, the bar, the detail line, the live step, criteria, warnings and the
 * evidence timeline. Rows are at most `panelInnerWidth` cells.
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
  view.steps.forEach((step, index) => {
    if (index > 0) {
      const color = linkColor(view, index, frame, palette, palette.borderSubtle);
      rows.set(`link:${index}`, [{ text: color === palette.borderSubtle ? "┆" : "┃", fg: color }]);
    }
    rows.set(`step:${step.id}`, stepperRow(view, index, frame, palette, width));
  });
  if (view.progress !== undefined) rows.set("bar", progressBar(frame.barRatio, width, palette, sweep));
  rows.set("b2", []);
  // The detail line: `└ task 3 · next ▸ …`, or a research run's claim counts.
  const lead = view.detail === undefined ? "" : truncateCells(view.detail, width - 2);
  const gap = lead !== "" && view.next !== undefined ? " · " : "";
  const next = view.next === undefined ? "" : truncateCells(`next ▸ ${view.next}`, Math.max(0, width - 2 - cellWidth(lead) - cellWidth(gap)));
  rows.set("detail", [{ text: "└ ", fg: palette.muted }, { text: lead + (next === "" ? "" : gap), fg: palette.muted }, ...(next === "" ? [] : [{ text: next, fg: palette.text }])]);
  rows.set("live", liveSegments(view, frame, palette, width));
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
  const phase = view.complete ? "COMPLETE" : stepName(view.phase, view).toUpperCase();
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
