#!/usr/bin/env node
// Capability probe for the external browser driver this skill delegates to.
//
// It answers one question -- may this session drive a browser, and by what exact command -- and it
// answers it as data. Nothing here installs, downloads, or launches anything. A missing driver is a
// normal result rather than an exception, because "no driver" is the answer that most often decides
// the route.
//
// Resolving a name is not verifying a tool. A command on PATH can carry the expected name and be
// something else entirely, so identity is checked against the version banner before the driver is
// reported usable. This is the engine-probe discipline structural-search already applies here.
import { spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";
import process from "node:process";

export const DRIVER_COMMAND = "agent-browser";
export const VERIFIED_DRIVER_FLOOR = "0.34.0";
export const BROWSER_PROCESS_CLEANUP_FAILED = "BROWSER_PROCESS_CLEANUP_FAILED";

export const BROWSER_DRIVE_BLOCKER = Object.freeze({
  unavailable: "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
  identity: "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED",
  cleanup: "BLOCKED_BROWSER_DRIVER_CLEANUP_FAILED"
});

const bannerLimit = 200;
const spawnOutputLimit = 64 * 1024;
const versionTimeoutMs = 10_000;
const canonicalDriverIdentity = /^agent-browser ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;
const ansiEscape = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const residualControl = /[\p{Cc}\p{Cf}]/u;
const bannerInstruction = /(?:(?:^|[^A-Za-z0-9])(?:ignore|disregard|forget)[\s_-]+(?:all[\s_-]+)?(?:previous|prior|above|earlier)[\s_-]+instructions\b)|(?:\b(?:follow|execute|run)[\s_-]+(?:these|the[\s_-]+following)[\s_-]+instructions\b)|(?:\b(?:system|developer)\s*:\s*)/iu;
const bannerMarkup = /(?:<\/?[A-Za-z][^>\r\n]{0,128}>|<!--|-->|<!\[CDATA\[|\{\{|\}\})/u;
// Without a shell, only a binary the loader runs directly is executable; a .cmd or .bat would need
// cmd.exe interpretation, which reopens the injection surface the direct spawn closes.
const windowsDirectlyExecutable = /\.(?:exe|com)$/iu;
const windowsUnsafeCommand = /["%!^&|<>*?]/u;
// This copy stays in the installed skill because the browser asset runs without the TypeScript
// source tree. The parity test keeps this boundary aligned with src/secret-shapes.ts.
const browserCredentialShapeAlternatives = [
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----`,
  String.raw`(?<![A-Za-z0-9_])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])github_pat[_-][A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`\bsk-[A-Za-z0-9_-]{20,}\b`,
  String.raw`(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`,
  String.raw`(?<![A-Za-z0-9_])(?:xox[baprs]|xapp)-[A-Za-z0-9-]{8,}(?![A-Za-z0-9_-])`,
  String.raw`(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])hf_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])glpat-[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_])`,
  String.raw`(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_])`,
  String.raw`\b(?:authorization\s*:\s*)?(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])`,
  String.raw`\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:token|secret|key)(?:[_-][A-Za-z0-9]+)*\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`\b_?auth(?:[_-]?token)?\s*[:=]\s*[^\s,;]{8,}`,
  String.raw`(?<![A-Za-z0-9+.-])(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/?#\s]+@`
];
const browserCredentialShape = new RegExp(`(?:${browserCredentialShapeAlternatives.join("|")})`, "iu");

export function containsBrowserSecret(value) {
  return typeof value === "string" && value !== "" && browserCredentialShape.test(value);
}

function terminateOwnedPosixProcessGroup(pid) {
  if (process.platform === "win32") return true;
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    // The negative PID targets only the detached group created for this command.
    process.kill(-pid, "SIGKILL");
    return true;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function cleanupFailure(result) {
  const error = new Error("the browser process-group cleanup was not verified");
  error.code = BROWSER_PROCESS_CLEANUP_FAILED;
  return { ...result, error };
}

export function runCommandSync(command, args, options = {}) {
  let result;
  try {
    result = spawnSync(command, args, {
      ...options,
      maxBuffer: Number.isSafeInteger(options.maxBuffer)
        ? Math.min(options.maxBuffer, spawnOutputLimit)
        : spawnOutputLimit,
      // POSIX gets an owned process group. Windows can stop only the direct child.
      detached: process.platform !== "win32",
      killSignal: process.platform === "win32" ? "SIGTERM" : "SIGKILL"
    });
  } catch {
    return null;
  }
  if (process.platform !== "win32") {
    const processWasStarted = Number.isInteger(result?.pid) && result.pid > 1;
    const cleanupMustBeProven = result?.status === 0
      || ["ETIMEDOUT", "ENOBUFS"].includes(result?.error?.code);
    if ((processWasStarted && !terminateOwnedPosixProcessGroup(result.pid))
      || (cleanupMustBeProven && !processWasStarted)) {
      return cleanupFailure(result);
    }
  }
  return result;
}

function meaningfulLines(text) {
  if (typeof text !== "string") return [];
  if (Buffer.byteLength(text, "utf8") > spawnOutputLimit) return null;
  const lines = [];
  for (const raw of text.split(/\r?\n/u)) {
    const withoutAnsi = raw.replace(ansiEscape, "");
    if (residualControl.test(withoutAnsi)) return null;
    const line = withoutAnsi.trim();
    if (line === "") continue;
    if (line.length > bannerLimit) return null;
    lines.push(line);
  }
  return lines;
}

function bannerIsUnsafe(text) {
  if (typeof text !== "string") return false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(ansiEscape, "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
    if (line !== "" && (bannerInstruction.test(line) || bannerMarkup.test(line) || containsBrowserSecret(line))) {
      return true;
    }
  }
  return false;
}

function identifiedVersion(banner) {
  return typeof banner === "string" ? canonicalDriverIdentity.exec(banner)?.[1] ?? null : null;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function report(status, { command = null, version = null, blocker = null, detail }) {
  return { status, command, version, blocker, detail };
}

function minimalProbeEnvironment(searchPath, platform) {
  const env = { PATH: searchPath };
  if (platform === "win32") {
    for (const key of ["ComSpec", "PATHEXT", "SystemRoot"]) {
      if (typeof process.env[key] === "string") env[key] = process.env[key];
    }
  }
  return env;
}

function resolverInvocation(platform) {
  return platform === "win32"
    ? { command: "where.exe", args: [DRIVER_COMMAND], shell: false }
    : { command: "command", args: ["-v", DRIVER_COMMAND], shell: true };
}

function safeDirectExecutable(command, platform) {
  if (platform !== "win32") return true;
  return windowsDirectlyExecutable.test(command) && !windowsUnsafeCommand.test(command);
}

function attempt(runCommand, command, args, options) {
  try {
    return runCommand(command, args, options);
  } catch {
    return null;
  }
}

function resolvedCommand(result, platform) {
  if (result?.status !== 0 || result?.error !== undefined) return null;
  const stdoutLines = meaningfulLines(result.stdout);
  const stderrLines = meaningfulLines(result.stderr);
  return stdoutLines !== null && stderrLines !== null && stdoutLines.length === 1 && stderrLines.length === 0
    && (platform === "win32" ? win32 : posix).isAbsolute(stdoutLines[0])
    && safeDirectExecutable(stdoutLines[0], platform)
    && !bannerIsUnsafe(stdoutLines[0])
    ? stdoutLines[0]
    : null;
}

export function probeBrowserDriver({ path, runCommand = runCommandSync, platform = process.platform } = {}) {
  const searchPath = typeof path === "string" ? path : (process.env.PATH ?? "");
  const env = minimalProbeEnvironment(searchPath, platform);
  const resolver = resolverInvocation(platform);

  const resolved = attempt(runCommand, resolver.command, resolver.args, {
    encoding: "utf8",
    env,
    shell: resolver.shell,
    maxBuffer: spawnOutputLimit
  });
  if (resolved?.error?.code === BROWSER_PROCESS_CLEANUP_FAILED) {
    return report("unverified-identity", {
      blocker: BROWSER_DRIVE_BLOCKER.cleanup,
      detail: `${DRIVER_COMMAND} resolution cleanup was not verified`
    });
  }
  const command = resolvedCommand(resolved, platform);
  if (command === null) {
    return report("unavailable", {
      blocker: BROWSER_DRIVE_BLOCKER.unavailable,
      detail: `${DRIVER_COMMAND} is not on PATH; this session cannot drive a browser`
    });
  }

  // The resolved command is argv[0] of a direct spawn on every platform. A shell would re-parse
  // the resolver's output as command text, which is the injection surface this probe closes.
  const versionRun = attempt(runCommand, command, ["--version"], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: versionTimeoutMs,
    maxBuffer: spawnOutputLimit
  });
  if (versionRun?.error?.code === BROWSER_PROCESS_CLEANUP_FAILED) {
    return report("unverified-identity", {
      command,
      version: null,
      blocker: BROWSER_DRIVE_BLOCKER.cleanup,
      detail: `${command} cleanup was not verified`
    });
  }
  const stdoutLines = meaningfulLines(versionRun?.stdout);
  const stderrLines = meaningfulLines(versionRun?.stderr);
  const versionLines = stdoutLines === null || stderrLines === null
    ? null
    : [...stdoutLines, ...stderrLines];
  const unsafeBanner = bannerIsUnsafe(versionRun?.stdout) || bannerIsUnsafe(versionRun?.stderr);
  const version = versionLines === null || versionLines.length !== 1 || unsafeBanner
    ? null
    : versionLines[0] ?? null;
  if (versionRun === null || versionRun.status !== 0 || versionRun.error !== undefined || version === null) {
    return report("unverified-identity", {
      command,
      version: null,
      blocker: BROWSER_DRIVE_BLOCKER.identity,
      detail: `${command} resolved but did not report a usable version`
    });
  }
  const semver = identifiedVersion(version);
  if (semver === null) {
    return report("unverified-identity", {
      command,
      version: null,
      blocker: BROWSER_DRIVE_BLOCKER.identity,
      detail: `${command} resolved but its version banner does not identify ${DRIVER_COMMAND}`
    });
  }
  if (compareVersions(semver, VERIFIED_DRIVER_FLOOR) < 0) {
    return report("unverified-identity", {
      command,
      version,
      blocker: BROWSER_DRIVE_BLOCKER.identity,
      detail: `${version} is older than the verified floor ${VERIFIED_DRIVER_FLOOR}`
    });
  }
  return report("available", {
    command,
    version,
    detail: compareVersions(semver, VERIFIED_DRIVER_FLOOR) === 0
      ? `${command} identified itself as ${version}; verified floor ${VERIFIED_DRIVER_FLOOR}`
      : `${command} identified itself as ${version}; beyond verified floor ${VERIFIED_DRIVER_FLOOR}`
  });
}

if (process.argv[1]?.endsWith("capability-probe.mjs")) {
  const result = probeBrowserDriver();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "available" ? 0 : 1;
}
