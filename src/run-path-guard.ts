import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeInertData } from "./inert-data.ts";
import { classifyRunPath, defaultRunPathContext, gitCommonDir, type RunPathAccess } from "./run-paths.ts";
import type { SessionLookup } from "./session-lineage.ts";

// While a start-work run is live, a direct tool call on a protected file (a secret, or settings that carry keys
// or load code) is refused for the owner session and its direct children. The guard never consults the run's
// grants, so no grant can reopen one, and it writes nothing: no park, no grant, no state. With no live run it
// does nothing at all. It checks the paths a call names; a folder-wide search or a script can still read a
// secret, and Bash is not otherwise restricted.

export type RunPathGuardOptions = {
  readonly projectRoot: string;
  readonly baseDirectory?: string;
  readonly getSession?: SessionLookup;
};

export type RunPathGuard = {
  readonly before: (input: { readonly tool: string; readonly sessionID: string }, args: unknown) => Promise<void>;
};

type LiveRun = { readonly sessionID: string };

const pathArgTools = new Set(["read", "edit", "write", "list", "multiedit"]);
const searchTools = new Set(["grep", "glob"]);
const patchTools = new Set(["patch", "apply_patch"]);
const readTools = new Set(["read", "list", "grep", "glob"]);
const patchHeader = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+)$/gmu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stateFileOf(root: string): string {
  return path.join(root, ".litopencode", "litgoal", "lit-loop", "work-schema-3.json");
}

/** The main checkout of a linked worktree, when the plugin root is one. */
function mainCheckout(root: string): string | undefined {
  const common = gitCommonDir(root);
  if (common === undefined || path.basename(common) !== ".git") return undefined;
  const main = path.dirname(common);
  return path.resolve(main) === path.resolve(root) ? undefined : main;
}

/**
 * Splits a Bash command into the words that may name files: `~`, `$HOME` and `${HOME}` expand, quotes go. A word
 * after an output redirection (`>`, `>>`, `2>`, `&>`) is a write; every other word is a read.
 */
export function bashPathTokens(command: string): { readonly target: string; readonly access: RunPathAccess }[] {
  const home = os.homedir();
  const out: { target: string; access: RunPathAccess }[] = [];
  for (const segment of command.split(/&&|\|\||;|\|/u)) {
    let redirectNext = false;
    for (const raw of segment.split(/\s+/u)) {
      if (raw === "") continue;
      const redirect = /^(?:\d*>>?|&>)/u.exec(raw);
      let token = raw.replace(/^(?:\d*>>?|&>|<)/u, "").replace(/^["']+|["']+$/gu, "");
      const access: RunPathAccess = redirect !== null || redirectNext ? "write" : "read";
      redirectNext = redirect !== null && token === "";
      if (token === "" || token.startsWith("-")) continue;
      token = token.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, home);
      out.push({ target: token, access });
    }
  }
  return out;
}

function targetsOf(tool: string, args: unknown): { readonly target: string; readonly access: RunPathAccess }[] {
  if (!isRecord(args)) return [];
  const access: RunPathAccess = readTools.has(tool) ? "read" : "write";
  if (pathArgTools.has(tool)) {
    return ["filePath", "path", "file_path"].flatMap((key) => (typeof args[key] === "string" && args[key] !== "" ? [{ target: args[key] as string, access }] : []));
  }
  if (searchTools.has(tool)) return typeof args.path === "string" && args.path !== "" ? [{ target: args.path, access }] : [];
  if (patchTools.has(tool)) {
    const text = typeof args.patchText === "string" ? args.patchText : typeof args.patch === "string" ? args.patch : "";
    return [...text.matchAll(patchHeader)].map((match) => ({ target: match[1].trim(), access: "write" as const }));
  }
  if (tool === "bash" && typeof args.command === "string") {
    return bashPathTokens(args.command);
  }
  return [];
}

export function createRunPathGuard(options: RunPathGuardOptions): RunPathGuard {
  const baseDirectory = options.baseDirectory?.trim() || options.projectRoot;
  const roots = [options.projectRoot];
  const main = mainCheckout(options.projectRoot);
  if (main !== undefined) roots.push(main);
  const cache = new Map<string, { readonly mtimeMs: number; readonly run: LiveRun | undefined }>();

  function liveRunAt(root: string): LiveRun | undefined {
    const file = stateFileOf(root);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      cache.delete(file);
      return undefined;
    }
    if (!stat.isFile()) return undefined;
    const cached = cache.get(file);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) return cached.run;
    let run: LiveRun | undefined;
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (isRecord(raw) && raw.schemaVersion === 3 && (raw.status === "active" || raw.status === "paused") && typeof raw.sessionID === "string") {
        run = { sessionID: raw.sessionID };
      }
    } catch {
      run = undefined;
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, run });
    return run;
  }

  async function inScope(sessionID: string, run: LiveRun): Promise<boolean> {
    if (sessionID === run.sessionID) return true;
    if (options.getSession === undefined) return true;
    try {
      const session = await options.getSession(sessionID);
      // Unknown lineage counts as in scope: failing closed here can only refuse protected paths.
      if (session === undefined) return true;
      return session.parentID === run.sessionID;
    } catch {
      return true;
    }
  }

  return {
    async before(input, args) {
      const targets = targetsOf(input.tool, args);
      if (targets.length === 0) return;
      let run: LiveRun | undefined;
      let runRoot = options.projectRoot;
      for (const root of roots) {
        run = liveRunAt(root);
        if (run !== undefined) {
          runRoot = root;
          break;
        }
      }
      if (run === undefined || !(await inScope(input.sessionID, run))) return;
      const ctx = defaultRunPathContext(runRoot, baseDirectory);
      for (const { target, access } of targets) {
        if (classifyRunPath(target, ctx, access) === "protected") {
          throw new Error(`LitOpenCode start-work: ${serializeInertData(target)} is protected for this run. Do not retry it; add a BLOCKED: <reason> line under the task's row and ask the user.`);
        }
      }
    }
  };
}
