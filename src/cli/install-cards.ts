// The installer's question cards for a person at a real terminal: pick one, yes or no, type a value, look
// over and continue, live steps and the closing summary. cardsTerminal() decides whether they are used at
// all; every other run keeps the plain prompts. A card is drawn in place, never wider or taller than the
// window, and folds to one line once it is answered. Rows are spans, so a width is never read from escapes.
// The round form ends every fill in caps that take its padding cells, so both forms hold the same columns.
import os from "node:os";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { wrapValue } from "./install-report.ts";
import { fontFolders, iconFontInstalled, roundCaps } from "../round-glyphs.ts";
import { cubeIndex } from "../synthwave-mark.ts";
import { cellWidth, gradientAt, stripControls, truncateCells } from "../tui/mission-text.ts";

type Ink = { readonly fg?: string; readonly bg?: string; readonly bold?: boolean; readonly dim?: boolean };
type Span = readonly [text: string, ink?: Ink];
export type CardRow = readonly Span[];
type Key = { readonly text: string; readonly name: string; readonly enter: boolean; readonly ctrl: boolean };
type Keypress = { readonly name?: string; readonly ctrl?: boolean; readonly meta?: boolean };

export type CardInput = NodeJS.ReadableStream & { readonly isTTY?: boolean; setRawMode?(mode: boolean): unknown };
export type CardOutput = NodeJS.WritableStream & {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  getColorDepth?(env?: object): number;
};
type CardProcess = Pick<NodeJS.Process, "on" | "once" | "removeListener" | "kill" | "pid" | "platform">;

export type CardTerminal = {
  readonly stdin: CardInput;
  readonly stdout: CardOutput;
  readonly env: NodeJS.ProcessEnv;
  readonly animate?: boolean;
  readonly settleMs?: number;
  readonly now?: () => number;
  readonly proc?: CardProcess;
  /** Whether the terminal has the round caps; looked up once per run when not given. */
  readonly caps?: boolean;
};

export type CardChoice = {
  readonly label: string;
  readonly detail?: string;
  /** Stays at the end of the list whatever filter is typed. */
  readonly sticky?: boolean;
};
export type CardField = { readonly label: string; readonly value: string; readonly mark?: "done" | "note" | "warn" | "fail" };
export type CardSection = { readonly head?: string; readonly fields: readonly CardField[] };

export type InstallCards = ReturnType<typeof createInstallCards>;

const minColumns = 40;
const minRows = 12;
const maxWidth = 100;
const listRows = 12;
// More choices than this can be read at a glance: the list scrolls and typing filters it.
const numberedChoices = 10;
/** Where values start, counted from the first text column of a fold (20 + 1) and of a card row (2 + 19). */
const valueGap = 21;
const buttonCells = 15;
const settleDelayMs = 30;
// `y` and then Enter is a habit: the letter already answered, so an Enter this soon after it is part of it.
const letterEnterMs = 400;
const promptHook = /^LITOPENCODE_\w+_PROMPT$/u;

const pink = "#ff2d95";
const violet = "#b48cff";
const accent = "#5fd7ff";
const orange = "#ff8f3c";
const ink = "#0b0e14";
const ivory = "#f2efdf";
const bar = "#34205c";
const green = "#50e68c";
const amber = "#ffb02e";
const red = "#ff5577";
const neon = [pink, violet, accent] as const;

const unicodeGlyphs = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", pointer: "❯", done: "✓", fail: "✗", warn: "!", note: "·", up: "↑", down: "↓",
  updown: "↑ ↓", sides: "← →", caret: "█", spin: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
};
const asciiGlyphs: typeof unicodeGlyphs = {
  tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", pointer: ">", done: "ok", fail: "x", warn: "!", note: "-", up: "^", down: "v",
  updown: "Up Down", sides: "Left Right", caret: "_", spin: ["-", "\\", "|", "/"]
};
const asciiWords: Readonly<Record<string, string>> = { "—": "-", "–": "-", "·": "-", "…": "...", "→": "->", "한국어": "Korean", "간소화 기술 영어": "Simplified Technical English", "쉽게 설명하기": "Explain Like I'm 5" };

const ansi16 = ["#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5", "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"];

function channels(hex: string): readonly number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

function nearest16(hex: string): number {
  // The soft green is nearest to grey.
  if (hex === green) return 2;
  const [r, g, b] = channels(hex);
  const distance = (other: string): number => {
    const [x, y, z] = channels(other);
    return (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
  };
  return ansi16.reduce((best, candidate, index) => (distance(candidate) < distance(ansi16[best]) ? index : best), 0);
}

function colourCode(hex: string, back: boolean, depth: number): string {
  if (depth >= 24) return (back ? "48;2;" : "38;2;") + channels(hex).join(";");
  if (depth >= 8) return (back ? "48;5;" : "38;5;") + String(cubeIndex(hex));
  const index = nearest16(hex);
  return String((index < 8 ? 30 + index : 82 + index) + (back ? 10 : 0));
}

function colourDepth({ stdout, env }: CardTerminal): number {
  if (env.NO_COLOR !== undefined) return 1;
  return stdout.getColorDepth?.(env) ?? (/^(?:truecolor|24bit)$/iu.test(env.COLORTERM ?? "") ? 24 : /256/u.test(env.TERM ?? "") ? 8 : 4);
}

function asciiLocale(env: NodeJS.ProcessEnv): boolean {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return locale !== "" && !/utf-?8/iu.test(locale);
}

/** True where the terminal says its background is light; most say nothing, and a terminal is dark by default. */
function lightAppearance(env: NodeJS.ProcessEnv): boolean {
  const back = /;(\d+)$/u.exec(env.COLORFGBG ?? "")?.[1];
  return back === "7" || back === "15";
}

/** Cards need a person at a terminal: two TTYs, raw mode, room to draw, no CI, no prompt hook in the environment. */
export function cardsTerminal({ stdin, stdout, env }: CardTerminal): boolean {
  return (
    stdin.isTTY === true && stdout.isTTY === true && typeof stdin.setRawMode === "function" &&
    env.CI === undefined && !/^dumb$/iu.test(env.TERM ?? "") &&
    !Object.keys(env).some((name) => promptHook.test(name)) &&
    (stdout.columns || 80) >= minColumns && (stdout.rows || 24) >= minRows
  );
}

/** A path as a person reads it, with the home folder as `~`. */
export function homePath(file: string): string {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
}

const rowWidth = (row: CardRow): number => row.reduce((total, [text]) => total + cellWidth(text), 0);

function padRow(row: CardRow, width: number, style?: Ink): CardRow {
  const gap = width - rowWidth(row);
  return gap > 0 ? [...row, [" ".repeat(gap), style]] : row;
}

/** `text` along a gradient, starting `from` cells into a run of `total`; equal neighbours share a span. */
function ramp(text: string, stops: readonly string[], style: (hex: string) => Ink, from = 0, total = text.length): Span[] {
  const runs: { text: string; step: number }[] = [];
  [...text].forEach((char, index) => {
    const step = Math.round(((from + index) / Math.max(1, total - 1)) * 24);
    const last = runs.at(-1);
    if (last?.step === step) last.text += char;
    else runs.push({ text: char, step });
  });
  return runs.map((run): Span => [run.text, style(gradientAt(stops, run.step / 24))]);
}

export function createInstallCards(terminal: CardTerminal) {
  const { stdin, stdout, env, animate = true, settleMs = settleDelayMs, now = Date.now } = terminal;
  const proc: CardProcess = terminal.proc ?? process;
  const depth = colourDepth(terminal);
  const plain = depth < 4;
  const ascii = asciiLocale(env);
  const glyph = ascii ? asciiGlyphs : unicodeGlyphs;
  const round = depth >= 24 && !ascii && !lightAppearance(env) &&
    (terminal.caps ?? roundCaps(env, () => iconFontInstalled(fontFolders(env, process.platform))));
  const capLeft = "\ue0b6";
  const capRight = "\ue0b4";
  let letterAt = Number.NEGATIVE_INFINITY;
  let asked = 0;
  let expected = 0;

  // ---- rows
  const columns = (): number => stdout.columns || 80;
  const height = (): number => stdout.rows || 24;
  const budget = (): number => height() - 1;
  const innerWidth = (): number => Math.min(columns() - 2, maxWidth) - 4;
  const say = (text: string): string => {
    const clean = stripControls(text);
    if (!ascii) return clean;
    return Object.entries(asciiWords).reduce((out, [from, to]) => out.replaceAll(from, to), clean).replace(/[^\x20-\x7e]/gu, "?");
  };
  const cut = (text: string, width: number): string => {
    const short = truncateCells(text, Math.max(1, width));
    return ascii ? short.replace("…", "~") : short;
  };
  const quiet = (text: string): Span => [text, { dim: true }];
  const wrapRows = (text: string, width: number, style?: Ink): CardRow[] => wrapValue(say(text), width).map((line): CardRow => [[line, style]]);
  const encode = (row: CardRow): string => row.map(([text, style = {}]) => {
    if (plain || text === "") return text;
    // Sixteen colours have no dark violet, and a theme may redraw any of them: reverse video always reads.
    if (style.bg === bar && depth < 8) return `\u001b[1;7m${text}\u001b[0m`;
    const codes = [
      style.bold === true ? "1" : "",
      style.dim === true ? "2" : "",
      style.fg === undefined ? "" : colourCode(style.fg, false, depth),
      style.bg === undefined ? "" : colourCode(style.bg, true, depth)
    ].filter((code) => code !== "");
    return codes.length === 0 ? text : `\u001b[${codes.join(";")}m${text}\u001b[0m`;
  }).join("");

  /** The key hints, as many on a row as fit; one hint is never split. */
  const hintRows = (hints: readonly string[]): CardRow[] => {
    const lines: string[] = [];
    for (const hint of hints) {
      const joined = lines.length === 0 ? hint : lines[lines.length - 1] + "   " + hint;
      if (lines.length > 0 && cellWidth(joined) <= innerWidth()) lines[lines.length - 1] = joined;
      else lines.push(hint);
    }
    return lines.map((line): CardRow => [quiet(line)]);
  };

  /** A filled pill, `text` + 2 cells: the caps take the cells that are padding in the square form. */
  const pill = (text: string, stops: readonly string[]): Span[] => {
    if (plain) return [[`[${text}]`]];
    const use = depth < 8 ? [stops[0]] : stops;
    const fill = (from: number, part: string): Span[] => ramp(part, use, (bg) => ({ fg: ink, bg, bold: true }), from, cellWidth(text) + 2);
    if (!round) return fill(0, ` ${text} `);
    return [[capLeft, { fg: gradientAt(use, 0) }], ...fill(1, text), [capRight, { fg: gradientAt(use, 1) }]];
  };

  const frame = (tag: string, title: string, body: readonly CardRow[], bad = false): CardRow[] => {
    const inner = innerWidth();
    const width = inner + 4;
    const heading = say(title);
    const border = (text: string, from: number): Span[] => ramp(text, bad ? [red, red] : neon, (fg) => ({ fg }), from, width);
    const badge = pill(tag, [orange, pink]);
    const onEdge = rowWidth(badge) + cellWidth(heading) + 9 <= width;
    const label: Span[] = [[" "], ...badge, [" "], ...(onEdge ? [quiet(say("·")), [" "], [heading, { bold: true }], [" "]] as const : [])];
    const used = 2 + rowWidth(label);
    const rows = onEdge ? body : [...wrapRows(heading, inner, { bold: true }), ...body];
    return [
      [...border(glyph.tl + glyph.h, 0), ...label, ...border(glyph.h.repeat(width - used - 1) + glyph.tr, used)],
      ...rows.map((row): CardRow => [...border(glyph.v, 0), [" "], ...padRow(row, inner), [" "], ...border(glyph.v, width - 1)]),
      border(glyph.bl + glyph.h.repeat(width - 2) + glyph.br, 0)
    ].map((row): CardRow => [[" "], ...row]);
  };

  /** The first body that fits the window, roomiest first; the last one when none does. */
  const fit = (tag: string, title: string, bodies: readonly (() => readonly CardRow[])[]): { rows: CardRow[]; fits: boolean } => {
    let rows: CardRow[] = [];
    for (const body of bodies) {
      rows = frame(tag, title, body());
      if (rows.length < budget()) return { rows: [[], ...rows], fits: true };
      if (rows.length === budget()) return { rows, fits: true };
    }
    return { rows, fits: false };
  };

  const folded = (mark: string, colour: string, title: string, value: string, style: Ink = { bold: true }): CardRow => {
    const name = say(title);
    const lead: Span = [` ${mark} `, { fg: colour, bold: true }];
    const room = (label: string): number => columns() - rowWidth([lead]) - cellWidth(label) - 1;
    const wide = name + " ".repeat(Math.max(0, valueGap + 3 - rowWidth([lead]) - 1 - cellWidth(name))) + " ";
    const text = say(value);
    const label = cellWidth(text) <= room(wide) ? wide : name + " ";
    return [lead, [label], [cut(text, room(label)), style]];
  };
  const answered = (title: string, value: string): CardRow => folded(glyph.done, green, title, value);
  const warning = (text: string): CardRow[] =>
    wrapValue(say(text), columns() - 4).map((line, index): CardRow => [[index === 0 ? ` ${glyph.warn} ` : "   ", { fg: amber, bold: true }], [line, { bold: true }]]);

  /** A step that finished with a warning: its value is never cut. */
  const warnedFold = (title: string, text: string): CardRow[] => {
    const room = columns() - valueGap - 4;
    if (room < 24) return warning(`${title}: ${text}`);
    return wrapValue(say(text), room).map((line, index): CardRow => (index === 0 ? folded(glyph.warn, amber, title, line) : [[" ".repeat(valueGap + 3)], [line, { bold: true }]]));
  };

  // ---- drawing in place
  let drawn: readonly CardRow[] = [];
  let drawnText: readonly string[] = [];
  const up = (count: number): string => (count > 0 ? `\u001b[${String(count)}A` : "");
  const draw = (rows: readonly CardRow[]): void => {
    const shown = rows.slice(-Math.max(1, budget()));
    const text = shown.map(encode);
    const same = text.length === drawnText.length;
    let out = up(drawnText.length) + "\r" + (same ? "" : "\u001b[J");
    text.forEach((line, index) => { out += same && drawnText[index] === line ? "\r\n" : `${line}\u001b[K\r\n`; });
    drawn = shown;
    drawnText = text;
    stdout.write(out);
  };
  const forget = (): void => { drawn = []; drawnText = []; };
  // After a resize the old rows may have wrapped: step over what they take up now, then draw afresh.
  const erase = (): void => {
    const taken = drawn.reduce((total, row) => total + Math.max(1, Math.ceil(rowWidth(row) / columns())), 0);
    stdout.write(`${up(Math.min(taken, budget()))}\r\u001b[J`);
    forget();
  };
  const print = (rows: readonly CardRow[]): void => { stdout.write(rows.map((row) => encode(row) + "\r\n").join("")); };
  // Folds stand on consecutive rows; every other block starts with its own blank row.
  let folding = false;
  const printFolds = (rows: readonly CardRow[]): void => {
    print(folding ? rows : [[], ...rows]);
    folding = true;
  };
  const printBlock = (rows: readonly CardRow[]): void => {
    print([[], ...rows]);
    folding = false;
  };
  const replace = (rows: readonly CardRow[]): void => { erase(); printFolds(rows); };

  // ---- the terminal's own state
  let held = false;
  const restore = (): void => {
    if (!held) return;
    held = false;
    stdout.write("\u001b[?25h");
    stdin.setRawMode?.(false);
    stdin.pause();
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const onSignal = (signal: NodeJS.Signals): void => { release(); proc.kill(proc.pid, signal); };
  const hold = (): void => {
    if (held) return;
    held = true;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdout.write("\u001b[?25l");
    proc.on("exit", restore);
    for (const signal of signals) proc.on(signal, onSignal);
  };
  function release(): void {
    restore();
    proc.removeListener("exit", restore);
    for (const signal of signals) proc.removeListener(signal, onSignal);
  }
  // Raw mode keeps Ctrl+Z from the shell, so the whole job is stopped here and the card drawn again on return.
  const suspend = (resume: () => void): void => {
    stdout.write("\u001b[?25h");
    stdin.setRawMode?.(false);
    proc.once("SIGCONT", () => {
      if (!held) return;
      stdin.setRawMode?.(true);
      stdout.write("\u001b[?25l");
      forget();
      resume();
    });
    proc.kill(0, "SIGTSTP");
  };

  // Keys typed before a card is on screen were never meant for it; only Ctrl+C counts.
  const settle = (): Promise<void> => new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onData = (chunk: Buffer | string): void => { if (String(chunk).includes("\u0003")) finish(new Error("Aborted with Ctrl+C")); };
    const timer = setTimeout(finish, settleMs);
    stdin.on("data", onData);
  });

  type Card<T> = {
    readonly title: string;
    readonly view: () => readonly CardRow[];
    readonly onKey: (key: Key) => { readonly value: T } | undefined;
    readonly fold: (value: T) => readonly CardRow[];
  };

  async function ask<T>({ title, view, onKey, fold }: Card<T>): Promise<T> {
    asked += 1;
    hold();
    const detach: (() => void)[] = [];
    try {
      await settle();
      draw(view());
      const value = await new Promise<T>((resolve, reject) => {
        let over = false;
        const end = (act: () => void): void => { if (!over) { over = true; act(); } };
        const onKeypress = (text: string | undefined, press: Keypress = {}): void => {
          if (over) return;
          const name = press.name ?? "";
          if (press.ctrl === true && (name === "c" || name === "d")) return end(() => reject(new Error(`Aborted with Ctrl+${name.toUpperCase()}`)));
          if (press.ctrl === true && name === "z" && proc.platform !== "win32") return suspend(() => { if (!over) draw(view()); });
          if (press.meta === true && name !== "escape") return;
          const enter = name === "return" || name === "enter";
          if (enter && now() - letterAt < letterEnterMs) return;
          try {
            const answer = onKey({ text: text ?? "", name, enter, ctrl: press.ctrl === true });
            if (answer === undefined) draw(view());
            else end(() => resolve(answer.value));
          } catch (error) {
            end(() => reject(error instanceof Error ? error : new Error(String(error))));
          }
        };
        const onResize = (): void => { if (!over) { erase(); draw(view()); } };
        const onEnd = (): void => end(() => reject(new Error("Aborted: the terminal closed")));
        emitKeypressEvents(stdin);
        stdin.on("keypress", onKeypress);
        stdout.on("resize", onResize);
        stdin.on("end", onEnd);
        detach.push(() => stdin.removeListener("keypress", onKeypress), () => stdout.removeListener("resize", onResize), () => stdin.removeListener("end", onEnd));
      });
      replace(fold(value));
      return value;
    } catch (error) {
      replace([folded(glyph.fail, red, title, "stopped")]);
      throw error;
    } finally {
      for (const off of detach) off();
      release();
    }
  }

  const tag = (): string => (expected === 0 ? "LIT" : `LIT ${String(Math.max(1, asked))}/${String(Math.max(asked, expected))}`);

  // ---- pick one
  type ChooseCard = {
    readonly title: string;
    readonly note: string;
    readonly choices: readonly CardChoice[];
    readonly initial: number;
    /** What the marked row is: the shipped default, or what is saved now. */
    readonly mark?: "default" | "current";
  };

  async function choose({ title, note, choices, initial, mark = "default" }: ChooseCard): Promise<number> {
    const filterable = choices.length > numberedChoices;
    const labels = choices.map((choice) => say(choice.label));
    const details = choices.map((choice) => say(choice.detail ?? ""));
    const markWord = plain ? `(${mark})` : mark;
    let filter = "";
    let at = initial;

    const matches = (): number[] => {
      const words = filter.toLowerCase().split(/\s+/u).filter((word) => word !== "");
      return choices.flatMap((choice, index) => (choice.sticky === true || words.every((word) => labels[index].toLowerCase().includes(word)) ? [index] : []));
    };
    const first = (): void => {
      const found = matches();
      if (!found.includes(at)) at = found.includes(initial) ? initial : (found[0] ?? -1);
      else if (choices[at].sticky === true && filter !== "") at = found[0];
    };
    const move = (by: number): void => {
      const found = matches();
      if (found.length === 0) return;
      const next = found.indexOf(at) + by;
      at = found[Math.abs(by) > 1 ? Math.max(0, Math.min(found.length - 1, next)) : (next + found.length) % found.length];
    };

    const view = (): readonly CardRow[] => {
      const inner = innerWidth();
      const found = matches();
      // gutter, pointer, space, and a key with its space; the right gutter closes the row.
      const lead = filterable ? 3 : 5;
      const room = inner - lead - 1;
      const markText = cellWidth(labels[initial] ?? "") + 2 + markWord.length <= room ? markWord : "*";
      // Only rows with a detail share the detail's column; a long label without one may run past it.
      const longest = Math.max(...labels.map((label, index) => (details[index] === "" && details.some((detail) => detail !== "") ? 0 : cellWidth(label))));
      const markRoom = (index: number): number => (index === initial ? markText.length + 2 : 0);
      const labelWidth = Math.min(longest, room - markText.length - 2);
      const beside = labels.every((_, index) => details[index] === "" || cellWidth(details[index]) + labelWidth + 2 + markRoom(index) <= room);
      const under = !beside && choices.length <= 5;

      const optionRows = (index: number, stacked: boolean): CardRow[] => {
        const on = index === at;
        const style = (normal?: Ink): Ink | undefined => (on && !plain ? { ...normal, fg: ivory, bg: bar, dim: false, bold: normal?.dim !== true } : normal);
        const detail = beside ? details[index] : "";
        const label = cut(labels[index], room - markRoom(index) - (detail === "" ? 0 : cellWidth(detail) + 2));
        const column = details[index] === "" ? 0 : labelWidth;
        const row: Span[] = [
          [" ", style()],
          [`${on ? glyph.pointer : " "} `, style()],
          ...(filterable ? [] : [[`${String(index)} `, style()] as const]),
          [label + " ".repeat(Math.max(0, column - cellWidth(label))), style()],
          ...(detail === "" ? [] : [["  " + detail, style({ dim: true })] as const]),
          ...(index === initial ? [["  " + markText, on ? style() : { fg: pink, bold: true }] as const] : [])
        ];
        const extra = stacked && details[index] !== "" ? wrapValue(details[index], room).map((line): CardRow => [[" ".repeat(lead), style()], [line, style({ dim: true })]]) : [];
        return [row, ...extra].map((line): CardRow => {
          const whole = padRow(line, inner, style());
          if (!on || !round) return whole;
          const last = whole[whole.length - 1];
          const tail: Span[] = last[0] === " " ? [] : [[last[0].slice(0, -1), last[1]]];
          const [, ...rest] = whole[0][0] === " " ? whole : [whole[0], [whole[0][0].slice(1), whole[0][1]] as const, ...whole.slice(1)];
          return [[capLeft, { fg: bar }], ...rest.slice(0, -1), ...tail, [capRight, { fg: bar }]];
        });
      };
      // What a list row had no room for, spelled out for the highlighted row. Every row reserves the same space.
      const spelledOut = (index: number): string => [cellWidth(labels[index]) > room - markRoom(index) ? labels[index] : "", beside ? "" : details[index]].filter((part) => part !== "").join(" ");
      const footRows = (): CardRow[] => {
        const reserve = Math.max(0, ...choices.map((_, index) => (spelledOut(index) === "" ? 0 : wrapValue(spelledOut(index), room).length)));
        const text = at < 0 || spelledOut(at) === "" ? [] : wrapValue(spelledOut(at), room);
        return Array.from({ length: reserve }, (_, index): CardRow => [[" ".repeat(lead)], quiet(text[index] ?? "")]);
      };
      const windowRows = (count: number): CardRow[] => {
        const start = Math.max(0, Math.min(found.indexOf(at) - Math.floor(count / 2), found.length - count));
        const rows = found.slice(start, start + count).flatMap((index) => optionRows(index, false));
        return filterable ? [...rows, ...Array.from({ length: Math.max(0, count - rows.length) }, (): CardRow => [])] : rows;
      };

      const noteRows = wrapRows(note, inner);
      const position = `${String(found.indexOf(at) + 1)}/${String(found.length)}`;
      const listed = choices.filter((choice) => choice.sticky !== true).length;
      const shown = found.filter((index) => choices[index].sticky !== true).length;
      const count = filter === "" ? `${String(listed)} to choose from` : `${String(shown)} of ${String(listed)}`;
      const filterRow = (): CardRow => {
        const typed = cut(filter, Math.max(4, inner - 12 - count.length));
        const left: Span[] = [["Filter  ", { fg: pink, bold: true }], [filter.endsWith(" ") ? typed + " " : typed, { bold: true }], [glyph.caret, { fg: accent }], ...(filter === "" ? [quiet(" type to filter")] : [])];
        const gap = inner - rowWidth(left) - count.length;
        return gap >= 2 ? [...left, [" ".repeat(gap)], quiet(count)] : left.slice(0, 3);
      };

      if (!filterable) {
        const hints = hintRows([`${glyph.updown} move`, `0-${String(choices.length - 1)} jump`, "Enter choose", "Ctrl+C stop"]);
        const all = (stacked: boolean): CardRow[] => choices.flatMap((_, index) => optionRows(index, stacked));
        const foot = (): CardRow[] => (beside ? [] : footRows());
        const list = (): CardRow[] => [...all(under), ...(beside || under ? [] : [[], ...foot()])];
        const whole = fit(tag(), title, [() => [[], ...noteRows, [], ...list(), [], ...hints], () => [...noteRows, ...list().filter((row) => row.length > 0), ...hints], () => [...noteRows, ...all(false), ...foot(), ...hints]]);
        if (whole.fits) return whole.rows;
        // Too short for the whole list: a window on it that follows the highlight.
        const short = hintRows([`${position} ${glyph.updown}`, "Enter choose", "Ctrl+C stop"]);
        const spare = (tail: readonly CardRow[]): number => budget() - frame(tag(), title, [...noteRows, ...tail, ...short]).length;
        const tail = spare(foot()) >= 1 ? foot() : [];
        return frame(tag(), title, [...noteRows, ...windowRows(Math.max(1, Math.min(choices.length, spare(tail)))), ...tail, ...short]);
      }
      const hints = hintRows([`${glyph.updown} move`, "Enter choose", "Esc clear filter", "Ctrl+C stop"]);
      const rest = [...noteRows, filterRow(), ...footRows(), ...hints];
      const roomy = budget() - frame(tag(), title, rest).length;
      const list = (count: number): CardRow[] => windowRows(Math.max(1, Math.min(choices.length, count)));
      return fit(tag(), title, [
        () => [[], ...noteRows, [], filterRow(), ...list(listRows), ...footRows(), [], ...hints],
        () => [...noteRows, filterRow(), ...list(Math.min(listRows, roomy)), ...footRows(), ...hints],
        () => [...noteRows, filterRow(), ...list(1), ...hints]
      ]).rows;
    };

    return ask<number>({
      title,
      view,
      fold: (value) => [answered(title, labels[value])],
      onKey: ({ text, name, enter, ctrl }) => {
        if (enter) return at < 0 ? undefined : { value: at };
        if (name === "up") move(-1);
        else if (name === "down") move(1);
        else if (name === "pageup") move(-listRows);
        else if (name === "pagedown") move(listRows);
        else if (name === "home") move(-choices.length);
        else if (name === "end") move(choices.length);
        else if (filterable) {
          if (name === "escape" || (ctrl && name === "u")) filter = "";
          else if (name === "backspace") filter = [...filter].slice(0, -1).join("");
          else if (!ctrl && text !== "" && stripControls(text) === text) filter = (filter + text).trimStart().slice(0, 80);
          else return undefined;
          first();
        } else if (!ctrl) {
          if (name === "k") move(-1);
          else if (name === "j") move(1);
          else if (/^\d$/u.test(text) && Number(text) < choices.length) at = Number(text);
        }
        return undefined;
      }
    });
  }

  // ---- yes or no
  type ConfirmCard = { readonly title: string; readonly note: string; readonly initial: boolean; readonly yes?: string; readonly no?: string };

  type Button = { readonly label: string; readonly on: boolean };
  const litEdge = ascii ? "#=####" : plain ? "╔═╗║╚╝" : "╭─╮│╰╯";
  const button = ({ label, on }: Button, small: boolean, cells: number): CardRow[] => {
    const text = `${on ? glyph.pointer : " "} ${label}`.padEnd(cells);
    const width = cellWidth(text) + 6;
    if (small) return [on ? pill(text, [pink, violet]) : [quiet(` ${text} `)]];
    const [tl, h, tr, v, bl, br] = on ? [...litEdge] : [glyph.tl, glyph.h, glyph.tr, glyph.v, glyph.bl, glyph.br];
    const edge = (part: string, from: number): Span[] => (on ? ramp(part, [pink, violet], (fg) => ({ fg }), from, width) : [quiet(part)]);
    const chip: Span[] = on && !plain ? pill(text, [pink, violet]) : [[` ${text} `, on ? { bold: true } : undefined]];
    return [
      edge(tl + h.repeat(width - 2) + tr, 0),
      [...edge(v, 0), [" "], ...chip, [" "], ...edge(v, width - 1)],
      edge(bl + h.repeat(width - 2) + br, 0)
    ];
  };
  const buttonRow = (labels: readonly Button[], small: boolean, cells: number): CardRow[] => {
    const each = labels.map((entry) => button(entry, small, cells));
    return each[0].map((_, line): CardRow => each.flatMap((rows, index) => (index === 0 ? rows[line] : [["  "] as const, ...rows[line]])));
  };
  const buttonBodies = (lead: readonly CardRow[], labels: readonly Button[], hints: readonly string[]): (() => readonly CardRow[])[] => {
    const tight = innerWidth() < 44;
    const cells = tight ? buttonCells - 2 : buttonCells;
    const shown = tight ? labels.map((entry) => ({ ...entry, label: entry.label.replace("(default)", "default") })) : labels;
    const wide = buttonRow(shown, false, cells);
    const small = buttonRow(shown, true, cells);
    const big = rowWidth(wide[0]) <= innerWidth() ? wide : small;
    return [
      () => [[], ...lead, [], ...big, [], ...hintRows(hints)],
      () => [...lead, ...big, ...hintRows(hints)],
      () => [...lead, ...small, ...hintRows(hints)]
    ];
  };

  async function confirm({ title, note, initial, yes: yesFold = "yes", no: noFold = "no" }: ConfirmCard): Promise<boolean> {
    let yes = initial;
    const name = (value: boolean): string => (value ? "Yes" : "No") + (value === initial ? " (default)" : "");
    return ask<boolean>({
      title,
      view: () => fit(tag(), `${title} ${initial ? "[Y/n]" : "[y/N]"}`, buttonBodies(
        wrapRows(note, innerWidth()),
        [{ label: name(true), on: yes }, { label: name(false), on: !yes }],
        ["y / n answer", `${glyph.sides} switch`, `Enter = ${yes ? "Yes" : "No"}`, "Ctrl+C stop"]
      )).rows,
      fold: (value) => [answered(title, value ? yesFold : noFold)],
      onKey: ({ text, name: key, enter, ctrl }) => {
        if (enter) return { value: yes };
        if (!ctrl && /^[yn]$/iu.test(text)) {
          letterAt = now();
          return { value: /y/iu.test(text) };
        }
        if (key === "left" || key === "right" || key === "tab") yes = !yes;
        return undefined;
      }
    });
  }

  // ---- fields of a finished or a waiting card
  const marks = { done: [glyph.done, green], note: [glyph.note, violet], warn: [glyph.warn, amber], fail: [glyph.fail, red] } as const;
  const fieldRows = (fields: readonly CardField[], usual: "done" | "note" | "fail"): CardRow[] => {
    const inner = innerWidth();
    const signWidth = glyph.done.length + 1;
    const labelWidth = valueGap - signWidth;
    const stacked = inner < 56;
    return fields.flatMap(({ label, value, mark = usual }) => {
      const [sign, colour] = marks[mark];
      const lead: Span = [sign.padEnd(signWidth), { fg: colour, bold: true }];
      const style: Ink | undefined = mark === "warn" || mark === "fail" ? { bold: true } : undefined;
      const gap = signWidth + (stacked ? 0 : labelWidth);
      const lines = wrapValue(say(value), inner - gap).map((line): CardRow => [[" ".repeat(gap)], [line, style]]);
      if (stacked) return [[lead, [label, { bold: true }]] as CardRow, ...lines];
      return [[lead, [label.padEnd(labelWidth - 1) + " ", { bold: true }], lines[0][1]] as CardRow, ...lines.slice(1)];
    });
  };

  /** A card of facts to look over; Enter goes on. Its warnings stay on screen after it folds. */
  async function proceed({ title, note, fields, done }: { readonly title: string; readonly note: string; readonly fields: readonly CardField[]; readonly done: string }): Promise<void> {
    const bodies = (rows: readonly CardRow[]): (() => readonly CardRow[])[] =>
      buttonBodies([...wrapRows(note, innerWidth()), ...rows], [{ label: "Continue", on: true }], ["Enter = Continue", "Ctrl+C stop, nothing written yet"]);
    const facts = (): CardRow[] => [[], ...fieldRows(fields, "note")];
    // Too many facts for this window: they are printed above the card instead, where they scroll but are never cut.
    const inside = fit(tag(), title, bodies(facts())).fits;
    if (!inside) printBlock(frame("LIT", title, [[], ...fieldRows(fields, "note")]));
    await ask<true>({
      title,
      view: () => fit(tag(), title, bodies(inside ? facts() : [])).rows,
      fold: () => [answered(title, done), ...(inside ? fields.filter(({ mark }) => mark === "warn").flatMap(({ value }) => warning(value)) : [])],
      onKey: ({ enter }) => (enter ? { value: true } : undefined)
    });
  }

  // ---- type a value
  type TypeCard<T> = {
    readonly title: string;
    readonly note: string;
    readonly example: string;
    readonly attempts: number;
    /** The value, or what is wrong with the text. */
    readonly read: (text: string) => { readonly value: T; readonly label: string } | { readonly problem: string };
    readonly exhausted: string;
  };

  async function typed<T>({ title, note, example, attempts, read, exhausted }: TypeCard<T>): Promise<T> {
    let text = "";
    let problem = "";
    let left = attempts;
    const result = await ask<{ readonly value: T; readonly label: string }>({
      title,
      view: () => {
        const inner = innerWidth();
        // The end of a long value stays in sight, where the next letter goes.
        let tail = text;
        while (cellWidth(tail) > inner - 4) tail = [...tail].slice(1).join("");
        const input: CardRow = [[`${glyph.pointer} `, { fg: pink, bold: true }], [tail, { bold: true }], [glyph.caret, { fg: accent }], ...(text === "" && cellWidth(example) + 5 <= inner ? [quiet(` ${example}`)] : [])];
        const trouble = problem === "" ? [] : warningIn(`${problem.replace(/\.?$/u, ".")} ${left === 1 ? "One try left." : `${String(left)} tries left.`}`, inner);
        const hints = hintRows(["Enter use it", "Ctrl+U clear", "Ctrl+C stop"]);
        const noteRows = wrapRows(note, inner);
        return fit(tag(), title, [
          () => [[], ...noteRows, [], input, ...(trouble.length > 0 ? [[], ...trouble] : []), [], ...hints],
          () => [...noteRows, input, ...trouble, ...hints]
        ]).rows;
      },
      fold: ({ label }) => [answered(title, label)],
      onKey: ({ text: letters, name, enter, ctrl }) => {
        if (enter) {
          const answer = read(text);
          if (!("problem" in answer)) return { value: answer };
          problem = answer.problem;
          left -= 1;
          if (left <= 0) throw new Error(exhausted);
        } else if (ctrl && name === "u") text = "";
        else if (name === "backspace") text = [...text].slice(0, -1).join("");
        else if (!ctrl && name !== "escape" && name !== "tab" && letters !== "" && stripControls(letters) === letters) text += letters;
        return undefined;
      }
    });
    return result.value;
  }
  function warningIn(text: string, width: number): CardRow[] {
    return wrapValue(say(text), width - 2).map((line, index): CardRow => [[index === 0 ? `${glyph.warn} ` : "  ", { fg: amber, bold: true }], [line, { bold: true }]]);
  }

  // ---- work in progress
  // Keys pressed while work runs are dropped (echoed, they would push the card about). Ctrl+C still ends the
  // whole job, as the terminal would: a host command this process started must not outlive it.
  let dropKeys: ((chunk: Buffer | string) => void) | undefined;
  const holdKeys = (): void => {
    hold();
    dropKeys = (chunk) => {
      if (!String(chunk).includes("\u0003")) return;
      letGo();
      proc.kill(proc.platform === "win32" ? proc.pid : 0, "SIGINT");
    };
    stdin.on("data", dropKeys);
  };
  function letGo(): void {
    if (dropKeys === undefined) return;
    stdin.removeListener("data", dropKeys);
    dropKeys = undefined;
    release();
  }

  /** One line while a task that blocks this process runs; it folds to what the task found. */
  function busy<T>(title: string, waiting: string, task: () => T, found: (value: T) => { readonly text: string; readonly warn?: boolean }): T {
    // Raw mode stays on until the next card takes over: typed keys are not echoed, and that card reads a Ctrl+C.
    hold();
    draw([folded(glyph.spin[0], accent, title, waiting, { dim: true })]);
    const value = task();
    const { text, warn = false } = found(value);
    replace(warn ? warnedFold(title, text) : [answered(title, text)]);
    return value;
  }

  type StepState = "wait" | "run" | "done" | "fail";
  let steps: { readonly title: string; readonly rows: readonly { readonly name: string; readonly text: string }[]; readonly state: StepState[] } | undefined;
  let spin = 0;
  const stepRows = (): CardRow[] => {
    if (steps === undefined) return [];
    const { title, rows, state } = steps;
    const signWidth = glyph.done.length + 1;
    const usual = valueGap - signWidth - 2;
    const longest = Math.max(...rows.map(({ name }) => cellWidth(name)));
    const nameWidth = rows.every(({ name, text }) => signWidth + Math.max(usual, cellWidth(name)) + 2 + cellWidth(text) <= innerWidth()) ? Math.max(usual, longest) : longest;
    const body = rows.map(({ name, text }, index): CardRow => {
      const step = state[index];
      const sign: Span = step === "wait" ? quiet(glyph.note) : step === "run" ? [glyph.spin[spin % glyph.spin.length], { fg: accent, bold: true }] : [step === "done" ? glyph.done : glyph.fail, { fg: step === "done" ? green : red, bold: true }];
      const row: Span[] = [sign, [" ".repeat(signWidth - cellWidth(sign[0]))], [name.padEnd(nameWidth), step === "run" ? { bold: true } : step === "wait" ? { dim: true } : undefined]];
      return rowWidth(row) + 2 + cellWidth(text) <= innerWidth() ? [...row, quiet("  " + text)] : row;
    });
    return [[], ...frame("LIT", title, [[], ...body], state.includes("fail"))];
  };
  const onStepResize = (): void => { erase(); draw(stepRows()); };
  const endSteps = (): void => {
    stdout.removeListener("resize", onStepResize);
    steps = undefined;
    letGo();
  };

  return {
    /** How many questions this run asks, for the `LIT 2/4` on each card; `next` starts the next one. */
    expect(count: number): void { expected = count; },
    /** Fewer questions than expected turned out to be needed. */
    skip(count: number): void { expected -= count; },
    /** The mark, centred over the cards. */
    banner(rows: readonly string[]): void {
      const width = Math.max(...rows.map((row) => cellWidth(stripControls(row))));
      const indent = " ".repeat(Math.max(0, 1 + Math.floor((innerWidth() + 4 - width) / 2)));
      stdout.write(["", ...rows.map((row) => indent + row)].map((row) => row + "\r\n").join(""));
    },
    intro(text: string): void { printBlock(wrapValue(say(text), innerWidth() + 4).map((line): CardRow => [[" "], quiet(line)])); },
    warn(text: string): void { printFolds(warning(text)); },
    /** A heading, prose and command lines (indented by two) below the last card; a command line is never wrapped. */
    notice(heading: string, lines: readonly string[]): void {
      printBlock([[[" "], [say(heading), { bold: true }]], ...lines.map((line): CardRow => [["   "], [say(line)]])]);
    },
    get textWidth(): number { return innerWidth() + 2; },
    choose, confirm, proceed, type: typed, busy,

    startSteps(title: string, rows: readonly { readonly name: string; readonly text: string }[]): void {
      holdKeys();
      steps = { title, rows, state: rows.map(() => "wait") };
      stdout.on("resize", onStepResize);
      draw(stepRows());
    },
    async runStep<T>(index: number, task: () => Promise<T>): Promise<T> {
      if (steps === undefined) return task();
      const { state } = steps;
      state[index] = "run";
      draw(stepRows());
      const timer = animate ? setInterval(() => { spin += 1; draw(stepRows()); }, 80) : undefined;
      try {
        const value = await task();
        state[index] = "done";
        return value;
      } catch (error) {
        state[index] = "fail";
        throw error;
      } finally {
        clearInterval(timer);
        draw(stepRows());
      }
    },
    finishSteps(title: string, value: string): void {
      if (steps === undefined) return;
      endSteps();
      replace([answered(title, value)]);
    },
    /** Leaves whatever is on screen as it is and adds one failed line. */
    fail(message: string): void {
      forget();
      if (steps !== undefined) endSteps();
      else release();
      print([[[` ${glyph.fail} `, { fg: red, bold: true }], [say(message)]], []]);
    },
    /** The work card stays as it is, with the failed step marked; a red card says what happened. */
    stopSteps(fields: readonly CardField[]): void {
      forget();
      endSteps();
      printBlock(frame("LIT", "INSTALL STOPPED", [[], ...fieldRows(fields, "fail")], true));
      print([[]]);
    },
    get working(): boolean { return steps !== undefined; },
    panel(title: string, sections: readonly CardSection[]): void {
      printBlock(frame("LIT", title, sections.flatMap(({ head, fields }): CardRow[] => [
        [],
        ...(head === undefined ? [] : [[[head, { fg: pink, bold: true }]] as CardRow]),
        ...fieldRows(fields, head === "Installed" ? "done" : "note")
      ])));
    }
  };
}
