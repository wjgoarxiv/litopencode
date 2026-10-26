import fs from "node:fs/promises";
import path from "node:path";
import { resolveLatestDurablePlan } from "./durable-plan.ts";
import { activationDiscipline } from "./activation-probe.ts";
import { createRuntimePaths } from "./state.ts";
import { planChecklist, readActiveGoal, readWorkState } from "./tui/mission-model.ts";
import {
  emptyStack,
  isSpineSkill,
  pushSide,
  readStack,
  resumeSpine,
  startSpine,
  writeStack,
  type FrameProgress,
  type StackFrame,
  type WorkflowStack
} from "./workflow-stack.ts";
import type { ChatActivationMode } from "./activation-routing.ts";

// What a second `lit ...` in the same session does. The first lit of a session, a different
// discipline, `lit new` and `lit restart` all send the full activation. The same discipline sends a
// short note instead, and a bare `lit` over saved work resumes it. Session identity is the host's
// session id; anything missing or unreadable falls back to the full activation.

const continuableModes: ReadonlySet<ChatActivationMode> = new Set(["lit-task", "lit-loop", "lit-plan"]);
const bareLit = /^\s*lit[.!?]*\s*$/iu;
const bareLitOrContinue = /^\s*lit(?:[\s,:]+(?:continue|resume))?[.!?]*\s*$/iu;
const restartRequest = /^\s*lit[\s,:]+(?:new|restart)(?![\w-])/iu;

export type ActivationMemory = {
  readonly active: (sessionID: string) => ChatActivationMode | undefined;
  readonly remember: (sessionID: string, mode: ChatActivationMode) => void;
  readonly forget: (sessionID: string) => void;
};

export function createActivationMemory(): ActivationMemory {
  const active = new Map<string, ChatActivationMode>();
  return {
    active: (sessionID) => active.get(sessionID),
    remember: (sessionID, mode) => { active.set(sessionID, mode); },
    forget: (sessionID) => { active.delete(sessionID); }
  };
}

// A paused spine older than this belongs to earlier work, so a later side skill does not claim to pause it.
const spineStaleMs = 6 * 60 * 60 * 1000;
const progressByteLimit = 1024 * 1024;

async function readSmallJson(file: string): Promise<unknown> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > progressByteLimit) return undefined;
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Where a spine discipline stands, read from the records the band reads: the bounded work run's plan
 * checklist, else the goal ledger's criteria. A total that no record knows stays absent.
 */
export async function spineProgress(projectRoot: string, sessionID: string, skill: string): Promise<FrameProgress> {
  const paths = createRuntimePaths(projectRoot);
  const work = readWorkState(await readSmallJson(paths.lifecycleStateFile), sessionID);
  let counts: { done: number; total: number } | undefined;
  if (work !== undefined && work.planPath !== "" && path.isAbsolute(work.planPath) && !path.relative(paths.projectRoot, work.planPath).startsWith("..")) {
    try {
      const stat = await fs.lstat(work.planPath);
      const checklist = stat.isFile() && stat.size <= progressByteLimit ? planChecklist(await fs.readFile(work.planPath, "utf8")) : undefined;
      if (checklist !== undefined) counts = { done: checklist.done, total: checklist.total };
    } catch { // no-excuse-ok: catch -- an unreadable plan leaves the count to the goal ledger.
      // The next source in the chain answers.
    }
  }
  const goal = readActiveGoal(await readSmallJson(paths.goalsFile));
  if (counts === undefined && goal !== undefined && goal.criteria.length > 0) {
    counts = { done: goal.criteria.filter((criterion) => criterion.status === "pass").length, total: goal.criteria.length };
  }
  const phase = skill === "lit-plan" ? "plan" : work !== undefined || counts !== undefined ? "work" : undefined;
  return { ...(phase === undefined ? {} : { phase }), ...(counts ?? {}) };
}

function where(frame: Pick<StackFrame, "phase" | "done" | "total">): string {
  if (frame.phase === undefined) return "";
  return frame.done !== undefined && frame.total !== undefined ? ` at ${frame.phase} ${frame.done}/${frame.total}` : ` at ${frame.phase}`;
}

async function freshStack(projectRoot: string, sessionID: string, now: number): Promise<WorkflowStack> {
  const stack = await readStack(projectRoot, sessionID);
  return stack !== undefined && now - stack.updatedAt <= spineStaleMs ? stack : emptyStack(sessionID);
}

async function persist(projectRoot: string, stack: WorkflowStack): Promise<void> {
  try {
    await writeStack(projectRoot, stack);
  } catch { // no-excuse-ok: catch -- the stack is a convenience record; activation must not fail on it.
    // The in-memory activation still answers this turn.
  }
}

/**
 * Remembers an activation. A spine skill (lit-loop, lit-plan, start-work, lit-task) starts a fresh
 * stack; a side skill started over a running spine pauses it, keeping its stage and counts, and the
 * returned line tells the model and the user how to come back.
 */
export async function recordActivation(input: {
  readonly memory: ActivationMemory;
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly mode: ChatActivationMode;
  readonly now?: number;
}): Promise<{ readonly line?: string }> {
  const now = input.now ?? Date.now();
  let stack = await freshStack(input.projectRoot, input.sessionID, now);
  if (isSpineSkill(input.mode)) {
    input.memory.remember(input.sessionID, input.mode);
    await persist(input.projectRoot, startSpine(stack, input.mode, now));
    return {};
  }
  const remembered = input.memory.active(input.sessionID);
  if (!stack.frames.some((frame) => isSpineSkill(frame.skill)) && remembered !== undefined && isSpineSkill(remembered)) {
    stack = startSpine(stack, remembered, now);
  }
  const spine = stack.frames.find((frame) => isSpineSkill(frame.skill));
  if (spine === undefined) {
    input.memory.remember(input.sessionID, input.mode);
    // A lone side discipline leaves no file of its own; only a stack that already exists is updated.
    if (stack.frames.length > 0) await persist(input.projectRoot, pushSide(stack, input.mode, now, undefined));
    return {};
  }
  const progress = await spineProgress(input.projectRoot, input.sessionID, spine.skill);
  const next = pushSide(stack, input.mode, now, progress);
  await persist(input.projectRoot, next);
  const paused = next.frames[0];
  return { line: `LitOpenCode: ${activationDiscipline(paused.skill)} is paused${where(paused)}. Say lit continue to return to it.` };
}

function resumeNote(frame: StackFrame): string {
  const discipline = activationDiscipline(frame.skill);
  const gate = frame.skill === "lit-plan"
    ? " Stay planning-only: no edits or mutating commands until the user approves the plan and runs /start-work."
    : "";
  return `LitOpenCode: back in ${discipline}${where(frame)}, where it paused. Keeping its criteria, plan and run state; the user's message above is the next instruction. Do not start a new brief, plan or goal.${gate}`;
}

export type ReentryDecision =
  | { readonly kind: "full" }
  | { readonly kind: "continue"; readonly mode: ChatActivationMode; readonly text: string }
  | { readonly kind: "resume"; readonly line: string }
  | { readonly kind: "confirm"; readonly line: string };

export function continueNote(mode: ChatActivationMode): string {
  const discipline = activationDiscipline(mode);
  const gate = mode === "lit-plan"
    ? " Stay planning-only: no edits or mutating commands until the user approves the plan and runs /start-work."
    : "";
  return `LitOpenCode: ${discipline} is already active in this session. Continuing ${discipline}, not restarting it.
The user's message above is the next instruction. Keep the existing criteria, plan and run state; do not start a new brief, plan or goal.${gate}`;
}

const confirmLine =
  'The user sent only "lit" with no task and nothing is in progress. Ask one short question: what should it work on, or did they mean to start a lit-loop? Change nothing until they answer.';

async function resumableWork(projectRoot: string, now: number): Promise<string | undefined> {
  try {
    const plan = await resolveLatestDurablePlan(projectRoot);
    if (plan !== undefined && (plan.expiresAt === undefined || Date.parse(plan.expiresAt) > now)) {
      return `approved plan ${plan.relativePath}`;
    }
  } catch { // no-excuse-ok: catch -- an unreadable plan store means the first-activation path, never a block.
    // Fall through to the lifecycle record, then to the full activation.
  }
  try {
    const state: unknown = JSON.parse(await fs.readFile(createRuntimePaths(projectRoot).lifecycleStateFile, "utf8"));
    if (typeof state === "object" && state !== null && "status" in state && (state.status === "active" || state.status === "paused")) {
      return "start-work record";
    }
  } catch { // no-excuse-ok: catch -- a missing or corrupt lifecycle record is the same as no active work.
    // A corrupt record never resumes anything.
  }
  return undefined;
}

export async function decideReentry(input: {
  readonly memory: ActivationMemory;
  readonly projectRoot: string;
  readonly sessionID: string;
  readonly mode: ChatActivationMode;
  readonly text: string;
  readonly now?: number;
}): Promise<ReentryDecision> {
  if (restartRequest.test(input.text)) return { kind: "full" };
  const now = input.now ?? Date.now();
  const stack = await freshStack(input.projectRoot, input.sessionID, now);
  const paused = stack.frames.find((frame) => isSpineSkill(frame.skill) && frame.status === "paused");
  if (paused !== undefined && (bareLitOrContinue.test(input.text) || input.mode === paused.skill)) {
    const resumed = resumeSpine(stack, now).resumed;
    if (resumed !== undefined) {
      await persist(input.projectRoot, resumeSpine(stack, now).stack);
      input.memory.remember(input.sessionID, resumed.skill as ChatActivationMode);
      return { kind: "continue", mode: resumed.skill as ChatActivationMode, text: resumeNote(resumed) };
    }
  }
  const active = input.memory.active(input.sessionID);
  if (active !== undefined && continuableModes.has(active)) {
    if (bareLitOrContinue.test(input.text)) return { kind: "continue", mode: active, text: continueNote(active) };
    if (input.mode === active) return { kind: "continue", mode: active, text: continueNote(active) };
  }
  if (input.mode !== "lit-task" || !bareLitOrContinue.test(input.text)) return { kind: "full" };
  const work = await resumableWork(input.projectRoot, now);
  if (work !== undefined) {
    return {
      kind: "resume",
      line: `LitOpenCode: resuming existing work (${work}); do not write a new plan. Start-work authority comes only from /start-work, not from this note.`
    };
  }
  return bareLit.test(input.text) ? { kind: "confirm", line: confirmLine } : { kind: "full" };
}
