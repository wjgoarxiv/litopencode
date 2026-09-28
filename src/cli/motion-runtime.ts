import { spawnSync } from "node:child_process";
import path from "node:path";
import type { CliResult } from "./types.ts";

// lit-typographic-motion's runtime lives in the managed skill (runtime.mjs, probe.mjs). The CLI verb
// `litopencode motion-runtime install|status` runs it under this same Node binary; the installer
// attempts the same pre-warm and reduces the outcome to one receipt line.
function motionScript(packageRoot: string, file: string): string {
  return path.join(packageRoot, "skills", "lit-typographic-motion", file);
}

export const motionInstallCommand = "litopencode motion-runtime install";

export function runMotionRuntime(packageRoot: string, args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [motionScript(packageRoot, "runtime.mjs"), ...args], { stdio: "inherit" });
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
