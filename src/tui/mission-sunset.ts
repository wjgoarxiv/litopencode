// The status card's sunset: a half-sunk sun, stars, a shooting star now and then and a glittering sea,
// drawn only in the blank tails of the last body rows. The words always win: the scene starts three cells
// after the last of them, and the sun sinks lower, then sets, as the rows above the sea fill up.
// The scene needs a dark theme on a truecolor terminal with colour on. Everything is a pure function of the
// clock, so a card without a clock (idle, or `motion: false`) holds still and costs no frames.
import { mixHex } from "./mission-motion.ts";
import { cellWidth, type Line, type Segment } from "./mission-text.ts";

export type Scene = {
  /** Seconds on the scene's clock while the turn runs; absent while it holds still. */
  readonly t?: number;
};

/** Slow enough for a terminal over a network, fast enough to drift smoothly. */
export const sceneTickMs = 166;
/** The glow of the sun, the rule and the stars is slow, so it steps on every second tick; the sea moves on each. */
const glowSeconds = (2 * sceneTickMs) / 1000;
const glowClock = (t: number): number => Math.floor(t / glowSeconds) * glowSeconds;
export const sunWidth = 18;
/** Below this many cells the card has no room for a sun. */
const sunMinimum = 72;
const faint = "#30363d";
const slit = "#1a1030";
const violet = "#b48cff";

type SkyColors = { readonly sun: readonly (readonly [string, string])[]; readonly sea: readonly string[] };
const sunset: SkyColors = {
  sun: [["#ffd24a", "#fff0a0"], ["#ff8f3c", "#ffc15a"], ["#ff2d8a", "#ff6b8f"]],
  sea: ["#ffdc73", "#ff9a4a", "#ff4f8b", "#b457d6", "#5a46a8"]
};
/** The sky while the session waits on the user: the amber of YOUR TURN. */
const amber: SkyColors = {
  sun: [["#ffc95a", "#fff0b8"], ["#ffaf3c", "#ffd98a"], ["#e08a1e", "#ffb95a"]],
  sea: ["#ffd98a", "#ffaf3c", "#e08a1e", "#9a6420", "#5a4020"]
};

/** The LIT pill's and the border's stops while the scene shows. */
export const sunsetBrand = ["#ffa033", "#ff6a55", "#ff3388"] as const;
export const stageFrom = violet;
const neonStops = ["#ff2d95", violet] as const;

// The terminal pays for every change of colour along a row, so light comes in blocks of four cells and in eight
// steps: equal neighbours merge into one span and most cells keep their colour from one frame to the next.
const block = 4;
const blockOf = (x: number): number => Math.floor(x / block) * block;
/** The sun's blocks, the same on both sides of its middle. */
const sunBlock = (x: number): number => blockOf(x + 1);
const mixes = new Map<string, string>();
function step(from: string, to: string, k: number): string {
  const n = Math.max(0, Math.min(8, Math.round(k * 8)));
  const key = `${from}${to}${n}`;
  const known = mixes.get(key);
  if (known !== undefined) return known;
  if (mixes.size > 2000) mixes.clear();
  const made = mixHex(from, to, n / 8);
  mixes.set(key, made);
  return made;
}

// A sun cell: its glyph and the glyph's ink, over a second ink or over the sky. An ink is a band of the sun
// (0 gold, 1 orange, 2 hot pink, fractions between them) or a dark slit.
type Ink = number | "slit";
type SunCell = { readonly glyph: string; readonly ink: Ink; readonly over?: Ink };
const lowerBlocks = "▁▂▃▄▅▆▇";

// The full cells of each sun row, top first. With three rows the sun is gold, orange and pink with a slit over the
// lower two; a sun with fewer rows has no row for every colour, so the gold of its top turns orange (and, with one row,
// pink) toward its edges.
const sunRows: Readonly<Record<number, readonly SunCell[]>> = {
  3: [{ glyph: "█", ink: 0 }, { glyph: "▇", ink: 1, over: "slit" }, { glyph: "▆", ink: 2, over: "slit" }],
  2: [{ glyph: "█", ink: 0 }, { glyph: "▆", ink: 2, over: "slit" }],
  1: [{ glyph: "█", ink: 0 }]
};

/** The dome for a sun `rows` rows tall; undefined cells stay sky. Its outline is drawn in eighth-blocks. */
function sunCells(rows: number): readonly (readonly (SunCell | undefined)[])[] {
  return (sunRows[rows] ?? []).map((inner, row) => Array.from({ length: sunWidth }, (_, x) => {
    const d = (x - (sunWidth - 1) / 2) / (sunWidth / 2);
    const fill = Math.max(0, Math.min(8, Math.round(Math.sqrt(1 - d * d) * rows * 8) - (rows - 1 - row) * 8));
    if (fill === 0) return undefined;
    const ink = rows === 3 || row > 0 ? inner.ink : (3 - rows) * Math.abs(sunBlock(x) + block / 2 - 1 - sunWidth / 2) / (sunWidth / 2);
    return fill < 8 ? { glyph: lowerBlocks[fill - 1] ?? "▁", ink } : { ...inner, ink };
  }));
}
const suns: Readonly<Record<number, ReturnType<typeof sunCells>>> = { 1: sunCells(1), 2: sunCells(2), 3: sunCells(3) };

// Where the stars stand: a sky row and a column counted from the sun's left edge.
const stars: readonly (readonly [number, number])[] = [[0, -30], [1, -24], [0, -18], [1, -13], [0, -9], [1, -5], [0, 22], [1, 25], [0, 29], [1, 32], [0, 35]];
const shootingStarEvery = 9;
const shootingStarLasts = 1.1;

// One terminal cell; a wide character's second cell is null. `from` names the segment it came from, so a
// row's own segments come back whole and only blank cells are ever replaced.
type Cell = { text: string; readonly fg: string; readonly bg?: string; readonly bold?: boolean; readonly from?: number | "gap" } | null;

function toCells(line: Line): Cell[] {
  const cells: Cell[] = [];
  let last: Exclude<Cell, null> | undefined;
  line.forEach((segment, index) => {
    const from = segment.bg !== undefined || segment.text.trim() !== "" ? index : "gap";
    for (const char of segment.text) {
      const width = cellWidth(char);
      if (width === 0) {
        if (last !== undefined) last.text += char;
        continue;
      }
      last = { ...segment, text: char, from };
      cells.push(last);
      if (width === 2) cells.push(null);
    }
  });
  return cells;
}

function toLine(cells: readonly Cell[]): Line {
  const out: (Segment & { text: string; from?: number | "gap" })[] = [];
  for (const cell of cells) {
    if (cell === null) continue;
    const last = out.at(-1);
    const joins = last !== undefined && last.from === cell.from && (cell.from === "gap" || (last.fg === cell.fg && last.bg === cell.bg && last.bold === cell.bold));
    if (joins) last.text += cell.text;
    else out.push({ ...cell });
  }
  return out.map(({ from: _from, ...segment }) => segment);
}

function isFree(cell: Cell | undefined): boolean {
  return cell !== null && cell !== undefined && cell.text === " " && cell.bg === undefined;
}

// The cells of a row the scene may use, three clear of every word: its blank tail, and a gap between words that
// is wide enough to read as sky.
const skyGap = 24;
function skyCells(cells: readonly Cell[]): boolean[] {
  const sky = cells.map(() => false);
  for (let from = 0; from < cells.length; ) {
    if (!isFree(cells[from])) {
      from += 1;
      continue;
    }
    let to = from;
    while (to < cells.length && isFree(cells[to])) to += 1;
    if (to === cells.length || to - from >= skyGap) for (let x = from === 0 ? 0 : from + 3; x < (to === cells.length ? to : to - 3); x += 1) sky[x] = true;
    from = to;
  }
  return sky;
}

// How high the sea stands `dx` cells from under the sun: waves travel outward, brightest on the sun's path.
function seaLevel(dx: number, t: number): number {
  const far = Math.abs(dx);
  const wave = Math.sin(far * 0.62 - t * 1.8) + 0.8 * Math.sin(dx * 0.31 + t * 0.8) + 0.6 * Math.sin(dx * 1.37 - t * 0.5);
  return wave * 0.62 + 1.05 - far / 34;
}

// Each cell of the sea has its own wave; its block's highest wave sets the light on all of them.
function seaCell(dx: number, t: number, ink: readonly string[]): Cell {
  const level = seaLevel(dx, t);
  const from = blockOf(dx);
  const crest = Math.max(...Array.from({ length: block }, (_, i) => seaLevel(from + i, t)));
  const hue = Math.min(3.99, (Math.floor(Math.abs(from + block / 2) / (2 * block)) * 2 * block) / 13);
  const base = step(ink[Math.floor(hue)] ?? violet, ink[Math.floor(hue) + 1] ?? violet, hue % 1);
  return { text: level > 1 ? "~" : level > 0.55 ? "-" : level > 0.22 ? "." : " ", fg: step(faint, base, Math.round(Math.min(1, 0.18 + crest * 0.5) * 4) / 4) };
}

export type SkyOptions = {
  readonly t?: number;
  /** A resting card draws the scene at low light. */
  readonly dim: boolean;
  /** The card wears the YOUR TURN look. */
  readonly turn?: boolean;
  /** The rewind look: the sun's colour at 0..1 across it. Its card has no sea. */
  readonly rainbow?: (position: number) => string;
};

export type Sky = { readonly rows: readonly Line[]; /** Rows the sun stands above the rule; 0 when it found no room. */ readonly sun: number };

/** Where the sun's left edge stands on a card `inner` cells wide. It never moves with the text. */
export function sunColumn(inner: number): number {
  return Math.round(inner * 0.62);
}

/** Paints the scene into the free cells of `rows`, the card's last body rows; text and widths stay as they are. */
export function paintSky(rows: readonly Line[], inner: number, options: SkyOptions): Sky {
  const { t, rainbow } = options;
  const s = t ?? 0;
  const glow = glowClock(s);
  const at = sunColumn(inner);
  const colors = options.turn === true ? amber : sunset;
  const shade = (hex: string): string => (options.dim ? step(hex, faint, 0.6) : hex);
  const grids = rows.map(toCells);
  const skies = grids.map(skyCells);
  const last = grids.length - 1;
  const roomFor = (row: number): boolean => at + sunWidth + 2 <= inner && Array.from({ length: sunWidth + 4 }, (_, x) => skies[row]?.[at - 2 + x]).every((free) => free === true);
  let sun = 0;
  if (inner >= sunMinimum) while (sun < Math.min(3, grids.length) && roomFor(last - sun)) sun += 1;
  const put = (row: number, x: number, cell: Cell): void => {
    if (skies[row]?.[x] === true) (grids[row] as Cell[])[x] = cell;
  };
  if (sun > 0) {
    for (const [sky, dx] of stars) {
      const row = last - 2 + sky;
      if (row < 0) continue;
      const light = 0.5 + 0.5 * Math.sin(glow * 1.7 + dx * 2.1);
      put(row, at + dx, { text: light > 0.85 ? "*" : light > 0.45 ? "+" : ".", fg: step(faint, shade(dx % 2 === 0 ? "#ff9ad5" : "#a99bff"), 0.35 + 0.65 * light) });
    }
    const dash = t === undefined ? shootingStarEvery : t % shootingStarEvery;
    if (dash < shootingStarLasts && last > 0) {
      const head = Math.round(at + sunWidth + 22 - (dash / shootingStarLasts) * 34);
      ["*", "-", "-", "."].forEach((glyph, i) => put(0, head + i, { text: glyph, fg: step("#fff4e0", "#b457d6", i / 3), ...(i === 0 ? { bold: true } : {}) }));
    }
  }
  if (last >= 0 && rainbow === undefined && (t !== undefined || sun > 0)) {
    const middle = at + sunWidth / 2;
    for (let x = 0; x < inner; x += 1) {
      const wave = seaCell(x - middle, s, colors.sea);
      if (wave !== null) put(last, x, { ...wave, fg: shade(wave.fg) });
    }
  }
  (suns[sun] ?? []).forEach((line, row) => line.forEach((cell, x) => {
    if (cell === undefined) return;
    // Heat: light runs up the sun and ripples across it, by colour alone.
    const heat = t === undefined ? 0.25 : 0.5 + 0.5 * Math.sin(glow * 2.1 + row * 1.5 + 0.55 * Math.sin(sunBlock(x) * 0.8 + glow * 1.6));
    const ink = (band: Ink): string => {
      if (band === "slit") return slit;
      if (rainbow !== undefined) return step(rainbow(x / sunWidth / 2 + band * 0.12), "#ffffff", 0.45 + 0.25 * heat);
      const low = Math.min(1, Math.floor(band));
      const [upper, lower] = [colors.sun[low], colors.sun[low + 1]].map((pair) => step(pair?.[0] ?? violet, pair?.[1] ?? violet, heat)) as [string, string];
      return shade(step(upper, lower, band - low));
    };
    (grids[last - sun + 1 + row] as Cell[])[at + x] = { text: cell.glyph, fg: ink(cell.ink), ...(cell.over === undefined ? {} : { bg: ink(cell.over) }) };
  }));
  return { rows: grids.map(toLine), sun };
}

const breathSeconds = 3.2;

/** How far the working card has breathed in, 0 to 1 in halves; 0 while it holds still. */
export function sceneBreath(t: number | undefined): number {
  return t === undefined ? 0 : Math.round(1 - Math.cos((2 * Math.PI * t) / breathSeconds)) / 2;
}

export type NeonOptions = { readonly width: number; readonly accent: string; readonly t?: number; readonly dim: boolean; readonly sun: number };

/**
 * The neon border's colour at column `x`, pink through violet to the accent in four-cell steps. On the bottom
 * rule (`water`) rings of sunset light run outward from under the sun.
 */
export function neonAt(x: number, water: boolean, { width, accent, t, dim, sun }: NeonOptions): string {
  const cell = Math.floor(x / 4) * 4;
  const g = cell / width;
  let hue = g < 0.5 ? step(neonStops[0], neonStops[1], g * 2) : step(neonStops[1], accent, g * 2 - 1);
  hue = step(hue, "#ffffff", 0.3 * sceneBreath(t));
  if (water && sun > 0) {
    const dx = Math.abs(cell - (sunColumn(width - 4) + 1.5 + sunWidth / 2));
    const near = Math.max(0, 1 - dx / 26);
    const ring = 0.5 + 0.5 * Math.sin(dx * 0.55 - glowClock(t ?? 0) * 2.6);
    hue = step(hue, near > 0.6 ? "#ffd24a" : "#ff8f3c", Math.min(1, near * (0.45 + 0.85 * ring)));
  }
  return dim ? step(hue, faint, 0.45) : hue;
}

/** A border row's rule and corners in neon; its labels keep their own colours. */
export function neonRow(line: Line, border: string, water: boolean, options: NeonOptions): Line {
  const out: Segment[] = [];
  let x = 0;
  for (const segment of line) {
    if (segment.fg !== border || !/^[─╭╮╰╯]+$/u.test(segment.text)) {
      out.push(segment);
      x += cellWidth(segment.text);
      continue;
    }
    for (const char of segment.text) {
      const fg = neonAt(x, water, options);
      const last = out.at(-1);
      if (last !== undefined && last.fg === fg && /^[─╭╮╰╯]+$/u.test(last.text)) out[out.length - 1] = { ...last, text: last.text + char };
      else out.push({ text: char, fg });
      x += 1;
    }
  }
  return out;
}
