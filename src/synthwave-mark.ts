// The Synthwave LIT mark for human-facing CLI screens only (install, doctor, help). Completion
// Markdown, toasts and every model-visible string keep the Ignition rows in lit-mark.ts.
import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS } from "./synthwave-data.ts";
import { markColorMode, supportsMarkGlyphs, type MarkColorMode, type MarkTerminal } from "./lit-mark.ts";

export const synthwaveHost = "opencode";
export const synthwaveFallback = `LIT · ${synthwaveHost}`;
/** LitOpenCode chrome: white at the top of each letter through steel and sky to deep navy at the base. */
export const synthwaveChrome = ["#ffffff", "#e5e7eb", "#94a3b8", "#ffffff", "#7dd3fc", "#0f2a44"] as const;
const taglineStops = ["#8be9fd", "#ff2d95", "#ffd23f"] as const;
const edge = "#ffffff";

export type SynthwaveSize = keyof typeof PIXEL_ROWS;
export const synthwaveSizes: readonly { readonly name: SynthwaveSize; readonly minCols: number }[] = [
  { name: "B-L", minCols: 76 },
  { name: "B-M", minCols: 44 },
  { name: "B-S", minCols: 24 }
];

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

/** Piecewise-linear sample of `stops` at `t` in 0..1, as #rrggbb. */
export function sampleStops(stops: readonly string[], t: number): string {
  const spans = stops.length - 1;
  const index = Math.min(spans - 1, Math.max(0, Math.floor(t * spans)));
  const fraction = t * spans - index;
  const from = channels(stops[index]);
  const to = channels(stops[index + 1]);
  return "#" + from.map((value, k) => Math.round(value + (to[k] - value) * fraction).toString(16).padStart(2, "0")).join("");
}

function pixelColour(symbol: string): string | undefined {
  if (symbol === " ") return undefined;
  if (symbol >= "a" && symbol <= "l") return sampleStops(synthwaveChrome, (symbol.charCodeAt(0) - 97) / 11);
  if (symbol === "m") return edge;
  return (SHARED_COLOURS as Record<string, string>)[symbol];
}

/** The xterm 256-colour cube index for #rrggbb: 16 + 36r + 6g + b. */
export function cubeIndex(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => Math.round((value / 255) * 5));
  return 16 + 36 * r + 6 * g + b;
}

type ColourDepth = Exclude<MarkColorMode, "none">;

function sgr(hex: string, layer: "fg" | "bg", depth: ColourDepth): string {
  const base = layer === "fg" ? 38 : 48;
  return depth === "truecolor" ? `${base};2;${channels(hex).join(";")}` : `${base};5;${cubeIndex(hex)}`;
}

function paint(glyph: string, fg: string | undefined, bg: string | undefined, depth: ColourDepth): string {
  const codes = [fg === undefined ? "" : sgr(fg, "fg", depth), bg === undefined ? "" : sgr(bg, "bg", depth)].filter((code) => code !== "");
  return codes.length === 0 ? glyph : `\u001b[${codes.join(";")}m${glyph}\u001b[0m`;
}

/** The largest size that fits `cols`, or undefined below B-S. An unknown width counts as 80. */
export function synthwaveSize(cols: number | undefined): SynthwaveSize | undefined {
  const width = typeof cols === "number" && Number.isFinite(cols) && cols > 0 ? cols : 80;
  return synthwaveSizes.find((size) => width >= size.minCols)?.name;
}

function colourRows(size: SynthwaveSize, depth: ColourDepth): string[] {
  const pixels = PIXEL_ROWS[size];
  const rows: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    let line = "";
    for (let x = 0; x < pixels[y].length; x += 1) {
      const upper = pixelColour(pixels[y][x]);
      const lower = pixelColour(pixels[y + 1]?.[x] ?? " ");
      if (upper === lower) line += upper === undefined ? " " : paint(" ", undefined, upper, depth);
      else if (upper === undefined) line += paint("▄", lower, undefined, depth);
      else line += paint("▀", upper, lower, depth);
    }
    rows.push(line);
  }
  return rows;
}

function tagline(width: number, depth: MarkColorMode): string {
  const pad = " ".repeat(Math.max(0, Math.floor((width - synthwaveFallback.length) / 2)));
  if (depth === "none") return pad + synthwaveFallback;
  const glyphs = [...synthwaveFallback];
  return pad + glyphs.map((glyph, index) => (glyph === " " ? glyph : paint(glyph, sampleStops(taglineStops, index / (glyphs.length - 1)), undefined, depth))).join("");
}

export type SynthwaveOptions = {
  readonly cols?: number;
  readonly depth: MarkColorMode;
  /** False when the terminal cannot draw block glyphs; the mark is then the one fallback line. */
  readonly glyphs?: boolean;
  /** One plain line centred under the tagline, such as the product and version. */
  readonly footer?: string;
};

/**
 * The mark rows for a terminal `cols` wide. `depth` "none" prints the spec's glyph scene; below B-S, or
 * without block glyphs, it is the one line `LIT · opencode`.
 */
export function synthwaveRows({ cols, depth, glyphs = true, footer }: SynthwaveOptions): string[] {
  const size = synthwaveSize(cols);
  const plain = size === undefined || !glyphs;
  const width = plain ? 0 : PIXEL_ROWS[size][0].length;
  const rows = plain ? [synthwaveFallback] : [...(depth === "none" ? MONO_ROWS[size] : colourRows(size, depth)), tagline(width, depth)];
  if (footer !== undefined) rows.push(" ".repeat(Math.max(0, Math.floor((width - footer.length) / 2))) + footer);
  return rows;
}

/**
 * The mark for the current process: its colour depth, glyph support and the width of `stream`.
 * When `stream` is not a TTY (a pipe, an agent's tool call, a CI log) it is only `LIT · opencode` and the
 * footer: the art is for terminals people look at. `terminal.isTTY` overrides the stream's own flag.
 */
export function terminalSynthwave(
  { colour = true, stream = process.stdout, terminal = {}, footer }: {
    readonly colour?: boolean;
    readonly stream?: { readonly columns?: number; readonly isTTY?: boolean };
    readonly terminal?: MarkTerminal;
    readonly footer?: string;
  } = {}
): string[] {
  const env = terminal.env ?? process.env;
  const tty = (terminal.isTTY ?? stream.isTTY) === true;
  const fromEnv = Number.parseInt(env.COLUMNS ?? "", 10);
  const cols = typeof stream.columns === "number" && stream.columns > 0 ? stream.columns : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : undefined;
  const depth = colour ? markColorMode({ ...terminal, env, isTTY: tty }) : "none";
  return synthwaveRows({ cols, depth, glyphs: tty && supportsMarkGlyphs(env), ...(footer === undefined ? {} : { footer }) });
}
