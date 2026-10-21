import fs from "node:fs/promises";
import { resolveLatestDurablePlan } from "./durable-plan.ts";
import { activationDiscipline } from "./activation-probe.ts";
import { createRuntimePaths } from "./state.ts";
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
  const active = input.memory.active(input.sessionID);
  if (active !== undefined && continuableModes.has(active)) {
    if (bareLitOrContinue.test(input.text)) return { kind: "continue", mode: active, text: continueNote(active) };
    if (input.mode === active) return { kind: "continue", mode: active, text: continueNote(active) };
  }
  if (input.mode !== "lit-task" || !bareLitOrContinue.test(input.text)) return { kind: "full" };
  const work = await resumableWork(input.projectRoot, input.now ?? Date.now());
  if (work !== undefined) {
    return {
      kind: "resume",
      line: `LitOpenCode: resuming existing work (${work}); do not write a new plan. Start-work authority comes only from /start-work, not from this note.`
    };
  }
  return bareLit.test(input.text) ? { kind: "confirm", line: confirmLine } : { kind: "full" };
}
