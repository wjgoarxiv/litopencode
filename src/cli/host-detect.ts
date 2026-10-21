// Which OpenCode hosts are installed. OpenCode 1 ships as the npm package `opencode-ai` with the
// `opencode` command; OpenCode 2 ships as `@opencode/cli` with both `opencode` and `opencode2`. When both
// are kept, OpenCode 1 stays `opencode` and OpenCode 2 is run as `opencode2`; they share
// ~/.config/opencode. Detection never starts a host: it reads the npm package behind each command on
// PATH. Only OpenCode 2 ships `opencode2`, so any `opencode2` on PATH is OpenCode 2. An `opencode` it
// cannot place (the curl installer, Homebrew, mise, a Windows shim it cannot read) is taken for OpenCode 1,
// because OpenCode 1 keeps its install however it was installed, unless it is the same file as
// `opencode2`. That guess is confirmed by `confirmUnplacedOpenCode` (which runs `opencode --version`)
// before the installer runs `opencode plugin` on it. With no command on PATH, config files are the
// evidence: cli.json is written only by OpenCode 2, tui.json is OpenCode 1's TUI config. `--host`
// overrides the result.
import fs from "node:fs";
import path from "node:path";

export const hostChoices = ["auto", "v1", "v2", "both"] as const;
export type HostChoice = (typeof hostChoices)[number];
export type HostMode = "v1" | "v2" | "both" | "none";
export type HostMajor = 1 | 2;
export type HostCommand = "opencode" | "opencode2";

export type HostBinary = {
  readonly command: HostCommand;
  readonly major: HostMajor;
  readonly version: string;
};

export type HostDetection = {
  readonly mode: HostMode;
  readonly binaries: readonly HostBinary[];
  /** Commands on PATH with no npm package behind them, and the host each one was taken for. */
  readonly unplaced?: readonly { readonly command: HostCommand; readonly major: HostMajor }[];
  readonly evidence: { readonly cliJson: boolean; readonly tuiJson: boolean };
  readonly v1Command?: string;
  readonly v2Command?: string;
  readonly override?: Exclude<HostChoice, "auto">;
};

export type PackageLike = { readonly name: string; readonly version: string };

export type HostDetectOptions = {
  readonly root: string;
  /** Injected package lookup; with it, PATH is only read through `findCommand`. */
  readonly resolvePackage?: (command: string) => Promise<PackageLike | undefined>;
  /** The real path of a command on PATH, or undefined. */
  readonly findCommand?: (command: string) => string | undefined;
  readonly override?: HostChoice;
};

type PathEnv = { readonly PATH?: string; readonly PATHEXT?: string };

const commands = ["opencode", "opencode2"] as const;
const hostPackages = ["opencode-ai", "@opencode/cli"] as const;
const shimLimitBytes = 64 * 1024;

export function isHostChoice(value: string): value is HostChoice {
  return (hostChoices as readonly string[]).includes(value);
}

function packageMajor(pkg: PackageLike): HostMajor | undefined {
  if (pkg.name === "opencode-ai") return 1;
  if (pkg.name === "@opencode/cli") return 2;
  return undefined;
}

/** A command on PATH. On Windows the PATHEXT extensions are tried too, so an npm `opencode.cmd` is found. */
export function findCommandOnPath(command: string, env: PathEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const windows = platform === "win32";
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext !== "").map((ext) => ext.toLowerCase());
  // npm leaves an extensionless sh script next to `x.cmd`; Windows never runs it, so a bare name matches only with an extension.
  const names = windows
    ? [...(extensions.some((ext) => command.toLowerCase().endsWith(ext)) ? [command] : []), ...extensions.map((ext) => command + ext)]
    : [command];
  for (const directory of (env.PATH ?? "").split(windows ? ";" : path.delimiter)) {
    if (directory === "") continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        fs.accessSync(candidate, windows ? fs.constants.F_OK : fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function readPackageJson(file: string): PackageLike | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { name?: unknown }).name === "string") {
      const { name, version } = parsed as { name: string; version?: unknown };
      return { name, version: typeof version === "string" ? version : "" };
    }
  } catch {
    // No readable package.json here.
  }
  return undefined;
}

/**
 * npm on Windows puts a small `.cmd`/`.ps1` shim next to its `node_modules` instead of a link. The shim is
 * read as text, never run, for the host package path it names.
 */
function packageFromShim(file: string): PackageLike | undefined {
  let text: string;
  try {
    if (fs.statSync(file).size > shimLimitBytes) return undefined;
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const normalized = text.replace(/\\/gu, "/");
  for (const name of hostPackages) {
    if (!normalized.includes(`node_modules/${name}/`)) continue;
    return readPackageJson(path.join(path.dirname(file), "node_modules", ...name.split("/"), "package.json")) ?? { name, version: "" };
  }
  return undefined;
}

/** The npm package that provides a command on PATH, found by following its link to the package folder. */
export async function resolveCommandPackage(command: string, env: PathEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<PackageLike | undefined> {
  const found = findCommandOnPath(command, env, platform);
  if (found === undefined) return undefined;
  let directory: string;
  try {
    directory = path.dirname(fs.realpathSync(found));
  } catch {
    return undefined;
  }
  for (let depth = 0; depth < 4; depth += 1) {
    // Only a host package counts: on Windows the walk starts in the npm folder, where an unrelated
    // package.json further up must not hide the package the shim names.
    const pkg = readPackageJson(path.join(directory, "package.json"));
    if (pkg !== undefined && (hostPackages as readonly string[]).includes(pkg.name)) return pkg;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return packageFromShim(found);
}

function realCommandPath(command: string): string | undefined {
  const found = findCommandOnPath(command);
  if (found === undefined) return undefined;
  try {
    return fs.realpathSync(found);
  } catch {
    return found;
  }
}

async function probe(command: HostCommand, options: HostDetectOptions): Promise<HostBinary | undefined> {
  const pkg = await (options.resolvePackage ?? resolveCommandPackage)(command);
  const major = pkg === undefined ? undefined : packageMajor(pkg);
  return pkg === undefined || major === undefined ? undefined : { command, major, version: pkg.version };
}

function modeOf(v1: boolean, v2: boolean): HostMode {
  if (v1 && v2) return "both";
  if (v1) return "v1";
  if (v2) return "v2";
  return "none";
}

type Unplaced = { command: HostCommand; major: HostMajor };

function summarize(
  binaries: readonly HostBinary[],
  unplaced: readonly Unplaced[],
  evidence: HostDetection["evidence"],
  override: Exclude<HostChoice, "auto"> | undefined
): HostDetection {
  const hosts = [...binaries, ...unplaced];
  const v1Command = hosts.find((host) => host.major === 1)?.command;
  const v2Command = hosts.find((host) => host.major === 2)?.command;
  const detected = hosts.length > 0 ? modeOf(v1Command !== undefined, v2Command !== undefined) : modeOf(evidence.tuiJson, evidence.cliJson);
  return {
    mode: override ?? detected,
    binaries,
    ...(unplaced.length === 0 ? {} : { unplaced }),
    evidence,
    ...(v1Command === undefined ? {} : { v1Command }),
    ...(v2Command === undefined ? {} : { v2Command }),
    ...(override === undefined ? {} : { override })
  };
}

export async function detectOpenCodeHosts(options: HostDetectOptions): Promise<HostDetection> {
  const binaries: HostBinary[] = [];
  for (const command of commands) {
    const binary = await probe(command, options);
    if (binary !== undefined) binaries.push(binary);
  }
  const findCommand = options.findCommand ?? (options.resolvePackage === undefined ? realCommandPath : () => undefined);
  const placed = (command: HostCommand) => binaries.some((binary) => binary.command === command);
  const opencodeFile = placed("opencode") ? undefined : findCommand("opencode");
  const opencode2File = placed("opencode2") ? undefined : findCommand("opencode2");
  const unplaced: Unplaced[] = [];
  if (opencodeFile !== undefined) {
    const sameAsOpenCode2 = findCommand("opencode2") === opencodeFile;
    unplaced.push({ command: "opencode", major: sameAsOpenCode2 ? 2 : 1 });
  }
  if (opencode2File !== undefined) unplaced.push({ command: "opencode2", major: 2 });
  const evidence = {
    cliJson: fs.existsSync(path.join(options.root, "cli.json")),
    tuiJson: fs.existsSync(path.join(options.root, "tui.json")) || fs.existsSync(path.join(options.root, "tui.jsonc"))
  };
  const override = options.override === undefined || options.override === "auto" ? undefined : options.override;
  return summarize(binaries, unplaced, evidence, override);
}

/**
 * Confirms an `opencode` that was only guessed to be OpenCode 1 (no npm package behind it) by asking its
 * version, so `opencode plugin` never runs on OpenCode 2. A 2.x answer makes it OpenCode 2; no readable
 * answer keeps the guess. Runs nothing when there is no guess to confirm.
 */
export async function confirmUnplacedOpenCode(
  detection: HostDetection,
  readVersion: (command: string) => Promise<string | undefined>
): Promise<HostDetection> {
  const guess = detection.unplaced?.find((entry) => entry.command === "opencode" && entry.major === 1);
  if (guess === undefined) return detection;
  const major = /(\d+)\.\d+\.\d+/u.exec((await readVersion(guess.command)) ?? "")?.[1];
  if (major !== "2") return detection;
  const unplaced = (detection.unplaced ?? []).map((entry) => (entry === guess ? { command: entry.command, major: 2 as const } : entry));
  return summarize(detection.binaries, unplaced, detection.evidence, detection.override);
}

/** Whether a detection result means the OpenCode 1 or the OpenCode 2 surfaces must be installed. A host-less result keeps the OpenCode 1 behaviour. */
export function targetsV1(mode: HostMode): boolean {
  return mode === "v1" || mode === "both" || mode === "none";
}

export function targetsV2(mode: HostMode): boolean {
  return mode === "v2" || mode === "both";
}
