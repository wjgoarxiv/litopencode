// `litopencode install --agent`: the install, step by step, for a coding agent whose user asked for it and for that
// user. Plain text only; test/agent-guide.test.mjs ties it to the parser's flags, the installer's own questions and
// the prompts in both READMEs.
import { iconFontPins } from "./icon-font.ts";

export const run = "npm exec --yes --package @litfamily/litopencode@latest -- litopencode";

export const agentCommands = {
  preview: `${run} install --dry-run --round`,
  install: `${run} install --yes --round`,
  doctor: `${run} doctor`,
  round: `${run} install --yes --glyphs round`,
  square: `${run} install --yes --glyphs square`,
  auto: `${run} install --yes --glyphs auto`
} as const;

/** The round ends themselves, for the user to look at. */
export const pill = " LIT ";

const short = "npx @litfamily/litopencode@latest install --agent";
export const agentPointer = `Agent? See ${short}.`;
export const agentHelpLine = `Are you an agent? Run ${short} and follow it with your user.`;

type InstallQuestion = { readonly title: string; readonly default: string; readonly flag?: string; readonly later?: string };

/** The installer's questions in the order it asks them. */
export const installQuestions: readonly InstallQuestion[] = [
  { title: "Lead provider", default: "OpenAI", flag: "--provider <openai|xai> --model <id>" },
  { title: "Lead model", default: "gpt-6-astra", flag: "--model <provider/id>" },
  { title: "Lead reasoning effort", default: "xhigh", flag: "--model <provider/id> --effort <e>" },
  { title: "Helper provider", default: "OpenAI", flag: "--model <provider/id> --subagent-model <provider/id>" },
  { title: "Helper model", default: "gpt-6-luna", flag: "--model <provider/id> --subagent-model <provider/id>" },
  { title: "Helper reasoning effort", default: "max", flag: "--model <provider/id> --subagent-model <provider/id> --subagent-effort <e>" },
  { title: "Model route", default: "Continue", later: "/lit-model in an OpenCode chat" },
  { title: "Permissions", default: "Safe", flag: "--permission-mode <safe|balanced|yolo>" },
  { title: "Output style", default: "None", later: `${run} install in their own terminal` },
  { title: "LitFamily block", default: "Yes", flag: "--no-agent-file" }
];

const questionLine = ({ title, default: value, flag, later }: InstallQuestion): string =>
  `   ${title}: ${value}. ${flag === undefined ? `No flag; your user can choose it later with ${later}.` : `Another answer: ${flag}`}`;

/** True for `install --agent` and a bare `--agent`, whatever flags stand beside it. */
export function asksForAgentGuide(argv: readonly string[]): boolean {
  return argv.includes("--agent") && (argv[0] === "install" || argv[0].startsWith("-"));
}

export function agentGuide(): string {
  return [
    "LitOpenCode install guide for coding agents",
    "",
    "If you are a coding agent and your user asked you to install LitOpenCode, follow these steps. They are written for your user to read too.",
    "",
    "1. Preview",
    `   ${agentCommands.preview}`,
    "   Show your user what it would change. It prints JSON and writes nothing.",
    "   LitOpenCode needs Node.js with npm, and OpenCode: OpenCode 1 (opencode), OpenCode 2 (opencode2) or both. It finds the",
    "   hosts itself; --host v1, --host v2 or --host both picks one. If a program is missing, stop and tell your user.",
    "",
    "2. Ask your user",
    "   Keep every default, or change some? A saved answer from an earlier install stays as it is.",
    ...installQuestions.map(questionLine),
    `   Icon font: ${iconFontPins.files[0].name} with its licence, in ~/Library/Fonts on macOS or \${XDG_DATA_HOME:-~/.local/share}/fonts on`,
    "   Linux. --round adds it only when no icon font is here, so the pills can end round. Windows gets no font.",
    "   Visible surface: the LIT card under the prompt and the LIT panel in the sidebar. Both are on by default.",
    "",
    "3. Wait",
    "   Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.",
    "",
    "4. Install, with the flags for any answer your user changed at the end",
    `   ${agentCommands.install}`,
    "",
    "5. Update later: run the install line of step 4 again. Saved answers stay.",
    "",
    "6. Check",
    `   ${agentCommands.doctor}`,
    "   It passes when install.ok, install.plugin.ok and install.nativeSkills.ok are true.",
    "   The install must print a ROUND_ENDS: line.",
    "",
    "7. If a step fails, show your user the lines and stop.",
    "",
    "8. Rounded ends",
    `   Show your user this and ask if both ends are round: ${pill}`,
    `   Round: ${agentCommands.round}`,
    `   Boxes: ${agentCommands.square}`,
    "   Then your user can set the terminal's own font to a full Nerd Font, or add Symbols Nerd Font Mono as its fallback font:",
    "   iTerm2 Non-ASCII Font, VS Code fontFamily, kitty symbol_map. Terminal.app has no fallback setting, so it needs a full",
    "   Nerd Font as its font. After that, ask again.",
    `   Over SSH or on a phone: leave it as it is. Undo either choice: ${agentCommands.auto}`,
    "",
    "9. Only your user can",
    "   OpenCode 1 and OpenCode 2: quit and start OpenCode again (restart), press Tab and choose lit-loop.",
    "   Sign in to a model provider in OpenCode, approve what OpenCode asks, and trust a Git folder.",
    "   Report what you ran, the ROUND_ENDS: line and what is left for them."
  ].join("\n");
}
