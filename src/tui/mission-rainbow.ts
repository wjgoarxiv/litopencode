// The look of the band while lit-adhd (alias lit-rewind) is the discipline at work: the border, the LIT
// word and the gauges take a colour that walks round the hue wheel. Every colour is drawn at one fixed
// OKLCH lightness, so the brightness of the band never swings; only the hue moves, a few degrees per
// 250 ms tick, which is four small colour steps a second and no flash at all. It is off under reduced
// motion (tui.json `motion: false`) and NO_COLOR, and it never reaches a session that is not rewinding.
import { activeSkillLook, lookOfSkill } from "./mission-looks.ts";
import { mixHex } from "./mission-motion.ts";
import type { SkillChip } from "./mission-skills.ts";
import type { Line, Segment } from "./mission-text.ts";
import type { MissionView } from "./mission-model.ts";

export const rainbowTickMs = 250;
/** Degrees of hue per second: a full turn every 12 s, 7.5 degrees per tick. */
const degreesPerSecond = 30;
const lightness = 0.8;
const chroma = 0.115;

export type Rainbow = { readonly hue: number };

/** True while the session's current discipline or a chip lit by this turn is lit-adhd or lit-rewind. */
export function rainbowActive(view: Pick<MissionView, "active" | "discipline">, chips: readonly SkillChip[], busy: boolean | undefined): boolean {
  return activeSkillLook(view, chips, busy) === "rewind";
}

/** The rewind look outlasts its turn so the band stays lit while the user reads the brief. */
export const rainbowLingerMs = 15 * 60_000;

/** Shown while lit-adhd runs, then until the next prompt, for at most rainbowLingerMs after it was last seen. */
export function rainbowShows(active: boolean, seenAt: number | undefined, lastPromptAt: number | undefined, now: number): boolean {
  if (active) return true;
  if (seenAt === undefined || now - seenAt > rainbowLingerMs) return false;
  return lastPromptAt === undefined || lastPromptAt <= seenAt;
}

const sparkleFrames = ["✦·⋆·", "·✦·⋆", "⋆·✦·", "·⋆·✧"] as const;

/** The top-border mark of the rewind look: REWIND « with a hue per letter, then a four-cell sparkle trail. */
export function rewindMark(rainbow: Rainbow): Line {
  const letters: Segment[] = [..."REWIND"].map((letter, index) => ({ text: letter, fg: rainbowColor(rainbow.hue + index * 45), bold: true }));
  // The hue advances one step per tick, so it also clocks the trail.
  const tick = Math.floor(rainbow.hue / ((degreesPerSecond * rainbowTickMs) / 1000));
  const trail = sparkleFrames[tick % sparkleFrames.length] ?? sparkleFrames[0];
  return [...letters, { text: " «", fg: rainbowColor(rainbow.hue + 270) }, { text: " ", fg: rainbowColor(rainbow.hue) }, ...[...trail].map((glyph, index) => ({ text: glyph, fg: rainbowColor(rainbow.hue + 300 + index * 20) }))];
}

/** True for the skill names that carry the rewind look. */
export const isRainbowSkill = (name: string): boolean => lookOfSkill(name) === "rewind";

/** Degrees of hue one pill spans from its first cell to its last. */
const pillSpread = 126;
const pillInk = "#14161c";

/** A pill cell's fill at this hue: the rainbow colour lifted toward white, so the dark ink keeps 4.5:1. */
export function rainbowCell(hue: number): string {
  return mixHex(rainbowColor(hue), "#ffffff", 0.3);
}

/**
 * A pill drawn cell by cell through the rainbow: each cell a step further round the wheel, dark bold ink
 * on top. Only the colours of fixed cells move, so the text and width never change and nothing flashes.
 */
export function rainbowPill(text: string, rainbow: Rainbow, offset: number): Segment[] {
  const chars = [...text];
  const step = chars.length <= 1 ? 0 : pillSpread / (chars.length - 1);
  return chars.map((char, index) => ({ text: char, fg: pillInk, bg: rainbowCell(rainbow.hue + offset + index * step), bold: true }));
}

/** Plain text with each character a step round the wheel, for labels that sit on the card's ground. */
export function rainbowText(text: string, rainbow: Rainbow, offset: number): Segment[] {
  return [...text].map((char, index) => ({ text: char, fg: rainbowColor(rainbow.hue + offset + index * 24), bold: true }));
}

/** Whether the rainbow may play at all: tui.json motion is not off and NO_COLOR is unset or empty. */
export function rainbowAllowed(motion: boolean, noColor: string | undefined): boolean {
  return motion && (noColor === undefined || noColor === "");
}

export function rainbowAt(now: number): Rainbow {
  return { hue: ((now / 1000) * degreesPerSecond) % 360 };
}

function encode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** An OKLCH colour at the rainbow's fixed lightness and chroma, as `#rrggbb`. */
export function rainbowColor(hue: number): string {
  const radians = (((hue % 360) + 360) % 360) * (Math.PI / 180);
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return "#" + [red, green, blue].map((channel) => Math.round(encode(channel) * 255).toString(16).padStart(2, "0")).join("");
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour, 0 to 1. */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => linear(Number.parseInt(hex.slice(index, index + 2), 16)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
