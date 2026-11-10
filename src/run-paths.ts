import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultOpenCodeConfigRoot } from "./state.ts";

// What a running start-work task may touch without asking. Secret files and the settings that carry keys or
// load code are refused for the whole run, whatever the grants say. OpenCode's own instruction and skill
// folders are read freely, because reading them is how the host works. Everything else is ordinary and
// goes through the run's grants as before. This module only classifies paths; callers decide what to do.

export type RunPathClass = "harness-read" | "protected" | "ordinary";
export type RunPathAccess = "read" | "write";

export type RunPathContext = {
  readonly projectRoot: string;
  readonly baseDirectory: string;
  readonly home: string;
  readonly configDirs: readonly string[];
  readonly dataDir: string;
};

const caseFolding = process.platform === "darwin" || process.platform === "win32";
const secretKeyNames = new Set(["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]);
const shellRcNames = new Set([".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile"]);
const configFileNames = new Set(["opencode.json", "opencode.jsonc", "config.json", "litopencode.json"]);
const configCodeFolders = ["plugin", "plugins", "agent", "agents", "command", "commands"];

/** The folders the classifier compares against, from the environment the plugin runs in. */
export function defaultRunPathContext(projectRoot: string, baseDirectory = projectRoot): RunPathContext {
  const home = os.homedir();
  const configDirs = [defaultOpenCodeConfigRoot()];
  const extra = process.env.OPENCODE_CONFIG_DIR;
  if (extra && path.isAbsolute(extra)) configDirs.push(extra);
  const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(home, ".local", "share");
  return { projectRoot, baseDirectory, home, configDirs, dataDir: path.join(dataHome, "opencode") };
}

function fold(value: string): string {
  const normal = value.normalize("NFC");
  return caseFolding ? normal.toLowerCase() : normal;
}

/** Real path when it exists; else the real path of the nearest existing parent plus the rest. */
export function canonicalRunPath(target: string): string {
  let current = path.resolve(target);
  const rest: string[] = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest.reverse());
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(fold(root), fold(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The common git dir of a checkout: `.git` itself, or the one a linked worktree's `.git` file points at. */
export function gitCommonDir(root: string): string | undefined {
  const dotGit = path.join(root, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dotGit);
  } catch {
    return undefined;
  }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile() || stat.size > 4096) return undefined;
  const match = /^gitdir:\s*(.+)$/mu.exec(fs.readFileSync(dotGit, "utf8"));
  if (match === null) return undefined;
  const gitdir = path.resolve(root, match[1].trim());
  try {
    const common = fs.readFileSync(path.join(gitdir, "commondir"), "utf8").trim();
    return path.resolve(gitdir, common);
  } catch {
    return gitdir;
  }
}

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/\.(?:example|sample|template)$/u.test(lower)) return false;
  if (lower === ".env" || lower === ".envrc" || /^\.env\.[\w-]+$/u.test(lower)) return true;
  if (secretKeyNames.has(lower)) return true;
  return lower.endsWith(".pem");
}

export function classifyRunPath(target: string, ctx: RunPathContext, access: RunPathAccess): RunPathClass {
  const resolved = canonicalRunPath(path.resolve(ctx.baseDirectory, target));
  const name = path.basename(resolved);
  const home = canonicalRunPath(ctx.home);
  const configDirs = ctx.configDirs.map(canonicalRunPath);
  const dataDir = canonicalRunPath(ctx.dataDir);
  const projectRoot = canonicalRunPath(ctx.projectRoot);

  if (isSecretName(name)) return "protected";
  for (const folder of [".ssh", ".aws", ".gnupg"]) if (inside(path.join(home, folder), resolved)) return "protected";
  for (const file of [".npmrc", ".netrc"]) if (fold(resolved) === fold(path.join(home, file))) return "protected";
  if (fold(resolved) === fold(path.join(dataDir, "auth.json"))) return "protected";
  for (const dir of configDirs) {
    if (configFileNames.has(name) && fold(path.dirname(resolved)) === fold(dir)) return "protected";
  }
  if (access === "write") {
    for (const dir of configDirs) for (const folder of configCodeFolders) if (inside(path.join(dir, folder), resolved)) return "protected";
    if ((name === "opencode.json" || name === "opencode.jsonc") && fold(path.dirname(resolved)) === fold(projectRoot)) return "protected";
    if (inside(path.join(projectRoot, ".opencode"), resolved)) return "protected";
    const litLoop = path.join(projectRoot, ".litopencode", "litgoal", "lit-loop");
    if (fold(path.dirname(resolved)) === fold(litLoop) && (/^work-schema-3\./u.test(name) || name === "cancel-notices.json")) return "protected";
    if (inside(path.join(litLoop, ".work-schema-3.lock"), resolved)) return "protected";
    const common = gitCommonDir(projectRoot);
    if (common !== undefined) {
      const git = canonicalRunPath(common);
      if (inside(path.join(git, "hooks"), resolved) || inside(path.join(git, "worktrees"), resolved) || fold(resolved) === fold(path.join(git, "config"))) return "protected";
    }
    if (shellRcNames.has(name) && fold(path.dirname(resolved)) === fold(home)) return "protected";
    if (inside(path.join(home, ".codex"), resolved) || fold(resolved) === fold(path.join(home, ".claude.json"))) return "protected";
    if (fold(path.dirname(resolved)) === fold(path.join(home, ".claude")) && /^settings.*\.json$/u.test(name)) return "protected";
  }
  if (access === "read") {
    for (const dir of configDirs) {
      if (fold(resolved) === fold(canonicalRunPath(path.join(dir, "AGENTS.md"))) || inside(canonicalRunPath(path.join(dir, "skills")), resolved)) return "harness-read";
    }
    if (inside(canonicalRunPath(path.join(home, ".agents", "skills")), resolved)) return "harness-read";
  }
  return "ordinary";
}
