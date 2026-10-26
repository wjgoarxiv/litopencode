import { lstatSync, readFileSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRuntimePaths } from "./state.ts";

// A session's workflow stack: the discipline it is running (the spine) and, while another lit command
// is interjected, the paused spine underneath it. An interjected command pauses the spine and never
// erases it, so `lit continue` returns to the same stage and the same k/n. Transitions are pure; the
// store keeps one small JSON file per session so the TUI band and a restarted plugin read the same
// record.

export const workflowStackSchema = "litopencode.workflow-stack/v1";

export type FrameStatus = "active" | "paused";

export type StackFrame = {
  readonly skill: string;
  readonly status: FrameStatus;
  readonly at: number;
  readonly phase?: string;
  /** Both counts or neither: an unknown total is never stored as zero. */
  readonly done?: number;
  readonly total?: number;
};

export type WorkflowStack = {
  readonly schema: typeof workflowStackSchema;
  readonly sessionID: string;
  readonly frames: readonly StackFrame[];
  readonly updatedAt: number;
};

export type FrameProgress = { readonly phase?: string; readonly done?: number; readonly total?: number };

const spineSkills: ReadonlySet<string> = new Set(["lit-loop", "lit-plan", "start-work", "lit-task"]);
const safeSessionID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const stackByteLimit = 64 * 1024;
const frameLimit = 4;

export function isSpineSkill(skill: string): boolean {
  return spineSkills.has(skill);
}

export function emptyStack(sessionID: string): WorkflowStack {
  return { schema: workflowStackSchema, sessionID, frames: [], updatedAt: 0 };
}

function counts(progress: FrameProgress | undefined): Pick<StackFrame, "done" | "total"> {
  const done = progress?.done;
  const total = progress?.total;
  return Number.isInteger(done) && Number.isInteger(total) && (total as number) > 0 && (done as number) >= 0 && (done as number) <= (total as number)
    ? { done: done as number, total: total as number }
    : {};
}

function frame(skill: string, status: FrameStatus, at: number, progress?: FrameProgress): StackFrame {
  return { skill, status, at, ...(progress?.phase === undefined ? {} : { phase: progress.phase }), ...counts(progress) };
}

function withFrames(stack: WorkflowStack, frames: readonly StackFrame[], now: number): WorkflowStack {
  return { ...stack, frames: frames.slice(-frameLimit), updatedAt: now };
}

/** A new spine skill ends whatever the stack held: the user moved on to a different discipline. */
export function startSpine(stack: WorkflowStack, skill: string, now: number): WorkflowStack {
  return withFrames(stack, [frame(skill, "active", now)], now);
}

/** Records the spine's progress without pausing it, so a later pause or a card read has real numbers. */
export function pauseSpine(stack: WorkflowStack, now: number, progress?: FrameProgress): WorkflowStack {
  const [spine, ...rest] = stack.frames;
  if (spine === undefined || !isSpineSkill(spine.skill)) return stack;
  return withFrames(stack, [frame(spine.skill, "paused", spine.at, { phase: progress?.phase ?? spine.phase, done: progress?.done ?? spine.done, total: progress?.total ?? spine.total }), ...rest], now);
}

/**
 * Starts a side skill. An active spine is paused under it, keeping its stage and counts; a second side
 * skill replaces the first. With no spine the side skill stands alone.
 */
export function pushSide(stack: WorkflowStack, skill: string, now: number, progress: FrameProgress | undefined): WorkflowStack {
  const spine = stack.frames.find((candidate) => isSpineSkill(candidate.skill));
  if (spine === undefined) return withFrames(stack, [frame(skill, "active", now)], now);
  const paused = pauseSpine({ ...stack, frames: [spine] }, now, progress).frames[0];
  return withFrames(stack, [paused, frame(skill, "active", now)], now);
}

/** Closes the side frame and makes the paused spine active again at the stage it was paused in. */
export function resumeSpine(stack: WorkflowStack, now: number): { readonly stack: WorkflowStack; readonly resumed?: StackFrame } {
  const spine = stack.frames.find((candidate) => isSpineSkill(candidate.skill) && candidate.status === "paused");
  if (spine === undefined) return { stack };
  const resumed: StackFrame = { ...spine, status: "active" };
  return { stack: withFrames(stack, [resumed], now), resumed };
}

export function stackFile(projectRoot: string, sessionID: string): string {
  if (!safeSessionID.test(sessionID)) throw new Error("workflow stack session id must match [A-Za-z0-9_-]");
  return path.join(createRuntimePaths(projectRoot).workflowStackDir, `${sessionID}.json`);
}

function isFrame(value: unknown): value is StackFrame {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const optionalInt = (field: unknown): boolean => field === undefined || (Number.isInteger(field) && (field as number) >= 0);
  return typeof record.skill === "string" && (record.status === "active" || record.status === "paused") && Number.isFinite(record.at) &&
    (record.phase === undefined || typeof record.phase === "string") && optionalInt(record.done) && optionalInt(record.total);
}

async function readRegular(file: string): Promise<string | undefined> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > stackByteLimit) return undefined;
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function parseStack(text: string | undefined, sessionID: string): WorkflowStack | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.schema !== workflowStackSchema || record.sessionID !== sessionID || !Array.isArray(record.frames) || !record.frames.every(isFrame) || !Number.isFinite(record.updatedAt)) return undefined;
  return { schema: workflowStackSchema, sessionID, frames: record.frames.slice(-frameLimit), updatedAt: record.updatedAt as number };
}

/** The session's stack, or undefined when the id is unsafe, the file is missing, a link, oversized or malformed. */
export async function readStack(projectRoot: string, sessionID: string): Promise<WorkflowStack | undefined> {
  if (!safeSessionID.test(sessionID)) return undefined;
  return parseStack(await readRegular(stackFile(projectRoot, sessionID)), sessionID);
}

export async function writeStack(projectRoot: string, stack: WorkflowStack): Promise<void> {
  const file = stackFile(projectRoot, stack.sessionID);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const dirStat = await fs.lstat(dir);
  if (!dirStat.isDirectory()) throw new Error("workflow stack directory is not a directory");
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("workflow stack file is a link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(stack)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

export type SiblingOptions = { readonly now: number; readonly freshMs: number; readonly max: number };

/** Other sessions' stacks that moved recently, for the thread rows. Links and the session's own file are skipped. */
export async function readSiblingStacks(projectRoot: string, selfID: string, options: SiblingOptions): Promise<readonly WorkflowStack[]> {
  const dir = createRuntimePaths(projectRoot).workflowStackDir;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const found: WorkflowStack[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const sessionID = name.slice(0, -".json".length);
    if (sessionID === selfID || !safeSessionID.test(sessionID)) continue;
    const stack = parseStack(await readRegular(path.join(dir, name)), sessionID);
    if (stack === undefined || stack.frames.length === 0 || options.now - stack.updatedAt > options.freshMs) continue;
    found.push(stack);
    if (found.length >= options.max) break;
  }
  return found;
}

function readRegularSync(file: string): string | undefined {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && stat.size <= stackByteLimit ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** The TUI reads on its own refresh and cannot await: the same checks as `readStack`, synchronously. */
export function readStackSync(projectRoot: string, sessionID: string): WorkflowStack | undefined {
  if (!safeSessionID.test(sessionID)) return undefined;
  return parseStack(readRegularSync(stackFile(projectRoot, sessionID)), sessionID);
}

/** Synchronous twin of `readSiblingStacks`. */
export function readSiblingStacksSync(projectRoot: string, selfID: string, options: SiblingOptions): readonly WorkflowStack[] {
  const dir = createRuntimePaths(projectRoot).workflowStackDir;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: WorkflowStack[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const sessionID = name.slice(0, -".json".length);
    if (sessionID === selfID || !safeSessionID.test(sessionID)) continue;
    const stack = parseStack(readRegularSync(path.join(dir, name)), sessionID);
    if (stack === undefined || stack.frames.length === 0 || options.now - stack.updatedAt > options.freshMs) continue;
    found.push(stack);
    if (found.length >= options.max) break;
  }
  return found;
}
