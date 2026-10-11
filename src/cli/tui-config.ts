import fs from "node:fs/promises";
import path from "node:path";
import { OpenCodeConfigCommentError, renderOpenCodeConfig, writeTextAtomically } from "./install-config.ts";
import { isRecord, readJsonObjectIfPresent, readTextIfPresent } from "./json.ts";
import { parseJsonc } from "./jsonc.ts";
import { isLitOpenCodeEntry } from "./plugin-mutation.ts";

// OpenCode reads TUI plugins from the `plugin` list of tui.json and tui.jsonc beside opencode.json,
// merging both. When it adds an entry itself it edits the first of the two that exists, else creates
// tui.json; LitOpenCode follows the same choice so a host install and ours never split the entry.

export const tuiSchemaUrl = "https://opencode.ai/tui.json";
export const tuiBackupSuffix = ".litopencode-backup";

type TuiFile = { readonly path: string; readonly text: string | null; readonly config: Record<string, unknown> | null };

type PlannedWrite = { readonly path: string; readonly before: string | null; readonly text: string };

export type TuiInstallReport = {
  readonly path: string;
  readonly alreadyPresent: boolean;
  readonly changed: boolean;
  readonly add: readonly string[];
  readonly currentCount: number;
  readonly resultCount: number;
  readonly cleaned: readonly string[];
};

export type TuiInstallPlan = {
  readonly report: TuiInstallReport;
  readonly writes: readonly PlannedWrite[];
  readonly blocked?: string;
};

export type TuiRemovalReport = {
  readonly dryRun: boolean;
  readonly removed: number;
  readonly files: readonly { readonly path: string; readonly removed: number; readonly backup?: string }[];
};

export function tuiConfigCandidates(root: string): readonly [string, string] {
  const resolved = path.resolve(root);
  return [path.join(resolved, "tui.json"), path.join(resolved, "tui.jsonc")];
}

function entryId(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

async function isLitOpenCodePathEntry(root: string, id: string): Promise<boolean> {
  if (!(path.isAbsolute(id) || id.startsWith("."))) return false;
  const metadata = await readJsonObjectIfPresent(path.join(path.resolve(root, id), "package.json")).catch(() => null);
  return metadata?.name === "litopencode" || metadata?.name === "@litfamily/opencode" || metadata?.name === "@litfamily/litopencode";
}

async function isOwnEntry(root: string, value: unknown, target: string | undefined): Promise<boolean> {
  const id = entryId(value);
  return id !== "" && (id === target || isLitOpenCodeEntry(value) || (await isLitOpenCodePathEntry(root, id)));
}

async function readTuiFile(file: string): Promise<TuiFile> {
  const text = await readTextIfPresent(file);
  if (text === null) return { path: file, text, config: null };
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (error) {
    throw new Error(`Malformed JSONC at ${file}: ${error instanceof Error ? error.message : String(error)}. Nothing was written.`);
  }
  if (!isRecord(parsed)) throw new Error(`Malformed JSON at ${file}: expected an object. Nothing was written.`);
  return { path: file, text, config: parsed };
}

async function ownIndexes(root: string, plugins: readonly unknown[], target: string | undefined): Promise<readonly number[]> {
  const indexes: number[] = [];
  for (const [index, value] of plugins.entries()) if (await isOwnEntry(root, value, target)) indexes.push(index);
  return indexes;
}

function pluginList(config: Record<string, unknown> | null): readonly unknown[] {
  return Array.isArray(config?.plugin) ? config.plugin : [];
}

function render(file: TuiFile, next: Record<string, unknown>): PlannedWrite {
  return { path: file.path, before: file.text, text: renderOpenCodeConfig(file.path, file.text, next) };
}

/** Works out every TUI config edit an install makes, without writing. A comment that would be lost blocks the plan. */
export async function planTuiInstall(root: string, target: string): Promise<TuiInstallPlan> {
  const files = await Promise.all(tuiConfigCandidates(root).map(readTuiFile));
  const owned = await Promise.all(files.map(async (file) => ownIndexes(root, pluginList(file.config), target)));
  const holder = files.findIndex((_file, index) => owned[index].length > 0);
  const primaryIndex = holder >= 0 ? holder : Math.max(0, files.findIndex((file) => file.text !== null));
  const primary = files[primaryIndex];
  const current = pluginList(primary.config);
  const primaryOwned = owned[primaryIndex];
  const alreadyPresent = primaryOwned.length === 1 && entryId(current[primaryOwned[0]]) === target;

  let nextPlugins: unknown[];
  if (primaryOwned.length === 0) {
    nextPlugins = [...current, target];
  } else {
    const first = current[primaryOwned[0]];
    const replacement = Array.isArray(first) ? [target, ...first.slice(1)] : target;
    nextPlugins = current.flatMap((value, index) => (index === primaryOwned[0] ? [replacement] : primaryOwned.includes(index) ? [] : [value]));
  }

  const writes: PlannedWrite[] = [];
  const cleaned: string[] = [];
  try {
    if (JSON.stringify(nextPlugins) !== JSON.stringify(current) || primary.config === null) {
      const base = primary.config === null ? { $schema: tuiSchemaUrl } : primary.config;
      writes.push(render(primary, { ...base, plugin: nextPlugins }));
    }
    for (const [index, file] of files.entries()) {
      if (index === primaryIndex || owned[index].length === 0 || file.config === null) continue;
      const kept = pluginList(file.config).filter((_value, position) => !owned[index].includes(position));
      writes.push(render(file, { ...file.config, plugin: kept }));
      cleaned.push(file.path);
    }
  } catch (error) {
    if (!(error instanceof OpenCodeConfigCommentError)) throw error;
    return { report: { ...report(), changed: true, add: [target] }, writes: [], blocked: error.message };
  }
  return { report: report(), writes };

  function report(): TuiInstallReport {
    const changed = writes.length > 0;
    return {
      path: primary.path,
      alreadyPresent,
      changed,
      add: changed ? [target] : [],
      currentCount: current.length,
      resultCount: nextPlugins.length,
      cleaned
    };
  }
}

async function backup(write: PlannedWrite): Promise<string | undefined> {
  if (write.before === null) return undefined;
  const file = write.path + tuiBackupSuffix;
  await writeTextAtomically(file, write.before);
  return file;
}

/** Writes a plan: each file that already existed is copied to `<file>.litopencode-backup` first. */
export async function applyTuiWrites(writes: readonly PlannedWrite[], options: { readonly backup?: boolean } = {}): Promise<void> {
  for (const write of writes) {
    if (options.backup !== false) await backup(write);
    await fs.mkdir(path.dirname(write.path), { recursive: true });
    await writeTextAtomically(write.path, write.text);
  }
}

/** Backs up the TUI files a plan is about to change, for writers outside LitOpenCode such as `opencode plugin`. */
export async function backupTuiFiles(plan: TuiInstallPlan): Promise<void> {
  for (const write of plan.writes) await backup(write);
}

/** Removes LitOpenCode's own TUI entries, and only those, from tui.json and tui.jsonc. */
export async function removeTuiPlugin(root: string, dryRun: boolean): Promise<TuiRemovalReport> {
  const files = await Promise.all(tuiConfigCandidates(root).map(readTuiFile));
  const writes: { readonly write: PlannedWrite; readonly removed: number }[] = [];
  for (const file of files) {
    if (file.config === null) continue;
    const plugins = pluginList(file.config);
    const owned = await ownIndexes(root, plugins, undefined);
    if (owned.length === 0) continue;
    const kept = plugins.filter((_value, index) => !owned.includes(index));
    writes.push({ write: render(file, { ...file.config, plugin: kept }), removed: owned.length });
  }
  const reports: { path: string; removed: number; backup?: string }[] = [];
  for (const { write, removed } of writes) {
    if (dryRun) {
      reports.push({ path: write.path, removed });
      continue;
    }
    const backupPath = await backup(write);
    await writeTextAtomically(write.path, write.text);
    reports.push({ path: write.path, removed, ...(backupPath === undefined ? {} : { backup: backupPath }) });
  }
  return { dryRun, removed: reports.reduce((total, entry) => total + entry.removed, 0), files: reports };
}

export type TuiInspection = {
  readonly path: string;
  readonly expected: string;
  readonly configured: string | null;
  readonly present: boolean;
  readonly entries: number;
  readonly ok: boolean;
  readonly error?: string;
};

export async function inspectTuiPlugin(root: string, expected: string): Promise<TuiInspection> {
  let files: TuiFile[];
  try {
    files = await Promise.all(tuiConfigCandidates(root).map(readTuiFile));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: tuiConfigCandidates(root)[0], expected, configured: null, present: false, entries: 0, ok: false, error: message };
  }
  let found: { readonly path: string; readonly id: string } | undefined;
  let entries = 0;
  let present = false;
  for (const file of files) {
    for (const value of pluginList(file.config)) {
      const id = entryId(value);
      const exact = id === expected || (await isLitOpenCodePathEntry(root, id));
      if (!exact && !isLitOpenCodeEntry(value)) continue;
      entries += 1;
      if (exact && !present) {
        present = true;
        found = { path: file.path, id };
      } else if (found === undefined) {
        found = { path: file.path, id };
      }
    }
  }
  const fallback = files.find((file) => file.text !== null)?.path ?? files[0].path;
  return {
    path: found?.path ?? fallback,
    expected,
    configured: found?.id ?? null,
    present,
    entries,
    ok: present && entries === 1
  };
}
