import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CliResult } from "./types.ts";

// lit-typographic-motion's runtime lives in the managed skill (runtime.mjs, probe.mjs). The CLI verb
// `litopencode motion-runtime install|status` runs it under this same Node binary; the installer
// attempts the same pre-warm and reduces the outcome to one receipt line.
function motionScript(packageRoot: string, file: string): string {
  return path.join(packageRoot, "skills", "lit-typographic-motion", file);
}

export const motionInstallCommand = "litopencode motion-runtime install";

const motionUsage = "Usage: litopencode motion-runtime install [--audio] [--word-timing] [--dry-run] | status [--json]";

export type MotionRuntimeArgs =
  | { readonly command: "help" }
  | { readonly command: "install"; readonly audio: boolean; readonly wordTiming: boolean; readonly dryRun: boolean }
  | { readonly command: "status"; readonly json: boolean };

// Every flag is checked before the runtime script runs, because install downloads and writes the
// cache: an unknown or misspelled flag must stop the command, never be ignored.
export function parseMotionRuntimeArgs(args: readonly string[]): MotionRuntimeArgs {
  const [command, ...flags] = args;
  const refuse = (reason: string): never => {
    throw new Error(`motion-runtime: ${reason}\n${motionUsage}`);
  };
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (flags.length > 0) refuse(`unexpected argument after ${command ?? "motion-runtime"}: ${flags[0]}`);
    return { command: "help" };
  }
  if (command === "install") {
    let audio = false;
    let wordTiming = false;
    let dryRun = false;
    for (const flag of flags) {
      if (flag === "--audio") audio = true;
      else if (flag === "--word-timing") wordTiming = true;
      else if (flag === "--dry-run" || flag === "--dry-run=true") dryRun = true;
      else refuse(`unknown install flag ${flag}`);
    }
    return { command: "install", audio, wordTiming, dryRun };
  }
  if (command === "status") {
    let json = false;
    for (const flag of flags) {
      if (flag === "--json") json = true;
      else if (flag === "--dry-run" || flag.startsWith("--dry-run=")) refuse("status only reads the cache, so --dry-run does not apply");
      else refuse(`unknown status flag ${flag}`);
    }
    return { command: "status", json };
  }
  return refuse(`unknown command ${command}`);
}

type MotionRuntimeModule = {
  readonly runtimePaths: (env?: NodeJS.ProcessEnv) => { readonly base: string; readonly node: string; readonly fonts: string; readonly audio: string };
  readonly inspectWarmState: (env?: NodeJS.ProcessEnv) => {
    readonly deps: readonly string[];
    readonly missingFonts: readonly string[];
    readonly mismatchedFonts: readonly string[];
    readonly audio: { readonly ready: boolean; readonly reason?: string };
  };
  readonly describeWordTiming: () => string;
  readonly inspectWordTiming: () => { readonly pinned: boolean };
};

// Reads the same pins and cache state the install uses and reports each step it would take.
// Nothing here downloads, creates the cache, or takes the install lock.
async function describeMotionInstall(packageRoot: string, options: { readonly audio: boolean; readonly wordTiming: boolean }): Promise<string> {
  const runtime = await import(pathToFileURL(motionScript(packageRoot, "runtime.mjs")).href) as MotionRuntimeModule;
  const paths = runtime.runtimePaths(process.env);
  const state = runtime.inspectWarmState(process.env);
  const lines = ["DRY RUN: nothing was downloaded or written.", `motion runtime cache: ${paths.base}`];
  if (options.wordTiming) {
    lines.push(runtime.describeWordTiming());
    if (!runtime.inspectWordTiming().pinned) {
      lines.push("would stop: no licence-verified Korean alignment model is pinned, so the real install exits 14 (BLOCKED_DEPS_NOT_PREWARMED) before downloading anything.");
      return lines.join("\n");
    }
  }
  const fonts = [...state.missingFonts, ...state.mismatchedFonts];
  lines.push(fonts.length === 0 ? "fonts: all pinned fonts are present" : `would fetch and verify ${fonts.length} pinned font file(s) into ${paths.fonts}: ${fonts.join(", ")}`);
  lines.push(state.deps.length === 0 ? "engine dependencies: already installed" : `would run npm ci for ${state.deps.join(", ")} into ${paths.node}`);
  if (options.audio) lines.push(state.audio.ready ? "audio venv: already ready" : `would create the pinned librosa audio venv in ${paths.audio}`);
  lines.push("Run the same command without --dry-run to install.");
  return lines.join("\n");
}

export async function runMotionRuntime(packageRoot: string, args: readonly string[]): Promise<CliResult> {
  let parsed: MotionRuntimeArgs;
  try {
    parsed = parseMotionRuntimeArgs(args);
  } catch (error) {
    return { exitCode: 2, stderr: error instanceof Error ? error.message : String(error) };
  }
  if (parsed.command === "install" && parsed.dryRun) {
    return { exitCode: 0, stdout: await describeMotionInstall(packageRoot, parsed) };
  }
  const forwarded = parsed.command === "help" ? ["--help"]
    : parsed.command === "status" ? ["status", ...(parsed.json ? ["--json"] : [])]
    : ["install", ...(parsed.audio ? ["--audio"] : []), ...(parsed.wordTiming ? ["--word-timing"] : [])];
  const result = spawnSync(process.execPath, [motionScript(packageRoot, "runtime.mjs"), ...forwarded], { stdio: "inherit" });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}

// A test run never reaches the network or the real cache from the installer: node --test marks its
// child processes with NODE_TEST_CONTEXT. LITOPENCODE_MOTION_PREWARM=force (a test proving this path
// against a fixture mirror) or =off overrides that.
export function motionPrewarmSkipped(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.LITOPENCODE_MOTION_PREWARM === "force") return undefined;
  if (env.LITOPENCODE_MOTION_PREWARM === "off") return "LITOPENCODE_MOTION_PREWARM=off";
  if (env.NODE_TEST_CONTEXT !== undefined) return "test run";
  return undefined;
}

export function prewarmMotionRuntime(packageRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const skipped = motionPrewarmSkipped(env);
  if (skipped !== undefined) return `Motion runtime: pre-warm skipped (${skipped}); run ${motionInstallCommand} before rendering.`;
  const result = spawnSync(process.execPath, [motionScript(packageRoot, "runtime.mjs"), "install"], { encoding: "utf8", env, timeout: 600_000, maxBuffer: 8_000_000 });
  if (result.status === 0) return "Motion runtime: pre-warmed; litopencode motion-runtime status shows the five probes.";
  const reason = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? result.error?.message ?? `exit ${String(result.status)}`;
  return `Motion runtime: pre-warm not completed (${reason}); run ${motionInstallCommand} outside any sandboxed session before rendering.`;
}

export function probeMotionRuntime(packageRoot: string): unknown {
  const result = spawnSync(process.execPath, [motionScript(packageRoot, "probe.mjs"), "--json"], { encoding: "utf8", timeout: 90_000, maxBuffer: 4_000_000 });
  if (result.status !== 0 || !result.stdout) return { error: (result.stderr || result.error?.message || "motion probe unavailable").trim() };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: "motion probe returned invalid JSON" };
  }
}
