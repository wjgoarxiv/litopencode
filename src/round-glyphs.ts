// Whether pills and gauges may end in round caps (U+E0B6 and U+E0B4), decided once for every surface: the card,
// the prompt chip, the sidebar panel and the installer. The caps come from the terminal itself or from an icon
// font on this machine; over SSH the fonts here are not the ones on screen. The answer lasts for the process.
import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "./cli/jsonc.ts";
import { litOpenCodeConfigFileForOpenCodeRoot } from "./state.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const glyphChoices = ["auto", "round", "square"] as const;
export type GlyphChoice = (typeof glyphChoices)[number];

const terminalsWithCaps: ReadonlySet<string> = new Set(["vscode", "wezterm", "ghostty"]);
const folderDepth = 4;
const nameLimit = 4000;

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

/** The folders where this platform keeps fonts. */
export function fontFolders(env: Env, platform: NodeJS.Platform): readonly string[] {
  const inside = (base: string | undefined, ...parts: string[]): string[] => (isSet(base) ? [path.join(base as string, ...parts)] : []);
  if (platform === "darwin") return [...inside(env.HOME, "Library", "Fonts"), "/Library/Fonts"];
  if (platform === "win32") return [...inside(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"), ...inside(env.WINDIR, "Fonts")];
  return [...(isSet(env.XDG_DATA_HOME) ? inside(env.XDG_DATA_HOME, "fonts") : inside(env.HOME, ".local", "share", "fonts")), ...inside(env.HOME, ".fonts"), "/usr/local/share/fonts", "/usr/share/fonts"];
}

/** True for a font file named as an icon font: `JetBrainsMonoNerdFont-Regular.ttf`, `MesloLGS NF Bold.ttf`. */
export function isIconFontFile(name: string): boolean {
  return /\.(?:ttf|otf|ttc)$/iu.test(name) && (/nerd[ _-]?font/iu.test(name) || /(?:^|[a-z0-9 _-])NF[MP]?[ _.-]/u.test(name));
}

/** Looks for an icon font by file name alone: no file is opened, no link followed, and the look is bounded. */
export function iconFontInstalled(folders: readonly string[], limit = nameLimit): boolean {
  let left = limit;
  const look = (folder: string, depth: number): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (left <= 0) return false;
      left -= 1;
      if (entry.isFile() && isIconFontFile(entry.name)) return true;
      if (entry.isDirectory() && depth > 1 && look(path.join(folder, entry.name), depth - 1)) return true;
    }
    return false;
  };
  return folders.some((folder) => look(folder, folderDepth));
}

export function isGlyphChoice(value: unknown): value is GlyphChoice {
  return glyphChoices.some((choice) => choice === value);
}

/** What `LITOPENCODE_GLYPHS` says; `nerd` and `basic` are older names. */
export function envGlyphChoice(env: Env): GlyphChoice | undefined {
  const value = (env.LITOPENCODE_GLYPHS ?? "").toLowerCase();
  if (value === "nerd") return "round";
  if (value === "basic") return "square";
  return isGlyphChoice(value) ? value : undefined;
}

/** The choice `install --glyphs` saved in litopencode.json. */
export function savedGlyphChoice(root?: string): GlyphChoice {
  try {
    const stored = parseJsonc(fs.readFileSync(litOpenCodeConfigFileForOpenCodeRoot(root), "utf8")) as { readonly glyphs?: unknown } | null;
    return isGlyphChoice(stored?.glyphs) ? stored.glyphs : "auto";
  } catch {
    return "auto";
  }
}

/** A terminal that draws the caps itself, whatever its font. */
export function drawsCaps(env: Env): boolean {
  if (isSet(env.WT_SESSION) || terminalsWithCaps.has((env.TERM_PROGRAM ?? "").toLowerCase())) return true;
  return env.TERM === "xterm-kitty" || isSet(env.KITTY_WINDOW_ID);
}

/** The rule: `LITOPENCODE_GLYPHS`, then the saved choice; on `auto` the terminal, then (not over SSH) an icon font here. */
export function roundCaps(env: Env, hasIconFont: () => boolean, saved: GlyphChoice = "auto"): boolean {
  const choice = envGlyphChoice(env) ?? saved;
  if (choice !== "auto") return choice === "round";
  return drawsCaps(env) || (!isSet(env.SSH_CONNECTION) && hasIconFont());
}

let remembered: boolean | undefined;

/** `roundCaps` for this process; the font folders are read at most once. */
export function roundGlyphs(): boolean {
  remembered ??= roundCaps(process.env, () => iconFontInstalled(fontFolders(process.env, process.platform)), savedGlyphChoice());
  return remembered;
}
