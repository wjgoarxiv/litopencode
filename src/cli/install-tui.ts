import type { InstallProgress, InstallStageLabel } from "./types.ts";
import { banner, colorize, lockup, markColorMode, supportsMarkGlyphs } from "../lit-mark.ts";

const reset = "\u001b[0m";
const bold = "\u001b[1m";
const green = "\u001b[38;5;82m";
const muted = "\u001b[38;5;245m";
const amber = "\u001b[38;5;221m";
const litLoopOrange = "\u001b[38;2;255;90;31m";
const litPlanYellow = "\u001b[38;2;250;204;21m";
const boxContentWidth = 56;
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

type InstallStageState = "running" | "complete" | "failed";

type InstallStage = {
  readonly index: number;
  readonly label: InstallStageLabel;
  readonly code: string;
  readonly purpose: string;
  readonly active: string;
  readonly complete: string;
};

type TextOutput = {
  write(value: string): unknown;
};

const installStages: readonly InstallStage[] = [
  {
    index: 1,
    label: "Resolve package",
    code: "PACKAGE",
    purpose: "Resolve package root and the host-native install source",
    active: "Resolving package identity",
    complete: "Package source resolved"
  },
  {
    index: 2,
    label: "Read OpenCode config",
    code: "HOST CONFIG",
    purpose: "Inspect plugin entries without exposing stored secrets",
    active: "Inspecting OpenCode configuration",
    complete: "OpenCode config inspected"
  },
  {
    index: 3,
    label: "Write litopencode.json",
    code: "ROUTES & SKILLS",
    purpose: "Write role routes, commands, and native skill surfaces",
    active: "Writing LitOpenCode surfaces",
    complete: "Routes, commands, and skills ready"
  },
  {
    index: 4,
    label: "Register plugin",
    code: "PLUGIN",
    purpose: "Register through OpenCode or patch the requested custom root",
    active: "Registering plugin with OpenCode",
    complete: "Plugin registered"
  },
  {
    index: 5,
    label: "Verify install",
    code: "HEALTH CHECK",
    purpose: "Confirm the installer surface completed cleanly",
    active: "Verifying installed surfaces",
    complete: "Install surface verified"
  }
] as const;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function color(value: string, code: string): string {
  if (markColorMode() === "none") return value;
  return code + value + reset;
}

function boxTop(title: string): string {
  return "╭─ " + title + " " + "─".repeat(boxContentWidth - title.length - 1) + "╮";
}

function boxLine(value: string): string {
  return "│ " + value.padEnd(boxContentWidth, " ") + " │";
}

function boxBottom(): string {
  return "╰" + "─".repeat(boxContentWidth + 2) + "╯";
}

function findStage(label: InstallStageLabel): InstallStage {
  const stage = installStages.find((candidate) => candidate.label === label);
  if (stage === undefined) throw new Error("Unknown install stage: " + String(label));
  return stage;
}

function stageHeader(stage: InstallStage): string {
  const number = String(stage.index).padStart(2, "0") + " / " + String(installStages.length).padStart(2, "0");
  return "\n  " + color(number, amber) + "  " + color(stage.code, bold) + "\n       " + color(stage.purpose, muted) + "\n";
}

function stageStateLine(stage: InstallStage, state: InstallStageState, frameIndex: number): string {
  if (state === "complete") return "  " + color("✓", green) + " " + stage.complete;
  if (state === "failed") return "  " + color("×", amber) + " " + stage.label + " stopped";
  const frame = spinnerFrames[frameIndex % spinnerFrames.length];
  return "  " + color(frame, amber) + " " + stage.active;
}

function clearLine(output: TextOutput): void {
  output.write(markColorMode() !== "none" ? "\r\u001b[2K" : "\r");
}

const bannerRule = "  " + "━".repeat(46);

function productVersion(packageLabel: string): string {
  const at = packageLabel.lastIndexOf("@");
  return at > 0 ? packageLabel.slice(at + 1) : packageLabel;
}

export function renderLitOpenCodeWordmark(packageLabel: string, colorEnabled = true): string {
  const product = "litopencode v" + productVersion(packageLabel);
  if (!supportsMarkGlyphs()) return "LIT\n" + product;
  return colorize(lockup(product, banner), { mode: colorEnabled ? markColorMode() : "none" }).join("\n");
}

export function renderInstallTuiLogo(packageLabel: string): string {
  const stageRows = installStages.map((stage) =>
    "  │ " + color(String(stage.index).padStart(2, "0"), litPlanYellow) + " · " + stage.label.split(" ")[0].padEnd(10, " ") + " " + color(stage.purpose, muted)
  );
  return [
    "",
    color(bannerRule, litLoopOrange),
    "",
    renderLitOpenCodeWordmark(packageLabel),
    "       " + color("OpenCode plugin installer · visible progress, explicit receipts", muted),
    "",
    color(bannerRule, litLoopOrange),
    "  ╭─ INSTALL",
    ...stageRows,
    "  ╰─ writes begin at 03 / 05 · " + packageLabel,
    ""
  ].join("\n") + "\n";
}

export function renderInstallTuiStage(label: InstallStageLabel, state: InstallStageState, frameIndex: number): string {
  const stage = findStage(label);
  return stageHeader(stage) + stageStateLine(stage, state, frameIndex);
}

export function renderInstallTuiCompletion(): string {
  return [
    "",
    color(boxTop("INSTALL READY"), green),
    boxLine("Plugin, routes, commands, and skills are ready."),
    boxLine("Next     Restart OpenCode · press Tab · choose lit-loop"),
    color(boxBottom(), green),
    ""
  ].join("\n");
}

export function shouldRenderInstallTui(argv: readonly string[]): boolean {
  return process.stdout.isTTY === true && process.env.CI === undefined && argv[0] === "install" && !argv.includes("--dry-run") && !argv.includes("--json");
}

export function createInstallTui(output: TextOutput = process.stdout): InstallProgress {
  let frameIndex = 0;

  function paint(stage: InstallStage): void {
    clearLine(output);
    output.write(stageStateLine(stage, "running", frameIndex));
    frameIndex += 1;
  }

  return {
    async start(packageLabel: string): Promise<void> {
      output.write(renderInstallTuiLogo(packageLabel));
      await sleep(80);
    },
    async run<T>(label: InstallStageLabel, task: () => Promise<T>): Promise<T> {
      const stage = findStage(label);
      output.write(stageHeader(stage));
      paint(stage);
      const timer = setInterval(() => paint(stage), 80);
      try {
        const result = await task();
        clearInterval(timer);
        clearLine(output);
        output.write(stageStateLine(stage, "complete", frameIndex) + "\n");
        return result;
      } catch (error) {
        clearInterval(timer);
        clearLine(output);
        output.write(stageStateLine(stage, "failed", frameIndex) + "\n");
        throw error;
      }
    },
    async complete(): Promise<void> {
      output.write(renderInstallTuiCompletion());
    },
    async fail(message: string): Promise<void> {
      clearLine(output);
      output.write("  " + color("×", amber) + " " + message + "\n\n");
    }
  };
}
