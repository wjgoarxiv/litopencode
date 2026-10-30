// The LitFamily block on disk: OpenCode's global AGENTS.md at `<config root>/AGENTS.md` (the folder
// OpenCode itself reads, `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`), and a repo's own
// AGENTS.md. Writes go through a temporary file and a rename and keep the file's mode. A symlink, a
// non-regular file or a non-UTF-8 file is refused rather than rewritten, and a file system error comes
// back as `refused-io` instead of stopping the installer. The user's original global file is copied
// once, the first time a block goes in. The on/off setting is `agentFile` in litopencode.json.

import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultGlobalConfigJson } from "../config.ts";
import { litOpenCodeConfigFileForOpenCodeRoot } from "../state.ts";
import { isRecord, readJsonObjectIfPresent } from "./json.ts";
import { inspectBlock, ManagedBlockError, removeBlock, upsertBlock } from "./managed-block.ts";

export const AGENT_FILE_ID = "litopencode";
export const AGENT_FILE_MODES = ["on", "off"] as const;
export type AgentFileMode = (typeof AGENT_FILE_MODES)[number];
// OpenCode reads the global file on every turn of every session, so the block stays small.
export const AGENT_FILE_MAX_BYTES = 1200;

const globalBody = `## LitFamily · LitOpenCode

LitOpenCode adds the lit workflows to OpenCode (lit-plan, start-work, lit-loop, review-work, lit-adhd,
litresearch). Its plugin hooks load the full rules each turn, so this block only sets the ground rules.

- \`lit\` at the start of a prompt is LitOpenCode's activation word, not the Lit web library.
- Plans live in \`plans/\`, the session handoff in \`HANDOFF.md\`, run state in \`.litopencode/\`. Read them
  before resuming work in a repo.
- Never push, publish, tag or bump a version without the user's explicit yes for that action.
- Call work done only after its tests pass and the changed surface was checked for real.
- In a new repo, \`lit-init\` writes a short project \`AGENTS.md\` with these conventions.
- Turn this block off with \`litopencode agent-file off\`.
`;

const projectBody = `## LitFamily · project conventions

This repo is worked with LitOpenCode's lit workflows (lit-plan, start-work, lit-loop, review-work).

- Plans live in \`plans/\`, the session handoff in \`HANDOFF.md\`, run state in \`.litopencode/\` (keep it out
  of commits). Read the handoff and the active plan before resuming.
- Never push, publish, tag or bump a version without the user's explicit yes for that action.
- Pair every behaviour change with a test that failed first, and check the changed surface for real
  before calling it done.
`;

/** The shipped block text: `global` for OpenCode's AGENTS.md, `project` for a repo's AGENTS.md. */
export function agentFileBody(kind: "global" | "project" = "global"): string {
  return kind === "global" ? globalBody : projectBody;
}

export function globalAgentFilePath(root: string): string {
  return path.join(path.resolve(root), "AGENTS.md");
}

/**
 * OpenCode reads the first of `<config root>/AGENTS.md` and `~/.claude/CLAUDE.md` that exists. A new
 * AGENTS.md would therefore hide the user's CLAUDE.md from OpenCode, unless the host's own
 * OPENCODE_DISABLE_CLAUDE_CODE_PROMPT switch has already turned that fallback off.
 */
export function claudeFallbackFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const disabled = env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT;
  if (disabled !== undefined && disabled !== "" && disabled !== "0" && disabled.toLowerCase() !== "false") return null;
  const home = env.OPENCODE_TEST_HOME ?? (process.platform === "win32" ? env.USERPROFILE : env.HOME) ?? os.homedir();
  const candidate = path.join(home, ".claude", "CLAUDE.md");
  return fsSync.existsSync(candidate) ? candidate : null;
}

type EntryKind = "missing" | "file" | "symlink" | "other";

function entryKind(filePath: string): EntryKind {
  try {
    const stats = fsSync.lstatSync(filePath);
    return stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

// The text, or null for a file that is not UTF-8 (UTF-16 from a Windows editor, Latin-1): rewriting
// one would corrupt the user's bytes outside the markers.
function readUtf8(filePath: string): string | null {
  const bytes = fsSync.readFileSync(filePath);
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (bytes.includes(0) || utf16) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

// A unique staging name, so a leftover from a crashed run never blocks the next one.
function writeAtomic(filePath: string, text: string): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const staging = `${filePath}.litfamily-${randomUUID()}.tmp`;
  let mode: number | null = null;
  try {
    mode = fsSync.statSync(filePath).mode & 0o7777;
  } catch {
    // A new file takes the default mode.
  }
  try {
    fsSync.writeFileSync(staging, text, { flag: "wx" });
    if (mode !== null) fsSync.chmodSync(staging, mode);
    fsSync.renameSync(staging, filePath);
  } finally {
    fsSync.rmSync(staging, { force: true });
  }
}

export type AgentFileStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "removed"
  | "absent"
  | "dry-run"
  | "refused-symlink"
  | "refused-not-file"
  | "refused-not-utf8"
  | "refused-malformed"
  | "refused-io";

export type AgentFileResult = {
  readonly status: AgentFileStatus;
  readonly path: string;
  readonly backup?: string;
  readonly preview?: string;
  readonly error?: string;
};

/**
 * Installs or removes block `id` in `path`. `backup: false` skips the first-insert copy (a repo's
 * AGENTS.md, where a copy would sit beside tracked files).
 */
export function applyAgentFile(input: {
  readonly path: string;
  readonly id?: string;
  readonly version: string;
  readonly body: string;
  readonly action: "install" | "uninstall";
  readonly dryRun?: boolean;
  readonly now?: Date;
  readonly backup?: boolean;
}): AgentFileResult {
  const { path: filePath, id = AGENT_FILE_ID, version, body, action, dryRun = false, now = new Date(), backup = true } = input;
  try {
    const kind = entryKind(filePath);
    if (kind === "symlink") return { status: "refused-symlink", path: filePath };
    if (kind === "other") return { status: "refused-not-file", path: filePath };
    const text = kind === "file" ? readUtf8(filePath) : "";
    if (text === null) return { status: "refused-not-utf8", path: filePath };
    let next: { text: string; changed: boolean; created?: boolean };
    try {
      next = action === "uninstall" ? removeBlock(text, id) : upsertBlock(text, { id, version, body }, { created: kind === "missing" });
    } catch (error) {
      if (error instanceof ManagedBlockError) return { status: "refused-malformed", path: filePath };
      throw error;
    }
    if (!next.changed) return { status: action === "uninstall" ? "absent" : "unchanged", path: filePath };
    if (dryRun) return { status: "dry-run", path: filePath, preview: next.text };
    if (action === "uninstall") {
      if (next.text === "" && next.created === true) fsSync.unlinkSync(filePath);
      else writeAtomic(filePath, next.text);
      return { status: "removed", path: filePath };
    }
    let copy: string | undefined;
    if (backup && kind === "file" && inspectBlock(text, id).state === "absent") {
      copy = `${filePath}.litfamily-backup-${now.toISOString().replace(/[:.]/gu, "-")}`;
      fsSync.copyFileSync(filePath, copy);
    }
    writeAtomic(filePath, next.text);
    return { status: kind === "file" ? "updated" : "created", path: filePath, ...(copy === undefined ? {} : { backup: copy }) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return { status: "refused-io", path: filePath, error: code ?? (error instanceof Error ? error.message : String(error)) };
  }
}

/** `present v=<x>`, `stale v=<x>` (an older install's block), `absent`, `malformed`, or `symlink` / `not-file` / `not-utf8`. */
export function agentFileState(input: { readonly path: string; readonly id?: string; readonly version: string }): string {
  const kind = entryKind(input.path);
  if (kind === "missing") return "absent";
  if (kind === "symlink") return "symlink";
  if (kind === "other") return "not-file";
  const text = readUtf8(input.path);
  if (text === null) return "not-utf8";
  const found = inspectBlock(text, input.id ?? AGENT_FILE_ID);
  if (found.state !== "present") return found.state;
  return `${found.version === input.version ? "present" : "stale"} v=${found.version}`;
}

export function agentFileLine(result: AgentFileResult): string {
  return `AGENT_FILE: ${result.status} ${result.path}${result.backup === undefined ? "" : ` (backup: ${result.backup})`}`;
}

/** The stored setting in litopencode.json; LITOPENCODE_AGENT_FILE=on|off overrides it. A missing or unreadable value is `unset`. */
export async function readAgentFileMode(root: string, env: NodeJS.ProcessEnv = process.env): Promise<AgentFileMode | "unset"> {
  const override = (env.LITOPENCODE_AGENT_FILE ?? "").trim().toLowerCase();
  if (override === "on" || override === "off") return override;
  try {
    const stored = (await readJsonObjectIfPresent(litOpenCodeConfigFileForOpenCodeRoot(root)))?.agentFile;
    return stored === "on" || stored === "off" ? stored : "unset";
  } catch {
    return "unset";
  }
}

/** Stores the setting, keeping every other key; a missing litopencode.json starts from the install defaults. */
export async function writeAgentFileMode(root: string, mode: AgentFileMode): Promise<void> {
  const filePath = litOpenCodeConfigFileForOpenCodeRoot(root);
  const existing = await readJsonObjectIfPresent(filePath);
  const base = isRecord(existing) ? existing : defaultGlobalConfigJson();
  if (base.agentFile === mode) return;
  writeAtomic(filePath, JSON.stringify({ ...base, agentFile: mode }, null, 2) + "\n");
}
