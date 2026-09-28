// Approved Ignition B geometry and per-cell colors; provenance is in test/fixtures/lit-mark/README.md.
export const standard = [
  "          ▄▖  ▄█▄     ",
  "▗▄▄▖    ▄██▌  ▜█▛     ",
  "▐██▌  ▄████████████▜▛ ",
  "▐██▌ ▐█▀▀▀▀▀▀▀▀▀▀▀▀▘  ",
  "▐██▌   ▄█▌█████████▌  ",
  "▐██▌ ▄██▛▘  ▗▄▄  ▗    ",
  "▐██▌▐█▛▘    ▐██  ▝▀   ",
  "▐██▌▝       ▐██       ",
  "▐██████▘    ▐██       ",
  "▝▀▀▀▀▀      ▝▀▀       ",
] as const;

const standardColors = [
  "..........II..LLL.....",
  "OOOO....IIII..LLL.....",
  "OOOO..IIIIOOOOOOOOOOO.",
  "OOOO.IIIOOOOOOOOOOOO..",
  "OOOO...IIILLLIIIIIII..",
  "OOOO.IIIII..III..I....",
  "OOOOIIII....III..II...",
  "OOOOI.......III.......",
  "OOOOOOOO....III.......",
  "OOOOOO......III.......",
] as const;

export const banner = [
  "                             ▄▄▄▄           ",
  "                   ▗███▌   ▗██████▖         ",
  " ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘         ",
  " ▐█████        ▗▟██████▌    ▝▀▜█▀▘          ",
  " ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ",
  " ▐█████    ▗▟█████████████████████████ ▐█▀  ",
  " ▐█████    ████████████████████████████▀    ",
  " ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖     ",
  " ▐█████    ▀    ▄██ ████▌█████████████▌     ",
  " ▐█████       ▄████ ████▌█████████████▌     ",
  " ▐█████     ▄█████▛                         ",
  " ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖       ",
  " ▐█████ ▐█████▀          █████     ▐▛▀      ",
  " ▐█████ ▐███▀            █████              ",
  " ▐█████ ▐█▀              █████              ",
  " ▐█████ ▝                █████              ",
  " ▐█████▄▄▄▄▄▄▄▖          █████              ",
  " ▐███████████▛           █████              ",
  " ▐██████████▀            █████              ",
  "                                            ",
] as const;

const bannerColors = [
  ".............................LLLL...........",
  "...................IIIII...LLLLLLLL.........",
  ".OOOOOO..........IIIIIII...LLLLLLLL.........",
  ".OOOOOO........IIIIIIIII....LLLLLL..........",
  ".OOOOOO......IIIIIIIIIOOOOOOOOOOOOOOOOOOOO..",
  ".OOOOOO....IIIIIIIIOOOOOOOOOOOOOOOOOOO.OOO..",
  ".OOOOOO....IIIIIIOOOOOOOOOOOOOOOOOOOOOOO....",
  ".OOOOOO....IIII...I.LLLLLIIIIIIIIIIIIII.....",
  ".OOOOOO....I....III.LLLLLIIIIIIIIIIIIII.....",
  ".OOOOOO.......IIIII.LLLLLIIIIIIIIIIIIII.....",
  ".OOOOOO.....IIIIIII.........................",
  ".OOOOOO..IIIIIIIII.......IIIII.....II.......",
  ".OOOOOO.IIIIIII..........IIIII.....III......",
  ".OOOOOO.IIIII............IIIII..............",
  ".OOOOOO.III..............IIIII..............",
  ".OOOOOO.I................IIIII..............",
  ".OOOOOOOOOOOOOO..........IIIII..............",
  ".OOOOOOOOOOOOO...........IIIII..............",
  ".OOOOOOOOOOOO............IIIII..............",
  "............................................",
] as const;

export const micro = [
  "▗▖  ▄▄ █▌       ",
  "▐▌▗█▀▀▀▀▀▀▘     ",
  "▐▌ ▄▌▀▝▀▀▘      ",
  "▐▌▛▘  ▐▌        ",
  "▝▀▀▘  ▝▘        ",
] as const;

const microColors = [
  "OO..II.LL.......",
  "OOIIIOOOOOO.....",
  "OO.IILIIII......",
  "OOII..II........",
  "OOOO..II........",
] as const;

const palette = {
  O: { truecolor: "38;2;255;99;55", "256": "38;5;203" },
  L: { truecolor: "38;2;215;247;91", "256": "38;5;191" },
  I: { truecolor: "38;2;242;239;223", "256": "38;5;230" }
} as const;

const variants = [
  { rows: standard, colors: standardColors },
  { rows: banner, colors: bannerColors },
  { rows: micro, colors: microColors }
] as const;

export type MarkColorMode = "truecolor" | "256" | "none";
export type MarkTerminal = {
  readonly env?: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  readonly argv?: readonly string[];
};

// Keep the product label six spaces beyond the mark envelope, followed by a two-space gap.
export function lockup(productName: string, rows: readonly string[] = standard): string[] {
  const name = productName.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "");
  const column = Math.max(...rows.map((row) => row.length)) + 6;
  return rows.map((row, index) => row.padEnd(column) + (index === Math.floor(rows.length / 2) ? `  ${name}` : ""));
}

export function colorize(
  rows: readonly string[],
  { mode, shadow }: { readonly mode: MarkColorMode; readonly shadow?: string }
): string[] {
  if (mode === "none") return [...rows];
  // Retain validation for callers of the former shadow option; Ignition has no shadow layer.
  if (shadow !== undefined && !/^#[0-9a-f]{6}$/iu.test(shadow)) throw new Error("mark shadow must be a six-digit hex color");
  const variant = variants.find((candidate) => rows.length === candidate.rows.length
    && candidate.rows.every((row, index) => rows[index]?.startsWith(row)));
  return rows.map((row, index) => [...row].map((glyph, column) => {
    const key = variant === undefined ? "I" : variant.colors[index]?.[column];
    if (key !== "O" && key !== "L" && key !== "I") return glyph;
    if (!/[█▓▀▄▌▐▖▗▘▝▙▛▜▟▚▞]/u.test(glyph)) return glyph;
    return `\u001b[${palette[key][mode]}m${glyph}\u001b[0m`;
  }).join(""));
}

export function markColorMode({ env = process.env, isTTY = process.stdout.isTTY, argv = process.argv.slice(2) }: MarkTerminal = {}): MarkColorMode {
  if (env.NO_COLOR !== undefined || env.CI !== undefined || isTTY !== true || argv.includes("--json") || !supportsMarkGlyphs(env)) return "none";
  return /^(truecolor|24bit)$/iu.test(env.COLORTERM ?? "") || /direct/iu.test(env.TERM ?? "") ? "truecolor" : "256";
}

export function supportsMarkGlyphs(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERM !== "dumb" && /utf-?8/iu.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "");
}

export function terminalMark(rows: readonly string[], terminal: MarkTerminal = {}): string[] {
  if (!supportsMarkGlyphs(terminal.env)) return ["LIT"];
  return colorize(rows, { mode: markColorMode(terminal) });
}
