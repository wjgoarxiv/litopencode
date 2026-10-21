import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findCommandOnPath } from "./host-detect.ts";

/**
 * How to start a command so Windows accepts it. Node refuses to spawn a `.cmd` or `.bat` file
 * without a shell (CVE-2024-27980, `spawn EINVAL`), and a bare `npm` or `opencode` is not found
 * there because only the `.cmd` shim exists. POSIX runs the command as given.
 */
export type CommandPlan = {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
};

export type CommandPlanContext = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly execPath?: string;
  readonly versions?: Readonly<Record<string, string | undefined>>;
  /** The path of a command on PATH, PATHEXT included. */
  readonly find?: (command: string) => string | undefined;
  readonly exists?: (file: string) => boolean;
};

const shimPattern = /\.(?:cmd|bat)$/iu;
const unquotableCharacters = /["%\r\n\0]/u;

/** One cmd.exe argument in double quotes. Refuses what quotes cannot protect, so a value never becomes shell syntax. */
export function quoteForCmd(value: string): string {
  if (unquotableCharacters.test(value)) throw new Error("A Windows command argument may not contain a quote, a percent sign or a line break.");
  return `"${value.replace(/(\\+)$/u, "$1$1")}"`;
}

function resolveCommand(command: string, context: CommandPlanContext): string {
  if (command.includes("/") || command.includes("\\")) return command;
  const find = context.find ?? ((name: string) => findCommandOnPath(name, context.env ?? process.env, "win32"));
  return find(command) ?? command;
}

export function commandPlan(command: string, args: readonly string[], context: CommandPlanContext = {}): CommandPlan {
  if ((context.platform ?? process.platform) !== "win32") return { command, args, shell: false };
  const resolved = resolveCommand(command, context);
  if (!shimPattern.test(resolved)) return { command: resolved, args, shell: false };
  return { command: quoteForCmd(resolved), args: args.map(quoteForCmd), shell: true };
}

/**
 * npm without a `.cmd` shim in the way. Inside OpenCode the plugin runs on a Bun host binary, so
 * `process.execPath` is not Node: npm is found through its shim's own directory instead, and only
 * then through a quoted shell.
 */
export function npmPlan(args: readonly string[], context: CommandPlanContext = {}): CommandPlan {
  if ((context.platform ?? process.platform) !== "win32") return { command: "npm", args, shell: false };
  const env = context.env ?? process.env;
  const execPath = context.execPath ?? process.execPath;
  const versions = context.versions ?? process.versions;
  const exists = context.exists ?? ((file: string) => fs.existsSync(file));
  const npmCli = env.npm_execpath;
  if (npmCli !== undefined && /\.[cm]?js$/iu.test(npmCli) && versions.bun === undefined && /^node(?:\.exe)?$/iu.test(path.win32.basename(execPath))) {
    return { command: execPath, args: [npmCli, ...args], shell: false };
  }
  const shim = resolveCommand("npm", context);
  if (shimPattern.test(shim)) {
    const directory = path.win32.dirname(shim);
    const cli = path.win32.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (exists(cli)) {
      const sibling = path.win32.join(directory, "node.exe");
      const node = exists(sibling) ? sibling : resolveCommand("node", context);
      return { command: node, args: [cli, ...args], shell: false };
    }
  }
  return commandPlan("npm", args, { ...context, platform: "win32" });
}

const execFileAsync = promisify(execFile);

type ExecOptions = { readonly env?: NodeJS.ProcessEnv; readonly cwd?: string; readonly timeout?: number; readonly maxBuffer?: number };

/** `execFile` through a CommandPlan; `npm` is resolved by `npmPlan`. A failure keeps the child's stderr and exit code. */
export async function execCommand(command: string, args: readonly string[], options: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const context: CommandPlanContext = { env: options.env ?? process.env };
  const plan = command === "npm" ? npmPlan(args, context) : commandPlan(command, args, context);
  return await execFileAsync(plan.command, [...plan.args], { ...options, encoding: "utf8", shell: plan.shell, windowsHide: true });
}
