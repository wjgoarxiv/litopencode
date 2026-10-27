import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRuntimePaths } from "./state.ts";

// One small record per session, `.litopencode/liveness/<session>.json`, holding the last lifecycle signal
// the plugin saw: `alive` after a tool ran, `idle` on session.idle, `ended` on session.deleted. The TUI
// mission card reads it to tell working, idle and ended sessions apart and to name a herdr lane by its
// pane. A repeat of the same state is written at most every 30 s, so a busy session stays one write per
// half minute. Only a project that already keeps LitOpenCode state gets records.

export type LivenessState = "alive" | "idle" | "ended";
export type LivenessRecord = {
  readonly version: 1;
  readonly sessionId: string;
  readonly state: LivenessState;
  readonly at: string;
  readonly herdrPane: string | null;
};

export const livenessRepeatMs = 30_000;
const states = new Set<string>(["alive", "idle", "ended"]);
const safeSessionID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const herdrPane = /^[A-Za-z0-9:_-]{1,32}$/u;
const recordByteLimit = 1024;

export function livenessFile(projectRoot: string, sessionID: string): string {
  if (!safeSessionID.test(sessionID)) throw new Error("liveness session id must match [A-Za-z0-9_-]");
  return path.join(createRuntimePaths(projectRoot).livenessDir, `${sessionID}.json`);
}

function parseRecord(text: string | undefined, sessionID: string): LivenessRecord | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (
      value.version !== 1 || value.sessionId !== sessionID || typeof value.state !== "string" || !states.has(value.state) ||
      typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) ||
      !(value.herdrPane === null || (typeof value.herdrPane === "string" && herdrPane.test(value.herdrPane)))
    ) return undefined;
    return value as unknown as LivenessRecord;
  } catch {
    return undefined;
  }
}

function readRegularSync(file: string): string | undefined {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && stat.size <= recordByteLimit ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** The session's record, or undefined when the id is unsafe or the file is missing, a link, oversized or malformed. */
export function readLivenessSync(projectRoot: string, sessionID: string): LivenessRecord | undefined {
  if (!safeSessionID.test(sessionID)) return undefined;
  const dir = createRuntimePaths(projectRoot).livenessDir;
  const dirStat = (() => {
    try {
      return lstatSync(dir);
    } catch {
      return undefined;
    }
  })();
  if (dirStat === undefined || !dirStat.isDirectory()) return undefined;
  return parseRecord(readRegularSync(path.join(dir, `${sessionID}.json`)), sessionID);
}

/**
 * Records the session's state; true when a record was written. Never throws: a missing project state folder,
 * a linked folder or record, an unsafe id or a failed write all return false so the calling hook carries on.
 */
export async function markLiveness(
  projectRoot: string,
  sessionID: string,
  state: LivenessState,
  options: { readonly now?: number; readonly env?: NodeJS.ProcessEnv } = {}
): Promise<boolean> {
  if (!safeSessionID.test(sessionID) || !states.has(state)) return false;
  const now = options.now ?? Date.now();
  const paths = createRuntimePaths(projectRoot);
  try {
    if (!(await fs.lstat(paths.runtimeDir)).isDirectory()) return false;
    await fs.mkdir(paths.livenessDir, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await fs.lstat(paths.livenessDir)).isDirectory()) return false;
    const file = path.join(paths.livenessDir, `${sessionID}.json`);
    const existing = await fs.lstat(file).catch(() => undefined);
    if (existing !== undefined && !existing.isFile()) return false;
    const previous = existing === undefined ? undefined : parseRecord(await fs.readFile(file, "utf8"), sessionID);
    if (previous?.state === state && now - Date.parse(previous.at) < livenessRepeatMs) return false;
    const pane = options.env === undefined ? process.env.HERDR_PANE_ID : options.env.HERDR_PANE_ID;
    const record: LivenessRecord = {
      version: 1,
      sessionId: sessionID,
      state,
      at: new Date(now).toISOString(),
      herdrPane: typeof pane === "string" && herdrPane.test(pane) ? pane : null
    };
    // A unique staging name: two events of one session (alive, then idle) may write at the same moment.
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
    return true;
  } catch {
    return false;
  }
}
