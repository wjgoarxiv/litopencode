// The `ROUND_ENDS:` line that closes install and doctor: whether the pills of the LIT card end round, and if they do
// not, why and the one thing to do. An icon font on disk proves nothing about the terminal on screen, so only a
// terminal known to draw the ends is `ready`, and only a choice the user confirmed is `shown`.
import { run } from "./agent-guide.ts";
import { drawsCaps, envGlyphChoice, type GlyphChoice } from "../round-glyphs.ts";
import { synthwaveBadgeAllowed } from "../tui/mission-text.ts";
import { lightAppearance } from "./install-cards.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type RoundEndsFacts = {
  /** The LIT card is registered with OpenCode. */
  readonly surface: boolean;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly saved: GlyphChoice;
  readonly iconFont: () => boolean;
  /** Why `--round` could not add the font. */
  readonly failure?: string;
  readonly stream?: { readonly isTTY?: boolean };
};

/** What this terminal's colours rule out. An agent's shell says nothing about the user's window, so only a real terminal counts. */
function terminalTrouble(env: Env): string | undefined {
  if (env.NO_COLOR !== undefined) return "NO_COLOR is set; unset it";
  if (/^dumb$/iu.test(env.TERM ?? "")) return "TERM=dumb; use another terminal";
  if (lightAppearance(env)) return "light ground; use a dark theme";
  return synthwaveBadgeAllowed(env, "dark") ? undefined : "fewer colours; use a truecolor terminal";
}

export function roundEndsLine({ surface, env, platform, saved, iconFont, failure, stream }: RoundEndsFacts): string {
  const square = (why: string): string => `ROUND_ENDS: square (${why})`;
  const terminal = stream?.isTTY === true;
  const setting = envGlyphChoice(env);
  const choice = setting ?? saved;
  if (!surface) return square(`no surface enabled; run ${run} install`);
  if (choice === "square") return square(`choice is square; ${setting === undefined ? "run install --glyphs auto" : "unset LITOPENCODE_GLYPHS"}`);
  const trouble = terminal ? terminalTrouble(env) : undefined;
  if (trouble !== undefined) return square(trouble);
  if (choice === "round") return saved === "round" ? "ROUND_ENDS: shown" : "ROUND_ENDS: check (LITOPENCODE_GLYPHS is round; show step 8 of install --agent)";
  if (drawsCaps(env)) return `ROUND_ENDS: ready${terminal ? "" : " in a dark full-colour terminal"}`;
  if ((env.SSH_CONNECTION ?? "") !== "") return square("SSH; if your screen draws them, run install --glyphs round");
  if (iconFont()) return "ROUND_ENDS: check (icon font is here; show your user step 8 of install --agent)";
  if (failure !== undefined) return square(`font not installed (${failure}); retry --round`);
  if (platform === "win32") return square("Windows console; use Windows Terminal");
  return square(`no icon font; run ${run} install --round`);
}
