import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { movedSkillFamilies, type MovedSkillId } from "../moved-skills.ts";
import { pendingExtensionsNoticeName, extensionsShelfUrl } from "../extensions-notice.ts";
import { litOpenCodeRuntimeSkills } from "../skills.ts";
import { hasLitOpenCodeGeneratedFileMarker } from "../user-facing-markdown.ts";
import { readPackageMetadata } from "./json.ts";
import { detectShadowedSkills, nativeSkillContent, nativeSkillsRoot } from "./native-skill-integrity.ts";
import { assertContained, inventoryTree, lstatIfPresent } from "./native-skill-tree.ts";
import type { CliResult } from "./types.ts";

// `litopencode extensions` does the pointer's four lines in code (check, move aside, copy, receipt) for the nine
// skills that moved to wjgoarxiv-skills. It writes only to <root>/skills/<id>, <root>/extension-backups and its own
// source clone under the LitOpenCode cache. Same-name skills in folders OpenCode also reads (~/.agents/skills,
// ~/.claude/skills, a project's skill folders) are read, never written.

export const extensionVerbs = ["list", "check", "install", "update", "remove", "prune-backups"] as const;
type ExtensionVerb = (typeof extensionVerbs)[number];

export const extensionReceiptName = ".litfamily-extension.json";
export const extensionBackupsDirectoryName = "extension-backups";
const variantPath = ["variants", "litopencode"] as const;

export type ExtensionReceipt = {
  readonly id: string;
  readonly source: string;
  readonly variant: string;
  readonly installed_at: string;
  readonly sha256?: string;
};

export type ExtensionEntry = {
  readonly id: MovedSkillId;
  readonly family: string;
  readonly path: string;
  readonly state: "not-installed" | "installed" | "user-managed" | "unsafe";
  readonly pointer: boolean;
  readonly receipt?: ExtensionReceipt;
  readonly competing: readonly string[];
  readonly reason?: string;
};

export type ExtensionIssue = { readonly id?: string; readonly problem: string; readonly fix: string };

export type ExtensionsReport = {
  readonly root: string;
  readonly backups: { readonly path: string; readonly count: number; readonly bytes: number };
  readonly extensions: readonly ExtensionEntry[];
  readonly needsAction: readonly ExtensionIssue[];
  readonly notes: readonly ExtensionIssue[];
};

type ExtensionsArgs = {
  readonly verb: ExtensionVerb;
  readonly ids: readonly MovedSkillId[];
  readonly root: string;
  readonly yes: boolean;
  readonly json: boolean;
  readonly from?: string;
  readonly allowShadow: boolean;
  readonly olderThanDays?: number;
};

const ids = Object.keys(movedSkillFamilies) as MovedSkillId[];
const families: readonly string[] = [...new Set(Object.values(movedSkillFamilies))];
const isMovedSkillId = (value: string): value is MovedSkillId => ids.some((id) => id === value);

class UsageError extends Error {}

function defaultRoot(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "opencode") : path.join(os.homedir(), ".config", "opencode");
}

function cacheSourceDirectory(env: NodeJS.ProcessEnv): string {
  const cacheHome = env.XDG_CACHE_HOME ? env.XDG_CACHE_HOME : path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "litopencode", "extensions-src");
}

export function extensionsUsage(): string {
  return [
    "litopencode extensions: install and manage the nine LitFamily extensions from wjgoarxiv-skills.",
    "",
    "  litopencode extensions list [--json]",
    "  litopencode extensions check [--json]",
    "  litopencode extensions install <skill...> | --family <name> | --all [--from <clone>] [--allow-shadow] [--yes]",
    "  litopencode extensions update [<skill...> | --all] [--from <clone>] [--yes]",
    "  litopencode extensions remove <skill...> [--yes]",
    "  litopencode extensions prune-backups [--older-than <days>] [--yes]",
    "",
    "Every verb that writes is a dry run until you add --yes. Without --from, the shelf is fetched with git into",
    "the LitOpenCode cache. A replaced folder moves whole into extension-backups beside skills/; nothing is deleted",
    "except by prune-backups --yes.",
    `Skills: ${ids.join(", ")}. Families: ${families.join(", ")}.`
  ].join("\n");
}

function parseExtensionsArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ExtensionsArgs {
  const verb = argv[0];
  if (!extensionVerbs.some((candidate) => candidate === verb)) {
    throw new UsageError(`extensions requires a verb: ${extensionVerbs.join(", ")}`);
  }
  const selected: MovedSkillId[] = [];
  let root = defaultRoot(env);
  let yes = false;
  let json = false;
  let from: string | undefined;
  let allowShadow = false;
  let all = false;
  let olderThanDays: number | undefined;
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined || next.trim() === "" || next.startsWith("--")) throw new UsageError(`${flag} requires a value`);
    return next;
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes") yes = true;
    else if (arg === "--dry-run") yes = false;
    else if (arg === "--json" && (verb === "list" || verb === "check")) json = true;
    else if (arg === "--root") root = value(index++, arg);
    else if (arg === "--from" && (verb === "install" || verb === "update")) from = path.resolve(value(index++, arg));
    else if (arg === "--allow-shadow" && verb === "install") allowShadow = true;
    else if (arg === "--all" && (verb === "install" || verb === "update")) all = true;
    else if (arg === "--family" && verb === "install") {
      const name = value(index++, arg);
      if (!families.includes(name)) throw new UsageError(`Unknown family: ${name}. Families: ${families.join(", ")}`);
      selected.push(...ids.filter((id) => movedSkillFamilies[id] === name));
    } else if (arg === "--older-than" && verb === "prune-backups") {
      const days = Number(value(index++, arg));
      if (!Number.isFinite(days) || days < 0) throw new UsageError("--older-than requires a number of days");
      olderThanDays = days;
    } else if (!arg.startsWith("-") && (verb === "install" || verb === "update" || verb === "remove")) {
      if (!isMovedSkillId(arg)) throw new UsageError(`Unknown extension: ${arg}. Extensions: ${ids.join(", ")}`);
      selected.push(arg);
    } else throw new UsageError(`Unknown argument for extensions ${verb}: ${arg}`);
  }
  if (all) selected.push(...ids);
  if ((verb === "install" || verb === "remove") && selected.length === 0) {
    throw new UsageError(`extensions ${verb} needs at least one skill${verb === "install" ? ", --family <name> or --all" : ""}`);
  }
  return { verb: verb as ExtensionVerb, ids: [...new Set(selected)], root, yes, json, allowShadow, ...(from === undefined ? {} : { from }), ...(olderThanDays === undefined ? {} : { olderThanDays }) };
}

// ---------------------------------------------------------------- reading state

async function readReceipt(folder: string, id: string): Promise<ExtensionReceipt | undefined> {
  const file = path.join(folder, extensionReceiptName);
  const stat = await lstatIfPresent(file);
  if (stat === null || !stat.isFile()) return undefined;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.id !== id || typeof record.source !== "string" || typeof record.variant !== "string" || typeof record.installed_at !== "string") return undefined;
    return {
      id,
      source: record.source,
      variant: record.variant,
      installed_at: record.installed_at,
      ...(typeof record.sha256 === "string" ? { sha256: record.sha256 } : {})
    };
  } catch {
    return undefined;
  }
}

async function classify(skillsRoot: string, id: MovedSkillId, competing: readonly string[]): Promise<ExtensionEntry> {
  const folder = path.join(skillsRoot, id);
  const base = { id, family: movedSkillFamilies[id], path: folder, competing };
  const stat = await lstatIfPresent(folder);
  if (stat === null) return { ...base, state: "not-installed", pointer: false };
  if (stat.isSymbolicLink()) return { ...base, state: "unsafe", pointer: false, reason: `${folder} is a symbolic link` };
  if (!stat.isDirectory()) return { ...base, state: "user-managed", pointer: false, reason: "not a directory" };
  const receipt = await readReceipt(folder, id);
  if (receipt !== undefined) return { ...base, state: "installed", pointer: false, receipt };
  const entry = path.join(folder, "SKILL.md");
  const entryStat = await lstatIfPresent(entry);
  if (entryStat?.isFile() === true && hasLitOpenCodeGeneratedFileMarker(await fs.readFile(entry, "utf8"))) {
    return { ...base, state: "not-installed", pointer: true };
  }
  return { ...base, state: "user-managed", pointer: false };
}

async function directoryBytes(folder: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const child = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else total += (await fs.lstat(child)).size;
  }
  return total;
}

type BackupFolder = { readonly path: string; readonly bytes: number; readonly ageDays: number };

async function listBackups(backupsRoot: string): Promise<BackupFolder[]> {
  const stat = await lstatIfPresent(backupsRoot);
  if (stat === null) return [];
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`The backup folder is not a plain directory: ${backupsRoot}`);
  const found: BackupFolder[] = [];
  for (const entry of (await fs.readdir(backupsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    // Only the dated folders this command and the pointer's lines make; anything else there is left alone.
    const match = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)(?:-\d+)?$/u.exec(entry.name);
    if (!entry.isDirectory() || match === null) continue;
    const folder = path.join(backupsRoot, entry.name);
    const made = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
    found.push({ path: folder, bytes: await directoryBytes(folder), ageDays: (Date.now() - made) / 86_400_000 });
  }
  return found;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function pointerIsStale(entry: ExtensionEntry): Promise<boolean> {
  const skill = litOpenCodeRuntimeSkills.find((candidate) => candidate.id === entry.id);
  if (!entry.pointer || skill === undefined) return false;
  const expected = await nativeSkillContent(await readPackageMetadata(), skill);
  return (await fs.readFile(path.join(entry.path, "SKILL.md"), "utf8")) !== expected;
}

/** Read only. What `extensions list` and `check` show, and what doctor and the install notice summarize. */
export async function inspectExtensions(root: string, workDir: string = process.cwd()): Promise<ExtensionsReport> {
  const skillsRoot = await nativeSkillsRoot(root);
  const shadowed = await detectShadowedSkills(ids, skillsRoot, os.homedir(), workDir);
  const extensions: ExtensionEntry[] = [];
  for (const id of ids) {
    const competing = (shadowed.find((entry) => entry.id === id)?.locations ?? []).map((location) => path.join(location.root, id));
    extensions.push(await classify(skillsRoot, id, competing));
  }
  const backupsRoot = path.join(path.resolve(root), extensionBackupsDirectoryName);
  const backups = await listBackups(backupsRoot);
  const needsAction: ExtensionIssue[] = [];
  const notes: ExtensionIssue[] = [];
  for (const entry of extensions) {
    for (const other of entry.competing) {
      needsAction.push({
        id: entry.id,
        problem: `OpenCode also reads a same-name skill at ${other}, so two ${entry.id} skills compete.`,
        fix: `mv "${other}" "${path.join(os.homedir(), `${entry.id}.parked-skill`)}"   (a folder OpenCode does not read; or keep it and ignore this)`
      });
    }
    if (entry.state === "unsafe") needsAction.push({ id: entry.id, problem: `${entry.reason}; LitOpenCode will not write through it.`, fix: `replace the link with a folder, or remove it: ${entry.path}` });
    if (entry.state === "user-managed") {
      needsAction.push({
        id: entry.id,
        problem: `${entry.path} has no receipt, so nothing tracks or updates it.`,
        fix: `litopencode extensions install ${entry.id} --yes   (moves it whole into ${extensionBackupsDirectoryName}/ first)`
      });
    }
    if (entry.state === "installed" && entry.receipt !== undefined && (await lstatIfPresent(entry.receipt.source)) === null) {
      needsAction.push({ id: entry.id, problem: `The receipt's source ${entry.receipt.source} no longer exists.`, fix: `litopencode extensions update ${entry.id} --yes` });
    }
    if (await pointerIsStale(entry)) {
      needsAction.push({ id: entry.id, problem: `The ${entry.id} pointer is from another LitOpenCode version.`, fix: "litopencode install" });
    }
  }
  if (backups.length > 0) {
    const bytes = backups.reduce((sum, backup) => sum + backup.bytes, 0);
    notes.push({ problem: `${backups.length} backup ${backups.length === 1 ? "folder" : "folders"} in ${backupsRoot}, ${formatBytes(bytes)} in all.`, fix: "litopencode extensions prune-backups --older-than 30" });
  }
  if ((await lstatIfPresent(path.join(path.resolve(root), pendingExtensionsNoticeName))) !== null) {
    notes.push({ problem: "The extensions notice is still waiting for the next OpenCode session.", fix: "start OpenCode once; it shows the notice and clears it" });
  }
  return {
    root: path.resolve(root),
    backups: { path: backupsRoot, count: backups.length, bytes: backups.reduce((sum, backup) => sum + backup.bytes, 0) },
    extensions,
    needsAction,
    notes
  };
}

/** The one line doctor prints. */
export function extensionsSummaryLine(report: ExtensionsReport): string {
  const installed = report.extensions.filter((entry) => entry.state === "installed").length;
  const pointers = report.extensions.filter((entry) => entry.pointer).length;
  const look = report.needsAction.length;
  return `EXTENSIONS: ${installed} installed, ${pointers} pointers, ${look} ${look === 1 ? "needs" : "need"} a look (details and fixes: litopencode extensions check)`;
}

// ---------------------------------------------------------------- source

type Source = { readonly variants: string; readonly fetched: boolean; readonly pending?: string };

function git(args: readonly string[]): void {
  try {
    execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") throw new Error("git is not installed or not on PATH, so the shelf cannot be fetched. Nothing was installed. Clone wjgoarxiv-skills yourself and pass --from <path to the clone>.");
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "").trim().split("\n").slice(-2).join(" ") : "";
    throw new Error(`git ${args[0] === "-C" ? args[2] : args[0]} failed${stderr ? `: ${stderr}` : ""}. You may be offline. Nothing was installed. Pass --from <path to a wjgoarxiv-skills clone> to install from a local copy.`);
  }
}

async function resolveSource(args: ExtensionsArgs, env: NodeJS.ProcessEnv, refresh: boolean): Promise<Source> {
  if (args.from !== undefined) {
    const variants = path.join(args.from, ...variantPath);
    const stat = await lstatIfPresent(variants);
    if (stat === null || !stat.isDirectory()) throw new Error(`No variants/litopencode folder in ${args.from}. Pass the root of a wjgoarxiv-skills clone with --from. Nothing was installed.`);
    return { variants, fetched: false };
  }
  const cache = cacheSourceDirectory(env);
  const variants = path.join(cache, ...variantPath);
  const present = (await lstatIfPresent(path.join(cache, ".git"))) !== null;
  if (!args.yes) {
    return present
      ? { variants, fetched: false, ...(refresh ? { pending: `With --yes the shelf in ${cache} is fetched again first.` } : {}) }
      : { variants, fetched: false, pending: `With --yes the shelf is fetched with git from ${extensionsShelfUrl} into ${cache} (only variants/litopencode).` };
  }
  if (!present) {
    await fs.mkdir(path.dirname(cache), { recursive: true });
    const temp = `${cache}.${process.pid}.${randomUUID()}.tmp`;
    try {
      git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", `${extensionsShelfUrl}.git`, temp]);
      git(["-C", temp, "sparse-checkout", "set", variantPath.join("/")]);
      await fs.rename(temp, cache);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  } else if (refresh) {
    git(["-C", cache, "fetch", "--depth", "1", "origin", "HEAD"]);
    git(["-C", cache, "reset", "--hard", "FETCH_HEAD"]);
  }
  const stat = await lstatIfPresent(variants);
  if (stat === null || !stat.isDirectory()) throw new Error(`The fetched shelf in ${cache} has no variants/litopencode folder. Nothing was installed.`);
  return { variants, fetched: true };
}

/** sha256 over the sorted file list and each file's bytes, leaving out the receipt and Python bytecode. */
async function treeHash(folder: string): Promise<string> {
  const inventory = await inventoryTree(folder);
  if (inventory.unsafe.length > 0) throw new Error(`${folder} holds a symbolic link or special file: ${inventory.unsafe.join(", ")}`);
  const hash = createHash("sha256");
  for (const file of inventory.files) {
    if (file === extensionReceiptName || (file.split("/").includes("__pycache__") && file.endsWith(".pyc"))) continue;
    hash.update(`${file}\0${createHash("sha256").update(await fs.readFile(path.join(folder, file))).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------- writing

function localStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** One dated folder per run under extension-backups, made on first use; a second run in the same second gets -2. */
function backupFolderFor(root: string): { readonly preview: string; readonly get: () => Promise<string> } {
  const parent = path.join(path.resolve(root), extensionBackupsDirectoryName);
  const stamp = localStamp(new Date());
  let made: string | undefined;
  return {
    preview: path.join(parent, stamp),
    get: async () => {
      if (made !== undefined) return made;
      const parentStat = await lstatIfPresent(parent);
      if (parentStat?.isSymbolicLink() === true) throw new Error(`The backup folder is a symbolic link: ${parent}`);
      await fs.mkdir(parent, { recursive: true, mode: 0o700 });
      for (let attempt = 1; ; attempt += 1) {
        const candidate = path.join(parent, attempt === 1 ? stamp : `${stamp}-${attempt}`);
        try {
          await fs.mkdir(candidate, { mode: 0o700 });
          made = candidate;
          return candidate;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
      }
    }
  };
}

async function copyTree(source: string, destination: string): Promise<void> {
  const inventory = await inventoryTree(source);
  await fs.mkdir(destination, { recursive: false });
  for (const directory of inventory.directories) await fs.mkdir(path.join(destination, directory), { recursive: true });
  for (const file of inventory.files) {
    const target = path.join(destination, file);
    assertContained(destination, target, "Extension copy");
    await fs.copyFile(path.join(source, file), target, fs.constants.COPYFILE_EXCL);
  }
}

/** Copies into a stage beside the target, moves any existing folder whole into the backup, then swaps the stage in. */
async function placeExtension(skillsRoot: string, entry: ExtensionEntry, source: string, sourceHash: string, backup: ReturnType<typeof backupFolderFor>): Promise<string | undefined> {
  await fs.mkdir(skillsRoot, { recursive: true });
  const stage = path.join(skillsRoot, `.${entry.id}.${randomUUID()}.stage`);
  let movedTo: string | undefined;
  try {
    await copyTree(source, stage);
    const receipt: ExtensionReceipt = {
      id: entry.id,
      source,
      variant: "litopencode",
      installed_at: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
      sha256: sourceHash
    };
    await fs.writeFile(path.join(stage, extensionReceiptName), `${JSON.stringify(receipt)}\n`, { flag: "wx" });
    if ((await treeHash(stage)) !== sourceHash) throw new Error(`The copy of ${entry.id} does not match its source; nothing was replaced`);
    const current = await lstatIfPresent(entry.path);
    if (current?.isSymbolicLink() === true) throw new Error(`${entry.path} is a symbolic link; nothing was replaced`);
    if (current !== null) {
      movedTo = path.join(await backup.get(), entry.id);
      await fs.rename(entry.path, movedTo);
    }
    try {
      await fs.rename(stage, entry.path);
    } catch (error) {
      if (movedTo !== undefined) await fs.rename(movedTo, entry.path);
      throw error;
    }
    return movedTo;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- verbs

function header(verb: string, yes: boolean): string {
  return `LitOpenCode extensions · ${verb}${yes ? "" : " (dry run: nothing changes until you add --yes)"}`;
}

function renderList(report: ExtensionsReport): string {
  const lines = [`LitOpenCode extensions in ${path.join(report.root, "skills")}`, ""];
  for (const entry of report.extensions) {
    const state = entry.state === "installed" && entry.receipt !== undefined
      ? `installed (variant ${entry.receipt.variant}, ${entry.receipt.installed_at}, from ${entry.receipt.source})`
      : entry.state === "not-installed"
        ? (entry.pointer ? "not installed (pointer)" : "not installed")
        : entry.state === "user-managed" ? `user-managed (no receipt: ${entry.path})` : `unsafe (${entry.reason ?? entry.path})`;
    lines.push(`  ${entry.id.padEnd(30)} ${entry.family.padEnd(13)} ${state}`);
    for (const other of entry.competing) lines.push(`  ${"".padEnd(30)} ${"".padEnd(13)} competing: ${other}`);
  }
  lines.push("", "Install one: litopencode extensions install <skill> --yes");
  return lines.join("\n");
}

function renderCheck(report: ExtensionsReport): string {
  const lines = [header("check", true), ""];
  if (report.needsAction.length === 0) lines.push("Nothing needs action.");
  else {
    lines.push(`${report.needsAction.length} ${report.needsAction.length === 1 ? "thing needs" : "things need"} action:`);
    for (const issue of report.needsAction) lines.push(`  - ${issue.id === undefined ? "" : `${issue.id}: `}${issue.problem}`, `    fix: ${issue.fix}`);
  }
  for (const note of report.notes) lines.push(`  · ${note.problem}`, `    ${note.fix}`);
  return lines.join("\n");
}

async function runInstallOrUpdate(args: ExtensionsArgs, env: NodeJS.ProcessEnv, workDir: string): Promise<CliResult> {
  const update = args.verb === "update";
  const report = await inspectExtensions(args.root, workDir);
  const skillsRoot = await nativeSkillsRoot(args.root);
  const chosen = update && args.ids.length === 0
    ? report.extensions.filter((entry) => entry.state === "installed")
    : args.ids.map((id) => report.extensions.find((entry) => entry.id === id)).filter((entry): entry is ExtensionEntry => entry !== undefined);
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const entry of chosen) {
    if (entry.state === "unsafe") errors.push(`${entry.id}: ${entry.reason ?? entry.path} is a symbolic link; LitOpenCode will not write through it.`);
    if (update && entry.state !== "installed") errors.push(`${entry.id}: not installed with a receipt; use litopencode extensions install ${entry.id}.`);
    for (const other of entry.competing) {
      const line = `${entry.id}: OpenCode also reads a same-name skill at ${other}. LitOpenCode never touches it.`;
      if (update || args.allowShadow) warnings.push(`warning: ${line}`);
      else errors.push(`${line} Move it out of the way, or pass --allow-shadow to install beside it.`);
    }
  }
  if (errors.length > 0) return { exitCode: 1, stderr: [...errors, "Nothing was installed."].join("\n") };
  const source = await resolveSource(args, env, update);

  type Plan = { entry: ExtensionEntry; from: string; hash?: string; action: "install" | "current" | "update" };
  const plans: Plan[] = [];
  if (source.pending === undefined || (await lstatIfPresent(source.variants)) !== null) {
    for (const entry of chosen) {
      const from = path.join(source.variants, entry.id);
      const stat = await lstatIfPresent(from);
      if (stat === null || !stat.isDirectory() || (await lstatIfPresent(path.join(from, "SKILL.md")))?.isFile() !== true) {
        errors.push(`${entry.id}: the shelf has no ${path.join(...variantPath, entry.id)}/SKILL.md under ${path.dirname(path.dirname(source.variants))}.`);
        continue;
      }
      const hash = await treeHash(from);
      const installedHash = entry.state === "installed" ? entry.receipt?.sha256 ?? await treeHash(entry.path) : undefined;
      const same = installedHash === hash && entry.receipt?.source === from;
      plans.push({ entry, from, hash, action: same ? "current" : entry.state === "installed" ? "update" : "install" });
    }
  } else {
    for (const entry of chosen) plans.push({ entry, from: path.join(source.variants, entry.id), action: entry.state === "installed" ? "update" : "install" });
  }
  if (errors.length > 0) return { exitCode: 1, stderr: [...errors, "Nothing was installed."].join("\n") };

  const backup = backupFolderFor(args.root);
  const lines = [header(args.verb, args.yes), `Source: ${source.variants}`, ...(source.pending === undefined ? [] : [source.pending]), ...warnings, ""];
  if (plans.length === 0) lines.push(update ? "No extension is installed with a receipt, so there is nothing to update." : "Nothing selected.");
  let changed = 0;
  for (const plan of plans) {
    const { entry } = plan;
    if (plan.action === "current") {
      lines.push(`${entry.id}: current`);
      continue;
    }
    const verbWord = plan.action === "update" ? "update" : "install";
    if (!args.yes || plan.hash === undefined) {
      const aside = entry.state === "not-installed" && !entry.pointer
        ? ""
        : `move ${entry.path} whole to ${path.join(backup.preview, entry.id)}, then `;
      lines.push(`${entry.id}: would ${verbWord}: ${aside}copy ${plan.from} in and write ${extensionReceiptName}`);
      continue;
    }
    const movedTo = await placeExtension(skillsRoot, entry, plan.from, plan.hash, backup);
    changed += 1;
    lines.push(`${entry.id}: ${plan.action === "update" ? "updated" : "installed"} from ${plan.from}${movedTo === undefined ? "" : `; the folder that was there is in ${movedTo}`}`);
  }
  if (changed > 0) lines.push("", "Start a new OpenCode session to load the change. litopencode install leaves these folders alone.");
  if (!args.yes && plans.some((plan) => plan.action !== "current")) lines.push("", `Run again with --yes to do it.`);
  return { exitCode: 0, stdout: lines.join("\n") };
}

async function runRemove(args: ExtensionsArgs, workDir: string): Promise<CliResult> {
  const report = await inspectExtensions(args.root, workDir);
  const chosen = args.ids.map((id) => report.extensions.find((entry) => entry.id === id)).filter((entry): entry is ExtensionEntry => entry !== undefined);
  const refused = chosen.filter((entry) => entry.state === "user-managed" || entry.state === "unsafe");
  if (refused.length > 0) {
    return {
      exitCode: 1,
      stderr: [
        ...refused.map((entry) => `${entry.id}: ${entry.path} has no LitOpenCode receipt, so it is yours and stays where it is.`),
        "Nothing was removed."
      ].join("\n")
    };
  }
  const backup = backupFolderFor(args.root);
  const lines = [header("remove", args.yes), ""];
  let removed = 0;
  for (const entry of chosen) {
    if (entry.state !== "installed") {
      lines.push(`${entry.id}: not installed; nothing to remove`);
      continue;
    }
    if (!args.yes) {
      lines.push(`${entry.id}: would move ${entry.path} whole to ${path.join(backup.preview, entry.id)}`);
      continue;
    }
    const movedTo = path.join(await backup.get(), entry.id);
    await fs.rename(entry.path, movedTo);
    removed += 1;
    lines.push(`${entry.id}: moved to ${movedTo}`);
  }
  if (removed > 0) lines.push("", "Run litopencode install to bring the pointers back, then start a new OpenCode session.");
  if (!args.yes && chosen.some((entry) => entry.state === "installed")) lines.push("", "Run again with --yes to do it.");
  return { exitCode: 0, stdout: lines.join("\n") };
}

async function runPrune(args: ExtensionsArgs): Promise<CliResult> {
  const backupsRoot = path.join(path.resolve(args.root), extensionBackupsDirectoryName);
  const all = await listBackups(backupsRoot);
  const chosen = args.olderThanDays === undefined ? all : all.filter((backup) => backup.ageDays > (args.olderThanDays ?? 0));
  const lines = [header("prune-backups", args.yes), `Backups: ${backupsRoot}`, ""];
  if (chosen.length === 0) lines.push(all.length === 0 ? "There are no backups." : "No backup is old enough.");
  for (const backup of chosen) {
    if (args.yes) {
      assertContained(backupsRoot, backup.path, "Backup");
      const stat = await fs.lstat(backup.path);
      if (stat.isSymbolicLink() || !stat.isDirectory() || path.dirname(backup.path) !== backupsRoot) throw new Error(`Refusing to delete ${backup.path}`);
      await fs.rm(backup.path, { recursive: true });
    }
    lines.push(`${args.yes ? "deleted" : "would delete"} ${backup.path}  ${formatBytes(backup.bytes)}, ${Math.floor(backup.ageDays)} days old`);
  }
  const total = chosen.reduce((sum, backup) => sum + backup.bytes, 0);
  if (chosen.length > 0) lines.push("", `${args.yes ? "Freed" : "Would free"} ${formatBytes(total)}.${args.yes ? "" : " Run again with --yes to delete."}`);
  return { exitCode: 0, stdout: lines.join("\n") };
}

export async function runExtensionsCommand(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, workDir: string = process.cwd()): Promise<CliResult> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") return { exitCode: 0, stdout: extensionsUsage() };
  let args: ExtensionsArgs;
  try {
    args = parseExtensionsArgs(argv, env);
  } catch (error) {
    if (error instanceof UsageError) return { exitCode: 2, stderr: `${error.message}\n\n${extensionsUsage()}` };
    throw error;
  }
  try {
    if (args.verb === "list" || args.verb === "check") {
      const report = await inspectExtensions(args.root, workDir);
      const exitCode = args.verb === "check" && report.needsAction.length > 0 ? 1 : 0;
      if (args.json) return { exitCode, stdout: JSON.stringify(report, null, 2) };
      return { exitCode, stdout: args.verb === "list" ? renderList(report) : renderCheck(report) };
    }
    if (args.verb === "install" || args.verb === "update") return await runInstallOrUpdate(args, env, workDir);
    if (args.verb === "remove") return await runRemove(args, workDir);
    return await runPrune(args);
  } catch (error) {
    return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
  }
}
