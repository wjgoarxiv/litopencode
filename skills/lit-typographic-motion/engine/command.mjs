// Finding and starting commands on every platform. Windows keeps npm and most shims as `.cmd` files:
// Node refuses to spawn one without a shell (CVE-2024-27980, `spawn EINVAL`), a bare name never
// matches `ffmpeg.exe`, and a child's lines end in CRLF. Each rule here is injectable, so a test
// proves the Windows answer on any machine.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Lines of a child's output, whichever line ending it printed. */
export const splitLines = (text) => String(text ?? "").split(/\r?\n/u);

/** The path of a command on PATH. On Windows the PATHEXT extensions are tried and a bare name never matches. */
export function which(name, env = process.env, platform = process.platform) {
  const windows = platform === "win32";
  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((ext) => ext.toLowerCase());
  const names = !windows ? [name]
    : [...(extensions.some((ext) => name.toLowerCase().endsWith(ext)) ? [name] : []), ...extensions.map((ext) => name + ext)];
  for (const dir of (env.PATH ?? env.Path ?? "").split(windows ? ";" : path.delimiter)) {
    if (!dir) continue;
    for (const candidate of names) {
      const file = path.join(dir, candidate);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}

const shim = /\.(?:cmd|bat)$/iu;

/** One cmd.exe argument in double quotes; what quotes cannot protect is refused, so a value never becomes shell syntax. */
export function quoteForCmd(value) {
  if (/["%\r\n\0]/u.test(value)) throw new Error("A Windows command argument may not contain a quote, a percent sign or a line break.");
  return `"${value.replace(/(\\+)$/u, "$1$1")}"`;
}

/** { command, args, shell } for spawnSync: a `.cmd` or `.bat` shim runs through a shell with quoted arguments. */
export function commandPlan(command, args, { platform = process.platform, env = process.env, find = (name) => which(name, env, "win32") } = {}) {
  if (platform !== "win32") return { command, args, shell: false };
  const resolved = command.includes("/") || command.includes("\\") ? command : find(command) ?? command;
  return shim.test(resolved) ? { command: quoteForCmd(resolved), args: args.map(quoteForCmd), shell: true } : { command: resolved, args, shell: false };
}

/** npm through Node and its own CLI script when one is at hand, else through the quoted shim. */
export function npmPlan(args, { platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync, find = (name) => which(name, env, "win32") } = {}) {
  if (platform !== "win32") return { command: "npm", args, shell: false };
  if (env.npm_execpath && /\.[cm]?js$/iu.test(env.npm_execpath) && /^node(?:\.exe)?$/iu.test(path.win32.basename(execPath))) {
    return { command: execPath, args: [env.npm_execpath, ...args], shell: false };
  }
  const found = find("npm");
  if (found && shim.test(found)) {
    const directory = path.win32.dirname(found);
    const cli = path.win32.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (exists(cli)) {
      const sibling = path.win32.join(directory, "node.exe");
      return { command: exists(sibling) ? sibling : find("node") ?? "node", args: [cli, ...args], shell: false };
    }
  }
  return commandPlan("npm", args, { platform, env, find });
}

/** Runs `command` once to read its Python version: { ok, command, version } when it starts, else ok false. */
export function probePython(command, env = process.env) {
  const launch = commandPlan(command, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], { env });
  const result = spawnSync(launch.command, launch.args, { encoding: "utf8", env, shell: launch.shell, windowsHide: true, timeout: 15000 });
  if (result.error?.code === "ENOENT") return { ok: false, command, detail: "not found" };
  if (result.error || result.status !== 0) return { ok: false, command, detail: (result.stderr || result.error?.message || "did not start").trim() };
  return { ok: true, command, version: result.stdout.trim() };
}

/**
 * The Python a venv of hash-pinned wheels is built from. The pins stop at a minor version, so a newer
 * python3 (such as 3.15) fails pip on the first package without a wheel. `override` is used alone when
 * set; otherwise the newest python3.<max> down to python3.<min> on PATH, then python3 and python.
 * Returns { ok, command, version } or { ok: false, detail } naming each interpreter it passed over.
 */
export function supportedPython({ min, max, override, env = process.env, probe = probePython }) {
  const range = `3.${min} to 3.${max}`;
  const check = (command) => {
    const found = probe(command, env);
    if (!found.ok) return found;
    const [major, minor] = found.version.split(".").map(Number);
    if (major !== 3 || minor < min) return { ok: false, command, detail: `${found.version} is older than 3.${min}` };
    if (minor > max) return { ok: false, command, detail: `${found.version} is newer than 3.${max}` };
    return found;
  };
  const candidates = override ? [override] : [...Array.from({ length: max - min + 1 }, (_, index) => `python3.${max - index}`), "python3", "python"];
  const passed = [];
  for (const command of candidates) {
    const found = check(command);
    if (found.ok) return found;
    if (override || found.detail !== "not found") passed.push(`${command}: ${found.detail}`);
  }
  return { ok: false, detail: `no supported Python (${range})${passed.length > 0 ? `; ${passed.join(", ")}` : " on PATH"}` };
}
